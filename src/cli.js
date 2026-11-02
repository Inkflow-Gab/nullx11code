// Interactive terminal REPL: streaming chat, slash commands, tool approvals.
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { c, hex, banner, modelBadge, providerBadge, md, Spinner, setColors, colorsEnabled, width, familyChip } from './ui.js';
import { loadConfig, VERSION, projectDir } from './config.js';
import { allProviders, resolveProvider, listModels, guessModel } from './providers.js';
import { discoverSkills, skillsPrompt, suggestSkills } from './skills.js';
import { createSession, saveSession, loadSession } from './sessions.js';
import { runTurn } from './chat.js';
import { COMMANDS, findCommand, completeCommand } from './commands.js';
import { actionSummary } from './tools.js';

const BASE_PROMPT = (root, provName) => `You are nullx11code, a concise AI coding agent running in the user's terminal (also usable from mobile terminals like Termux).
Project root: ${root}
Provider in use: ${provName}.
Rules:
- Prefer short, direct answers. Use markdown sparingly.
- When file context is unknown, use the available tools (list_files, read_file, grep) instead of guessing.
- Use write_file / shell only when the task requires it — the user approves each one.
- Paths you receive are relative to the project root.
- If a tool result says the user rejected an action, do not retry it; ask what they prefer instead.`;

/** Incremental markdown renderer: whole lines only, safe for streaming. */
class StreamRenderer {
  constructor() {
    this.buf = '';
    this.inCode = false;
  }
  push(text) {
    this.buf += text;
    let idx;
    let out = '';
    while ((idx = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 1);
      out += this.renderLine(line) + '\n';
    }
    if (out) process.stdout.write(out);
  }
  renderLine(line) {
    if (/^\s*```/.test(line)) {
      this.inCode = !this.inCode;
      return c.gray(line || '```');
    }
    if (this.inCode) return '  ' + c.white(line);
    return md(line, width());
  }
  end() {
    if (this.buf) {
      process.stdout.write(this.renderLine(this.buf));
      this.buf = '';
    }
    process.stdout.write('\n');
  }
}

export async function runInteractive(opts = {}) {
  const cwd = process.cwd();
  const cfg = loadConfig(cwd);
  if (opts.noColor) setColors(false);

  const prov = resolveProvider(cfg, opts.provider);
  const models = await listModels(prov, cfg);
  let model = opts.model && opts.model !== 'auto' ? opts.model : cfg.model && cfg.model !== 'auto' ? cfg.model : guessModel(prov, models);

  const settings = {
    stream: true,
    approveShell: cfg.approvals?.shell !== false,
    approveWrite: cfg.approvals?.write !== false,
    colors: colorsEnabled(),
    autoApproveShell: !!opts.yes,
    autoApproveWrite: !!opts.yes,
  };

  const state = {
    cfg,
    cwd,
    root: cfg._root,
    prov,
    model,
    models,
    skills: [],
    session: null,
    messages: [],
    settings,
    quitting: false,
  };

  state.refreshSkills = () => {
    state.skills = discoverSkills(cfg, cwd);
  };
  state.systemPrompt = () => {
    const skills = skillsPrompt(state.skills);
    return [BASE_PROMPT(state.root, prov.name), cfg.systemPrompt || '', skills].filter(Boolean).join('\n\n');
  };
  state.newSession = () => {
    state.session = createSession({ provider: prov.id, model, cwd, project: true });
    state.messages = [{ role: 'system', content: state.systemPrompt() }];
  };
  state.cmd = async (name, args) => {
    const cmd = findCommand(name);
    if (!cmd) return `Unknown command: ${name}`;
    try {
      return (await cmd.run(state, args)) ?? null;
    } catch (e) {
      return c.red(`error: ${e.message}`);
    }
  };
  state.quit = () => {
    state.quitting = true;
  };
  state.clearScreen = () => {};

  state.refreshSkills();
  state.newSession();
  if (opts.resume) {
    const s = opts.resume === true ? null : loadSession(opts.resume, { cwd });
    if (s) {
      state.session = s;
      state.messages = [{ role: 'system', content: state.systemPrompt() }, ...(s.messages || [])];
    }
  }

  // ---- banner ----
  if (process.stdout.isTTY) {
    console.log(
      banner({
        prov,
        model,
        skills: state.skills.filter((s) => s.enabled).length,
        providers: allProviders(cfg).filter((p) => p.detected).length,
      })
    );
    const enabledSkills = state.skills.filter((s) => s.enabled);
    if (enabledSkills.length) {
      console.log(`  ${c.dim('skills')} ${enabledSkills.map((s) => hex(s.name, '#76B900')).join(c.dim(', '))}`);
    }
    const undetected = allProviders(cfg).filter((p) => !p.detected && !p.local);
    if (!allProviders(cfg).some((p) => p.detected)) {
      console.log(`  ${c.yellow('!')} ${c.dim('no API keys yet — free: put NVIDIA_API_KEY=… in .env, then /doctor')}`);
    } else if (undetected.length) {
      console.log(`  ${c.dim('keys missing:')} ${c.dim(undetected.slice(0, 6).map((p) => p.id).join(', '))}`);
    }
    console.log('');
  }

  // ---- approval plumbing ----
  let pendingApproval = null; // { resolve }
  let rl = null;

  const askApproval = (action) => {
    if (!process.stdin.isTTY) {
      // non-interactive: allow reads only
      return Promise.resolve(action.kind === 'read' || action.kind === 'list' || action.kind === 'grep');
    }
    return new Promise((resolve) => {
      const kindOn = action.kind === 'shell' ? settings.autoApproveShell : action.kind === 'write' ? settings.autoApproveWrite : false;
      if (kindOn) {
        console.log(c.dim(`  auto-approved (${action.kind})`));
        resolve(true);
        return;
      }
      console.log('');
      console.log(c.yellow('  ┌─ approval needed ') + c.yellow('─'.repeat(Math.max(4, width() - 24))));
      for (const l of actionSummary(action).split('\n')) {
        console.log(c.yellow('  │ ') + l);
      }
      console.log(c.yellow('  └') + c.gray('─'.repeat(Math.max(4, width() - 6))));
      console.log(`  ${c.bold('[y]')}es  ${c.bold('[n]')}o  ${c.bold('[a]')}lways (${action.kind})  ${c.bold('[q]')}uit? `, '');
      rl?.resume();
      pendingApproval = {
        resolve: (answer) => {
          pendingApproval = null;
          const a = String(answer || '').trim().toLowerCase();
          if (a === 'a' || a === 'always') {
            if (action.kind === 'shell') settings.autoApproveShell = true;
            if (action.kind === 'write') settings.autoApproveWrite = true;
            resolve(true);
          } else if (a === 'q') {
            state.quitting = true;
            resolve(false);
          } else {
            resolve(a === 'y' || a === 'yes');
          }
        },
      };
    });
  };

  // ---- main loop ----
  const rlInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
    completer: (line) => {
      if (!line.startsWith('/')) return [[], line];
      const parts = line.split(/\s+/);
      if (parts.length === 1) {
        const hits = completeCommand(parts[0]);
        return [hits.length ? hits : [], line];
      }
      if (/^\/(model|provider|skill)/.test(parts[0])) {
        const pool =
          parts[0] === '/model'
            ? state.models.map((m) => m.id)
            : parts[0] === '/provider'
              ? allProviders(state.cfg).map((p) => p.id)
              : state.skills.map((s) => s.name);
        const hits = pool.filter((x) => x.startsWith(parts[parts.length - 1]));
        return [hits, line];
      }
      return [[], line];
    },
  });
  rl = rlInterface;

  const promptLine = () => {
    const badge = hex('❯', '#76B900');
    process.stdout.write(`${badge} `);
  };

  const printAssistantHeader = () => {
    console.log('');
    console.log(`  ${modelBadge(state.prov, state.model)}`);
    console.log('');
  };

  const persist = () => {
    try {
      const s = state.session;
      s.messages = state.messages.filter((m) => m.role !== 'system');
      s.updatedAt = new Date().toISOString();
      s.provider = state.prov.id;
      s.model = state.model;
      if (!s.title) {
        const firstUser = s.messages.find((m) => m.role === 'user');
        if (firstUser?.content) s.title = String(firstUser.content).replace(/\s+/g, ' ').slice(0, 60);
      }
      saveSession(s, { project: true, cwd });
    } catch {
      /* sessions are best-effort */
    }
  };

  let busy = false;
  let abort = null;

  const handleUserInput = async (raw) => {
    const text = raw.trim();
    if (!text) {
      promptLine();
      return;
    }

    if (text.startsWith('/')) {
      const [head, ...rest] = text.split(/\s+/);
      const cmd = findCommand(head);
      if (cmd) {
        const out = await state.cmd(head, rest.join(' '));
        if (out) console.log('\n' + out + '\n');
        if (state.quitting) {
          rlInterface.close();
          return;
        }
        promptLine();
        return;
      }
      if (head.length > 1) {
        console.log(c.dim(`  unknown command ${head} — try /help`));
        promptLine();
        return;
      }
    }

    // ---- chat turn ----
    busy = true;
    abort = new AbortController();
    state.messages.push({ role: 'user', content: text });

    // skill suggestion hint
    const hints = suggestSkills(state.skills, text);
    if (hints.length) {
      console.log(c.dim(`  💡 skill "${hints[0].name}" may apply — /skills on ${hints[0].name}`));
    }

    printAssistantHeader();
    const renderer = new StreamRenderer();
    const spinner = settings.stream ? new Spinner('thinking…') : null;
    let anyText = false;
    let err = null;

    try {
      for await (const ev of runTurn({
        prov: state.prov,
        model: state.model,
        messages: state.messages,
        ctx: {
          root: state.root,
          cwd: state.cwd,
          temperature: state.cfg.temperature,
          maxTokens: state.cfg.maxTokens,
          approve: askApproval,
        },
        signal: abort.signal,
      })) {
        if (ev.type === 'delta') {
          if (!anyText) {
            spinner?.stop();
            anyText = true;
          }
          renderer.push(ev.text);
        } else if (ev.type === 'tool_start') {
          if (!anyText) spinner?.stop();
          const argStr = Object.entries(ev.args || {})
            .filter(([k]) => k !== 'content')
            .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
            .join(' ');
          console.log(c.dim(`  ⚙ ${ev.name} ${c.bold(argStr)}`));
        } else if (ev.type === 'tool_end') {
          const firstLine = String(ev.result).split('\n')[0].slice(0, 100);
          console.log(c.dim(`    → ${firstLine}`));
        } else if (ev.type === 'error') {
          spinner?.stop();
          err = ev.message;
        } else if (ev.type === 'done') {
          spinner?.stop();
        }
      }
    } catch (e) {
      spinner?.stop();
      err = e.message || String(e);
    }

    if (anyText) renderer.end();
    if (err) {
      console.log('');
      console.log(c.red(`  ✗ ${err}`));
      if (/401|403/.test(err)) console.log(c.dim('    hint: check the API key (.env / /providers)'));
      if (/ECONNREFUSED|ENOTFOUND|fetch failed|timed? ?out/i.test(err)) {
        console.log(c.dim('    hint: network issue or local server down — try /doctor'));
      }
    }
    console.log('');
    persist();
    busy = false;
    abort = null;
    if (state.quitting) {
      rlInterface.close();
      return;
    }
    promptLine();
  };

  // serialize all input handling (chat turns AND commands) so rapid/piped lines can't race
  let queue = Promise.resolve();
  const enqueue = (line) => {
    queue = queue.then(() => handleUserInput(line)).catch((e) => {
      console.log(c.red(String(e?.message || e)));
      promptLine();
    });
  };

  rlInterface.on('line', (line) => {
    if (pendingApproval) {
      pendingApproval.resolve(line);
      return;
    }
    enqueue(line);
  });

  rlInterface.on('close', () => {
    if (busy && abort) abort.abort();
    console.log('');
    console.log(c.dim('  bye — session saved. 👋'));
    persist();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    if (busy && abort) {
      abort.abort();
      console.log(c.dim('\n  (interrupted)'));
      busy = false;
      abort = null;
      promptLine();
    } else {
      rlInterface.close();
    }
  });

  if (opts.prompt) {
    // initial prompt given on the command line
    await handleUserInput(opts.prompt);
    if (!process.stdin.isTTY) {
      // piped stdin: keep reading until EOF
      let buf = '';
      for await (const chunk of process.stdin) {
        buf += chunk;
      }
      if (buf.trim()) await handleUserInput(buf);
      rlInterface.close();
    }
  } else {
    promptLine();
  }

  return state;
}

/** One-shot non-interactive run (print mode). */
export async function runPrint(prompt, opts = {}) {
  const cwd = process.cwd();
  const cfg = loadConfig(cwd);
  if (opts.noColor) setColors(false);
  const prov = resolveProvider(cfg, opts.provider);
  const models = await listModels(prov, cfg);
  const model = opts.model && opts.model !== 'auto' ? opts.model : guessModel(prov, models);
  const skills = discoverSkills(cfg, cwd);

  const messages = [
    { role: 'system', content: [BASE_PROMPT(cfg._root, prov.name), skillsPrompt(skills)].filter(Boolean).join('\n\n') },
    { role: 'user', content: prompt },
  ];

  let out = '';
  let err = null;
  for await (const ev of runTurn({
    prov,
    model,
    messages,
    ctx: {
      root: cfg._root,
      cwd,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
      tools: opts.tools !== false,
      // print mode: auto-approve nothing mutating
      approve: async (action) => (action.kind === 'shell' && opts.yes ? true : false),
    },
    signal: opts.signal,
  })) {
    if (ev.type === 'delta') {
      out += ev.text;
      if (process.stdout.isTTY) process.stdout.write(ev.text);
    } else if (ev.type === 'error') err = ev.message;
    else if (ev.type === 'tool_start' && process.stderr.isTTY) {
      process.stderr.write(c.dim(`\n[tool] ${ev.name} `) + Object.entries(ev.args || {}).map(([k, v]) => `${k}=${String(v).slice(0, 50)}`).join(' '));
    }
  }
  if (process.stdout.isTTY && out) process.stdout.write('\n');
  if (err) throw new Error(err);
  if (!process.stdout.isTTY) process.stdout.write(out + '\n');
  return out;
}
