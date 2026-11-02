// Linux CI/browser tests use the npm-distributed headless Chromium, avoiding a
// network download from a separate browser CDN. No browser ships in the app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);

export async function browserOptions() {
  if (process.env.CHROMIUM_EXECUTABLE_PATH) return { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH, args: ['--no-sandbox'], headless: true };
  if (process.platform !== 'linux') return { headless: true };
  const { default: chromium } = await import('@sparticuz/chromium');
  const base = path.join(os.tmpdir(), 'nullx11-browser-libs');
  const lib = path.join(base, 'lib');
  if (!fs.existsSync(path.join(lib, 'libnspr4.so'))) {
    fs.mkdirSync(base, { recursive: true });
    const packageRoot = path.resolve(path.dirname(require.resolve('@sparticuz/chromium')), '../..');
    const archive = path.join(base, 'libs.tar');
    fs.writeFileSync(archive, zlib.brotliDecompressSync(fs.readFileSync(path.join(packageRoot, 'bin/al2023.tar.br'))));
    execFileSync('tar', ['-xf', archive, '-C', base]);
    fs.unlinkSync(archive);
  }
  return {
    executablePath: await chromium.executablePath(),
    // Keep web security enabled: same-origin and CSP behavior are under test.
    args: chromium.args.filter((arg) => !arg.includes('disable-web-security') && !arg.includes('allow-running-insecure-content') && arg !== '--single-process'),
    env: { ...process.env, LD_LIBRARY_PATH: [lib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
    headless: true,
  };
}
