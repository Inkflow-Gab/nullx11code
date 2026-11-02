// Update check: version compare + GitHub probing (all offline via injected fetch).
import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, checkForUpdate, INSTALL_CMD } from '../src/update.js';
import { VERSION } from '../src/config.js';

test('compareVersions orders semver-ish strings', () => {
  assert.equal(compareVersions('0.2.0', '0.1.0'), 1);
  assert.equal(compareVersions('0.1.0', '0.1.0'), 0);
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1);
  assert.equal(compareVersions('v0.3.1', '0.3.0'), 1);
  assert.equal(compareVersions('0.1.9', '0.2.0'), -1);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1); // numeric, not lexicographic
});

test('VERSION is the semver the check compares against', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(INSTALL_CMD.includes('install.sh'));
});

test('checkForUpdate: newer release tag → updateAvailable', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/releases/latest')) {
      return { ok: true, json: async () => ({ tag_name: 'v9.9.9' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const info = await checkForUpdate({ current: VERSION, fetchImpl });
  assert.equal(info.latest, '9.9.9');
  assert.equal(info.updateAvailable, true);
  assert.equal(info.current, VERSION);
  assert.ok(info.install.includes('curl'));
});

test('checkForUpdate: falls back to package.json on main when no releases', async () => {
  const pkg = Buffer.from(JSON.stringify({ name: 'nullx11code', version: '0.1.0' })).toString('base64');
  const fetchImpl = async (url) => {
    if (url.includes('/releases/latest')) return { ok: false, status: 404, json: async () => ({}) };
    if (url.includes('contents/package.json')) return { ok: true, json: async () => ({ content: pkg }) };
    return { ok: false, json: async () => ({}) };
  };
  const info = await checkForUpdate({ current: '0.2.0', fetchImpl });
  assert.equal(info.latest, '0.1.0');
  assert.equal(info.updateAvailable, false); // remote older/equal → no nag
});

test('checkForUpdate: up to date reports false', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/releases/latest')) return { ok: true, json: async () => ({ tag_name: `v${VERSION}` }) };
    return { ok: false, json: async () => ({}) };
  };
  const info = await checkForUpdate({ current: VERSION, fetchImpl });
  assert.equal(info.updateAvailable, false);
  assert.equal(info.latest, VERSION);
});

test('checkForUpdate: network failure returns null (silent)', async () => {
  const info = await checkForUpdate({
    fetchImpl: async () => {
      throw new Error('offline');
    },
  });
  assert.equal(info, null);
});

test('checkForUpdate: unparseable payloads return null', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/releases/latest')) return { ok: true, json: async () => ({ tag_name: 'not-a-version' }) };
    if (url.includes('contents/package.json')) return { ok: true, json: async () => ({ content: '' }) };
    return { ok: false, json: async () => ({}) };
  };
  const info = await checkForUpdate({ current: VERSION, fetchImpl });
  assert.equal(info, null);
});
