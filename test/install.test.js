import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('installer fallback uses a durable npm prefix, not a deleted temporary symlink', { skip: process.platform === 'win32' }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nullx11-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'mockbin');
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  for (const dir of [bin, home, tmp]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do\n if [ "$1" = "-o" ]; then shift; : > "$1"; exit 0; fi\n shift\ndone\nexit 1\n', { mode: 0o755 });
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/sh
printf '%s\\n' "$*" >> "$HOME/npm-calls"
case "$*" in
  *--prefix*)
    mkdir -p "$HOME/.local/bin"
    printf '#!/bin/sh\\necho installed\\n' > "$HOME/.local/bin/nullx11code"
    chmod +x "$HOME/.local/bin/nullx11code"
    exit 0 ;;
  *) exit 1 ;;
esac
`, { mode: 0o755 });
  const result = spawnSync('sh', [fileURLToPath(new URL('../install.sh', import.meta.url))], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, HOME: home, TMPDIR: tmp, PATH: `${bin}:${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const calls = fs.readFileSync(path.join(home, 'npm-calls'), 'utf8');
  assert.match(calls, /install -g --prefix/);
  const installed = path.join(home, '.local/bin/nullx11code');
  assert.ok(fs.existsSync(installed));
  assert.equal(fs.lstatSync(installed).isSymbolicLink(), false);
  assert.deepEqual(fs.readdirSync(tmp), [], 'temporary downloads are cleaned');
});
