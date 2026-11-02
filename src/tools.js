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
      name: 'question',
      description:
        'Ask the user questions during execution — clarify requirements, offer choices, get decisions. ' +
        'A free-form "type your own" option is always available to the user; put a recommended choice first with "(Recommended)".',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: 'Questions to ask',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                options: { type: 'array', items: { type: 'string' }, description: 'Numbered choices (2-6)' },
                multiple: { type: 'boolean', description: 'Allow selecting more than one option' },
              },
              required: ['question'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'todoread',
      description: 'Read the current todo list for this task.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch',
      description:
        'Apply a unified diff (git-style) to multiple files in one call: add, update, or delete. ' +
        'Hunks must match the current file content exactly. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          patchText: {
            type: 'string',
            description:
              'Full unified diff: diff --git a/f b/f · --- a/f · +++ b/f · @@ hunks with context/-/+ lines (use /dev/null to add or delete files)',
          },
        },
        required: ['patchText'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'subagent',
      description:
        'Delegate a focused task to a child agent session with its own context window (exploration, research, separable subtasks). Returns the child final output.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'One-line summary of the delegated task' },
          prompt: { type: 'string', description: 'Full instructions for the child agent' },
          agent: { type: 'string', enum: ['build', 'plan'], description: 'Child mode: build (default) or plan (read-only)' },
          model: { type: 'string', description: 'Optional child model id (defaults to the current model)' },
        },
        required: ['description', 'prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'load_skill',
      description: 'Load the full instructions of a discovered skill by name (use when a skill is relevant but not active).',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
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

/**
 * Parse a git-style unified diff into per-file operations.
 * Supports: diff --git / --- / +++ headers, @@ hunks, /dev/null (add/delete),
 * "\ No newline at end of file" markers (ignored — we normalize trailing newline).
 */
export function parseUnifiedDiff(text) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const files = [];
  let cur = null;
  let i = 0;
  const startFile = () => {
    cur = { path: null, oldPath: null, isNew: false, deleteFile: false, hunks: [] };
    files.push(cur);
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      startFile();
      i++;
      continue;
    }
    if (line.startsWith('--- ')) {
      if (!cur) startFile();
      const p = stripPrefix(line.slice(4).trim());
      cur.oldPath = p;
      i++;
      continue;
    }
    if (line.startsWith('+++ ')) {
      if (!cur) startFile();
      const p = stripPrefix(line.slice(4).trim());
      if (p === '/dev/null') {
        cur.deleteFile = true;
        cur.path = cur.oldPath;
      } else {
        cur.path = p;
        if (cur.oldPath === '/dev/null' || cur.oldPath == null) cur.isNew = true;
      }
      i++;
      continue;
    }
    const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (m) {
      if (!cur) startFile();
      const oldStart = Number(m[1]);
      const oldCount = m[2] == null ? 1 : Number(m[2]);
      const newStart = Number(m[3]);
      const newCount = m[4] == null ? 1 : Number(m[4]);
      i++;
      const oldLines = [];
      const newLines = [];
      while (i < lines.length) {
        const l = lines[i];
        if (l.startsWith('@@') || l.startsWith('diff --git') || l.startsWith('--- ') || l.startsWith('+++ ')) break;
        if (l.startsWith('\\')) {
          i++;
          continue; // \ No newline at end of file
        }
        const tag = l[0];
        const body = l.slice(1);
        if (tag === ' ') {
          oldLines.push(body);
          newLines.push(body);
        } else if (tag === '-') {
          oldLines.push(body);
        } else if (tag === '+') {
          newLines.push(body);
        } else if (l === '') {
          // some tools emit empty context lines without the leading space
          oldLines.push('');
          newLines.push('');
        } else break;
        i++;
      }
      cur.hunks.push({ oldStart, oldCount, newStart, newCount, oldLines, newLines });
      continue;
    }
    i++;
  }
  for (const f of files) {
    if (!f.path && f.oldPath) f.path = f.oldPath;
    if (!f.path) throw new Error('file section without a path');
    f.path = f.path.replace(/^[ab]\//, '');
  }
  return files.filter((f) => f.path && (f.deleteFile || f.hunks.length));
}

function stripPrefix(p) {
  return p.replace(/^"|"$/g, '').replace(/^[ab]\//, (m, off, s) => (s.startsWith('/dev/null') ? m : ''));
}

/**
 * Apply parsed hunks to `before` content, returning the new content.
 * Verifies every context/removal line against the original text (offsets stay original-based).
 */
export function applyHunks(before, hunks, isNew) {
  if (isNew) {
    const out = [];
    for (const h of hunks) out.push(...h.newLines);
    return out.join('\n') + '\n';
  }
  const orig = before.split('\n');
  // 1. verify
  for (const h of hunks) {
    const start = Math.max(0, h.oldStart - 1);
    let oi = 0;
    for (let k = 0; k < h.oldLines.length; k++) {
      const expected = h.oldLines[k];
      const actual = orig[start + k];
      if (actual === undefined) {
        throw new Error(`hunk at line ${h.oldStart}: file is shorter than expected (missing "${truncate(expected)}")`);
      }
      if (actual !== expected) {
        throw new Error(`hunk at line ${h.oldStart}: expected "${truncate(expected)}" but found "${truncate(actual)}"`);
      }
      oi++;
    }
    void oi;
  }
  // 2. rebuild: walk original lines, splice hunks at their oldStart positions (in order)
  const out = [];
  let cursor = 0; // 0-based index into orig
  const sorted = [...hunks].sort((a, b) => a.oldStart - b.oldStart);
  for (const h of sorted) {
    const start = Math.max(0, h.oldStart - 1);
    if (start < cursor) throw new Error('overlapping hunks');
    while (cursor < start) out.push(orig[cursor++]);
    out.push(...h.newLines);
    cursor = start + h.oldLines.length;
  }
  while (cursor < orig.length) out.push(orig[cursor++]);
  let result = out.join('\n');
  if (!result.endsWith('\n')) result += '\n';
  return result;
}

function truncate(s) {
  s = String(s ?? '');
  return s.length > 60 ? s.slice(0, 57) + '...' : s;
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
    case 'question': {
      const questions = Array.isArray(args.questions) ? args.questions.slice(0, 6) : [];
      if (!questions.length) return 'No questions provided.';
      if (typeof ctx.askQuestions !== 'function') {
        return 'The user is not available to answer questions right now — continue with your best judgment.';
      }
      const answers = await ctx.askQuestions(questions);
      if (!answers) return 'The user dismissed the questions.';
      const formatted = questions
        .map((q, i) => {
          const a = answers[i];
          const val = Array.isArray(a) ? a.join(', ') : a == null || a === '' ? 'Unanswered' : String(a);
          return `"${q.question}"="${val}"`;
        })
        .join(', ');
      return `User has answered your questions: ${formatted}. Continue with the user's answers in mind.`;
    }
    case 'todoread': {
      const todos = Array.isArray(ctx.todos) ? ctx.todos : [];
      if (!todos.length) return 'No todos yet.';
      const mark = { completed: '[x]', in_progress: '[~]', pending: '[ ]', cancelled: '[-]' };
      return todos.map((t) => `${mark[t.status] || '[ ]'} ${t.content}`).join('\n');
    }
    case 'patch': {
      const patchText = String(args.patchText ?? '');
      if (!patchText.trim()) return 'Empty patch.';
      let plan;
      try {
        plan = parseUnifiedDiff(patchText);
      } catch (e) {
        return `Patch parse error: ${e.message}`;
      }
      if (!plan.length) return 'No file sections found in patch (expected ---/+++ or diff --git headers).';
      // verify all hunks against current content BEFORE asking approval
      const results = [];
      for (const file of plan) {
        const abs = safePath(root, file.path);
        const exists = fs.existsSync(abs);
        if (file.deleteFile) {
          if (!exists) return `Cannot delete ${file.path}: not found.`;
          results.push({ file, abs, before: fs.readFileSync(abs, 'utf8'), after: null });
          continue;
        }
        const before = exists ? fs.readFileSync(abs, 'utf8') : '';
        if (!exists && !file.isNew) return `Not found: ${file.path}`;
        if (exists && file.isNew) return `${file.path} already exists (patch says add).`;
        let after;
        try {
          after = applyHunks(before, file.hunks, file.isNew);
        } catch (e) {
          return `Patch does not apply to ${file.path}: ${e.message}`;
        }
        results.push({ file, abs, before, after });
      }
      const preview = plan
        .map((f) => `${f.deleteFile ? 'D' : f.isNew ? 'A' : 'M'} ${f.path} (${f.hunks.length} hunk${f.hunks.length === 1 ? '' : 's'})`)
        .join('\n');
      const ok = await needsApproval({
        kind: 'write',
        title: `Apply patch — ${plan.length} file${plan.length === 1 ? '' : 's'}`,
        detail: '',
        preview,
        command: null,
      });
      if (!ok) return 'User rejected the patch.';
      for (const r of results) {
        if (r.after == null) {
          fs.unlinkSync(r.abs);
        } else {
          fs.mkdirSync(path.dirname(r.abs), { recursive: true });
          fs.writeFileSync(r.abs, r.after);
        }
      }
      return `Success. Updated ${results.length} file(s):\n${results
        .map((r) => `${r.file.deleteFile ? 'D' : r.file.isNew ? 'A' : 'M'} ${r.file.path}`)
        .join('\n')}`;
    }
    case 'subagent': {
      const prompt = String(args.prompt || '');
      if (!prompt) return 'No prompt provided for the subagent.';
      if (typeof ctx.subagent !== 'function') {
        return 'Subagents are not available in this context.';
      }
      return await ctx.subagent({
        description: String(args.description || prompt.slice(0, 120)),
        prompt,
        agent: args.agent === 'plan' ? 'plan' : 'build',
        model: typeof args.model === 'string' && args.model ? args.model : undefined,
      });
    }
    case 'load_skill': {
      const name = String(args.name || '').trim().toLowerCase();
      if (!name) return 'name required.';
      const skills = ctx.skills || [];
      const hit = skills.find((s) => s.name.toLowerCase() === name);
      if (!hit) return `No skill "${name}". Available: ${skills.map((s) => s.name).join(', ') || '(none)'}`;
      return `<skill_content name="${hit.name}">\n${hit.body || ''}\n</skill_content>\nBase directory: ${hit.dir}`;
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
