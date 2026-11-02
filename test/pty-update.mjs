// Manual pty probe: launch-time update ask (faked remote v9.9.9), answer [n], continue.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const fake = pathToFileURL(join(repo, 'test/fake-update.mjs')).href;
const dir = mkdtempSync(join(tmpdir(), 'pty-upd-'));
writeFileSync(join(dir, '.mock.json'), JSON.stringify({ provider: 'mock', model: 'mock-chat' }));

const p = spawn('script', ['-qec', `node --import ${fake} ${join(repo, 'bin/nullx11code.js')}`, '/dev/null'], {
  cwd: dir,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, FORCE_COLOR: '0' }, // NO NULLX11_NO_UPDATE_CHECK — the ask must fire
});

let out = '';
p.stdout.on('data', (d) => (out += d));
const results = [];
const check = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  for (let i = 0; i < 40 && !out.includes('update available'); i++) await sleep(100);
  check('asks about the update', out.includes('update available'));
  check('shows versions 0.2.0 → 9.9.9', out.includes('0.2.0') && out.includes('9.9.9'));
  check('offers [y]/[n]', out.includes('[y]') && out.includes('[n]'));

  p.stdin.write('n\n');
  await sleep(600);
  check('skip acknowledged', out.includes('skipped'));
  check('prompt follows', out.includes('❯'));

  p.stdin.write('/quit\n');
  for (let i = 0; i < 20 && p.exitCode === null && !out.includes('bye'); i++) await sleep(100);
  check('exited cleanly', p.exitCode !== null || out.includes('bye'));

  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  rmSync(dir, { recursive: true, force: true });
  p.kill();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.log(results.join('\n'));
  console.log('TAIL:', JSON.stringify(out.slice(-900)));
  p.kill();
  process.exit(1);
});
setTimeout(() => {
  console.log('TIMEOUT');
  console.log(results.join('\n'));
  console.log('TAIL:', JSON.stringify(out.slice(-1200)));
  p.kill();
  process.exit(1);
}, 20000);
