// End-to-end: mock OpenAI-compatible server → runTurn streaming + tool loop + approval.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTurn } from '../src/chat.js';
import { setColors } from '../src/ui.js';

setColors(false);

function sse(obj) {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/**
 * Mock provider.
 * mode 'tool-then-text': first call → tool_call, second → final text (streamed)
 * mode 'no-stream': rejects stream:true with 400, answers stream:false with plain JSON
 * mode 'gate-tool': like tool-then-text but the tool is shell (approval-gated)
 */
function startMock(mode = 'tool-then-text') {
  let calls = 0;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls++;
      const parsed = JSON.parse(body || '{}');

      if (mode === 'no-stream') {
        if (parsed.stream) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'streaming not supported here' } }));
        } else {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'fallback works' } }], usage: { total_tokens: 5 } }));
        }
        return;
      }

      if (!parsed.stream) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: 'unexpected non-stream' } }] }));
        return;
      }

      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (calls === 1) {
        const toolName = mode === 'gate-tool' ? 'shell' : 'read_file';
        const toolArgs = mode === 'gate-tool' ? { command: 'echo hi' } : { path: 'demo.txt' };
        res.write(sse({ choices: [{ delta: { content: 'Let me check. ' } }] }));
        res.write(
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, id: 'call_1', function: { name: toolName, arguments: JSON.stringify(toolArgs) } },
                  ],
                },
              },
            ],
          })
        );
        res.write(sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { total_tokens: 42 } }));
      } else {
        res.write(sse({ choices: [{ delta: { content: 'The file says hello.' } }] }));
        res.write(sse({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 77 } }));
      }
      res.write('data: [DONE]\n\n');
      res.end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        calls: () => calls,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections?.();
            server.close(() => r());
          }),
      });
    });
  });
}

function makeTmp() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n11-e2e-'));
  fs.writeFileSync(path.join(tmp, 'demo.txt'), 'hello');
  return tmp;
}

test('runTurn: streams text, runs tool loop, yields events in order', async () => {
  const mock = await startMock('tool-then-text');
  const tmp = makeTmp();
  try {
    const prov = { id: 'mock', name: 'Mock', base: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'k', color: '#fff' };
    const messages = [
      { role: 'system', content: 'test' },
      { role: 'user', content: 'read demo.txt' },
    ];
    const events = [];

    for await (const ev of runTurn({
      prov,
      model: 'mock-1',
      messages,
      ctx: { root: tmp, cwd: tmp, approve: async () => true },
    })) {
      events.push(ev);
    }

    const types = events.map((e) => e.type);
    assert.ok(types.includes('delta'), 'has deltas');
    assert.equal(types.filter((t) => t === 'tool_start').length, 1, 'one tool_start');
    assert.equal(types.filter((t) => t === 'tool_end').length, 1, 'one tool_end');
    assert.equal(types.at(-1), 'done', 'ends with done');

    const start = events.find((e) => e.type === 'tool_start');
    assert.equal(start.name, 'read_file');
    assert.equal(start.args.path, 'demo.txt');
    const end = events.find((e) => e.type === 'tool_end');
    assert.match(end.result, /1\|hello/, 'tool result has numbered line');

    const done = events.at(-1);
    assert.equal(done.steps, 2, 'two model calls');
    assert.equal(done.usage.total_tokens, 77);

    assert.equal(messages.at(-1).role, 'assistant');
    assert.ok(messages.some((m) => m.role === 'tool'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    await mock.close();
  }
});

test('runTurn: non-stream fallback when stream:true is rejected', async () => {
  const mock = await startMock('no-stream');
  try {
    const prov = { id: 'mock', name: 'Mock', base: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'k', color: '#fff' };
    let text = '';
    let done = null;
    for await (const ev of runTurn({
      prov,
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      ctx: { root: process.cwd(), cwd: process.cwd(), tools: false },
    })) {
      if (ev.type === 'delta') text += ev.text;
      if (ev.type === 'done') done = ev;
      if (ev.type === 'error') assert.fail(ev.message);
    }
    assert.equal(text, 'fallback works');
    assert.ok(done);
  } finally {
    await mock.close();
  }
});

test('runTurn: approval rejection is reported to the model', async () => {
  const mock = await startMock('gate-tool');
  const tmp = makeTmp();
  try {
    const prov = { id: 'mock', name: 'Mock', base: `http://127.0.0.1:${mock.port}/v1`, apiKey: 'k', color: '#fff' };
    const messages = [{ role: 'user', content: 'go' }];
    let approvalAsked = false;
    const events = [];
    for await (const ev of runTurn({
      prov,
      model: 'm',
      messages,
      ctx: {
        root: tmp,
        cwd: tmp,
        approve: async (action) => {
          approvalAsked = true;
          assert.equal(action.kind, 'shell');
          return false; // user rejects
        },
      },
    })) {
      events.push(ev);
    }
    assert.ok(approvalAsked, 'approve() was invoked for shell');
    const toolMsg = messages.find((m) => m.role === 'tool');
    assert.ok(toolMsg, 'tool message appended');
    assert.match(toolMsg.content, /rejected/i);
    assert.ok(events.some((e) => e.type === 'tool_end'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
    await mock.close();
  }
});
