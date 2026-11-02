// Config: global (~/.nullx11code) + project (.nullx11code) + .env key detection.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const VERSION = '0.1.0';
export const APP_NAME = 'nullx11code';

export function globalDir() {
  return process.env.NULLX11_HOME || path.join(os.homedir(), '.nullx11code');
}

/** Walk up from cwd to find the project root (.git or .nullx11code). */
export function projectRoot(cwd = process.cwd()) {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git')) || fs.existsSync(path.join(dir, '.nullx11code'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}

export function projectDir(cwd = process.cwd()) {
  return path.join(projectRoot(cwd), '.nullx11code');
}

function readJson(p) {
  try {
    const v = JSON.parse(fs.readFileSync(p, 'utf8'));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

export function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
}

/** Minimal .env parser (KEY=value, optional export, quotes). */
export function parseEnvFile(text) {
  const out = {};
  for (const line of String(text).split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function loadEnvFiles(root) {
  const merged = {};
  for (const p of [path.join(globalDir(), '.env'), path.join(root, '.env')]) {
    try {
      Object.assign(merged, parseEnvFile(fs.readFileSync(p, 'utf8')));
    } catch {
      /* no file */
    }
  }
  return merged;
}

const DEFAULTS = {
  provider: null, // null => auto-pick first detected free provider
  model: 'auto',
  temperature: 0.7,
  maxTokens: null,
  systemPrompt: null, // extra base prompt appended
  skills: { dirs: [], enabled: [] },
  approvals: { shell: true, write: true },
  providers: {}, // { customId: { baseUrl, apiKey, name } }
  port: 7860,
  host: '0.0.0.0',
};

/** Deep-ish merge of defaults <- global <- project. */
export function loadConfig(cwd = process.cwd()) {
  const root = projectRoot(cwd);
  const globalCfg = readJson(path.join(globalDir(), 'config.json')) || {};
  const projCfg = readJson(path.join(projectDir(cwd), 'config.json')) || {};
  const fileEnv = loadEnvFiles(root);

  const cfg = {
    ...DEFAULTS,
    ...globalCfg,
    ...projCfg,
    skills: {
      ...DEFAULTS.skills,
      ...(globalCfg.skills || {}),
      ...(projCfg.skills || {}),
      dirs: [...(globalCfg.skills?.dirs || []), ...(projCfg.skills?.dirs || [])],
      enabled: [...new Set([...(globalCfg.skills?.enabled || []), ...(projCfg.skills?.enabled || [])])],
    },
    approvals: {
      ...DEFAULTS.approvals,
      ...(globalCfg.approvals || {}),
      ...(projCfg.approvals || {}),
    },
    providers: { ...(globalCfg.providers || {}), ...(projCfg.providers || {}) },
    _root: root,
    _env: fileEnv,
    _global: globalCfg,
    _project: projCfg,
  };
  return cfg;
}

/** Persist selected fields into the project config. */
export function saveProjectConfig(patch, cwd = process.cwd()) {
  const p = path.join(projectDir(cwd), 'config.json');
  const cur = readJson(p) || {};
  const next = { ...cur, ...patch };
  delete next._root;
  delete next._env;
  writeJson(p, next);
  return p;
}

/** Resolve an API key: process env > .env files > config providers block. */
export function getApiKey(provider, cfg) {
  for (const name of provider.env || []) {
    const v = process.env[name] || cfg?._env?.[name];
    if (v) return v;
  }
  const custom = cfg?.providers?.[provider.id]?.apiKey;
  if (custom) return custom;
  if (provider.id === 'custom' && cfg?.providers?.custom?.apiKey) {
    return cfg.providers.custom.apiKey;
  }
  return null;
}

/** Where skills live for this project (ordered by precedence). */
export function skillDirs(cfg, cwd = process.cwd()) {
  const dirs = [];
  for (const d of cfg.skills?.dirs || []) {
    const abs = path.isAbsolute(d) ? d : path.resolve(cfg._root || cwd, d);
    if (!dirs.includes(abs)) dirs.push(abs);
  }
  const proj = path.join(projectDir(cwd), 'skills');
  if (!dirs.includes(proj)) dirs.push(proj);
  const shared = path.join(cwd, 'skills');
  if (!dirs.includes(shared)) dirs.push(shared);
  const home = path.join(globalDir(), 'skills');
  if (!dirs.includes(home)) dirs.push(home);
  return dirs;
}
