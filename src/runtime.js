// nullx11code's compatibility layer for the real, pinned OpenCode distribution.
// No terminal emulation or feature stubs: the child owns the terminal and server.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { loadConfig, loadInstructions } from './config.js';
import { allProviders, guessModel } from './providers.js';
import { discoverSkills, skillsPrompt } from './skills.js';
import { discoverExtras } from './extracmds.js';

const require = createRequire(import.meta.url);
export const RUNTIME_VERSION = '1.19.5';
export const NATIVE_COMMANDS = new Set([
  'acp', 'mcp', 'attach', 'run', 'debug', 'auth', 'agent', 'web', 'models',
  'stats', 'export', 'import', 'github', 'pr', 'session', 'plugin', 'plug', 'db', 'completion',
]);
export const LOCAL_COMMANDS = new Set([
  'setup', 'doctor', 'config', 'skills', 'icon', 'banner', 'update', 'version',
]);

export function resolveRuntime(env = process.env) {
  if (env.NULLX11_OPENCODE_BIN) {
    const bin = path.resolve(env.NULLX11_OPENCODE_BIN);
    if (!fs.existsSync(bin)) throw new Error(`Runtime not found: ${bin}`);
    return bin;
  }
  try {
    const pkg = require.resolve('opencode-ai/package.json');
    const bin = path.join(path.dirname(pkg), 'bin', 'opencode.exe');
    if (fs.existsSync(bin)) return bin;
  } catch { /* installation may intentionally omit the optional native runtime */ }
  throw new Error('OpenCode runtime is not installed for this platform. Run npm install --include=optional (do not disable install scripts). On unsupported platforms such as Android/Termux, use nullx11code legacy.');
}

/** Merge plain config records; arrays replace rather than duplicate permission rules. */
export function mergeConfig(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra || {})) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) continue;
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? mergeConfig(out[key] && typeof out[key] === 'object' && !Array.isArray(out[key]) ? out[key] : {}, value)
      : value;
  }
  return out;
}

/** Upstream uses last-match wins; put deny rules last to retain legacy deny priority. */
export function bridgePermissions(cfg) {
  const fallback = ['allow', 'deny'].includes(cfg.permissions?.default) ? cfg.permissions.default : 'ask';
  const rules = [{ action: '*', resource: '*', effect: fallback }];
  // As in the original CLI, repository reads do not require approval by default.
  if (fallback === 'ask') {
    for (const action of ['read', 'glob', 'grep', 'list', 'todowrite', 'skill']) {
      rules.push({ action, resource: '*', effect: 'allow' });
    }
  }
  const configured = (cfg.permissions?.rules || []).filter((r) => ['allow', 'deny'].includes(r.effect));
  for (const effect of ['allow', 'deny']) {
    for (const rule of configured.filter((r) => r.effect === effect)) {
      rules.push({ action: rule.action === 'shell' ? 'bash' : (rule.action || '*'), resource: rule.resource || '*', effect });
    }
  }
  // The published stable CLI uses the V1 permission object, not the V2 array.
  // Expand wildcard-action rules before serializing so a later per-tool allow
  // cannot accidentally override a global deny.
  const actions = new Set(['*', 'read', 'edit', 'glob', 'grep', 'list', 'bash', 'task',
    'external_directory', 'todowrite', 'question', 'webfetch', 'websearch', 'lsp',
    'doom_loop', 'skill', ...rules.map((r) => r.action)]);
  const permission = {};
  for (const action of actions) {
    const patterns = {};
    for (const rule of rules) {
      if (rule.action !== '*' && rule.action !== action) continue;
      // Assignment alone preserves insertion order; move overrides to the end.
      delete patterns[rule.resource];
      patterns[rule.resource] = rule.effect;
    }
    if (Object.keys(patterns).length) {
      permission[action] = Object.keys(patterns).length === 1 && patterns['*']
        ? patterns['*'] : patterns;
    }
  }
  return permission;
}

/** Translate old flags, but leave native subcommand arguments completely intact. */
export function translateArgs(argv, { cwd = process.cwd(), tty = process.stdin.isTTY, defaultPort = 7860, defaultHost = '0.0.0.0' } = {}) {
  if (argv[0] === 'upstream') return { args: argv.slice(1), bridge: false };
  const native = NATIVE_COMMANDS.has(argv[0]) || argv[0] === 'providers';
  const serving = argv[0] === 'serve' || argv[0] === 'web';
  const args = [];
  let provider;
  let model;
  let print;
  let port;
  let host;
  let explicitModel = false;
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const take = () => {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${a} requires a value`);
      return argv[++i];
    };
    if (a === '--provider') provider = take();
    else if (!native && (a === '--model' || a === '-m')) { model = take(); explicitModel = true; }
    else if (!native && (a === '-p' || a === '--print')) print = take();
    else if (a === '--no-update-check') continue;
    else if (a === '--no-color') { /* applied to child env by launchRuntime */ }
    else if (a === '--host') { host = take(); args.push('--hostname', host); }
    else if (a === '--hostname') { host = take(); args.push(a, host); }
    else if (a === '--hostname=0.0.0.0' || a.startsWith('--hostname=')) { host = a.split('=')[1]; args.push(a); }
    else if (a === '--port') { port = take(); args.push(a, port); }
    else if (a.startsWith('--port=')) { port = a.split('=')[1]; args.push(a); }
    else if (a === '--yes' || a === '-y') args.push('--auto');
    else if (a === '--resume') {
      if (argv[i + 1] && !argv[i + 1].startsWith('-')) args.push('--session', argv[++i]);
      else args.push('--continue');
    } else if (!native && ['--agent', '--session', '-s', '--prompt', '--log-level', '--title', '--format', '--dir', '--variant'].includes(a)) {
      args.push(a, take());
    } else if (serving && i === 1 && /^\d+$/.test(a)) { port = a; args.push('--port', a); }
    else {
      args.push(a === 'serve' && i === 0 ? 'web' : a);
      if (!a.startsWith('-')) positionals.push(a);
    }
  }
  if (serving) {
    if (!host) args.push('--hostname', defaultHost);
    if (!port) args.push('--port', String(defaultPort));
  }
  let projectPath;
  if (!native && !serving) {
    const positional = positionals[0];
    let directory = false;
    if (positional) {
      try {
        directory = fs.statSync(path.resolve(cwd, positional)).isDirectory();
        if (directory) projectPath = path.resolve(cwd, positional);
      } catch { /* prompt */ }
    }
    if (print !== undefined) { args.unshift('run'); args.push('--', print); }
    else if (positional && !directory) args.unshift('run');
    else if (!tty && !positional) args.unshift('run');
  }
  return { args, provider, model, explicitModel, bridge: true, ...(projectPath ? { projectPath } : {}) };
}

/** No keys are persisted or placed on the command line. Config uses env references. */
export function buildRuntimeConfig(cfg, selection = {}, env = process.env, cwd = process.cwd()) {
  const childEnv = { ...cfg._env, ...env };
  const providers = allProviders(cfg, env);
  const requested = selection.provider || cfg.provider;
  const selected = requested ? providers.find((p) => p.id === requested)
    : providers.find((p) => p.detected && p.free && !p.local) || providers.find((p) => p.detected && !p.local);
  if (selection.provider && !selected) throw new Error(`Unknown provider: ${selection.provider}. Run nullx11code legacy providers to list provider IDs.`);
  const config = {
    autoupdate: false,
    permission: bridgePermissions(cfg),
    provider: {},
    command: {},
  };
  let selectedModel = selection.model || cfg.model;
  if (selectedModel === 'auto') selectedModel = undefined;
  // Native qualified models bypass the compatibility provider selection.
  const nativeModel = selection.explicitModel && !selection.provider && selectedModel?.includes('/');
  let index = 0;
  for (const provider of providers) {
    if (!provider.detected && provider !== selected) continue;
    const id = `nullx11-${provider.id}`;
    const configured = cfg.providers?.[provider.id] || {};
    const modelIDs = new Set((configured.models || provider.fallback || []).map((m) => typeof m === 'string' ? m : m.id).filter(Boolean));
    if (provider === selected && selectedModel && !nativeModel) modelIDs.add(selectedModel);
    const keyName = `NULLX11_RUNTIME_KEY_${index++}`;
    if (provider.apiKey) childEnv[keyName] = provider.apiKey;
    const models = Object.fromEntries([...modelIDs].map((id) => [id, { name: id, tool_call: true }]));
    config.provider[id] = {
      name: `${provider.name} · nullx11code`,
      npm: '@ai-sdk/openai-compatible',
      options: {
        baseURL: configured.baseUrl || provider.base,
        ...(provider.apiKey ? { apiKey: `{env:${keyName}}` } : {}),
      },
      models,
    };
    if (provider === selected && !nativeModel) {
      const model = selectedModel || guessModel(provider, [...modelIDs].map((id) => ({ id })));
      if (model !== 'default' || modelIDs.has('default')) config.model = `${id}/${model}`;
    }
  }
  if (nativeModel) config.model = selectedModel;
  const instructions = loadInstructions(cfg._root).filter((f) => !['AGENTS.md', 'CLAUDE.md'].includes(path.relative(cfg._root, f.path))).map((f) => f.path);
  if (instructions.length) config.instructions = instructions;
  const system = [cfg.systemPrompt, skillsPrompt(discoverSkills(cfg, cwd))].filter(Boolean).join('\n\n');
  if (system) config.agent = { build: { prompt: system }, plan: { prompt: system } };
  for (const command of discoverExtras(cfg, cwd)) {
    if (command.name === 'agents') continue;
    config.command[command.name] = { description: command.description, template: command.body };
  }
  // An explicit advanced config is authoritative over compatibility defaults.
  let result = mergeConfig(config, cfg.opencode);
  if (env.OPENCODE_CONFIG_CONTENT) {
    let extra;
    try { extra = JSON.parse(env.OPENCODE_CONFIG_CONTENT); }
    catch { throw new Error('OPENCODE_CONFIG_CONTENT must be valid JSON when using the compatibility bridge. Use nullx11code upstream for native JSONC config.'); }
    result = mergeConfig(result, extra);
  }
  // Explicit compatibility flags behave like native CLI options: they win
  // over defaults/config documents, including the advanced override block.
  if ((selection.explicitModel || selection.provider) && config.model) result.model = config.model;
  childEnv.OPENCODE_CONFIG_CONTENT = JSON.stringify(result);
  return { config: result, env: childEnv };
}

/** Inherit stdio for OpenTUI's real raw-mode input, resizing, paste, mouse and streaming. */
export function runChild(bin, args, { env, cwd = process.cwd(), spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(bin, args, { cwd, env, stdio: 'inherit', shell: false });
    const forward = (signal) => { if (!child.killed) child.kill(signal); };
    const signals = ['SIGINT', 'SIGTERM', ...(process.platform === 'win32' ? [] : ['SIGHUP'])];
    const handlers = signals.map((signal) => {
      const handler = () => forward(signal);
      process.on(signal, handler);
      return [signal, handler];
    });
    const cleanup = () => { for (const [signal, handler] of handlers) process.removeListener(signal, handler); };
    child.once('error', (error) => { cleanup(); reject(new Error(`Unable to start OpenCode: ${error.message}. Try npm install --include=optional, or nullx11code legacy.`)); });
    child.once('exit', (code, signal) => { cleanup(); resolve(code ?? ({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 }[signal] || 1)); });
  });
}

export async function launchRuntime(argv) {
  let cfg = loadConfig();
  const selection = translateArgs(argv, { defaultPort: cfg.port, defaultHost: cfg.host });
  if (selection.projectPath) cfg = loadConfig(selection.projectPath);
  const { env } = selection.bridge ? buildRuntimeConfig(cfg, selection, process.env, selection.projectPath || process.cwd()) : { env: { ...process.env } };
  if (argv.includes('--no-color')) env.NO_COLOR = '1';
  if (process.env.NULLX11_NO_UPDATE_CHECK || argv.includes('--no-update-check')) env.OPENCODE_DISABLE_AUTOUPDATE = 'true';
  const divider = selection.args.indexOf('--');
  const helpIndex = selection.args.findIndex((arg) => arg === '--help' || arg === '-h');
  if (selection.bridge && (selection.args[0] === 'completion' || (helpIndex >= 0 && (divider < 0 || helpIndex < divider)))) {
    return (await import('./branding.js')).capturePresentation(resolveRuntime(env), selection.args, env, selection.args[0] === 'completion' ? 'completion' : 'help');
  }
  const tui = selection.args[0] === 'attach' || (!NATIVE_COMMANDS.has(selection.args[0]) && selection.args[0] !== 'providers');
  const childEnv = selection.bridge && tui && !argv.includes('--pure')
    ? (await import('./branding.js')).terminalEnvironment(env) : env;
  return runChild(resolveRuntime(childEnv), selection.args, { env: childEnv });
}
