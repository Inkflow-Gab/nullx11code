// Update check: compare local VERSION against the repo on GitHub and offer to update.
// Zero-dep, best-effort, short timeouts — a slow network must never block the CLI.
import { spawn } from 'node:child_process';
import { VERSION } from './config.js';

const REPO = 'Inkflow-Gab/nullx11code';
const API = `https://api.github.com/repos/${REPO}`;
const HEADERS = {
  accept: 'application/vnd.github+json',
  'user-agent': 'nullx11code',
};

/** How the user updates: the installer re-pulls main and relinks binaries. */
export const INSTALL_CMD = `curl -fsSL https://raw.githubusercontent.com/${REPO}/main/install.sh | sh`;

/** Compare semver-ish strings: -1 (a<b), 0 (equal), 1 (a>b). Non-numeric parts ignored. */
export function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Check GitHub for a newer version.
 * 1) latest release tag, 2) package.json on main (this repo has no releases yet).
 * Returns { current, latest, updateAvailable, url, install } or null (silent failure).
 */
export async function checkForUpdate({ current = VERSION, timeout = 2000, fetchImpl = fetch } = {}) {
  try {
    let latest = null;

    const res1 = await fetchImpl(`${API}/releases/latest`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(timeout),
    });
    if (res1.ok) {
      const tag = String((await res1.json()).tag_name || '').replace(/^v/, '');
      if (/^\d+\.\d+\.\d+/.test(tag)) latest = tag;
    }

    if (!latest) {
      const res2 = await fetchImpl(`${API}/contents/package.json?ref=main`, {
        headers: HEADERS,
        signal: AbortSignal.timeout(timeout),
      });
      if (res2.ok) {
        const json = await res2.json();
        const pkg = JSON.parse(Buffer.from(json.content || '', 'base64').toString('utf8'));
        if (pkg.version) latest = String(pkg.version);
      }
    }

    if (!latest) return null;
    return {
      current,
      latest,
      updateAvailable: compareVersions(latest, current) > 0,
      url: `https://github.com/${REPO}`,
      install: INSTALL_CMD,
    };
  } catch {
    return null; // offline / rate-limited / timed out — never bother the user
  }
}

/** Run the installer (stdio inherited). Resolves with the exit code. */
export function runInstaller() {
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', INSTALL_CMD], { stdio: 'inherit' });
    child.on('error', () => resolve(-1));
    child.on('exit', (code) => resolve(code ?? -1));
  });
}
