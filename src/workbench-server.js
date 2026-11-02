// A same-origin, streaming gateway around the real OpenCode server. No second agent engine.
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { VERSION, loadConfig } from './config.js';
import { brandNativeHTML } from './branding.js';
import { buildRuntimeConfig, resolveRuntime, RUNTIME_VERSION } from './runtime.js';

const require = createRequire(import.meta.url);
const web = fileURLToPath(new URL('./workbench/', import.meta.url));
const json = (res, code, value) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
const equals = (a, b) => { const aa = Buffer.from(a || ''); const bb = Buffer.from(b || ''); return aa.length === bb.length && timingSafeEqual(aa, bb); };

export function allowedOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!req.headers.origin) return true; // CLI clients do not send Origin.
  try { const origin = new URL(req.headers.origin); return ['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host; } catch { return false; }
}

export function allowedHost(req, extra = []) {
  let hostname;
  try { hostname = new URL(`http://${req.headers.host}`).hostname.replace(/^\[|\]$/g, '').toLowerCase(); } catch { return false; }
  if (/^[a-z0-9-]+\.e2b\.app$/.test(hostname)) return true;
  const local = ['localhost', '127.0.0.1', '::1', '0.0.0.0', os.hostname().toLowerCase(),
    ...Object.values(os.networkInterfaces()).flat().filter(Boolean).map((entry) => entry.address.toLowerCase()),
    ...extra.map((value) => value.trim().toLowerCase()).filter(Boolean)];
  return local.includes(hostname);
}

export function authorized(req, username, password) {
  if (!password) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  return equals(Buffer.from(header.slice(6), 'base64').toString(), `${username}:${password}`);
}

async function bootRuntime({ cwd, env, bin, extraArgs = [] }) {
  const child = spawn(bin, ['serve', '--hostname', '127.0.0.1', '--port', '0', ...extraArgs], {
    cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let logs = '';
  let settled = false;
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`OpenCode startup timed out. ${logs.slice(-1500)}`)); }, 25000);
    const collect = (chunk) => {
      logs = (logs + chunk.toString()).slice(-5000);
      const match = logs.match(/http:\/\/(?:127\.0\.0\.1|localhost):(\d+)/);
      if (match && !settled) { settled = true; clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { if (!settled) { clearTimeout(timer); reject(new Error(`OpenCode exited (${code}). ${logs.slice(-1500)}`)); } });
  });
  return { child, url };
}

export async function startWorkbench({ port = 7860, host = '0.0.0.0', cwd = process.cwd(), cfg = loadConfig(cwd), env = process.env, runtimeBin, runtimeArgs = [], selection = {} } = {}) {
  const prepared = buildRuntimeConfig(cfg, selection, env, cwd);
  const trustedHosts = [host, ...(env.NULLX11_ALLOWED_HOSTS || cfg._env?.NULLX11_ALLOWED_HOSTS || '').split(',')];
  const password = env.OPENCODE_SERVER_PASSWORD || cfg._env?.OPENCODE_SERVER_PASSWORD || '';
  const username = env.OPENCODE_SERVER_USERNAME || cfg._env?.OPENCODE_SERVER_USERNAME || 'opencode';
  // The engine's ephemeral loopback port is ALWAYS authenticated, even when the
  // user chooses a passwordless local workbench. Never expose its credential.
  const internalPassword = randomBytes(32).toString('hex');
  const runtime = await bootRuntime({ cwd, env: { ...prepared.env, OPENCODE_SERVER_USERNAME: 'nullx11-internal', OPENCODE_SERVER_PASSWORD: internalPassword }, bin: runtimeBin || resolveRuntime(prepared.env), extraArgs: runtimeArgs });
  const upstream = new URL(runtime.url);
  const authorization = `Basic ${Buffer.from(`nullx11-internal:${internalPassword}`).toString('base64')}`;
  let closing = false;
  const sockets = new Set();
  const staticFiles = new Map([
    ['/_nullx/app.js', [path.join(web, 'app.js'), 'text/javascript']],
    ['/_nullx/native-brand.js', [path.join(web, 'native-brand.js'), 'text/javascript']],
    ['/_nullx/native-brand.css', [path.join(web, 'native-brand.css'), 'text/css']],
    ['/_nullx/brand.svg', [fileURLToPath(new URL('../assets/icons/app-icon.svg', import.meta.url)), 'image/svg+xml']],
    ['/_nullx/style.css', [path.join(web, 'style.css'), 'text/css']],
    ['/_nullx/marked.js', [path.join(path.dirname(require.resolve('marked')), 'marked.esm.js'), 'text/javascript']],
    ['/_nullx/purify.js', [path.join(path.dirname(require.resolve('dompurify')), 'purify.es.mjs'), 'text/javascript']],
  ]);
  const check = (req, res) => {
    if (!allowedHost(req, trustedHosts)) { json(res, 403, { error: 'Untrusted hostname. Set NULLX11_ALLOWED_HOSTS for a custom proxy domain.' }); return false; }
    if (!allowedOrigin(req)) { json(res, 403, { error: 'Cross-origin access is not allowed.' }); return false; }
    if (!authorized(req, username, password)) {
      res.setHeader('www-authenticate', 'Basic realm="nullx11code", charset="UTF-8"');
      json(res, 401, { error: 'Authentication required.' }); return false;
    }
    return true;
  };
  const requestHeaders = (req) => {
    const headers = { ...req.headers, host: upstream.host, authorization, 'accept-encoding': 'identity' };
    // No ambient browser cookies or proxy credentials should reach the engine.
    delete headers.cookie;
    delete headers['proxy-authorization'];
    delete headers['x-forwarded-host'];
    return headers;
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'same-origin');
    if (!check(req, res)) return;
    const url = new URL(req.url, 'http://nullx11.local');
    try {
      if (url.pathname === '/_nullx/state' && req.method === 'GET') {
        json(res, 200, { version: VERSION, runtimeVersion: RUNTIME_VERSION, root: cwd, project: path.basename(cwd), model: prepared.config.model || null, authenticated: !!password });
        return;
      }
      const isHome = (url.pathname === '/' || url.pathname === '/workspace') && !['upstream', 'advanced'].includes(url.searchParams.get('experience'));
      const asset = staticFiles.get(url.pathname);
      if ((isHome || asset) && ['GET', 'HEAD'].includes(req.method)) {
        const [file, type] = asset || [path.join(web, 'index.html'), 'text/html'];
        const body = await fs.readFile(file);
        res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-cache', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self' https://*.e2b.app https://arena.ai https://*.arena.ai" });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
      if (url.pathname.startsWith('/_nullx/')) { json(res, 404, { error: 'Not found' }); return; }
      // Proxy streams directly, preserving SSE backpressure and cancellation.
      const proxy = http.request({ hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers: requestHeaders(req) }, (incoming) => {
        const headers = { ...incoming.headers, 'cache-control': 'no-store' };
        delete headers['access-control-allow-origin'];
        delete headers['access-control-allow-credentials'];
        if (String(incoming.headers['content-type'] || '').includes('text/html')) {
          const chunks = [];
          let size = 0;
          incoming.on('data', (chunk) => {
            size += chunk.length;
            if (size > 2 * 1024 * 1024) { incoming.destroy(); if (!res.headersSent) json(res, 502, { error: 'Native HTML exceeded the safe branding limit.' }); return; }
            chunks.push(chunk);
          });
          incoming.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'Unable to load the advanced workspace.' }); else res.destroy(); });
          incoming.on('end', () => {
            if (res.writableEnded) return;
            delete headers['content-length']; delete headers.etag;
            res.writeHead(incoming.statusCode || 502, headers);
            res.end(brandNativeHTML(Buffer.concat(chunks).toString('utf8')));
          });
        } else {
          res.writeHead(incoming.statusCode || 502, headers);
          incoming.pipe(res);
        }
      });
      proxy.on('error', () => { if (!res.headersSent) json(res, 502, { error: 'The agent engine is unavailable. Restart nullx11code serve.' }); else res.destroy(); });
      res.on('close', () => proxy.destroy());
      req.on('aborted', () => proxy.destroy());
      req.pipe(proxy);
    } catch {
      if (!res.headersSent) json(res, 500, { error: 'Unable to serve the workspace.' }); else res.destroy();
    }
  });
  // Keep native terminal/PTy WebSockets functional in the full upstream UI.
  server.on('upgrade', (req, socket, head) => {
    if (!allowedHost(req, trustedHosts) || !allowedOrigin(req) || !authorized(req, username, password)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const upstreamSocket = net.connect(Number(upstream.port), upstream.hostname, () => {
      const headers = requestHeaders(req);
      upstreamSocket.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`);
      if (head.length) upstreamSocket.write(head);
      socket.pipe(upstreamSocket).pipe(socket);
    });
    upstreamSocket.on('error', () => socket.destroy());
    socket.on('error', () => upstreamSocket.destroy());
    socket.on('close', () => upstreamSocket.destroy());
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  const stopEngine = async () => {
    if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) return;
    const exited = new Promise((resolve) => runtime.child.once('exit', resolve));
    runtime.child.kill('SIGTERM');
    const timer = setTimeout(() => runtime.child.kill('SIGKILL'), 3000);
    await exited;
    clearTimeout(timer);
  };
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  } catch (error) { await stopEngine(); throw error; }
  const close = async () => {
    if (closing) return;
    closing = true;
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
    await stopEngine();
  };
  runtime.child.once('exit', () => { if (!closing) { for (const socket of sockets) socket.destroy(); server.close(); } });
  return { server, port: server.address().port, url: `http://${host}:${server.address().port}`, close, runtimePID: runtime.child.pid };
}

export async function serveWorkbench(argv) {
  const cfg = loadConfig();
  let port = cfg.port || 7860;
  let host = cfg.host || '0.0.0.0';
  const selection = {};
  const runtimeArgs = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    const take = () => { if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`${arg} requires a value`); return argv[++i]; };
    if (i === 1 && /^\d+$/.test(arg)) port = Number(arg);
    else if (arg === '--port') port = Number(take());
    else if (arg.startsWith('--port=')) port = Number(arg.slice(7));
    else if (arg === '--host' || arg === '--hostname') host = take();
    else if (arg.startsWith('--hostname=')) host = arg.slice(11);
    else if (arg === '--provider') selection.provider = take();
    else if (arg === '--model' || arg === '-m') { selection.model = take(); selection.explicitModel = true; }
    else if (arg === '--pure') runtimeArgs.push('--pure');
    else if (arg === '--no-update-check') continue;
    else throw new Error(`Unsupported workspace option: ${arg}. For all native server flags use nullx11code upstream web --help.`);
  }
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  const app = await startWorkbench({ port, host, cfg, selection, runtimeArgs });
  console.log(`\n  nullx11code ${VERSION} · OpenCode ${RUNTIME_VERSION}\n\n  Workspace:    http://localhost:${app.port}\n  Local access: http://localhost:${app.port}\n  Advanced UI:  http://localhost:${app.port}/?experience=advanced\n  Bind:         ${host}\n  Project:      ${process.cwd()}\n`);
  if (!(process.env.OPENCODE_SERVER_PASSWORD || cfg._env?.OPENCODE_SERVER_PASSWORD)) console.warn('  No server password set. Use --host 127.0.0.1 for local-only access, or set OPENCODE_SERVER_PASSWORD.\n');
  await new Promise((resolve) => {
    const shutdown = async () => { await app.close(); cleanup(); resolve(); };
    const cleanup = () => { for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, shutdown); };
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, shutdown);
    app.server.once('close', () => { cleanup(); resolve(); });
  });
}
