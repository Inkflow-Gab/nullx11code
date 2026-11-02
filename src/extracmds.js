// Extra/custom slash commands from `.nullx11/*.md` files (auto-detected, opencode-style).
//
// A file `.nullx11/extra.md` becomes the command `/extra`:
//   ---
//   description: What this command does (shown in /help and the /ex preview)
//   example: /extra make it pop
//   ---
//   Prompt body… use $ARGUMENTS for whatever the user typed after the command.
//
// Discovery order (later overrides earlier, same name):
//   config commands.dirs → project .nullx11/ + .nullx11/commands/
//   → global ~/.nullx11/ + ~/.nullx11/commands/
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { globalDir, projectDir, projectRoot } from './config.js';
import { parseFrontmatter } from './skills.js';

const MAX_BYTES = 32 * 1024;

/** Folders searched for extra-command .md files (.nullx11 auto-detected). */
export function extraDirs(cfg, cwd = process.cwd()) {
  const dirs = [];
  const push = (d) => {
    if (d && !dirs.includes(d)) dirs.push(d);
  };
  // user-chosen folders (config commands.dirs)
  for (const d of cfg.commands?.dirs || []) {
    push(path.isAbsolute(d) ? d : path.resolve(cfg._root || cwd, d));
  }
  // project markers: .nullx11/ and .nullx11code/ (project root or cwd where CLI ran)
  const root = cfg._root || projectRoot(cwd);
  for (const marker of ['.nullx11', '.nullx11code']) {
    push(path.join(root, marker));
    push(path.join(root, marker, 'commands'));
    // CLI executed directly inside a folder holding .nullx11 (marker wins in projectRoot)
    push(path.join(cwd, marker));
    push(path.join(cwd, marker, 'commands'));
  }
  // legacy projectDir + global homes
  const p = projectDir(cwd);
  push(p);
  push(path.join(p, 'commands'));
  for (const home of [globalDir(), path.join(os.homedir(), '.nullx11')]) {
    push(home);
    push(path.join(home, 'commands'));
  }
  return dirs;
}

function readCmdDir(dir) {
  const out = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    const p = path.join(dir, e.name);
    try {
      if (fs.statSync(p).size > MAX_BYTES) continue;
      const { meta, body } = parseFrontmatter(fs.readFileSync(p, 'utf8'));
      const name = String(meta.name || e.name.replace(/\.md$/i, ''))
        .trim()
        .toLowerCase();
      if (!name || !/^[a-z0-9][a-z0-9_-]*$/.test(name)) continue;
      out.push({
        name,
        description: String(meta.description || '').trim(),
        example: String(meta.example || `/${name}`).trim(),
        body: body.trim(),
        path: p,
        source: dir,
        custom: true,
      });
    } catch {
      /* unreadable file */
    }
  }
  return out;
}

/** Discover all custom commands (deduped by name). */
export function discoverExtras(cfg, cwd = process.cwd()) {
  const byName = new Map();
  for (const d of extraDirs(cfg, cwd)) {
    for (const c of readCmdDir(d)) byName.set(c.name, c);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build the final prompt from a command template (opencode-style).
 * Supports:
 *   $ARGUMENTS            — everything the user typed after the command
 *   $1..$9                — positional words ($N swallows the rest)
 *   !`shell command`      — runs the command in `root` and inlines its stdout
 * If the template has none of these and args were given, args are appended.
 */
export function renderExtra(extra, args = '', opts = {}) {
  const root = opts.root || process.cwd();
  const shell = opts.shell !== false;
  const a = String(args || '').trim();
  const body = String(extra.body || '');

  // tokenise args like opencode: quoted strings stay whole
  const tokens = a ? (a.match(/"[^"]*"|'[^']*'|[^\s"']+/g) || []).map((t) => t.replace(/^["']|["']$/g, '')) : [];
  const hasArgsPlaceholder = /\$(?:ARGUMENTS|[1-9]\d*)/.test(body);
  const numbers = [...body.matchAll(/\$([1-9]\d*)/g)].map((m) => Number(m[1]));
  const last = Math.max(0, ...numbers);

  let text = body.replace(/\$(?:ARGUMENTS|([1-9]\d*))/g, (match, num) => {
    if (match === '$ARGUMENTS') return a;
    const pos = Number(num);
    const i = pos - 1;
    if (i >= tokens.length) return '';
    return pos === last ? tokens.slice(i).join(' ') : tokens[i];
  });
  if (!hasArgsPlaceholder && a) text = `${text}\n\n${a}`;

  // opencode shell interpolation: !`git diff`
  if (shell && /!`/.test(text)) {
    text = text.replace(/!`([^`]+)`/g, (match, cmd) => {
      try {
        const out = execFileSync(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
          process.platform === 'win32' ? ['/d', '/s', '/c', cmd] : ['-c', cmd],
          { cwd: root, timeout: 5000, encoding: 'utf8', maxBuffer: 1024 * 1024, windowsHide: true });
        const trimmed = String(out || '').trim();
        return trimmed.length > 10_000 ? trimmed.slice(0, 10_000) + '\n… (truncated)' : trimmed;
      } catch (e) {
        const msg = String(e.message || e).split('\n')[0].slice(0, 200);
        return `(${cmd} failed: ${msg})`;
      }
    });
  }
  return text.trim();
}

/**
 * Resolve what the user typed against the command name list.
 * entries: [{ name, kind: 'builtin'|'extra', ref }]
 * Returns:
 *   { kind:'exact', match }            — full name typed
 *   { kind:'unique', match }           — one prefix match (e.g. /ex → extra)
 *   { kind:'ambiguous', candidates }   — several prefix matches
 *   { kind:'none' }
 */
export function resolveInvocation(entries, head) {
  const input = String(head || '').replace(/^\//, '').toLowerCase();
  if (!input) return { kind: 'none' };
  const exact = entries.find((e) => e.name === input);
  if (exact) return { kind: 'exact', match: exact };
  const cands = entries.filter((e) => e.name.startsWith(input));
  if (cands.length === 1) return { kind: 'unique', match: cands[0] };
  if (cands.length > 1) {
    // Exactly one *custom* command matches → treat as a prefix peek of it
    // (so /ex → /extra even though builtin `exit` also starts with "ex").
    const extrasOnly = cands.filter((e) => e.kind === 'extra');
    if (extrasOnly.length === 1) return { kind: 'unique', match: extrasOnly[0], viaTiebreak: true };
    return { kind: 'ambiguous', candidates: cands };
  }
  return { kind: 'none' };
}

/** Build the entries list (builtins first) used by resolveInvocation + completion. */
export function commandEntries(builtins, extras) {
  return [
    ...builtins.map((b) => ({ name: b.name, kind: 'builtin', ref: b, description: b.desc || '' })),
    ...extras.map((x) => ({ name: x.name, kind: 'extra', ref: x, description: x.description, example: x.example })),
  ];
}
