// Slash commands (opencode-style). Each command: run(ctx, args) => string | Promise<string|null>.
import fs from 'node:fs';
import path from 'node:path';
import { c, hex, helpLine, modelBadge, table, wrap, rule, providerBadge, familyChip } from './ui.js';
import { VERSION, saveProjectConfig, loadConfig, globalDir, projectDir } from './config.js';
import { allProviders, resolveProvider, listModels, guessModel } from './providers.js';
import { discoverSkills, setSkillEnabled, createSkill, suggestSkills } from './skills.js';
import { listSessions, loadSession, saveSession } from './sessions.js';
import { familyMeta } from './models.js';
import { describeRules } from './permissions.js';

/** Resolve /models|/model argument (#, exact id, or query) and switch to it. */
async function switchModel(ctx, models, arg) {
  if (/^\d+$/.test(arg)) {
    const m = models[Number(arg) - 1];
    if (!m) return `No model #${arg} (provider has ${models.length}).`;
    return applyModel(ctx, m.id, models);
  }
  if (arg === 'auto') return applyModel(ctx, guessModel(ctx.prov, models), models);
  const exact = models.find((m) => m.id.toLowerCase() === arg.toLowerCase());
  if (exact) return applyModel(ctx, exact.id, models);
  const q = arg.toLowerCase();
  const matches = models.filter((m) => m.id.toLowerCase().includes(q));
  if (matches.length === 1) return applyModel(ctx, matches[0].id, models);
  if (!matches.length) return `No model matches "${arg}". Try /models to list them.`;
  // several hits → show a numbered pick list
  const rows = matches.slice(0, 20).map((m, i) => {
    const fam = familyMeta(m.id);
    return [String(i + 1), hex(fam.letters, fam.color) + ' ' + fam.label, m.id];
  });
  return (
    `${matches.length} models match ${c.cyan(arg)} — switch with /models <#>\n` +
    table(['#', 'icon', 'model'], rows)
  );
}

function applyModel(ctx, id, models) {
  const known = models.find((m) => m.id === id);
  ctx.model = id;
  saveProjectConfig({ provider: ctx.prov.id, model: id }, ctx.cwd);
  return `model ${modelBadge(ctx.prov, id)}${known?.context ? c.dim(` · ctx ${Math.round(known.context / 1024)}k`) : ''}`;
}

export const COMMANDS = [
  {
    name: 'help',
    desc: 'Show this help (or /help <command>)',
    run(ctx, args) {
      if (args) {
        const cmd = COMMANDS.find((x) => x.name === args.split(/\s+/)[0].replace(/^\//, ''));
        if (!cmd) return `Unknown command: ${args}`;
        return [`/${cmd.name} ${cmd.args || ''}`.trim(), c.dim(cmd.desc), cmd.extra ? c.dim(cmd.extra) : ''].filter(Boolean).join('\n');
      }
      const out = [
        c.bold('  Commands'),
        helpLine('help [cmd]', 'this help'),
        helpLine('setup [id key]', 'add an API key the easy way'),
        helpLine('model [id]', 'switch / pick the model (shows icons)'),
        helpLine('models [query]', 'list models — or search & switch'),
        helpLine('provider [id]', 'switch AI provider'),
        helpLine('providers', 'list providers + key status'),
        helpLine('init', 'create / improve AGENTS.md instructions'),
        helpLine('review [ref]', 'review commits, branch or PR'),
        helpLine('agent [mode]', 'build (default) or plan (read-only)'),
        helpLine('permissions', 'allow/deny rules — skip prompts for safe cmds'),
        helpLine('skills', 'manage project skills'),
        helpLine('skill on|off <n>', 'toggle one skill'),
        helpLine('new', 'start a fresh conversation'),
        helpLine('clear', 'clear the screen'),
        helpLine('history', 'list saved sessions'),
        helpLine('load <id>', 'resume a session'),
        helpLine('export [file]', 'export chat as markdown'),
        helpLine('usage', 'estimate token usage'),
        helpLine('config [k=v]', 'view / set config'),
        helpLine('settings', 'toggle runtime settings'),
        helpLine('serve [port]', 'launch the web UI'),
        helpLine('doctor', 'diagnose setup (keys, network)'),
        helpLine('icon [what]', 'print app / provider / model icons'),
        helpLine('compact', 'shrink history to save context'),
        helpLine('version', 'version info'),
        helpLine('quit', 'exit'),
      ];
      const extras = ctx.extras || [];
      if (extras.length) {
        out.push('', c.bold('  Custom commands') + c.dim('  (.nullx11/*.md — auto-detected)'));
        for (const x of extras) {
          out.push(helpLine(x.name, x.description || c.dim('(no description)')));
          if (x.example) out.push(`  ${' '.repeat(14)}${c.dim('e.g. ' + x.example)}`);
        }
      } else {
        out.push('', c.dim('  No custom commands yet — drop a .md into .nullx11/ (see .nullx11/extra.md).'));
      }
      out.push('', c.dim('  Tip: start messages with / to auto-complete commands — prefix works too (/ex → /extra).'));
      return out.join('\n');
    },
  },
  {
    name: 'providers',
    desc: 'List all providers with key detection',
    run(ctx) {
      const list = allProviders(ctx.cfg);
      const rows = list.map((p) => [
        hex(p.id, p.color) + (ctx.prov?.id === p.id ? c.green(' *') : ''),
        p.free ? c.green('free') : c.dim('paid'),
        p.detected ? c.green('key ✓') : c.yellow('no key'),
        c.dim(p.base.replace(/^https?:\/\//, '')),
      ]);
      return [
        table(['provider', 'cost', 'status', 'endpoint'], rows),
        '',
        c.dim('* current · add a key via .env or `nullx11code config provider=<id>`'),
        c.dim('  free keys: NVIDIA_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY …'),
      ].join('\n');
    },
  },
  {
    name: 'provider',
    args: '[id]',
    desc: 'Switch provider',
    async run(ctx, args) {
      if (!args) return ctx.cmd('providers');
      const list = allProviders(ctx.cfg);
      const hit = list.find((p) => p.id === args.trim() || p.name.toLowerCase().includes(args.trim().toLowerCase()));
      if (!hit) return `No provider "${args}". Try: ${list.map((p) => p.id).join(', ')}`;
      ctx.prov = hit;
      ctx.cfg.provider = hit.id;
      saveProjectConfig({ provider: hit.id }, ctx.cwd);
      const models = await listModels(hit, ctx.cfg, { refresh: true });
      ctx.models = models;
      ctx.model = guessModel(hit, models);
      return `Switched to ${providerBadge(hit)}\nmodel ${modelBadge(hit, ctx.model)}`;
    },
  },
  {
    name: 'models',
    args: '[query|#|id]',
    desc: 'List models — or search & switch: /models llama, /models 3',
    async run(ctx, args) {
      const models = await listModels(ctx.prov, ctx.cfg, { refresh: true });
      if (!models.length) return 'No models available (endpoint unreachable and no fallback catalog).';
      const arg = (args || '').trim();
      if (arg) return switchModel(ctx, models, arg);
      const rows = models.slice(0, 60).map((m) => {
        const fam = familyMeta(m.id);
        return [
          m.id === ctx.model ? c.green('>') : ' ',
          hex(fam.letters, fam.color) + ' ' + fam.label,
          m.id,
          m.context ? c.dim(String(Math.round(m.context / 1024)) + 'k') : '',
        ];
      });
      return (
        `${providerBadge(ctx.prov)} models\n` +
        table(['', 'family', 'model', 'ctx'], rows) +
        `\n${c.dim('switch: /models <query|#|id>  ·  /models llama  ·  /models 3')}`
      );
    },
  },
  {
    name: 'model',
    args: '[id|#]',
    desc: 'Switch model (auto-detects family icon)',
    async run(ctx, args) {
      const models = await listModels(ctx.prov, ctx.cfg);
      if (!args) {
        const rows = models.slice(0, 60).map((m, i) => {
          const fam = familyMeta(m.id);
          return [
            m.id === ctx.model ? c.green('>') : String(i + 1),
            hex(fam.letters, fam.color),
            m.id,
            m.id === ctx.model ? c.green('active') : '',
          ];
        });
        return `${providerBadge(ctx.prov)} — pick with /model <#|id>\n` + table(['#', 'icon', 'model', ''], rows);
      }
      return switchModel(ctx, models, args.trim());
    },
  },
  {
    name: 'setup',
    args: '[provider] [key]',
    desc: 'Add an API key the easy way — /setup groq gsk_… (writes .env, verifies)',
    async run(ctx, args) {
      const list = allProviders(ctx.cfg);
      const remote = list.filter((p) => !p.local && !p.custom);
      const parts = (args || '').trim().split(/\s+/).filter(Boolean);
      if (parts.length < 2) {
        // guided menu: which providers still need a key
        const rows = remote.map((p) => [
          hex(p.id, p.color),
          p.free ? c.green('free') : c.dim('paid'),
          p.detected ? c.green('key saved') : c.yellow('needs key'),
          p.env[0] || '',
          p.keyUrl ? c.dim(p.keyUrl.replace(/^https?:\/\//, '')) : '',
        ]);
        const missing = remote.filter((p) => !p.detected);
        return [
          table(['provider', 'cost', 'status', 'env var', 'get key at'], rows),
          '',
          missing.length
            ? c.dim(`usage: /setup <provider> <key>   e.g. /setup ${missing[0].id} …`)
            : c.green('all providers configured'),
          c.dim('keys are appended to .env (project) — never sent anywhere but the provider'),
        ].join('\n');
      }
      const id = parts[0].toLowerCase();
      const key = parts.slice(1).join(' ').replace(/^["']|["']$/g, '');
      const hit = remote.find((p) => p.id === id || p.name.toLowerCase().includes(id));
      if (!hit) return `No provider "${parts[0]}". Try: ${remote.map((p) => p.id).join(', ')}`;
      if (!hit.env.length) return `${hit.name} takes its key from config — use /config providers.${hit.id}.apiKey=…`;
      const envName = hit.env[0];
      // append/replace in project .env
      const envFile = path.join(ctx.cfg._root || ctx.cwd, '.env');
      let content = '';
      try {
        content = fs.readFileSync(envFile, 'utf8');
      } catch {
        /* fresh file */
      }
      const line = `${envName}=${key}`;
      const re = new RegExp(`^\\s*(?:export\\s+)?${envName}\\s*=.*$`, 'm');
      content = re.test(content) ? content.replace(re, line) : content.replace(/\s*$/, '\n') + line + '\n';
      fs.writeFileSync(envFile, content);
      // make it visible to this process + refresh provider state
      process.env[envName] = key;
      ctx.cfg._env = { ...(ctx.cfg._env || {}), [envName]: key };
      ctx.prov = allProviders(ctx.cfg).find((p) => p.id === hit.id) || hit;
      if (ctx.cfg.provider !== hit.id) {
        ctx.cfg.provider = hit.id;
        saveProjectConfig({ provider: hit.id }, ctx.cwd);
      }
      // verify against /models
      let verdict;
      try {
        const res = await fetch(hit.base.replace(/\/+$/, '') + '/models', {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(6000),
        });
        verdict = res.ok ? c.green(`verified — /models returned ${res.status}`) : c.yellow(`endpoint answered ${res.status} — check the key`);
      } catch (e) {
        verdict = c.yellow(`could not verify (${e.message}) — key saved anyway`);
      }
      const models = await listModels(ctx.prov, ctx.cfg, { refresh: true });
      ctx.model = guessModel(ctx.prov, models);
      return [
        `${c.green('saved')} ${envName} → ${c.cyan(envFile)}`,
        `provider ${providerBadge(hit)} · ${verdict}`,
        `model ${modelBadge(ctx.prov, ctx.model)}`,
      ].join('\n');
    },
  },
  {
    name: 'init',
    args: '[focus]',
    desc: 'Create or improve AGENTS.md for this repo (project instructions)',
    run(ctx, args) {
      return {
        prompt: [
          'Create or update `AGENTS.md` for this repository.',
          '',
          'The goal is a compact instruction file that helps future sessions avoid mistakes and ramp up quickly.',
          'Every line should answer: "Would an agent likely miss this without help?" If not, leave it out.',
          '',
          'User-provided focus (honor this): ' + (args || '(none)'),
          '',
          'Read the highest-value sources first: README*, manifests, build/test/lint config, CI workflows,',
          'existing instruction files (AGENTS.md, CLAUDE.md, .cursor/rules/), and the real entrypoints of the code.',
          'Prefer executable sources of truth over prose.',
          '',
          'Extract: exact developer commands (esp. non-obvious ones), command order (lint → typecheck → test),',
          'architecture facts not obvious from filenames, framework/toolchain quirks, testing quirks,',
          'setup requirements and environment gotchas.',
          '',
          'Exclude: generic software advice, tutorials, exhaustive file trees, speculative claims.',
          'When in doubt, omit. Prefer short sections and bullets.',
          `If AGENTS.md already exists at ${ctx.root}, improve it in place — preserve verified guidance, delete fluff.`,
        ].join('\n'),
      };
    },
  },
  {
    name: 'review',
    args: '[commit|branch|pr]',
    desc: 'Review code changes (defaults to uncommitted)',
    run(ctx, args) {
      return {
        prompt: [
          'You are a code reviewer. Review code changes and provide actionable feedback.',
          '',
          `Input: ${args || '(none — review uncommitted changes)'}`,
          '',
          'Determine what to review:',
          '- No arguments: run `git diff`, `git diff --cached`, `git status --short` (untracked files too).',
          '- 40-char or short hash: `git show <hash>`.',
          '- Branch name: `git diff <branch>...HEAD`.',
          '- PR URL/number: `gh pr view <x>` and `gh pr diff <x>`.',
          '',
          'Diffs alone are not enough — read the full files being modified for context.',
          'Look for: bugs first (logic errors, edge cases, security, broken error handling),',
          'then structure (does it fit the codebase), then obvious performance problems,',
          'then unintended behavior changes.',
          '',
          'Be certain before flagging a bug; investigate with your tools if unsure.',
          'Do not review pre-existing code that was not modified. Do not be a zealot about style.',
          'Output: direct, severity-weighted, matter-of-fact. No flattery, no filler.',
        ].join('\n'),
      };
    },
  },
  {
    name: 'skills',
    args: '[add <dir>|new <name>|on|off]',
    desc: 'Manage skills for this project',
    run(ctx, args) {
      const parts = (args || '').trim().split(/\s+/).filter(Boolean);
      const sub = parts[0];
      if (sub === 'add' && parts[1]) {
        const dir = path.resolve(ctx.cwd, parts[1]);
        if (!fs.existsSync(dir)) return `Not found: ${dir}`;
        const dirs = [...(ctx.cfg.skills?.dirs || []), dir];
        ctx.cfg.skills = { ...ctx.cfg.skills, dirs: [...new Set(dirs)] };
        saveProjectConfig({ skills: ctx.skills_cfg_patch?.(ctx.cfg) || ctx.cfg.skills }, ctx.cwd);
        ctx.refreshSkills();
        return `Added skills folder ${c.cyan(dir)}\nFound ${ctx.skills.length} skill(s).`;
      }
      if (sub === 'new' && parts[1]) {
        const root = path.join(projectDir(ctx.cwd), 'skills');
        const file = createSkill(root, parts[1], { description: '' });
        ctx.refreshSkills();
        return `Created skill scaffold: ${c.cyan(file)}\nEdit the SKILL.md then run /skills reload.`;
      }
      if (sub === 'reload' || sub === 'refresh') {
        ctx.refreshSkills();
        return `Reloaded ${ctx.skills.length} skill(s).`;
      }
      if ((sub === 'on' || sub === 'off') && parts[1]) {
        const name = parts[1];
        setSkillEnabled(ctx.cfg, name, sub === 'on', (patch) => saveProjectConfig(patch, ctx.cwd));
        ctx.refreshSkills();
        const s = ctx.skills.find((x) => x.name === name);
        return s ? `Skill ${name} → ${s.enabled ? c.green('on') : c.dim('off')}` : `No skill "${name}".`;
      }
      // list
      if (!ctx.skills.length) {
        return [
          c.yellow('No skills yet.'),
          '',
          'A skill is a folder with a SKILL.md file:',
          '  .nullx11code/skills/my-skill/SKILL.md',
          '',
          'Commands:',
          '  /skills add <dir>   use a whole folder of skills in this project',
          '  /skills new <name>  scaffold a new skill',
          '  /skills on|off <n>  toggle',
        ].join('\n');
      }
      const rows = ctx.skills.map((s) => [
        s.enabled ? c.green('✓') : c.dim('○'),
        c.bold(s.name),
        c.dim(s.description || ''),
        c.dim(s.always ? '(always)' : path.relative(ctx.root, s.source) || '~'),
      ]);
      return [
        table(['', 'skill', 'description', 'source'], rows),
        '',
        c.dim('/skills on|off <name> · /skills add <dir> · /skills new <name>'),
      ].join('\n');
    },
  },
  {
    name: 'skill',
    args: 'on|off <name>',
    desc: 'Toggle a single skill',
    run(ctx, args) {
      return ctx.cmd('skills', args);
    },
  },
  {
    name: 'permissions',
    args: '[add <action> <resource> <effect>|rm <#>|default <effect>]',
    desc: 'Allow/deny rules so safe commands never prompt (opencode-style)',
    run(ctx, args) {
      const perms = ctx.cfg.permissions || { default: 'ask', rules: [] };
      const parts = (args || '').trim().split(/\s+/).filter(Boolean);
      const sub = (parts[0] || '').toLowerCase();

      if (sub === 'add' && parts.length >= 4) {
        const [, action, ...rest] = parts;
        const effect = rest[rest.length - 1];
        const resource = rest.slice(0, -1).join(' ').replace(/^["']|["']$/g, ''); // allow quoted resources
        if (!['allow', 'deny', 'ask'].includes(effect)) return 'effect must be allow | deny | ask';
        if (!['edit', 'shell', 'question', '*'].includes(action)) return 'action must be edit | shell | question | *';
        const rules = [...(perms.rules || []), { action, resource, effect }];
        ctx.cfg.permissions = { ...perms, rules };
        saveProjectConfig({ permissions: ctx.cfg.permissions }, ctx.cwd);
        return `rule added: ${c.cyan(action)} ~ ${c.cyan(resource)} → ${effect}`;
      }

      if (sub === 'rm' && parts[1] && /^\d+$/.test(parts[1])) {
        const i = Number(parts[1]) - 1;
        const rules = [...(perms.rules || [])];
        if (!rules[i]) return `No rule #${parts[1]}`;
        const [gone] = rules.splice(i, 1);
        ctx.cfg.permissions = { ...perms, rules };
        saveProjectConfig({ permissions: ctx.cfg.permissions }, ctx.cwd);
        return `removed: ${gone.action} ~ ${gone.resource} → ${gone.effect}`;
      }

      if (sub === 'default' && parts[1]) {
        if (!['allow', 'deny', 'ask'].includes(parts[1])) return 'default must be allow | deny | ask';
        ctx.cfg.permissions = { ...perms, default: parts[1] };
        saveProjectConfig({ permissions: ctx.cfg.permissions }, ctx.cwd);
        return `default permission → ${parts[1]}`;
      }

      const view = describeRules(perms);
      const rows = view.rules.map((r, i) => [String(i + 1), r.action, r.resource, r.effect === 'allow' ? c.green('allow') : r.effect === 'deny' ? c.red('deny') : c.yellow('ask')]);
      return [
        table(['#', 'action', 'resource', 'effect'], rows.length ? rows : [['—', '—', '—', '—']]),
        '',
        `default: ${view.default === 'allow' ? c.green('allow') : view.default === 'deny' ? c.red('deny') : c.yellow('ask')}`,
        c.dim('/permissions add shell "git *" allow  ·  /permissions add edit "*" allow  ·  /permissions rm 1'),
        c.dim('/permissions default allow   — first match wins; denies are checked before allows'),
      ].join('\n');
    },
  },
  {
    name: 'agent',
    args: '[build|plan]',
    desc: 'Switch agent mode — plan is read-only (opencode-style)',
    run(ctx, args) {
      const mode = (args || '').trim().toLowerCase();
      const current = ctx.agent || 'build';
      if (!mode) {
        return [
          `agent ${c.bold(current)}`,
          table(
            ['mode', 'behavior'],
            [
              ['build', c.dim('full access — writes/shell ask for approval')],
              ['plan', c.dim('read-only analysis — edits denied, shell still asks')],
            ]
          ),
          c.dim('/agent plan  ·  /agent build'),
        ].join('\n');
      }
      if (mode !== 'build' && mode !== 'plan') return `Unknown agent "${args}" — use build or plan.`;
      ctx.agent = mode;
      // refresh the live system prompt so the mode takes effect immediately
      if (ctx.messages?.[0]?.role === 'system' && typeof ctx.systemPrompt === 'function') {
        ctx.messages[0].content = ctx.systemPrompt();
      }
      if (mode === 'plan') {
        return c.cyan('agent → plan') + c.dim(' — read-only: file edits are denied, shell commands still ask.');
      }
      return c.green('agent → build') + c.dim(' — full access with approvals.');
    },
  },
  {
    name: 'new',
    desc: 'Start a fresh conversation',
    run(ctx) {
      ctx.newSession();
      return c.dim('Started a new conversation.');
    },
  },
  {
    name: 'clear',
    desc: 'Clear the screen (reprints the header)',
    run(ctx) {
      ctx.clearScreen?.();
      return null;
    },
  },
  {
    name: 'history',
    desc: 'List saved sessions',
    run(ctx) {
      const list = listSessions({ cwd: ctx.cwd, limit: 25 });
      if (!list.length) return c.dim('No saved sessions yet.');
      const rows = list.map((s, i) => [
        String(i + 1),
        s.id,
        c.dim(String(s.messages)),
        s.model ? familyChip(s.model) : '',
        c.dim((s.title || '').slice(0, 40)),
      ]);
      return table(['#', 'id', 'msgs', 'icon', 'title'], rows) + '\n' + c.dim('/load <id> to resume');
    },
  },
  {
    name: 'load',
    args: '<id>',
    desc: 'Resume a session',
    run(ctx, args) {
      if (!args) return 'Usage: /load <session-id>';
      const s = loadSession(args.trim(), { cwd: ctx.cwd });
      if (!s) return `Session not found: ${args}`;
      ctx.session = s;
      ctx.messages = [{ role: 'system', content: ctx.systemPrompt() }, ...(s.messages || [])];
      if (s.model && s.provider) {
        const p = allProviders(ctx.cfg).find((x) => x.id === s.provider);
        if (p) ctx.prov = p;
        ctx.model = s.model;
      }
      return `Resumed ${c.cyan(s.id)} — ${(s.messages || []).length} messages.`;
    },
  },
  {
    name: 'export',
    args: '[file]',
    desc: 'Export the chat as markdown',
    run(ctx, args) {
      const file = args?.trim() || path.join(process.cwd(), `nullx11-export-${Date.now()}.md`);
      const lines = [`# nullx11code export — ${new Date().toISOString()}`, '', `Model: ${ctx.prov?.id}/${ctx.model}`, ''];
      for (const m of ctx.messages) {
        if (m.role === 'system') continue;
        lines.push(`## ${m.role}`, '', m.content || '', '');
      }
      fs.writeFileSync(file, lines.join('\n'));
      return `Exported to ${c.cyan(file)}`;
    },
  },
  {
    name: 'usage',
    desc: 'Estimate context usage',
    run(ctx) {
      const chars = ctx.messages.reduce((n, m) => n + (m.content?.length || 0), 0);
      const tokens = Math.round(chars / 4);
      const pct = Math.min(100, Math.round((tokens / 128_000) * 100));
      const bar = '█'.repeat(Math.round(pct / 4)) + '░'.repeat(25 - Math.round(pct / 4));
      return `~${tokens.toLocaleString()} tokens across ${ctx.messages.length} messages (${chars.toLocaleString()} chars)\n${c.cyan(bar)} ${pct}% of a 128k window (estimate)`;
    },
  },
  {
    name: 'config',
    args: '[key=value|path]',
    desc: 'View or set configuration',
    run(ctx, args) {
      if (!args) {
        const { _env, _root, ...rest } = ctx.cfg;
        return `${c.bold('config')}\n${JSON.stringify(rest, null, 2)}\n\n${c.dim('file: ' + path.join(projectDir(ctx.cwd), 'config.json'))}`;
      }
      const kv = args.match(/^([\w.]+)\s*=\s*(.*)$/);
      if (!kv) return 'Usage: /config key=value  (e.g. /config temperature=0.2)';
      const [, key, raw] = kv;
      let val = raw;
      if (/^-?\d+(\.\d+)?$/.test(raw)) val = Number(raw);
      else if (raw === 'true') val = true;
      else if (raw === 'false') val = false;
      if (key.includes('.')) {
        const [a, b] = key.split('.');
        ctx.cfg[a] = { ...(ctx.cfg[a] || {}), [b]: val };
      } else {
        ctx.cfg[key] = val;
      }
      saveProjectConfig(key.includes('.') ? { [key.split('.')[0]]: ctx.cfg[key.split('.')[0]] } : { [key]: val }, ctx.cwd);
      return `Set ${c.cyan(key)} = ${JSON.stringify(val)}`;
    },
  },
  {
    name: 'settings',
    desc: 'Runtime settings',
    run(ctx) {
      const s = ctx.settings;
      return [
        table(
          ['setting', 'value', 'toggle'],
          [
            ['streaming', s.stream ? c.green('on') : c.dim('off'), '/settings stream'],
            ['approve shell', s.approveShell ? c.green('on') : c.yellow('off'), '/settings approveShell'],
            ['approve writes', s.approveWrite ? c.green('on') : c.yellow('off'), '/settings approveWrite'],
            ['colors', s.colors ? c.green('on') : c.dim('off'), '/settings colors'],
          ]
        ),
      ].join('\n');
    },
  },
  {
    name: 'serve',
    args: '[port]',
    desc: 'Launch the web UI (LAN/mobile friendly)',
    async run(ctx, args) {
      const port = Number(args) || ctx.cfg.port || 7860;
      const { startServer } = await import('./server.js');
      const info = await startServer({ port, host: ctx.cfg.host || '0.0.0.0', cfg: ctx.cfg, cwd: ctx.cwd });
      return c.green(`web UI → ${info.url}\n`) + c.dim('Open on your phone via the same network. Ctrl+C to stop.');
    },
  },
  {
    name: 'doctor',
    desc: 'Diagnose keys, network and skills',
    async run(ctx) {
      const lines = [c.bold('  nullx11code doctor')];
      lines.push(`  node      ${c.dim(process.version)} ${process.version >= 'v18' ? c.green('✓') : c.red('✗ (need ≥18)')}`);
      lines.push(`  cwd       ${c.dim(ctx.root)}`);
      const list = allProviders(ctx.cfg);
      const withKey = list.filter((p) => p.detected && !p.local);
      lines.push(`  keys      ${withKey.length ? c.green(withKey.length + ' detected: ' + withKey.map((p) => p.id).join(', ')) : c.yellow('none detected — add NVIDIA_API_KEY or another free key to .env')}`);
      // network probe
      const probe = list.find((p) => p.detected && !p.local);
      if (probe) {
        try {
          const r = await fetch(probe.base.replace(/\/+$/, '') + '/models', {
            headers: { authorization: `Bearer ${probe.apiKey}` },
            signal: AbortSignal.timeout(5000),
          });
          lines.push(`  network   ${r.ok ? c.green(`✓ ${probe.id} reachable (${r.status})`) : c.yellow(`✗ ${probe.id} → ${r.status}`)}`);
        } catch (e) {
          lines.push(`  network   ${c.red(`✗ ${probe.id}: ${e.message}`)}`);
        }
      } else {
        lines.push(`  network   ${c.dim('skipped (no keys)')}`);
      }
      lines.push(`  skills    ${ctx.skills.length ? c.green(ctx.skills.filter((s) => s.enabled).length + ' active / ' + ctx.skills.length + ' total') : c.dim('none')}`);
      lines.push(`  session   ${c.dim(ctx.session.id)}`);
      lines.push(`  home      ${c.dim(globalDir())}`);
      return lines.join('\n');
    },
  },
  {
    name: 'icon',
    args: '[app|cli|provider|model]',
    desc: 'Print built-in icons',
    run(ctx, args) {
      const what = (args || 'app').trim();
      if (what === 'provider') {
        return allProviders(ctx.cfg)
          .map((p) => `  ${providerBadge(p)}  ${c.dim(p.id)}`)
          .join('\n');
      }
      if (what === 'model') {
        return Object.entries(familyMeta && { current: ctx.model })
          .map(([, id]) => `  ${familyChip(id)}`)
          .join('\n');
      }
      const color = what === 'cli' ? '#8B93A7' : '#76B900';
      const art = [
        '    ████████╗██╗  ██╗██╗ ██╗██╗  ██╗',
        '    ╚══██╔══╝██║  ██╔╝██║ ██╔╝██║  ██╔╝',
        '       ██║   ███████╔╝ █████╔╝ ███████╔╝ ',
        '       ██║   ██╔══██╗ ██╔═██╗ ██╔══██╗ ',
        '       ██║   ██║  ██║ ██║  ██╗██║  ██║ ',
        '       ╚═╝   ╚═╝  ╚═╝ ╚═╝  ╚═╝╚═╝  ╚═╝ ',
      ];
      return art.map((l) => hex(l.trimEnd(), color)).join('\n') + `\n${c.dim('  icon files: assets/icons/app-icon.svg · cli-icon.svg')}`;
    },
  },
  {
    name: 'compact',
    desc: 'Trim history to the last messages',
    async run(ctx) {
      const before = ctx.messages.length;
      const tail = ctx.messages.slice(-14);
      ctx.messages = [ctx.messages[0], ...tail];
      return `Compacted ${before} → ${ctx.messages.length} messages.`;
    },
  },
  {
    name: 'version',
    desc: 'Version info',
    run() {
      return `nullx11code v${VERSION} · node ${process.version} · ${process.platform}`;
    },
  },
  { name: 'quit', desc: 'Exit', run(ctx) { ctx.quit(); return null; } },
  { name: 'exit', desc: 'Exit', run(ctx) { ctx.quit(); return null; } },
];

export function findCommand(name) {
  const n = String(name || '').replace(/^\//, '').toLowerCase();
  return COMMANDS.find((x) => x.name === n || x.aliases?.includes(n)) || null;
}

/** Tab-completion candidates for "/..." input. */
export function completeCommand(prefix) {
  const p = prefix.replace(/^\//, '').toLowerCase();
  return COMMANDS.filter((x) => x.name.startsWith(p)).map((x) => '/' + x.name);
}

export { suggestSkills, wrap, rule, VERSION };
