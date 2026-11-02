import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse as parseJSONC } from 'jsonc-parser';

export const TERMINAL_PLUGIN = fileURLToPath(new URL('./branding/terminal.tsx', import.meta.url));

/** A private generated TUI config adds branding without editing original files.
 * Native global/project tui.json layers still load. An explicit user-supplied
 * TUI config is copied/merged; relative plugin paths are made absolute because
 * the generated file has a different directory. It is never logged.
 */
export function terminalEnvironment(env = process.env) {
  if (env.NULLX11_NO_BRANDING === '1') return { ...env };
  let config = {};
  const original = env.OPENCODE_TUI_CONFIG;
  if (original) {
    const errors = [];
    config = parseJSONC(fs.readFileSync(original, 'utf8'), errors, { allowTrailingComma: true });
    if (errors.length || !config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Invalid OPENCODE_TUI_CONFIG. Fix the config, or use NULLX11_NO_BRANDING=1 for exact native loading.');
    if (config.plugin) {
      const normalize = (spec) => typeof spec === 'string' && (spec.startsWith('.') || path.isAbsolute(spec)) ? path.resolve(path.dirname(path.resolve(original)), spec) : spec;
      config.plugin = config.plugin.map((item) => Array.isArray(item) ? [normalize(item[0]), item[1]] : normalize(item));
    }
  }
  const home = env.NULLX11_HOME || path.join(env.HOME || env.USERPROFILE || os.homedir(), '.nullx11code');
  const merged = { ...config, plugin: [...(config.plugin || []), TERMINAL_PLUGIN] };
  const text = JSON.stringify(merged, null, 2) + '\n';
  // Content-addressed filenames avoid two concurrent terminals overwriting one
  // another's explicit TUI settings. Mode 0600 also protects plugin options.
  const directory = path.join(home, 'runtime');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(directory, `tui-${createHash('sha256').update(text).digest('hex').slice(0, 20)}.json`);
  if (!fs.existsSync(filename)) {
    const temporary = `${filename}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporary, text, { mode: 0o600 });
      fs.renameSync(temporary, filename);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  return { ...env, OPENCODE_TUI_CONFIG: filename };
}

/** Only native HTML presentation metadata is rewritten; JS bundles, provider
 * names, API routes, configuration keys and user content remain untouched.
 */
export function brandNativeHTML(html) {
  return html.replace(/<title>[^<]*<\/title>/i, '<title>nullx11code — Advanced workspace</title>')
    .replace(/<link\b(?=[^>]*\brel=["'](?:icon|shortcut icon|apple-touch-icon|manifest)["'])[^>]*>/gi, '')
    .replace('</head>', '<link rel="icon" href="/_nullx/brand.svg" type="image/svg+xml"><link rel="stylesheet" href="/_nullx/native-brand.css"><script src="/_nullx/native-brand.js" defer></script></head>');
}

export function brandNativeHelp(text) {
  // Called ONLY for generated help/completion, never live agent output.
  return text.replace(/(^|[\s(])opencode(?=\s|$)/gm, '$1nullx11code');
}
export function brandCompletion(text) {
  return text.replaceAll('opencode', 'nullx11code')
    .replace(/(complete[^\n]*-F[^\n]*) nullx11code\n/, '$1 nullx11code\n$1 n11\n');
}
export async function capturePresentation(bin, args, env, kind = 'help') {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout, stderr } = await promisify(execFile)(bin, args, { env, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  const transform = kind === 'completion' ? brandCompletion : brandNativeHelp;
  if (stdout) process.stdout.write(transform(stdout));
  if (stderr) process.stderr.write(transform(stderr));
  return 0;
}
