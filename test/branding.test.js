import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { terminalEnvironment, TERMINAL_PLUGIN, brandNativeHTML, brandNativeHelp, brandCompletion } from '../src/branding.js';

function home(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nullx11-branding-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('terminal branding creates private deterministic config without modifying original settings', (t) => {
  const dir = home(t);
  const original = path.join(dir, 'original.jsonc');
  const content = '{ // settings\n "theme":"my-theme", "plugin":[["./mine.tsx",{"option":true}]], "keybinds":{"leader":"ctrl+a"},\n}';
  fs.writeFileSync(original, content);
  const env = { NULLX11_HOME: dir, OPENCODE_TUI_CONFIG: original, EXAMPLE: 'unchanged' };
  const next = terminalEnvironment(env);
  const generated = JSON.parse(fs.readFileSync(next.OPENCODE_TUI_CONFIG, 'utf8'));
  assert.equal(generated.theme, 'my-theme');
  assert.equal(generated.keybinds.leader, 'ctrl+a');
  assert.deepEqual(generated.plugin[0], [path.join(dir, 'mine.tsx'), { option: true }]);
  assert.equal(generated.plugin.at(-1), TERMINAL_PLUGIN);
  assert.equal(next.EXAMPLE, 'unchanged');
  assert.equal(fs.readFileSync(original, 'utf8'), content);
  assert.equal(terminalEnvironment(env).OPENCODE_TUI_CONFIG, next.OPENCODE_TUI_CONFIG);
  if (process.platform !== 'win32') assert.equal(fs.statSync(next.OPENCODE_TUI_CONFIG).mode & 0o777, 0o600);
  assert.equal(env.OPENCODE_TUI_CONFIG, original);
});

test('terminal branding can be opted out of and invalid configs fail clearly', (t) => {
  const dir = home(t);
  const env = { NULLX11_HOME: dir, NULLX11_NO_BRANDING: '1', OPENCODE_TUI_CONFIG: '/missing' };
  assert.deepEqual(terminalEnvironment(env), env);
  const original = path.join(dir, 'broken.json');
  fs.writeFileSync(original, '{broken');
  assert.throws(() => terminalEnvironment({ NULLX11_HOME: dir, OPENCODE_TUI_CONFIG: original }), /Invalid OPENCODE_TUI_CONFIG/);
});

test('native HTML branding modifies presentation metadata, not scripts or content', () => {
  const html = '<html><head><title>OpenCode</title><link rel="icon" href="/old.svg"><link rel="manifest" href="/site.webmanifest"><script id="oc-theme-preload-script">const keep = "OpenCode"</script></head><body><pre>opencode --model test</pre><script src="/assets/engine.js"></script></body></html>';
  const branded = brandNativeHTML(html);
  assert.match(branded, /<title>nullx11code — Advanced workspace<\/title>/);
  assert.ok(branded.includes('/_nullx/native-brand.js'));
  assert.ok(branded.includes('/_nullx/brand.svg'));
  assert.ok(!branded.includes('/old.svg'));
  assert.ok(!branded.includes('/site.webmanifest'));
  assert.ok(branded.includes('const keep = "OpenCode"'));
  assert.ok(branded.includes('<pre>opencode --model test</pre>'));
  assert.ok(branded.includes('/assets/engine.js'));
});

test('generated help/completions use the public command name without renaming protocol identifiers', () => {
  const help = brandNativeHelp('opencode mcp\n  opencode mcp add\nDocs: https://opencode.ai\nOPENCODE_CONFIG_CONTENT\n');
  assert.match(help, /^nullx11code mcp/);
  assert.ok(help.includes('  nullx11code mcp add'));
  assert.ok(help.includes('https://opencode.ai'));
  assert.ok(help.includes('OPENCODE_CONFIG_CONTENT'));
  const completion = brandCompletion('_opencode_yargs_completions() {}\ncomplete -F _opencode_yargs_completions opencode\n');
  assert.ok(completion.includes('_nullx11code_yargs_completions()'));
  assert.ok(completion.includes('complete -F _nullx11code_yargs_completions nullx11code\n'));
  assert.ok(completion.includes('complete -F _nullx11code_yargs_completions n11\n'));
});
