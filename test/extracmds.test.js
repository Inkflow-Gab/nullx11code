// Tests for .nullx11/*.md custom slash commands.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverExtras, renderExtra, resolveInvocation, commandEntries, extraDirs } from '../src/extracmds.js';
import { loadConfig } from '../src/config.js';
import { COMMANDS, findCommand } from '../src/commands.js';

function makeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n11-cmd-'));
  fs.mkdirSync(path.join(root, '.nullx11'), { recursive: true });
  return root;
}

test('bundled repo .nullx11 discovers extra.md and pixel.md', () => {
  const cfg = loadConfig(process.cwd());
  const extras = discoverExtras(cfg, process.cwd());
  const names = extras.map((x) => x.name);
  assert.ok(names.includes('extra'), `expected extra in ${names}`);
  assert.ok(names.includes('pixel'));
  const extra = extras.find((x) => x.name === 'extra');
  assert.match(extra.description, /animation/i);
  assert.equal(extra.example, '/extra make the hero icon float with binary rain');
  assert.match(extra.body, /\$ARGUMENTS/);
});

test('auto-detects .nullx11 in the folder where the CLI runs', () => {
  const root = makeProject();
  fs.writeFileSync(
    path.join(root, '.nullx11', 'deploy.md'),
    '---\ndescription: Deploy this project\nexample: /deploy staging\n---\nDeploy to $ARGUMENTS\n'
  );
  // simulate running the CLI from inside that folder
  const cfg = loadConfig(root);
  const extras = discoverExtras(cfg, root);
  const dep = extras.find((x) => x.name === 'deploy');
  assert.ok(dep, `extras: ${extras.map((x) => x.name)}`);
  assert.equal(dep.description, 'Deploy this project');
  assert.equal(renderExtra(dep, 'staging'), 'Deploy to staging');
  fs.rmSync(root, { recursive: true, force: true });
});

test('subfolder .nullx11/commands/*.md also works', () => {
  const root = makeProject();
  fs.mkdirSync(path.join(root, '.nullx11', 'commands'));
  fs.writeFileSync(
    path.join(root, '.nullx11', 'commands', 'sing.md'),
    '---\ndescription: Sing a song\n---\nSing about $ARGUMENTS\n'
  );
  const extras = discoverExtras(loadConfig(root), root);
  assert.ok(extras.some((x) => x.name === 'sing'));
  fs.rmSync(root, { recursive: true, force: true });
});

test('renderExtra substitutes $ARGUMENTS or appends', () => {
  const withPlaceholder = { body: 'Do this: $ARGUMENTS\nThanks.' };
  assert.equal(renderExtra(withPlaceholder, 'now'), 'Do this: now\nThanks.');
  assert.equal(renderExtra(withPlaceholder, ''), 'Do this: \nThanks.');
  const noPlaceholder = { body: 'Base prompt.' };
  assert.equal(renderExtra(noPlaceholder, 'extra words'), 'Base prompt.\n\nextra words');
  assert.equal(renderExtra(noPlaceholder, ''), 'Base prompt.');
});

test('resolveInvocation: /ex previews /extra (user scenario)', () => {
  const extras = [{ name: 'extra', kind: 'extra', ref: {}, description: 'anim' }];
  const entries = commandEntries(COMMANDS, extras);
  const r = resolveInvocation(entries, 'ex');
  assert.equal(r.kind, 'unique');
  assert.equal(r.match.name, 'extra');
  assert.equal(r.match.kind, 'extra');
});

test('resolveInvocation: exact > unique prefix > ambiguous > none', () => {
  const entries = commandEntries(COMMANDS, [{ name: 'extra', kind: 'extra', ref: {} }]);
  assert.equal(resolveInvocation(entries, 'help').kind, 'exact');
  assert.equal(resolveInvocation(entries, '/help').kind, 'exact'); // leading slash tolerated
  assert.equal(resolveInvocation(entries, 'HELP').kind, 'exact'); // case-insensitive
  const u = resolveInvocation(entries, 'qui');
  assert.equal(u.kind, 'unique');
  assert.equal(u.match.name, 'quit');
  const a = resolveInvocation(entries, 'm'); // model, models
  assert.equal(a.kind, 'ambiguous');
  assert.ok(a.candidates.length >= 2);
  assert.equal(resolveInvocation(entries, 'zzz').kind, 'none');
  assert.equal(resolveInvocation(entries, '').kind, 'none');
});

test('resolveInvocation: tie-break picks the lone custom command (/p → /pixel vs provider(s))', () => {
  const entries = commandEntries(COMMANDS, [{ name: 'pixel', kind: 'extra', ref: {} }]);
  const r = resolveInvocation(entries, 'p');
  assert.equal(r.kind, 'unique');
  assert.equal(r.match.name, 'pixel');
});

test('commandEntries mixes builtins and extras without name clashes', () => {
  const extras = discoverExtras(loadConfig(process.cwd()), process.cwd());
  const entries = commandEntries(COMMANDS, extras);
  const builtinNames = COMMANDS.map((c) => c.name);
  for (const e of entries.filter((x) => x.kind === 'builtin')) {
    assert.ok(builtinNames.includes(e.name));
  }
  // extras must not shadow exact builtin names
  for (const x of extras) {
    assert.ok(!builtinNames.includes(x.name), `extra ${x.name} shadows a builtin`);
  }
  assert.ok(findCommand('serve'));
});

test('help lists custom commands section', () => {
  const help = COMMANDS.find((c) => c.name === 'help');
  const out = help.run({ extras: [{ name: 'extra', description: 'anim maker', example: '/extra x' }] });
  assert.match(out, /Custom commands/);
  assert.match(out, /extra/);
  assert.match(out, /anim maker/);
  assert.match(out, /e\.g\. \/extra x/);
  const outNone = help.run({ extras: [] });
  assert.match(outNone, /No custom commands yet/);
});
