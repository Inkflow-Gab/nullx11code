// Exercises the installed native runtime against a local provider. No real key/network needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveRuntime } from '../src/runtime.js';

let installed = true;
try { resolveRuntime({}); } catch { installed = false; }
const cli = fileURLToPath(new URL('../bin/nullx11code.js', import.meta.url));

test('real OpenCode runtime streams a response through a bridged custom provider', { skip: !installed, timeout: 60000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nullx11-native-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const requests = [];
  const mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || '{}') });
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const base = { id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1700000000, model: 'mock-model' };
      for (const delta of [{ role: 'assistant', content: '' }, { content: 'Bridge integration works.' }]) {
        res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 } })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  t.after(() => { mock.closeAllConnections(); mock.close(); });
  fs.mkdirSync(path.join(root, '.nullx11code'));
  fs.writeFileSync(path.join(root, '.nullx11code/config.json'), JSON.stringify({
    provider: 'mock', model: 'mock-model', providers: {
      mock: { name: 'Local integration test', apiKey: 'test-only-key', baseUrl: `http://127.0.0.1:${mock.address().port}/v1`, models: ['mock-model'] },
    },
  }));
  const env = {
    ...process.env, HOME: root, NULLX11_HOME: path.join(root, 'home'),
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'),
    XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'),
    OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
  };
  delete env.OPENCODE_CONFIG_CONTENT;
  delete env.OPENCODE_CONFIG;
  delete env.OPENCODE_CONFIG_DIR;
  const child = spawn(process.execPath, [cli, 'run', '--pure', '--format', 'json', 'Say hello'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { errors += chunk; });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Runtime timed out: ${errors}\n${output}`)); }, 50000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(code, 0, errors + output);
  assert.match(output, /Bridge integration works\./);
  assert.ok(requests.length > 0, 'native engine called the local provider');
  assert.ok(requests.every((r) => r.auth === 'Bearer test-only-key'));
  assert.ok(requests.every((r) => r.body.model === 'mock-model'));
  assert.ok(requests.some((r) => r.body.stream === true));
  assert.ok(!output.includes('test-only-key'));
});

test('real web app, native API, permission ordering and session lifecycle work together', { skip: !installed, timeout: 30000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nullx11-web-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.nullx11code'));
  fs.writeFileSync(path.join(root, '.nullx11code/config.json'), JSON.stringify({
    permissions: { default: 'ask', rules: [
      { action: 'shell', resource: 'rm *', effect: 'deny' },
      { action: 'shell', resource: '*', effect: 'allow' },
    ] },
  }));
  const env = {
    ...process.env, HOME: root, NULLX11_HOME: path.join(root, 'home'),
    XDG_CONFIG_HOME: path.join(root, 'config'), XDG_DATA_HOME: path.join(root, 'data'),
    XDG_CACHE_HOME: path.join(root, 'cache'), XDG_STATE_HOME: path.join(root, 'state'),
    OPENCODE_SERVER_PASSWORD: 'local-web-test',
    OPENCODE_DISABLE_AUTOUPDATE: 'true', OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
  };
  for (const name of ['OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR']) delete env[name];
  const child = spawn(process.execPath, [cli, 'serve', '--port', '0', '--host', '127.0.0.1', '--pure'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode !== null) return;
    const exit = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    await exit;
    clearTimeout(timer);
  });
  let output = '';
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Web runtime did not listen: ${output}`)), 15000);
    const collect = (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Web runtime exited ${code}: ${output}`)); });
  });
  const headers = { authorization: `Basic ${Buffer.from('opencode:local-web-test').toString('base64')}` };
  const crossOrigin = await fetch(url + '/_nullx/state', { headers: { ...headers, origin: 'https://untrusted.example' } });
  assert.equal(crossOrigin.status, 403);
  const fetchSite = await fetch(url + '/_nullx/state', { headers: { ...headers, 'sec-fetch-site': 'cross-site' } });
  assert.equal(fetchSite.status, 403);
  const get = (route, options = {}) => fetch(url + route, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(10000) });
  assert.equal((await fetch(url + '/config')).status, 401, 'native auth protects API');
  const health = await get('/global/health');
  assert.equal(health.status, 200);
  assert.equal((await health.json()).healthy, true);
  const home = await get('/');
  assert.match(await home.text(), /What are we building/);
  for (const assetPath of ['/_nullx/app.js', '/_nullx/style.css', '/_nullx/marked.js', '/_nullx/purify.js', '/_nullx/native-brand.js', '/_nullx/native-brand.css', '/_nullx/brand.svg']) assert.equal((await get(assetPath)).status, 200);
  assert.equal((await get('/_nullx/missing.js')).status, 404);
  const index = await get('/?experience=upstream');
  assert.equal(index.status, 200);
  const html = await index.text();
  assert.match(html, /<title>nullx11code — Advanced workspace<\/title>/);
  const asset = html.match(/<script[^>]+src="([^"]+)"/);
  assert.ok(asset, 'bundled app includes JS entrypoint');
  const js = await get(asset[1]);
  assert.equal(js.status, 200, 'bundled app asset serves locally');
  assert.match(js.headers.get('content-type'), /javascript/);
  const config = await get('/config');
  assert.equal(config.status, 200);
  const parsed = await config.json();
  assert.equal(parsed.permission.edit, 'ask');
  const agent = (await (await get('/agent')).json()).find((a) => a.name === 'build');
  const matches = agent.permission.filter((p) => (p.permission === '*' || p.permission === 'bash') && (p.pattern === '*' || p.pattern === 'rm *'));
  assert.equal(matches.at(-1).action, 'deny', 'native effective rules retain deny priority');
  const created = await get('/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'nullx11code integration' }) });
  assert.equal(created.status, 200);
  const session = await created.json();
  assert.match(session.id, /^ses/);
  const messages = await get(`/session/${session.id}/message`);
  assert.deepEqual(await messages.json(), []);
  assert.equal((await get(`/session/${session.id}`, { method: 'DELETE' })).status, 200);
});
