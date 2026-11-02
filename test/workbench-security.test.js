import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedOrigin, allowedHost, authorized } from '../src/workbench-server.js';

const req = (headers = {}) => ({ headers });

test('workspace permits same-origin previews and non-browser CLI requests', () => {
  assert.equal(allowedOrigin(req({ host: '7860-example.e2b.app', origin: 'https://7860-example.e2b.app', 'sec-fetch-site': 'same-origin' })), true);
  assert.equal(allowedOrigin(req({ host: 'localhost:7860' })), true);
});

test('workspace rejects cross-site requests, malformed origins, and port mismatches', () => {
  assert.equal(allowedOrigin(req({ host: 'localhost:7860', origin: 'https://evil.example' })), false);
  assert.equal(allowedOrigin(req({ host: 'localhost:7860', origin: 'http://localhost:9000' })), false);
  assert.equal(allowedOrigin(req({ host: 'localhost:7860', origin: 'null' })), false);
  assert.equal(allowedOrigin(req({ host: 'localhost:7860', 'sec-fetch-site': 'cross-site' })), false);
});

test('workspace basic auth checks exact credentials and safely rejects malformed values', () => {
  const basic = (text) => req({ authorization: `Basic ${Buffer.from(text).toString('base64')}` });
  assert.equal(authorized(basic('user:secret'), 'user', 'secret'), true);
  assert.equal(authorized(basic('user:wrong'), 'user', 'secret'), false);
  assert.equal(authorized(basic('other:secret'), 'user', 'secret'), false);
  assert.equal(authorized(req({ authorization: 'Bearer secret' }), 'user', 'secret'), false);
  assert.equal(authorized(req({ authorization: 'Basic !!!' }), 'user', 'secret'), false);
  assert.equal(authorized(req(), 'user', 'secret'), false);
  assert.equal(authorized(req(), 'user', ''), true);
});


test('workspace blocks DNS-rebinding hostnames but permits local, preview and explicitly trusted hosts', () => {
  assert.equal(allowedHost(req({ host: '127.0.0.1:7860' })), true);
  assert.equal(allowedHost(req({ host: '7860-example.e2b.app' })), true);
  assert.equal(allowedHost(req({ host: 'attacker.example' })), false);
  assert.equal(allowedHost(req({ host: 'evil.e2b.app.attacker.example' })), false);
  assert.equal(allowedHost(req({ host: 'code.example.com' }), ['code.example.com']), true);
});
