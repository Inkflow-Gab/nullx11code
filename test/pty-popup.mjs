// Manual pty probe for the CLI live popup (not part of npm test — needs a pty).
// Verifies: / command popup appears while typing, gets cleared on submit,
// @file popup appears, and the final prompt state is sane.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'pty-pop-'));
writeFileSync(join(dir, '.mock.json'), JSON.stringify({ provider: 'mock', model: 'mock-chat' }));
writeFileSync(join(dir, 'hello.txt'), 'hi\n');

const p = spawn('script', ['-qec', `node ${join(repo, 'bin/nullx11code.js')}`, '/dev/null'], {
  cwd: dir,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, MOCK_URL: '', FORCE_COLOR: '0' },
});

let out = '';
p.stdout.on('data', (d) => (out += d));
const results = [];
const check = (name, cond) => results.push(`${cond ? 'PASS' : 'FAIL'} ${name}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // wait for prompt
  for (let i = 0; i < 40 && !out.includes('❯'); i++) await sleep(100);
  const afterHeader = out.length;

  // 1. type /mo → popup should list /model + /models-query
  p.stdin.write('/mo');
  await sleep(500);
  const seg1 = out.slice(afterHeader);
  check('popup shows /model', seg1.includes('/model'));
  check('popup shows /models', seg1.includes('/models'));
  check('popup restores cursor (CUF after show)', /\x1b\[\d+C/.test(seg1));

  // 2. submit /mo → line handler must clear popup (\x1b[0J) and run the command
  p.stdin.write('\n');
  await sleep(900);
  const seg2 = out.slice(afterHeader);
  check('popup cleared on submit', seg2.includes('\x1b[0J'));
  check('prefix peek ran /model', /\/model/.test(seg2) && /provider|model/.test(seg2));

  // 3. @file popup: type "say @he"
  const mark = out.length;
  p.stdin.write('say @he');
  await sleep(500);
  const seg3 = out.slice(mark);
  check('@ popup lists hello.txt', seg3.includes('hello.txt'));

  // 4. clear the line (Ctrl+C? use backspaces) then quit
  for (let i = 0; i < 20; i++) p.stdin.write('\x7f');
  await sleep(300);
  p.stdin.write('/quit\n');
  for (let i = 0; i < 20 && p.exitCode === null && !out.includes('bye'); i++) await sleep(100);

  check('exited', p.exitCode !== null || out.includes('bye'));
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL')).length;
  rmSync(dir, { recursive: true, force: true });
  p.kill();
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  console.log(results.join('\n'));
  console.log('TAIL:', JSON.stringify(out.slice(-800)));
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
