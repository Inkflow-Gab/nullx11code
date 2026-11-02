// Integration check: the native engine loads our TSX through its official
// plugin runtime, draws the branded logo, and keeps the native full-screen UI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveRuntime } from '../src/runtime.js';
let available = process.platform !== 'win32' && spawnSync('python3', ['--version']).status === 0;
try { resolveRuntime({}); } catch { available = false; }

test('real terminal renders nullx11code branding through the native TUI plugin', { skip: !available, timeout: 30000 }, () => {
  const cli = fileURLToPath(new URL('../bin/nullx11code.js', import.meta.url));
  const script = String.raw`
import os, pty, subprocess, tempfile, select, time, struct, fcntl, termios, signal, shutil, json
root=tempfile.mkdtemp(prefix='nullx11-tui-test-')
master,slave=pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH',35,115,0,0))
env={k:v for k,v in os.environ.items() if not k.endswith(('_KEY','_TOKEN')) and not k.startswith('OPENCODE_')}
env.update(HOME=root, NULLX11_HOME=root+'/home', XDG_CONFIG_HOME=root+'/config', XDG_DATA_HOME=root+'/data', XDG_STATE_HOME=root+'/state', XDG_CACHE_HOME=root+'/cache', TERM='xterm-256color', OPENCODE_DISABLE_AUTOUPDATE='true', OPENCODE_DISABLE_DEFAULT_PLUGINS='true')
p=subprocess.Popen(['node',${JSON.stringify(cli)}],cwd=root,env=env,stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
os.close(slave)
out=b''
try:
 end=time.monotonic()+18
 while time.monotonic()<end:
  if select.select([master],[],[],0.2)[0]:
   try: out+=os.read(master,131072)
   except OSError: break
  if b'Your project. Your models.' in out or p.poll() is not None: break
 print(json.dumps({'brand':b'nullx11code' in out,'tagline':b'Your project. Your models.' in out,'alternate':b'\x1b[?1049h' in out,'title':b'\x1b]0;nullx11code' in out or b'\x1b]2;nullx11code' in out}))
finally:
 if p.poll() is None: os.killpg(p.pid,signal.SIGTERM)
 try: p.wait(timeout=4)
 except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL);p.wait()
 os.close(master)
 shutil.rmtree(root,ignore_errors=True)
`;
  const result = spawnSync('python3', ['-c', script], { encoding: 'utf8', timeout: 26000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const rendered = JSON.parse(result.stdout.trim());
  assert.equal(rendered.brand, true);
  assert.equal(rendered.tagline, true);
  assert.equal(rendered.alternate, true);
});
