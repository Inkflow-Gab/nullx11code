// Chat core: streaming completions (SSE) + the agent tool loop.
import { TOOL_SCHEMAS, runTool } from './tools.js';

const MAX_STEPS = 8;

function buildHeaders(prov) {
  const h = { 'content-type': 'application/json', accept: 'text/event-stream' };
  if (prov.apiKey) h.authorization = `Bearer ${prov.apiKey}`;
  return h;
}

/** Parse an SSE byte stream into {type:'delta'|'done'|'error'} events. */
async function* parseSSE(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trimEnd();
      buf = buf.slice(idx + 1);
      if (!line || !line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.error) {
        yield { type: 'error', message: json.error.message || JSON.stringify(json.error) };
        return;
      }
      const choice = json.choices?.[0];
      const delta = choice?.delta || choice?.message || {};
      if (delta.content) yield { type: 'delta', text: delta.content };
      if (delta.tool_calls) yield { type: 'tool_calls', toolCalls: delta.tool_calls };
      if (choice?.finish_reason) yield { type: 'finish', reason: choice.finish_reason, usage: json.usage };
    }
  }
}

/** Non-streaming fallback for endpoints that reject stream:true. */
async function completeOnce(prov, body, signal) {
  const res = await fetch(prov.base.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { ...buildHeaders(prov), accept: 'application/json' },
    body: JSON.stringify({ ...body, stream: false }),
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 400)}` : ''}`);
    err.status = res.status;
    throw err;
  }
  const json = await res.json();
  const msg = json.choices?.[0]?.message || {};
  return { content: msg.content || '', toolCalls: msg.tool_calls || null, usage: json.usage };
}

function mergeToolCalls(acc, incoming) {
  for (const tc of incoming) {
    const i = tc.index ?? acc.length;
    if (!acc[i]) acc[i] = { id: tc.id, type: 'function', function: { name: '', arguments: '' } };
    if (tc.id) acc[i].id = tc.id;
    if (tc.function?.name) acc[i].function.name += tc.function.name;
    if (tc.function?.arguments) acc[i].function.arguments += tc.function.arguments;
  }
}

/**
 * Run one assistant turn against a provider.
 * Yields events:
 *   {type:'delta', text}                 — streaming content
 *   {type:'tool_start', id, name, args}  — about to run a tool
 *   {type:'tool_end', id, name, result}  — tool finished
 *   {type:'approval', action}            — needs approval (ctx.approve decides)
 *   {type:'done', usage, steps}          — turn complete
 *   {type:'error', message}
 */
// Tool names a read-only (plan) or child agent may see.
const READ_ONLY_TOOLS = [
  'list_files', 'read_file', 'grep', 'glob', 'webfetch',
  'todowrite', 'todoread', 'question', 'load_skill',
];

export async function* runTurn({ prov, model, messages, ctx, signal }) {
  let steps = 0;
  let totalUsage = null;
  const depth = ctx.subagentDepth ?? 0;

  // opencode allowTools: restrict which tools this turn's model can see
  let visibleTools = TOOL_SCHEMAS;
  if (Array.isArray(ctx.allowTools)) {
    const allow = new Set(ctx.allowTools);
    visibleTools = TOOL_SCHEMAS.filter((s) => allow.has(s.function.name));
  }

  // child-session factory for the subagent tool (one nesting level max).
  // Object.create keeps getter/setter ctx (todos!) working through the prototype.
  let toolCtx = ctx;
  if (depth < 1 && typeof ctx.subagent !== 'function') {
    const subagent = async ({ description, prompt, agent, model: childModel }) => {
      const childMessages = [
        {
          role: 'system',
          content:
            agent === 'plan'
              ? 'You are a read-only plan subagent. Analyze and produce a plan; never modify files or run commands.'
              : 'You are a subagent of a coding agent. Complete the task independently and answer with the result.',
        },
        { role: 'user', content: `${description}\n\n${prompt}` },
      ];
      const childCtx = Object.assign(Object.create(ctx), {
        subagentDepth: depth + 1,
        allowTools: agent === 'plan' ? READ_ONLY_TOOLS : ctx.allowTools ?? null,
      });
      let out = '';
      let err = null;
      for await (const ev of runTurn({
        prov,
        model: childModel || model,
        messages: childMessages,
        ctx: childCtx,
        signal,
      })) {
        if (ev.type === 'delta') out += ev.text;
        else if (ev.type === 'error') {
          err = ev.message;
          break;
        }
      }
      if (err) return `Subagent failed: ${err}`;
      return `Subagent completed "${description}".\n\nOutput:\n${(out || '(no text output)').slice(0, 30_000)}`;
    };
    toolCtx = Object.assign(Object.create(ctx), { subagent });
  }

  while (steps < MAX_STEPS) {
    steps++;
    const body = {
      model,
      messages,
      stream: true,
      temperature: ctx.temperature ?? 0.7,
      ...(ctx.maxTokens ? { max_tokens: ctx.maxTokens } : {}),
      ...(ctx.tools !== false && visibleTools.length
        ? { tools: visibleTools, tool_choice: 'auto' }
        : {}),
    };

    let deltas = '';
    const toolAcc = [];
    let finish = null;
    let streamErr = null;

    try {
      const res = await fetch(prov.base.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: buildHeaders(prov),
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        streamErr = new Error(`${res.status} ${res.statusText}${text ? ` — ${text.slice(0, 300)}` : ''}`);
      } else {
        for await (const ev of parseSSE(res)) {
          if (ev.type === 'delta') {
            deltas += ev.text;
            yield ev;
          } else if (ev.type === 'tool_calls') {
            mergeToolCalls(toolAcc, ev.toolCalls);
          } else if (ev.type === 'finish') {
            finish = ev;
            if (ev.usage) totalUsage = ev.usage;
          } else if (ev.type === 'error') {
            streamErr = new Error(ev.message);
            break;
          }
        }
      }
    } catch (e) {
      if (signal?.aborted) return;
      streamErr = e;
    }

    // Fallback: retry without streaming.
    if (streamErr && !signal?.aborted) {
      try {
        const res = await completeOnce(prov, body, signal);
        if (res.content && !deltas) {
          // naive chunking so the UI still "streams"
          const chunks = res.content.match(/[\s\S]{1,24}/g) || [];
          for (const ch of chunks) {
            deltas += ch;
            yield { type: 'delta', text: ch };
          }
        }
        if (res.toolCalls) mergeToolCalls(toolAcc, res.toolCalls);
        if (res.usage) totalUsage = res.usage;
        streamErr = null;
      } catch (e2) {
        if (signal?.aborted) return;
        yield { type: 'error', message: e2.message || String(e2) };
        return;
      }
    }

    const toolCalls = toolAcc.filter((t) => t?.function?.name).map((t) => {
      let args = {};
      try {
        args = JSON.parse(t.function.arguments || '{}');
      } catch {
        args = { _raw: t.function.arguments };
      }
      return { id: t.id || `call_${Math.random().toString(36).slice(2)}`, name: t.function.name, args };
    });

    messages.push({
      role: 'assistant',
      content: deltas || null,
      ...(toolCalls.length
        ? {
            tool_calls: toolCalls.map((t) => ({
              id: t.id,
              type: 'function',
              function: { name: t.name, arguments: JSON.stringify(t.args) },
            })),
          }
        : {}),
    });

    if (!toolCalls.length) {
      yield { type: 'done', usage: totalUsage, steps };
      return;
    }

    for (const tc of toolCalls) {
      yield { type: 'tool_start', id: tc.id, name: tc.name, args: tc.args };
      let result;
      try {
        result = await runTool(tc.name, tc.args, toolCtx);
      } catch (e) {
        result = `Tool error: ${e.message || e}`;
      }
      yield { type: 'tool_end', id: tc.id, name: tc.name, result: String(result).slice(0, 60_000) };
      messages.push({ role: 'tool', tool_call_id: tc.id, content: String(result).slice(0, 60_000) });
    }
    // loop continues for the next assistant turn
  }

  yield { type: 'error', message: `Stopped after ${MAX_STEPS} agent steps (loop guard).` };
}
