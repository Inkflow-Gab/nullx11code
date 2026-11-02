import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { translateArgs, buildRuntimeConfig, bridgePermissions, mergeConfig, resolveRuntime, runChild, RUNTIME_VERSION } from '../src/runtime.js';
import { VERSION } from '../src/config.js';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nullx11-bridge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { _root: root, _env: {}, providers: {}, skills: { dirs: [], enabled: [] }, permissions: { default: 'ask', rules: [] } };
}
const translate = (args) => translateArgs(args, { tty: true });

test('package, application and pinned runtime versions agree', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(pkg.version, VERSION);
  assert.equal(pkg.optionalDependencies['opencode-ai'], RUNTIME_VERSION);
});

test('TTY uses real full-screen UI; pipe uses run', () => {
  assert.deepEqual(translate([]).args, []);
  assert.deepEqual(translateArgs([], { tty: false }).args, ['run']);
});

test('plain prompts and explicit print map to run without shell interpolation', () => {
  assert.deepEqual(translate(['explain this repo']).args, ['run', 'explain this repo']);
  assert.deepEqual(translate(['-p', '$(touch /tmp/not-executed)', '--agent', 'plan']).args,
    ['run', '--agent', 'plan', '--', '$(touch /tmp/not-executed)']);
});

test('TUI option values are not mistaken for prompts', () => {
  assert.deepEqual(translate(['--agent', 'plan']).args, ['--agent', 'plan']);
  assert.deepEqual(translate(['--prompt', 'hello']).args, ['--prompt', 'hello']);
});

test('existing directory selects TUI project, not run', () => {
  assert.deepEqual(translate(['.']).args, ['.']);
});

test('web aliases have preview-safe host and configurable port', () => {
  assert.deepEqual(translate(['serve']).args, ['web', '--hostname', '0.0.0.0', '--port', '7860']);
  assert.deepEqual(translate(['serve', '8000', '--host', '127.0.0.1']).args,
    ['web', '--port', '8000', '--hostname', '127.0.0.1']);
  assert.deepEqual(translate(['web', '--port=8001', '--hostname=0.0.0.0']).args,
    ['web', '--port=8001', '--hostname=0.0.0.0']);
});

test('native flags and exact upstream escape hatch retain their meaning', () => {
  assert.deepEqual(translate(['run', '-p', 'password', '--format', 'json', 'hi']).args,
    ['run', '-p', 'password', '--format', 'json', 'hi']);
  assert.deepEqual(translate(['mcp', 'add']).args, ['mcp', 'add']);
  assert.deepEqual(translate(['upstream', 'serve', '--help']), { args: ['serve', '--help'], bridge: false });
});

test('resume and approval flags are explicit; missing values fail', () => {
  assert.deepEqual(translate(['--resume']).args, ['--continue']);
  assert.deepEqual(translate(['--resume', 'ses_123', '-y']).args, ['--session', 'ses_123', '--auto']);
  for (const arg of ['--provider', '--model', '-p', '--host', '--port']) assert.throws(() => translate([arg]), /requires a value/);
});

test('provider bridge preserves slash-containing model IDs and keeps keys out of config', (t) => {
  const cfg = fixture(t);
  cfg.provider = 'nvidia';
  cfg._env.NVIDIA_API_KEY = 'test-secret';
  const { config, env } = buildRuntimeConfig(cfg, { provider: 'nvidia', model: 'meta/llama-test' }, {}, cfg._root);
  assert.equal(config.model, 'nullx11-nvidia/meta/llama-test');
  assert.equal(config.provider['nullx11-nvidia'].options.baseURL, 'https://integrate.api.nvidia.com/v1');
  assert.ok(config.provider['nullx11-nvidia'].models['meta/llama-test']);
  assert.ok(Object.values(env).includes('test-secret'));
  assert.ok(!JSON.stringify(config).includes('test-secret'));
  assert.equal(config.autoupdate, false);
});

test('native model selection is not prefixed with legacy provider', (t) => {
  const cfg = fixture(t);
  const { config } = buildRuntimeConfig(cfg, { model: 'anthropic/claude-sonnet-4-5', explicitModel: true }, {}, cfg._root);
  assert.equal(config.model, 'anthropic/claude-sonnet-4-5');
});

test('custom endpoint, environment precedence and model catalog are bridged', (t) => {
  const cfg = fixture(t);
  cfg.provider = 'mock';
  cfg._env.MY_KEY = 'file-key';
  cfg.providers.mock = { baseUrl: 'http://127.0.0.1:1234/v1', apiKey: 'custom-key', models: ['a/b'] };
  const { config, env } = buildRuntimeConfig(cfg, {}, { MY_KEY: 'process-key' }, cfg._root);
  assert.equal(env.MY_KEY, 'process-key');
  assert.equal(config.model, 'nullx11-mock/a/b');
  assert.equal(config.provider['nullx11-mock'].npm, '@ai-sdk/openai-compatible');
  assert.throws(() => buildRuntimeConfig(cfg, { provider: 'missing' }, {}, cfg._root), /Unknown provider/);
});

test('default permissions ask before shell/write; deny rules are serialized last', () => {
  const permission = bridgePermissions({ permissions: { default: 'ask', rules: [
    { action: 'shell', resource: 'rm *', effect: 'deny' },
    { action: 'shell', resource: '*', effect: 'allow' },
  ] } });
  assert.equal(permission.read, 'allow');
  assert.equal(permission.edit, 'ask');
  assert.deepEqual(permission.bash, { '*': 'allow', 'rm *': 'deny' });
});

test('global wildcard denies cannot be bypassed by per-tool allows', () => {
  const permission = bridgePermissions({ permissions: { default: 'ask', rules: [
    { action: '*', resource: '*', effect: 'deny' },
    { action: 'shell', resource: '*', effect: 'allow' },
  ] } });
  assert.equal(permission.bash, 'deny');
  assert.equal(permission.edit, 'deny');
  assert.equal(permission['*'], 'deny');
});

test('enabled skills and legacy custom commands are bridged without executing templates', (t) => {
  const cfg = fixture(t);
  fs.mkdirSync(path.join(cfg._root, '.nullx11code/skills/enabled'), { recursive: true });
  fs.mkdirSync(path.join(cfg._root, '.nullx11code/skills/disabled'), { recursive: true });
  fs.writeFileSync(path.join(cfg._root, '.nullx11code/skills/enabled/SKILL.md'), '---\nname: enabled\n---\nEnabled skill text');
  fs.writeFileSync(path.join(cfg._root, '.nullx11code/skills/disabled/SKILL.md'), '---\nname: disabled\n---\nDisabled skill text');
  fs.writeFileSync(path.join(cfg._root, '.nullx11code/review.md'), '---\ndescription: Review code\n---\nReview $ARGUMENTS !`echo not-executed`');
  cfg.skills.enabled = ['enabled'];
  const { config } = buildRuntimeConfig(cfg, {}, {}, cfg._root);
  assert.ok(config.agent.build.prompt.includes('Enabled skill text'));
  assert.ok(!config.agent.build.prompt.includes('Disabled skill text'));
  assert.equal(config.command.review.template, 'Review $ARGUMENTS !`echo not-executed`');
});

test('advanced config overrides compatibility defaults and invalid JSON is actionable', (t) => {
  const cfg = fixture(t);
  cfg.opencode = { permission: { bash: 'deny' }, mcp: { example: { type: 'local', command: ['example'] } } };
  const { config } = buildRuntimeConfig(cfg, {}, { OPENCODE_CONFIG_CONTENT: '{"model":"native/model"}' }, cfg._root);
  assert.equal(config.permission.bash, 'deny');
  assert.equal(config.model, 'native/model');
  assert.ok(config.mcp.example);
  assert.throws(() => buildRuntimeConfig(cfg, {}, { OPENCODE_CONFIG_CONTENT: '{broken' }, cfg._root), /valid JSON/);
  assert.deepEqual(mergeConfig({ a: [1], b: { a: 1 } }, { a: [2], b: { b: 2 } }), { a: [2], b: { a: 1, b: 2 } });
  mergeConfig({}, JSON.parse('{"__proto__":{"polluted":true}}'));
  assert.equal({}.polluted, undefined);
});

test('runtime override must exist', () => {
  assert.throws(() => resolveRuntime({ NULLX11_OPENCODE_BIN: '/missing/nullx11-runtime' }), /Runtime not found/);
});

test('child inherits terminal, never uses shell, propagates status and removes signal handlers', async () => {
  const before = process.listenerCount('SIGTERM');
  const code = await runChild('runtime', ['run', 'a; echo unsafe'], { env: { EXAMPLE: '1' }, spawnImpl(bin, args, options) {
    assert.equal(bin, 'runtime');
    assert.deepEqual(args, ['run', 'a; echo unsafe']);
    assert.equal(options.stdio, 'inherit');
    assert.equal(options.shell, false);
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', 42, null));
    return child;
  } });
  assert.equal(code, 42);
  assert.equal(process.listenerCount('SIGTERM'), before);
});

test('child spawn errors are actionable and signals map to exit codes', async () => {
  await assert.rejects(runChild('missing', [], { spawnImpl() {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('error', new Error('ENOENT')));
    return child;
  } }), /nullx11code legacy/);
  assert.equal(await runChild('runtime', [], { spawnImpl() {
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('exit', null, 'SIGINT'));
    return child;
  } }), 130);
});

test('explicit CLI model selection overrides advanced defaults', (t) => {
  const cfg = fixture(t);
  cfg.opencode = { model: 'native/default-model' };
  const { config } = buildRuntimeConfig(cfg, {
    model: 'native/cli-model', explicitModel: true,
  }, { OPENCODE_CONFIG_CONTENT: '{"model":"native/environment-model"}' }, cfg._root);
  assert.equal(config.model, 'native/cli-model');
});

test('web compatibility honors configured defaults and TUI path identifies target project', () => {
  assert.deepEqual(translateArgs(['serve'], { tty: true, defaultPort: 9000, defaultHost: '127.0.0.1' }).args,
    ['web', '--hostname', '127.0.0.1', '--port', '9000']);
  assert.equal(translate(['.']).projectPath, process.cwd());
});
