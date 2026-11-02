// Agent tools: list / read / write / grep files + shell, with approval for mutating actions.
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';

const IGNORE_DIRS = new Set([
  '.git', 'node_modules', '.nullx11code-cache', 'dist', 'build', 'out', 'coverage',
  '.next', '.nuxt', '.turbo', '.cache', '__pycache__', '.venv', 'venv', '.mypy_cache',
  '.pytest_cache', '.ruff_cache', '.tox', '.idea', '.vscode',
]);
const MAX_READ_BYTES = 64 * 1024;
const MAX_LIST = 400;
const MAX_GREP_HITS = 120;
const MAX_WRITE_BYTES = 256 * 1024;

/** JSON Schemas advertised to the model (OpenAI function-calling style). */
export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and folders in a directory (relative to the project root).',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path, default "."' },
          depth: { type: 'integer', description: 'Max depth, default 2' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file from the project. Returns numbered lines.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          offset: { type: 'integer', description: '1-based start line (optional)' },
          limit: { type: 'integer', description: 'Max lines to return (optional)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or overwrite a text file in the project. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'grep',
      description: 'Search file contents with a regular expression.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string' },
          path: { type: 'string', description: 'Directory or file, default "."' },
          glob: { type: 'string', description: 'Filename filter, e.g. "*.js"' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'glob',
      description: 'Find files by glob pattern (e.g. "**/*.ts", "src/*.js"). Returns matching paths.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern, default "**/*"' },
          path: { type: 'string', description: 'Directory to search, default "."' },
          limit: { type: 'integer', description: 'Max results, default 100' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit',
      description: 'Replace an exact string in a file (old_string must match uniquely). Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          old_string: { type: 'string', description: 'Exact text to find (must occur exactly once)' },
          new_string: { type: 'string', description: 'Replacement text' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'webfetch',
      description: 'Fetch an HTTP(S) URL and return it as plain text (tags stripped).',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          max_chars: { type: 'integer', description: 'Truncate to this many chars, default 8000' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'todowrite',
      description: 'Update the todo list for the current task. Pass the full list each time.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The full updated todo list',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Brief task description' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'shell',
      description: 'Run a shell command in the project. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
      },
    },
  },
];

function resolveRoot(root) {
  return path.resolve(root);
}

function safePath(root, p) {
  const abs = path.resolve(resolveRoot(root), p || '.');
  const rel = path.relative(resolveRoot(root), abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    const err = new Error(`path escapes project root: ${p}`);
    err.code = 'ESCAPE';
    throw err;
  }
  return abs;
}

function walk(dir, depth, out, prefix = '', budget = { n: MAX_LIST }) {
  if (depth < 0 || budget.n <= 0) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
  for (const e of entries) {
    if (budget.n <= 0) return;
    if (IGNORE_DIRS.has(e.name)) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push(rel + '/');
      budget.n--;
      walk(path.join(dir, e.name), depth - 1, out, rel, budget);
    } else {
      out.push(rel);
      budget.n--;
    }
  }
}

function globToRe(glob) {
  const esc = String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${esc}$`);
}

function* walkFiles(dir, depth = 8) {
  if (depth < 0) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (IGNORE_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(full, depth - 1);
    else if (e.isFile()) yield full;
  }
}

/** Execute a tool call. `approve` is async (action) => boolean for gated tools. */
export async function runTool(name, args, ctx) {
  const { root, cwd, approve } = ctx;
  const needsApproval = (action) => (approve ? approve(action) : Promise.resolve(true));

  switch (name) {
    case 'list_files': {
      const dir = safePath(root, args.path || '.');
      if (!fs.existsSync(dir)) return `Not found: ${args.path}`;
      const out = [];
      walk(dir, args.depth ?? 2, out);
      return out.length ? out.join('\n') : '(empty directory)';
    }
    case 'read_file': {
      const file = safePath(root, args.path);
      if (!fs.existsSync(file)) return `Not found: ${args.path}`;
      const stat = fs.statSync(file);
      if (stat.isDirectory()) return `${args.path} is a directory — use list_files.`;
      if (stat.size > MAX_READ_BYTES) return `File too large (${stat.size} bytes); request a range with offset/limit.`;
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      const offset = Math.max(1, args.offset || 1);
      const limit = args.limit ?? 2000;
      const slice = lines.slice(offset - 1, offset - 1 + limit);
      if (!slice.length) return '(empty file)';
      return slice.map((l, i) => `${String(offset + i).padStart(5)}|${l}`).join('\n');
    }
    case 'write_file': {
      const file = safePath(root, args.path);
      const content = String(args.content ?? '');
      if (content.length > MAX_WRITE_BYTES) return 'Content too large to write.';
      const rel = path.relative(resolveRoot(root), file) || args.path;
      const preview = content.split('\n').slice(0, 12).join('\n');
      const ok = await needsApproval({
        kind: 'write',
        title: `Write file ${rel}`,
        detail: `${content.split('\n').length} lines · ${content.length} bytes`,
        preview,
        command: null,
      });
      if (!ok) return 'User rejected the file write.';
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      return `Wrote ${content.length} bytes to ${rel}`;
    }
    case 'grep': {
      const target = safePath(root, args.path || '.');
      if (!fs.existsSync(target)) return `Not found: ${args.path}`;
      const re = new RegExp(args.pattern, 'i');
      const nameRe = args.glob ? globToRe(args.glob) : null;
      const hits = [];
      const files = fs.statSync(target).isDirectory() ? [...walkFiles(target)] : [target];
      for (const f of files) {
        if (hits.length >= MAX_GREP_HITS) break;
        if (nameRe && !nameRe.test(path.basename(f))) continue;
        let text;
        try {
          const stat = fs.statSync(f);
          if (stat.size > 512 * 1024) continue;
          text = fs.readFileSync(f, 'utf8');
        } catch {
          continue;
        }
        if (text.includes('\0')) continue;
        const lines = text.split('\n');
        for (let i = 0; i < lines.length && hits.length < MAX_GREP_HITS; i++) {
          if (re.test(lines[i])) {
            const rel = path.relative(resolveRoot(root), f);
            hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          }
        }
      }
      if (!hits.length) return `No matches for /${args.pattern}/`;
      const more = hits.length >= MAX_GREP_HITS ? '\n… truncated' : '';
      return hits.join('\n') + more;
    }
    case 'glob': {
      const dir = safePath(root, args.path || '.');
      if (!fs.existsSync(dir)) return `Not found: ${args.path}`;
      const limit = Math.min(args.limit ?? 100, 400);
      const re = globToRe(String(args.pattern || '**/*'));
      const hits = [];
      for (const f of walkFiles(dir)) {
        const rel = path.relative(resolveRoot(root), f).split(path.sep).join('/');
        if (re.test(rel) || re.test(path.basename(rel))) hits.push(rel);
        if (hits.length >= limit) break;
      }
      if (!hits.length) return `No files match ${args.pattern}`;
      return hits.join('\n') + (hits.length >= limit ? '\n… truncated' : '');
    }
    case 'edit': {
      const file = safePath(root, args.path);
      if (!fs.existsSync(file)) return `Not found: ${args.path}`;
      const oldStr = String(args.old_string ?? '');
      const newStr = String(args.new_string ?? '');
      if (!oldStr) return 'old_string is required.';
      const src = fs.readFileSync(file, 'utf8');
      const first = src.indexOf(oldStr);
      if (first === -1) return `old_string not found in ${args.path}.`;
      if (src.indexOf(oldStr, first + 1) !== -1) {
        return `old_string occurs ${src.split(oldStr).length - 1} times in ${args.path} — add more context to make it unique.`;
      }
      const rel = path.relative(resolveRoot(root), file) || args.path;
      const preview = oldStr.split('\n').slice(0, 8).join('\n');
      const ok = await needsApproval({
        kind: 'write',
        title: `Edit file ${rel}`,
        detail: `${oldStr.length} → ${newStr.length} chars`,
        preview,
        command: null,
      });
      if (!ok) return 'User rejected the file edit.';
      fs.writeFileSync(file, src.slice(0, first) + newStr + src.slice(first + oldStr.length));
      return `Edited ${rel} (${oldStr.length} chars replaced).`;
    }
    case 'webfetch': {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return 'webfetch only supports http(s) URLs.';
      const max = Math.min(args.max_chars ?? 8000, 40_000);
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(15_000),
          headers: { 'user-agent': 'nullx11code/0.1 (+https://github.com/Inkflow-Gab/nullx11code)' },
        });
        if (!res.ok) return `HTTP ${res.status} ${res.statusText} for ${url}`;
        let text = await res.text();
        // crude HTML → text (zero deps): drop script/style, then tags
        text = text.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ');
        text = text.replace(/<!--[\s\S]*?-->/g, ' ');
        text = text.replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, '\n');
        text = text.replace(/<[^>]+>/g, ' ');
        text = text
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        if (text.length > max) text = text.slice(0, max) + '\n… (truncated)';
        return text || '(empty page)';
      } catch (e) {
        return `Fetch failed: ${e.message || e}`;
      }
    }
    case 'todowrite': {
      const todos = Array.isArray(args.todos) ? args.todos : [];
      if (!ctx.todos) ctx.todos = [];
      ctx.todos = todos.slice(0, 50);
      if (!ctx.todos.length) return 'Todos cleared.';
      const count = (s) => ctx.todos.filter((t) => t.status === s).length;
      const parts = [`${count('completed')}/${ctx.todos.length} completed`];
      for (const s of ['in_progress', 'pending', 'cancelled']) {
        const n = count(s);
        if (n) parts.push(`${n} ${s.replace('_', ' ')}`);
      }
      const active = ctx.todos.filter((t) => t.status === 'in_progress').map((t) => `"${t.content}"`);
      return `Todos updated: ${parts.join(', ')}${active.length ? `. In progress: ${active.join(', ')}` : ''}`;
    }
    case 'shell': {
      const command = String(args.command ?? '').trim();
      if (!command) return 'Empty command.';
      const ok = await needsApproval({
        kind: 'shell',
        title: 'Run shell command',
        detail: `cwd: ${path.relative(root, cwd) || '.'}`,
        preview: null,
        command,
      });
      if (!ok) return 'User rejected the command.';
      return await new Promise((resolve) => {
        exec(
          command,
          { cwd, timeout: 60_000, maxBuffer: 2 * 1024 * 1024, shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' },
          (err, stdout, stderr) => {
            let out = '';
            if (stdout) out += stdout;
            if (stderr) out += (out ? '\n' : '') + stderr;
            if (err && !out) out = String(err.message);
            if (out.length > 30_000) out = out.slice(0, 30_000) + '\n… output truncated';
            resolve(out || '(no output)');
          }
        );
      });
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

/** Human-readable action summary for approval prompts. */
export function actionSummary(action) {
  if (action.kind === 'shell') {
    return `${action.title}\n  $ ${action.command}`;
  }
  return `${action.title}  ${action.detail ? cdim(action.detail) : ''}\n${action.preview ? action.preview.split('\n').map((l) => '  ' + l).join('\n') : ''}`;
}
function cdim(s) {
  return String(s);
}
