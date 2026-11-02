// Interactive terminal REPL: streaming chat, slash commands, tool approvals.
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { c, hex, banner, modelBadge, providerBadge, md, Spinner, setColors, colorsEnabled, width, familyChip } from './ui.js';
import { loadConfig, VERSION, projectDir, loadInstructions } from './config.js';
import { allProviders, resolveProvider, listModels, guessModel } from './providers.js';
import { discoverSkills, skillsPrompt, suggestSkills } from './skills.js';
import { createSession, saveSession, loadSession } from './sessions.js';
import { runTurn } from './chat.js';
import { COMMANDS, findCommand, completeCommand } from './commands.js';
import { discoverExtras, renderExtra, resolveInvocation, commandEntries } from './extracmds.js';
import { actionSummary } from './tools.js';
import { evaluate, actionForKind } from './permissions.js';
import { expandMentions, buildContent } from './mentions.js';
import { checkForUpdate, runInstaller } from './update.js';

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
    agent: 'build', // opencode-style: build (full) | plan (read-only)
    todos: [], // todowrite/todoread state for the session
  };

  state.refreshSkills = () => {
    state.skills = discoverSkills(cfg, cwd);
  };
  state.extras = [];
  state.refreshExtras = () => {
    state.extras = discoverExtras(cfg, cwd);
  };
  state.systemPrompt = () => {
    const skills = skillsPrompt(state.skills);
    const instructions = loadInstructions(state.root)
      .map((f) => `# Instructions from ${path.relative(state.root, f.path) || f.path}\n\n${f.text}`)
      .join('\n\n');
    const planNote =
      state.agent === 'plan'
        ? 'You are in PLAN mode: read-only analysis. Do not call write_file or shell — reason and report instead.'
        : '';
    return [BASE_PROMPT(state.root, prov.name), instructions, planNote, cfg.systemPrompt || '', skills]
      .filter(Boolean)
      .join('\n\n');
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

  state.refreshSkills();
  state.refreshExtras();
  state.newSession();
  if (opts.resume) {
    const s = opts.resume === true ? null : loadSession(opts.resume, { cwd });
    if (s) {
      state.session = s;
      state.messages = [{ role: 'system', content: state.systemPrompt() }, ...(s.messages || [])];
    }
  }

  // ---- header (printed on launch and after /clear, like opencode) ----
  const printHeader = () => {
    console.log(
      banner({
        prov: state.prov,
        model: state.model,
        skills: state.skills.filter((s) => s.enabled).length,
        providers: allProviders(cfg).filter((p) => p.detected).length,
      })
    );
    const enabledSkills = state.skills.filter((s) => s.enabled);
    if (enabledSkills.length) {
      console.log(`  ${c.dim('skills')} ${enabledSkills.map((s) => hex(s.name, '#76B900')).join(c.dim(', '))}`);
    }
    if (state.extras.length) {
      console.log(`  ${c.dim('commands')} ${state.extras.map((x) => hex('/' + x.name, '#4E8CFF')).join(c.dim(', '))} ${c.dim('— .nullx11/*.md')}`);
    }
    const undetected = allProviders(cfg).filter((p) => !p.detected && !p.local);
    if (!allProviders(cfg).some((p) => p.detected)) {
      console.log(`  ${c.yellow('!')} ${c.dim('no API keys yet — free: /setup nvidia <key> or put NVIDIA_API_KEY=… in .env')}`);
    } else if (undetected.length) {
      console.log(`  ${c.dim('keys missing:')} ${c.dim(undetected.slice(0, 6).map((p) => p.id).join(', '))}`);
    }
    console.log('');
  };
  state.clearScreen = () => {
    if (process.stdout.isTTY) {
      process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
      printHeader();
    }
  };

  // ---- launch: clear the window like opencode, then print the header ----
  if (process.stdout.isTTY) {
    process.stdout.write('\x1b[2J\x1b[3J\x1b[H'); // clear screen + scrollback + home
    printHeader();
  }

  // ---- approval plumbing (opencode: rules → session always → prompt) ----
  let pendingApproval = null; // { resolve }
  let pendingQuestion = null; // { q, resolve }
  let pendingUpdate = null; // { resolve } — launch-time update question
  let rl = null;

  const askApproval = (action) => {
    // plan agent: deny mutations outright (opencode plan-mode behavior)
    if (state.agent === 'plan' && (action.kind === 'write' || action.kind === 'shell')) {
      console.log(c.dim(`  denied (plan agent): ${action.title} — switch with /agent build`));
      return Promise.resolve(false);
    }
    // permission rules from config (deny > allow > default)
    const permAction = actionForKind(action.kind);
    const effect = evaluate(permAction, action.resource ?? '*', state.cfg.permissions);
    if (effect === 'deny') {
      console.log(c.dim(`  denied by rule: ${permAction} ${action.resource ?? ''}`));
      return Promise.resolve(false);
    }
    if (effect === 'allow') {
      console.log(c.dim(`  allowed by rule (${permAction}${action.resource && action.resource !== '*' ? ' ' + action.resource : ''})`));
      return Promise.resolve(true);
    }
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
      rl?.setPrompt(''); // no stray prompt glyph while answering
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
            // persist like opencode's "always" → a lasting allow rule
            try {
              const perms = state.cfg.permissions || { default: 'ask', rules: [] };
              state.cfg.permissions = {
                ...perms,
                rules: [...(perms.rules || []), { action: permAction, resource: '*', effect: 'allow' }],
              };
              import('./config.js').then(({ saveProjectConfig }) =>
                saveProjectConfig({ permissions: state.cfg.permissions }, state.cwd)
              );
            } catch {
              /* config save is best-effort */
            }
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

  // ---- question tool (opencode question/answer flow) ----
  const askOneQuestion = (q) =>
    new Promise((resolve) => {
      rl?.setPrompt(''); // no stray prompt glyph while answering
      console.log('');
      console.log(c.cyan(`  ? ${q.question}`));
      (q.options || []).forEach((o, i) => console.log(`    ${c.bold(String(i + 1))}. ${o}`));
      console.log(c.dim(`    t. type your own${q.multiple ? '  ·  separate multiple with commas' : ''}  ·  q. skip`));
      console.log(`  ${c.bold('answer')}: `, '');
      rl?.resume();
      pendingQuestion = { q, resolve };
    });

  const parseQuestionAnswer = (q, line) => {
    const raw = String(line || '').trim();
    if (!raw || raw.toLowerCase() === 'q') return null;
    const options = q.options || [];
    const picks = raw
      .split(/[,\s]+/)
      .filter(Boolean)
      .map((t) => {
        if (/^\d+$/.test(t) && options[Number(t) - 1]) return options[Number(t) - 1];
        if (t.toLowerCase() === 't') return null;
        return t;
      })
      .filter((v) => v != null);
    if (picks.length) return picks;
    return [raw.replace(/^[t,?\s]+/, '') || raw];
  };

  const askQuestions = async (questions) => {
    if (!process.stdin.isTTY) return null;
    const answers = [];
    for (const q of questions.slice(0, 6)) {
      const a = await askOneQuestion(q);
      if (a == null) return null;
      answers.push(a);
    }
    return answers;
  };

  // ---- main loop ----
  const describeCommandName = (n) => {
    const bare = n.replace(/^\//, '');
    const b = COMMANDS.find((x) => x.name === bare);
    if (b) return b.desc || '';
    const e = state.extras.find((x) => x.name === bare);
    return e?.description || '';
  };

  // project file list for @mentions popup (built once, capped)
  let fileListCache = null;
  const projectFileList = () => {
    if (fileListCache) return fileListCache;
    const out = [];
    const ignore = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next', '.cache', '__pycache__', '.venv', 'coverage']);
    const walk = (dir, rel, depth) => {
      if (depth < 0 || out.length >= 8000) return;
      let entries = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (out.length >= 8000) return;
        if (ignore.has(e.name)) continue;
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r, depth - 1);
        else if (e.isFile()) out.push(r);
      }
    };
    walk(state.root, '', 6);
    fileListCache = out;
    return out;
  };

  const filePopupHits = (prefix) => {
    const p = prefix.toLowerCase();
    const all = projectFileList();
    const starts = all.filter((f) => f.toLowerCase().startsWith(p)).slice(0, 6);
    const pool = starts.length ? starts : all.filter((f) => f.toLowerCase().includes(p)).slice(0, 6);
    return pool.map((f) => {
      let size = '';
      try {
        const kb = fs.statSync(path.join(state.root, f)).size / 1024;
        size = kb >= 1024 ? `${(kb / 1024).toFixed(1)}MB` : `${kb.toFixed(1)}kB`;
      } catch {
        /* race */
      }
      return { label: '@' + f, desc: size };
    });
  };

  const commandPopupHits = (line) => {
    const head = line.split(/\s+/)[0] || '/';
    if (head.includes(' ') || line.trimEnd() !== line) return [];
    const lower = head.toLowerCase();
    const names = [
      ...COMMANDS.map((x) => '/' + x.name),
      ...state.extras.map((x) => '/' + x.name),
    ].filter((n, i, a) => a.indexOf(n) === i && n.startsWith(lower));
    return names.slice(0, 6).map((n) => ({ label: n, desc: describeCommandName(n) }));
  };

  // ---- live completion popup (opencode-style palette) ----
  // math: input row R, cursor col C = rl.getCursorPos().cols (includes prompt width).
  // show writes rows at R+1.. via \r\n then moves back up; hide clears from the row
  // below the input down (never touching the input row) and restores (R, C).
  let popupRows = 0;
  const hidePopup = () => {
    if (!popupRows || !process.stdout.isTTY || !rl) {
      popupRows = 0;
      return;
    }
    const C = rl.getCursorPos().cols;
    process.stdout.write(`\x1b[1B\r\x1b[0J\x1b[1A\x1b[${C}C`);
    popupRows = 0;
  };
  const showPopup = (items) => {
    if (!process.stdout.isTTY || busy || pendingApproval || pendingQuestion) return;
    hidePopup();
    if (!items?.length) return;
    if (rl.cursor !== rl.line.length) return; // only when typing at the end
    const cols = process.stdout.columns || 80;
    const C = rl.getCursorPos().cols;
    if (C >= cols - 12) return; // don't fight wrapped input
    const rows = items.slice(0, 6);
    const body = rows
      .map((it) => {
        const label = String(it.label).padEnd(24).slice(0, 24);
        const desc = c.dim(String(it.desc || '').slice(0, Math.max(10, cols - 34)));
        return `  ${hex(label, '#4E8CFF')}${desc}`;
      })
      .join('\r\n');
    process.stdout.write('\r\n' + body);
    popupRows = rows.length;
    process.stdout.write(`\x1b[${popupRows}A\r\x1b[${C}C`);
  };

  // runs BEFORE readline's internal key handler (registration order) so the popup
  // is always gone before any internal refresh does its own clearScreenDown
  process.stdin.on('keypress', hidePopup);
  process.stdout.on('resize', () => {
    popupRows = 0;
  });

  const rlInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
    completer: (line) => {
      // @file completion
      const at = line.match(/(?:^|\s)@([\w./-]*)$/);
      if (at && !line.startsWith('/')) {
        const hits = filePopupHits(at[1]);
        if (hits.length === 1) return [[hits[0].label], line];
        if (hits.length > 1) {
          showPopup(hits);
          return [[], line];
        }
        return [[], line];
      }
      if (!line.startsWith('/')) return [[], line];
      const parts = line.split(/\s+/);
      if (parts.length === 1) {
        const hits = completeCommand(parts[0]);
        const extraHits = state.extras
          .map((x) => '/' + x.name)
          .filter((n) => n.startsWith(parts[0].toLowerCase()));
        const merged = [...new Set([...hits, ...extraHits])];
        if (merged.length === 1) return [[merged[0]], line];
        if (merged.length > 1) {
          showPopup(merged.map((n) => ({ label: n, desc: describeCommandName(n) })));
          return [[], line];
        }
        return [[], line];
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
    // opencode-style status footer above the prompt
    if (process.stdout.isTTY) {
      const chars = state.messages.reduce((n, m) => n + (typeof m.content === 'string' ? m.content.length : 0), 0);
      const tok = Math.round(chars / 4);
      console.log(
        c.dim(
          `  ${state.prov.id}/${state.model} · ${state.agent} · ~${tok} tok · ${state.messages.filter((m) => m.role !== 'system').length} msgs` +
            (state.todos.filter((t) => t.status === 'in_progress').length
              ? ` · ${state.todos.filter((t) => t.status === 'in_progress').length} in progress`
              : '')
        )
      );
    }
    // native readline prompt (ANSI-aware width → correct cursor math for the popup)
    rl.setPrompt(hex('❯', '#76B900') + ' ');
    rl.prompt();
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
        const rawTitle = Array.isArray(firstUser?.content)
          ? firstUser.content.find((p) => p.type === 'text')?.text
          : firstUser?.content;
        if (rawTitle) s.title = String(rawTitle).replace(/\s+/g, ' ').slice(0, 60);
      }
      saveSession(s, { project: true, cwd });
    } catch {
      /* sessions are best-effort */
    }
  };

  let busy = false;
  let abort = null;

  const handleUserInput = async (raw) => {
    let text = raw.trim();
    if (!text) {
      promptLine();
      return;
    }

    if (text.startsWith('/')) {
      const [head, ...rest] = text.split(/\s+/);
      const args = rest.join(' ');
      const bare = head.slice(1); // strip leading slash
      const entries = commandEntries(COMMANDS, state.extras);
      const res = resolveInvocation(entries, bare);

      if (res.kind === 'ambiguous') {
        // e.g. /ex → several candidates: show them as previews
        console.log('');
        for (const cand of res.candidates) {
          const tag = cand.kind === 'extra' ? hex('/' + cand.name, '#4E8CFF') : c.cyan('/' + cand.name);
          console.log(`  ${tag}  ${c.dim(cand.description || '')}`);
        }
        console.log(c.dim(`  ${res.candidates.length} matches for ${head} — be more specific`));
        promptLine();
        return;
      }

      if (res.kind === 'unique' && !res.exact) {
        // prefix peek: /ex → /extra  (show the resolved preview, then run it)
        const m = res.match;
        const tag = m.kind === 'extra' ? hex('/' + m.name, '#4E8CFF') : c.cyan('/' + m.name);
        console.log(c.dim(`  → ${tag}${m.description ? c.dim('  ' + m.description) : ''} ${c.dim(`(from ${head})`)}`));
      }

      if (res.kind === 'exact' || res.kind === 'unique') {
        const m = res.match;
        if (m.kind === 'builtin') {
          const out = await state.cmd(m.name, args);
          // commands may return { prompt } to run as a chat turn (opencode /init, /review)
          if (out && typeof out === 'object' && out.prompt) {
            text = out.prompt;
          } else {
            if (out) console.log('\n' + out + '\n');
            if (state.quitting) {
              rlInterface.close();
              return;
            }
            promptLine();
            return;
          }
        } else {
          // extra command → expand $ARGUMENTS / $1.. / !`shell` and send as a chat turn
          const expanded = renderExtra(m.ref, args, { root: state.root });
          console.log(c.dim(`  > /${m.name} ${args ? c.dim('· ' + args) : ''}`));
          text = expanded;
        }
      } else if (head.length > 1) {
        console.log(c.dim(`  unknown command ${head} — try /help${state.extras.length ? ' or /' + state.extras[0].name : ''}`));
        promptLine();
        return;
      }
    }

    // ---- chat turn ----
    // @file mentions (opencode-style): inline text files, attach images
    let images = [];
    if (!text.startsWith('/')) {
      const mentioned = expandMentions(text, state.root);
      text = mentioned.text;
      images = mentioned.images;
      if (mentioned.files.length) {
        console.log(c.dim(`  @ attached ${mentioned.files.join(', ')}`));
      }
      if (images.length) {
        console.log(c.dim(`  @ attached image ${images.map((i) => i.rel).join(', ')}`));
      }
    }

    busy = true;
    abort = new AbortController();
    state.messages.push({ role: 'user', content: buildContent(text, images) });

    // skill suggestion hint
    const hints = suggestSkills(state.skills, text);
    if (hints.length) {
      console.log(c.dim(`  i skill "${hints[0].name}" may apply — /skills on ${hints[0].name}`));
    }

    printAssistantHeader();
    const renderer = new StreamRenderer();
    const spinner = settings.stream ? new Spinner('thinking…') : null;
    const turnStart = Date.now();
    let anyText = false;
    let err = null;
    let turnStats = null;

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
          askQuestions,
          skills: state.skills,
          get todos() {
            return state.todos;
          },
          set todos(v) {
            state.todos = v;
          },
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
          console.log(c.dim(`  * ${ev.name} ${c.bold(argStr)}`));
        } else if (ev.type === 'tool_end') {
          const firstLine = String(ev.result).split('\n')[0].slice(0, 100);
          console.log(c.dim(`    → ${firstLine}`));
        } else if (ev.type === 'error') {
          spinner?.stop();
          err = ev.message;
        } else if (ev.type === 'done') {
          spinner?.stop();
          turnStats = ev;
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
    // opencode-style turn footer: steps · tokens · duration
    if (turnStats && !err) {
      const secs = ((Date.now() - turnStart) / 1000).toFixed(1);
      const u = turnStats.usage || {};
      const tok = u.total_tokens ?? (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
      console.log(c.dim(`  ${c.green('done')} ${turnStats.steps} step${turnStats.steps === 1 ? '' : 's'}${tok ? ` · ${tok.toLocaleString()} tok` : ''} · ${secs}s`));
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
    // clearLine left the cursor at col 0 of the row below the input — the popup
    // rows are still on screen; clear them from here down (input row untouched)
    if (popupRows && process.stdout.isTTY) {
      process.stdout.write('\x1b[0J');
      popupRows = 0;
    }
    if (pendingApproval) {
      pendingApproval.resolve(line);
      return;
    }
    if (pendingQuestion) {
      const { q, resolve } = pendingQuestion;
      pendingQuestion = null;
      resolve(parseQuestionAnswer(q, line));
      return;
    }
    if (pendingUpdate) {
      const { resolve } = pendingUpdate;
      pendingUpdate = null;
      resolve(line);
      return;
    }
    enqueue(line);
  });

  // live popup while typing /command or @file (opencode palette).
  // registered AFTER readline's handler → runs with updated rl.line/rl.cursor.
  process.stdin.on('keypress', (str, key) => {
    if (key?.name === 'return' || key?.name === 'enter') return; // 'line' handler clears it
    if (!process.stdout.isTTY || busy || pendingApproval || pendingQuestion) return;
    if (rl.cursor !== rl.line.length) return; // pre-hide already cleared; mid-line edits: no popup
    const line = rl.line;
    if (line.startsWith('/')) {
      showPopup(commandPopupHits(line));
      return;
    }
    const at = line.match(/(?:^|\s)@([\w./-]*)$/);
    if (at) {
      showPopup(filePopupHits(at[1]));
      return;
    }
    hidePopup();
  });

  rlInterface.on('close', () => {
    if (busy && abort) abort.abort();
    console.log('');
    console.log(c.dim('  bye — session saved.'));
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

  // ---- launch-time update check (best-effort; never blocks on a dead network) ----
  const maybeAskUpdate = async () => {
    try {
      if (!process.stdin.isTTY) return;
      if (opts['no-update-check'] || opts.noUpdateCheck) return;
      if (process.env.NULLX11_NO_UPDATE_CHECK) return;
      if (state.cfg.updateCheck === false) return;
      const info = await checkForUpdate({ timeout: 2000 });
      if (!info?.updateAvailable) return;
      console.log('');
      console.log(c.yellow('  ! update available') + c.dim(`  ${info.current} → ${info.latest}`));
      console.log(c.dim(`    ${info.url}`));
      console.log(`  ${c.bold('[y]')}es update now (runs the installer)   ${c.bold('[n]')}o / Enter — ask again next launch`);
      const answer = await new Promise((resolve) => {
        pendingUpdate = { resolve };
        rl?.resume?.();
      });
      pendingUpdate = null;
      if (/^y(es)?$/i.test(String(answer || '').trim())) {
        console.log(c.dim('  running installer…'));
        const code = await runInstaller();
        if (code === 0) console.log(c.green('  updated — restart nullx11code to pick up the new version'));
        else console.log(c.red(`  installer exited ${code}`) + c.dim(` — run manually: ${info.install}`));
      } else {
        console.log(c.dim('  skipped — /version checks again anytime'));
      }
    } catch {
      /* update checks are best-effort */
    }
  };

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
    await maybeAskUpdate();
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
