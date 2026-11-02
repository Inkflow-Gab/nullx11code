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

/** Fill $ARGUMENTS (or append) to build the final prompt. */
export function renderExtra(extra, args = '') {
  const a = String(args || '').trim();
  if (extra.body.includes('$ARGUMENTS')) return extra.body.split('$ARGUMENTS').join(a);
  return a ? `${extra.body}\n\n${a}` : extra.body;
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
