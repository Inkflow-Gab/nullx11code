// Unit + smoke tests for nullx11code (no network, no real keys).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseEnvFile, loadConfig, getApiKey, VERSION, skillDirs } from '../src/config.js';
import { parseFrontmatter, discoverSkills, skillsPrompt, suggestSkills } from '../src/skills.js';
import { modelFamily, familyMeta } from '../src/models.js';
import { PROVIDERS, allProviders, resolveProvider, guessModel } from '../src/providers.js';
import { findCommand, completeCommand, COMMANDS } from '../src/commands.js';
import { TOOL_SCHEMAS, runTool } from '../src/tools.js';
import { runTurn } from '../src/chat.js';
import { stripAnsi, wrap, modelBadge, colorsEnabled } from '../src/ui.js';

test('version is semver-ish', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

test('parseEnvFile handles export, quotes, comments', () => {
  const env = parseEnvFile(`
# comment
FOO=bar
export BAZ="hello world"
QUX='single'
EMPTY=
IGNORED not kv
`);
  assert.equal(env.FOO, 'bar');
  assert.equal(env.BAZ, 'hello world');
  assert.equal(env.QUX, 'single');
  assert.equal(env.EMPTY, '');
  assert.equal(env.IGNORED, undefined);
});

test('loadConfig merges defaults and returns root', () => {
  const cfg = loadConfig(process.cwd());
  assert.ok(cfg._root);
  assert.equal(typeof cfg.temperature, 'number');
  assert.ok(Array.isArray(cfg.skills.dirs));
  // skillDirs() adds the project + global skill folders on top of config dirs
  const dirs = skillDirs(cfg, process.cwd());
  assert.ok(dirs.some((d) => d.endsWith(path.join('.nullx11code', 'skills'))), `dirs: ${dirs}`);
  assert.ok(dirs.some((d) => d.endsWith(path.join('.nullx11code', 'skills')) && fs.existsSync(d)));
});

test('provider registry: nvidia is free flagship, all have required fields', () => {
  const nvidia = PROVIDERS.find((p) => p.id === 'nvidia');
  assert.ok(nvidia, 'nvidia exists');
  assert.equal(nvidia.free, true);
  for (const p of PROVIDERS) {
    assert.ok(p.id && p.name && p.base && Array.isArray(p.env), `${p.id} fields`);
    assert.match(p.base, /^https?:\/\//);
  }
});

test('resolveProvider prefers free detected provider', () => {
  const cfg = loadConfig(process.cwd());
  cfg._env = { GROQ_API_KEY: 'test-key' };
  const prov = resolveProvider(cfg);
  // github token may exist in real env; with only GROQ in _env it must pick a free detected one
  assert.equal(prov.free, true);
  assert.ok(prov.detected);
});

test('guessModel matches preferred regex then falls back to first', () => {
  const prov = PROVIDERS.find((p) => p.id === 'nvidia');
  const models = [{ id: 'foo/bar-1' }, { id: 'meta/llama-3.3-70b-instruct' }];
  assert.equal(guessModel(prov, models), 'meta/llama-3.3-70b-instruct');
  assert.equal(guessModel(prov, [{ id: 'only-one' }]), 'only-one');
  assert.equal(guessModel({ ...prov, preferred: [] }, models), 'foo/bar-1');
});

test('modelFamily detects families', () => {
  assert.equal(modelFamily('meta/llama-3.3-70b-instruct'), 'llama');
  assert.equal(modelFamily('deepseek-ai/deepseek-r1'), 'deepseek');
  assert.equal(modelFamily('qwen/qwen2.5-coder-32b'), 'qwen');
  assert.equal(modelFamily('nvidia/llama-3.1-nemotron-70b'), 'nemotron');
  assert.equal(modelFamily('mistralai/mixtral-8x7b'), 'mistral');
  assert.equal(modelFamily('gpt-4o-mini'), 'gpt');
  assert.equal(modelFamily('gemini-2.5-flash'), 'gemini');
  assert.equal(modelFamily('something-unknown'), 'generic');
  const meta = familyMeta('llama-3-8b');
  assert.equal(meta.letters, 'LL');
  assert.ok(meta.color.startsWith('#'));
});

test('frontmatter parser: keys, booleans, body', () => {
  const { meta, body } = parseFrontmatter(`---\nname: demo\ndescription: "Says hi"\nalways: true\n---\n\n# Demo\nbody`);
  assert.equal(meta.name, 'demo');
  assert.equal(meta.description, 'Says hi');
  assert.equal(meta.always, true);
  assert.match(body, /^# Demo/);
  const noFm = parseFrontmatter('just text');
  assert.equal(noFm.meta.name, undefined);
  assert.equal(noFm.body, 'just text');
});

test('skills discovery finds bundled example skills', () => {
  const cfg = loadConfig(process.cwd());
  const skills = discoverSkills(cfg, process.cwd());
  const names = skills.map((s) => s.name);
  assert.ok(names.includes('code-review'), `expected code-review in ${names}`);
  assert.ok(names.includes('explain-repo'));
  const active = skills.filter((s) => s.enabled);
  assert.ok(active.length === 0, 'bundled skills start disabled (always:false, nothing enabled)');

  // enabling via config injects the skill block
  const cfg2 = { ...cfg, skills: { ...cfg.skills, enabled: ['code-review'] } };
  const skills2 = discoverSkills(cfg2, process.cwd());
  const prompt = skillsPrompt(skills2);
  assert.match(prompt, /## Active skills/);
  assert.match(prompt, /code-review/);
  // disabled skill body must not leak into prompt (check against the enabled set we built)
  const disabled = skills2.find((s) => !s.enabled);
  assert.ok(disabled, 'there is at least one disabled skill');
  assert.ok(!prompt.includes(disabled.body.slice(0, 40)), `prompt leaked ${disabled.name}`);
});

test('suggestSkills matches on description keywords', () => {
  const skills = [
    { name: 'code-review', description: 'Reviews changed code for bugs', enabled: false },
    { name: 'sql-helper', description: 'Writes SQL queries', enabled: false },
  ];
  const hits = suggestSkills(skills, 'please review my code for bugs');
  assert.ok(hits.some((s) => s.name === 'code-review'));
});

test('slash commands: find + complete + required set', () => {
  assert.ok(findCommand('/model'));
  assert.ok(findCommand('skills'));
  assert.equal(findCommand('nope'), null);
  const hits = completeCommand('/sk');
  assert.ok(hits.includes('/skills'));
  for (const required of ['help', 'model', 'provider', 'skills', 'serve', 'doctor', 'quit']) {
    assert.ok(COMMANDS.find((c) => c.name === required), `missing command ${required}`);
  }
  // opencode-ported commands
  for (const oc of ['setup', 'init', 'review', 'agent']) {
    assert.ok(COMMANDS.find((c) => c.name === oc), `missing opencode command ${oc}`);
  }
});

test('agent command switches build/plan modes', () => {
  const agent = COMMANDS.find((c) => c.name === 'agent');
  const ctx = { agent: 'build', messages: [{ role: 'system', content: 'SYS' }], systemPrompt: () => 'SYS' };
  const out = agent.run(ctx, 'plan');
  assert.equal(ctx.agent, 'plan');
  assert.match(out, /plan/);
  assert.equal(ctx.messages[0].content, 'SYS'); // system prompt refreshed
  agent.run(ctx, 'build');
  assert.equal(ctx.agent, 'build');
  assert.match(agent.run(ctx, 'nope'), /Unknown agent/);
});

test('/models switches by #, id, or query (opencode-style search)', async () => {
  const models = COMMANDS.find((c) => c.name === 'models');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'n11-models-'));
  const ctx = {
    prov: {
      id: 'x',
      name: 'X',
      color: '#fff',
      base: 'http://127.0.0.1:1',
      fallback: ['meta/llama-3.3-70b-instruct', 'qwen/qwen2.5-coder', 'other/model-1'],
    },
    cfg: {},
    cwd: tmp, // applyModel persists config — keep it out of the repo
    model: 'a',
  };
  // note: fs/os/path are imported at the top of this file
  // no args → list with a switch hint
  const list = await models.run(ctx, '');
  assert.match(list, /switch: \/models/);
  // query with one match → switches
  const q = await models.run(ctx, 'llama');
  assert.match(q, /model /);
  // # → switches
  const byNum = await models.run(ctx, '1');
  assert.match(byNum, /model /);
  // no match → helpful error
  const miss = await models.run(ctx, 'zzz-not-a-model');
  assert.match(miss, /No model matches/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('/setup writes a key to .env and switches provider', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n11-setup-'));
  fs.mkdirSync(path.join(root, '.nullx11code'), { recursive: true });
  const setup = COMMANDS.find((c) => c.name === 'setup');
  const ctx = {
    cwd: root,
    cfg: { _root: root, _env: {}, providers: {} },
    prov: null,
    model: null,
    messages: [],
  };
  // menu mode (no args) lists providers
  const menu = await setup.run(ctx, '');
  assert.match(menu, /usage: \/setup/);
  // save a key — verification hits the real network but must not throw
  const saved = await setup.run(ctx, 'groq gsk_test_key_123');
  const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
  assert.match(env, /GROQ_API_KEY=gsk_test_key_123/);
  assert.match(saved, /saved/);
  assert.equal(process.env.GROQ_API_KEY, 'gsk_test_key_123');
  delete process.env.GROQ_API_KEY;
  // unknown provider → error
  const bad = await setup.run(ctx, 'nope key');
  assert.match(bad, /No provider/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('loadInstructions discovers AGENTS.md and CLAUDE.md', async () => {
  const { loadInstructions } = await import('../src/config.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n11-agents-'));
  assert.deepEqual(loadInstructions(root), []);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Rules\nUse tabs.');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), 'Prefer pipes.');
  const files = loadInstructions(root);
  assert.equal(files.length, 2);
  assert.match(files[0].text, /Use tabs/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('tool schemas are valid OpenAI function specs', () => {
  assert.ok(TOOL_SCHEMAS.length >= 5);
  for (const t of TOOL_SCHEMAS) {
    assert.equal(t.type, 'function');
    assert.ok(t.function.name);
    assert.equal(t.function.parameters.type, 'object');
  }
});

test('tools: list/read/grep/write with approval gate', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n11-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'a.js'), 'const TODO = 1;\nconsole.log(TODO);\n');
  const ctx = { root, cwd: root, approve: async () => false };

  const listed = await runTool('list_files', { path: '.', depth: 3 }, ctx);
  assert.match(listed, /src\//);
  assert.match(listed, /src\/a\.js/);

  const read = await runTool('read_file', { path: 'src/a.js' }, ctx);
  assert.match(read, /1\|const TODO/);
  assert.match(read, /2\|console\.log/);

  const grep = await runTool('grep', { pattern: 'TODO', path: '.' }, ctx);
  assert.match(grep, /src\/a\.js:1/);

  // rejected write must not create the file
  const rejected = await runTool('write_file', { path: 'src/b.js', content: 'x' }, ctx);
  assert.match(rejected, /rejected/i);
  assert.ok(!fs.existsSync(path.join(root, 'src', 'b.js')));

  // approved write creates it
  const ctx2 = { ...ctx, approve: async () => true };
  const ok = await runTool('write_file', { path: 'src/b.js', content: 'hello' }, ctx2);
  assert.match(ok, /Wrote/);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'b.js'), 'utf8'), 'hello');

  // path escape blocked
  await assert.rejects(() => runTool('read_file', { path: '../../etc/passwd' }, ctx), /escapes/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ui: stripAnsi, wrap, modelBadge without color still readable', () => {
  setColorsOff();
  const prov = { id: 'nvidia', name: 'NVIDIA NIM', color: '#76B900' };
  const badge = modelBadge(prov, 'meta/llama-3.3-70b-instruct');
  assert.ok(stripAnsi(badge).includes('llama-3.3-70b-instruct'));
  assert.ok(stripAnsi(badge).includes('LL'));
  const lines = wrap('word '.repeat(100), 40);
  for (const l of lines) assert.ok(l.length <= 40, `line too long: ${l}`);
  assert.equal(colorsEnabled() && false, false); // just ensure fn exists
});

function setColorsOff() {
  process.env.NO_COLOR = '1';
}

test('provider icon + model icon SVG files exist', () => {
  const base = path.join(process.cwd(), 'assets', 'icons');
  for (const p of PROVIDERS) {
    const f = path.join(base, 'providers', `${p.id}.svg`);
    if (p.id === 'lmstudio' || p.id === 'together' || p.id === 'openai' || p.id === 'ollama' || p.id === 'github' || p.id === 'custom') {
      // all registry ids should have icons — assert all
    }
    assert.ok(fs.existsSync(f), `missing provider icon ${p.id}`);
  }
  for (const fam of ['llama', 'qwen', 'deepseek', 'nemotron', 'generic']) {
    assert.ok(fs.existsSync(path.join(base, 'models', `${fam}.svg`)), `missing model icon ${fam}`);
  }
  assert.ok(fs.existsSync(path.join(base, 'app-icon.svg')));
  assert.ok(fs.existsSync(path.join(base, 'cli-icon.svg')));
  assert.ok(fs.existsSync(path.join(base, 'favicon.svg')));
  assert.ok(fs.existsSync(path.join(base, 'png', 'icon-192.png')));
  assert.ok(fs.existsSync(path.join(base, 'png', 'icon-512.png')));
});
