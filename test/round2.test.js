// Round-2 opencode port: permissions, mentions, patch, question, subagent, web API.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { matchPattern, actionForKind, evaluate, describeRules } from '../src/permissions.js';
import { expandMentions, buildContent } from '../src/mentions.js';
import { parseUnifiedDiff, applyHunks, runTool, TOOL_SCHEMAS } from '../src/tools.js';
import { runTurn } from '../src/chat.js';
import { findCommand } from '../src/commands.js';
import { startServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';

/* ---------- permissions ---------- */

test('matchPattern globs: exact, star, mid-wildcards', () => {
  assert.ok(matchPattern('git *', 'git push origin main'));
  assert.ok(matchPattern('git *', 'git status'));
  assert.ok(!matchPattern('git *', 'rm -rf /'));
  assert.ok(matchPattern('*', 'anything at all'));
  assert.ok(matchPattern('npm run *', 'npm run test'));
  assert.ok(!matchPattern('npm run *', 'npm install'));
  assert.ok(matchPattern('*.md', 'README.md'));
});

test('actionForKind maps tool kinds to permission actions', () => {
  assert.equal(actionForKind('shell'), 'shell');
  assert.equal(actionForKind('write'), 'edit');
  assert.equal(actionForKind('edit'), 'edit');
  assert.equal(actionForKind('question'), 'question');
  assert.equal(actionForKind('read'), 'read');
  assert.equal(actionForKind(undefined), '*');
});

test('evaluate: deny wins over allow, then allow, then default', () => {
  const perms = {
    default: 'ask',
    rules: [
      { action: '*', resource: 'git *', effect: 'allow' },
      { action: 'shell', resource: 'rm -rf *', effect: 'deny' },
      { action: 'shell', resource: 'npm install', effect: 'allow' },
    ],
  };
  // deny rule is later in the list but still wins
  assert.equal(evaluate('shell', 'rm -rf /tmp/x', perms), 'deny');
  assert.equal(evaluate('shell', 'git push', perms), 'allow');
  assert.equal(evaluate('shell', 'npm install', perms), 'allow');
  assert.equal(evaluate('shell', 'ls -la', perms), 'ask'); // default
  assert.equal(evaluate('edit', 'anything', perms), 'ask');
});

test('evaluate respects allow/deny defaults and empty perms', () => {
  assert.equal(evaluate('shell', 'x', { default: 'allow', rules: [] }), 'allow');
  assert.equal(evaluate('shell', 'x', { default: 'deny', rules: [] }), 'deny');
  assert.equal(evaluate('shell', 'x', undefined), 'ask');
});

test('describeRules renders a listing', () => {
  const view = describeRules({ default: 'deny', rules: [{ action: 'shell', resource: 'git *', effect: 'allow' }] });
  assert.equal(view.default, 'deny');
  assert.equal(view.rules.length, 1);
  assert.equal(view.rules[0].action, 'shell');
  assert.equal(view.rules[0].effect, 'allow');
});

test('/permissions command adds + lists rules (temp cwd, no repo writes)', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n11-perm-'));
  try {
    const cmd = findCommand('permissions');
    assert.ok(cmd, 'permissions command exists');
    const ctx = { cfg: { permissions: { default: 'ask', rules: [] } }, cwd: tmp };
    const out = cmd.run(ctx, 'add shell "git *" allow');
    assert.match(out, /rule added/);
    assert.equal(ctx.cfg.permissions.rules.length, 1);
    assert.deepEqual(ctx.cfg.permissions.rules[0], { action: 'shell', resource: 'git *', effect: 'allow' });
    // persisted to project config in tmp
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, '.nullx11code', 'config.json'), 'utf8'));
    assert.equal(saved.permissions.rules[0].effect, 'allow');
    // deny beats allow now
    assert.equal(evaluate('shell', 'git push', ctx.cfg.permissions), 'allow');
    ctx.cfg.permissions.rules.push({ action: 'shell', resource: 'git *', effect: 'deny' });
    assert.equal(evaluate('shell', 'git push', ctx.cfg.permissions), 'deny');
    const listing = cmd.run(ctx, '');
    assert.match(listing, /shell/);
    const rm = cmd.run(ctx, 'rm 1');
    assert.match(rm, /removed/);
    assert.equal(ctx.cfg.permissions.rules.length, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ---------- @mentions ---------- */

test('expandMentions inlines text files with a labeled fence', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n11-mention-'));
  try {
    fs.writeFileSync(path.join(tmp, 'notes.md'), '# Notes\nhello world\n');
    const r = expandMentions('check @notes.md please', tmp);
    assert.deepEqual(r.files, ['notes.md']);
    assert.match(r.text, /```+md file:notes\.md/); // labeled fence replaces the mention
    assert.match(r.text, /hello world/);
    assert.match(r.text, /check /); // surrounding sentence intact
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('expandMentions blocks root escapes and ignores non-files', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n11-mention2-'));
  try {
    const r = expandMentions('peek @../etc/passwd and @not-a-file', tmp);
    assert.equal(r.files.length, 0);
    assert.ok(r.text.includes('@../etc/passwd'), 'escape mention left as-is');
    assert.ok(r.text.includes('@not-a-file'));
    assert.ok(!r.text.includes('root:'), 'never read the outside file');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('expandMentions attaches images as data URLs', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n11-mention3-'));
  try {
    // minimal 1x1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(path.join(tmp, 'dot.png'), png);
    const r = expandMentions('see @dot.png', tmp);
    assert.equal(r.images.length, 1);
    assert.equal(r.images[0].rel, 'dot.png');
    assert.ok(r.images[0].dataUrl.startsWith('data:image/png;base64,'));
    assert.equal(r.files.length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildContent: string stays string, images make a multimodal array', () => {
  assert.equal(buildContent('hi', []), 'hi');
  const arr = buildContent('hi', [{ rel: 'a.png', dataUrl: 'data:image/png;base64,AA' }]);
  assert.ok(Array.isArray(arr));
  assert.equal(arr[0].type, 'text');
    assert.equal(arr[0].text, 'hi');
  assert.equal(arr[1].type, 'image_url');
  assert.ok(arr[1].image_url.url.startsWith('data:image/'));
});

/* ---------- patch (unified diff) ---------- */

test('parseUnifiedDiff: update, add, delete files', () => {
  const diff = [
    'diff --git a/old.txt b/old.txt',
    '--- a/old.txt',
    '+++ b/old.txt',
    '@@ -1,2 +1,2 @@',
    ' line one',
    '-line two',
    '+line TWO',
    'diff --git a/new.txt b/new.txt',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1,1 @@',
    '+fresh',
    'diff --git a/gone.txt b/gone.txt',
    '--- a/gone.txt',
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    '-bye',
  ].join('\n');
  const files = parseUnifiedDiff(diff);
  assert.equal(files.length, 3);
  assert.equal(files[0].path, 'old.txt');
  assert.equal(files[0].isNew, false);
  assert.equal(files[0].deleteFile, false);
  assert.equal(files[0].hunks.length, 1);
  assert.equal(files[1].path, 'new.txt');
  assert.equal(files[1].isNew, true);
  assert.equal(files[2].path, 'gone.txt');
  assert.equal(files[2].deleteFile, true);
});

test('applyHunks applies context edits and verifies exact match', () => {
  const before = 'line one\nline two\nline three\n';
  const diff = ['--- a/x.txt', '+++ b/x.txt', '@@ -1,3 +1,3 @@', ' line one', '-line two', '+line TWO', ' line three'].join('\n');
  const [file] = parseUnifiedDiff(diff);
  const after = applyHunks(before, file.hunks, false);
  assert.equal(after, 'line one\nline TWO\nline three\n');
});

test('applyHunks throws on context mismatch', () => {
  const before = 'totally different\n';
  const diff = ['--- a/x.txt', '+++ b/x.txt', '@@ -1,1 +1,1 @@', ' expected', '-old', '+new'].join('\n');
  const [file] = parseUnifiedDiff(diff);
  assert.throws(() => applyHunks(before, file.hunks, false), /expected|found|mismatch/i);
});

/* ---------- question tool ---------- */

test('question tool formats answers opencode-style', async () => {
  const out = await runTool(
    'question',
    { questions: [{ question: 'Which color?', options: ['red', 'blue'] }] },
    { askQuestions: async () => [['blue']] }
  );
  assert.match(out, /User has answered your questions/);
  assert.match(out, /"Which color\?"="blue"/);
});

test('question tool degrades gracefully without askQuestions', async () => {
  const out = await runTool('question', { questions: [{ question: 'q?' }] }, {});
  assert.match(out, /not available/);
});

test('question tool reports dismissal', async () => {
  const out = await runTool(
    'question',
    { questions: [{ question: 'q?' }] },
    { askQuestions: async () => null }
  );
  assert.match(out, /dismissed/);
});

/* ---------- subagent + allowTools ---------- */

function sse(payload) {
  return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

test('subagent tool runs a child turn and returns its output', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (url, opts) => {
      calls++;
      const body = JSON.parse(opts.body);
      const isChild = body.messages.some((m) => m.role === 'system' && /subagent/.test(m.content || ''));
      if (isChild) {
        return sse({ choices: [{ delta: { content: 'CHILD-RESULT' }, finish_reason: 'stop' }] });
      }
      if (calls === 1) {
        return sse({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'c1',
                    function: { name: 'subagent', arguments: JSON.stringify({ description: 'research X', prompt: 'find X' }) },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        });
      }
      return sse({ choices: [{ delta: { content: 'PARENT DONE' }, finish_reason: 'stop' }] });
    };

    const events = [];
    const messages = [{ role: 'user', content: 'delegate' }];
    for await (const ev of runTurn({
      prov: { base: 'http://mock.test/v1' },
      model: 'm',
      messages,
      ctx: { root: process.cwd(), approve: async () => true, todos: [] },
    })) {
      events.push(ev.type);
    }
    assert.ok(events.includes('tool_start'));
    const toolMsg = messages.find((m) => m.role === 'tool');
    assert.ok(toolMsg, 'tool result message appended');
    assert.match(toolMsg.content, /CHILD-RESULT/);
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    assert.equal(lastAssistant.content, 'PARENT DONE');
    assert.equal(calls, 3, 'parent → child → parent');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('allowTools filters the tool schema list sent to the model', async () => {
  const realFetch = globalThis.fetch;
  let seen = null;
  try {
    globalThis.fetch = async (url, opts) => {
      seen = JSON.parse(opts.body).tools?.map((t) => t.function.name) ?? null;
      return sse({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] });
    };
    for await (const _ of runTurn({
      prov: { base: 'http://mock.test/v1' },
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      ctx: { allowTools: ['read_file', 'grep'] },
    })) {
      /* drain */
    }
    assert.deepEqual(seen, ['read_file', 'grep']);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('subagent tool is in the schema catalog and denies without a factory', async () => {
  assert.ok(TOOL_SCHEMAS.some((s) => s.function.name === 'subagent'));
  const out = await runTool('subagent', { description: 'd', prompt: 'p' }, {});
  assert.match(out, /not available/);
});

/* ---------- web API (server-side command parity) ---------- */

test('web API: /api/commands, /api/command, /api/expand', async () => {
  const info = await startServer({ port: 0, host: '127.0.0.1', cfg: loadConfig(process.cwd()) });
  try {
    const base = `http://127.0.0.1:${info.port}`;
    const list = await (await fetch(`${base}/api/commands`)).json();
    assert.ok(Array.isArray(list) && list.length > 10, 'command list served');
    assert.ok(list.some((c) => c.name === 'help' && c.kind === 'builtin'));
    assert.ok(list.some((c) => c.kind === 'extra'), 'custom .nullx11 commands included');

    const help = await (
      await fetch(`${base}/api/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'help', args: '' }),
      })
    ).json();
    assert.equal(typeof help.output, 'string');
    assert.ok(help.output.length > 50, 'help text returned');
    assert.ok(!help.prompt, 'help is not a chat prompt');

    const bad = await (
      await fetch(`${base}/api/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'definitely-not-a-command', args: '' }),
      })
    ).json();
    assert.match(String(bad.output), /unknown command/);

    const ex = await (
      await fetch(`${base}/api/expand`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'read @README.md now' }),
      })
    ).json();
    assert.deepEqual(ex.files, ['README.md']);
    assert.match(ex.text, /file:README\.md/);
  } finally {
    info.server.closeAllConnections?.();
    await info.close();
  }
});

test('web API: /api/answer resolves a pending question (no-op when unknown)', async () => {
  const info = await startServer({ port: 0, host: '127.0.0.1', cfg: loadConfig(process.cwd()) });
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/api/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'q_nope', answers: ['a'] }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  } finally {
    info.server.closeAllConnections?.();
    await info.close();
  }
});
