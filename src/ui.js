// Terminal UI: ANSI styling, wrapping, badges (model icons), banner, spinner, markdown.
import { familyMeta, FAMILIES } from './models.js';
import { VERSION } from './config.js';

const noColorEnv =
  process.env.NO_COLOR != null || process.env.NULLX11_NO_COLOR != null || process.env.TERM === 'dumb';

export function colorsEnabled() {
  if (process.env.FORCE_COLOR) return process.env.FORCE_COLOR !== '0';
  if (noColorEnv) return false;
  return !!process.stdout.isTTY;
}

let enabled = colorsEnabled();
export function setColors(v) {
  enabled = !!v;
}

const CODES = {
  reset: [0, 0],
  bold: [1, 22],
  dim: [2, 22],
  italic: [3, 23],
  underline: [4, 24],
  inverse: [7, 27],
  black: [30, 39],
  red: [31, 39],
  green: [32, 39],
  yellow: [33, 39],
  blue: [34, 39],
  magenta: [35, 39],
  cyan: [36, 39],
  white: [37, 39],
  gray: [90, 39],
  brightRed: [91, 39],
  brightGreen: [92, 39],
  brightYellow: [93, 39],
  brightBlue: [94, 39],
  brightMagenta: [95, 39],
  brightCyan: [96, 39],
};

function code(name) {
  const c = CODES[name];
  return c ? `\x1b[${c[0]}m` : '';
}
function uncode(name) {
  const c = CODES[name];
  return c ? `\x1b[${c[1]}m` : '';
}

export const c = {};
for (const name of Object.keys(CODES)) {
  c[name] = (s) => (enabled ? code(name) + String(s) + uncode(name) : String(s));
}

/** Wrap an RGB hex to an ANSI 24-bit colored string. */
export function hex(s, color) {
  if (!enabled || !color) return String(s);
  const h = color.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m${s}\x1b[0m`;
}

export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return String(s).replace(/\x1b\[[0-9;]*m/g, '');
}

export function width() {
  const w = process.stdout.columns || 80;
  return Math.max(30, Math.min(w, 110));
}

/** Word-wrap plain text to `cols`, preserving existing newlines. */
export function wrap(text, cols = width()) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (line.length <= cols) {
      out.push(line);
      continue;
    }
    let cur = '';
    for (const word of line.split(' ')) {
      if (!cur) {
        cur = word;
      } else if (cur.length + 1 + word.length <= cols) {
        cur += ' ' + word;
      } else {
        out.push(cur);
        cur = word;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

/** Indent every line. */
export function indent(text, pad = '  ') {
  return String(text)
    .split('\n')
    .map((l) => (l.length ? pad + l : l))
    .join('\n');
}

/** [NAME] style label in a color. */
export function label(text, color = 'cyan') {
  return c[color](`[${text}]`);
}

/** Terminal "icon" for a provider: colored block + short name. */
export function providerBadge(prov, extra = '') {
  const short = (prov.name || prov.id).split(' ')[0];
  const mark = hex('▌', prov.color);
  return `${mark} ${c.bold(short)}${extra ? c.dim(' ' + extra) : ''}`;
}

/** Model badge: provider color bar + model id + family letters (the "model icon" in terminal). */
export function modelBadge(prov, modelId) {
  const fam = familyMeta(modelId);
  const bar = hex('▌', prov?.color || '#8B93A7');
  const famTag = hex(fam.letters, fam.color);
  return `${bar} ${hex(prov?.name || 'model', prov?.color || '#8B93A7')} ${c.dim('·')} ${c.bold(modelId)} ${c.dim('·')} ${famTag} ${c.dim(fam.label)}`;
}

/** Small family chip used inline after model names. */
export function familyChip(modelId) {
  const fam = familyMeta(modelId);
  return hex(` ${fam.letters} `, fam.color) + ' ' + c.dim(fam.label);
}

export function rule(ch = '─') {
  return c.gray(ch.repeat(Math.min(width(), 72)));
}

export function banner({ prov, model, skills = 0, providers = 0 } = {}) {
  const INNER = 48;
  const boxLine = (content) => {
    let pad = INNER - stripAnsi(content).length;
    if (pad < 0) {
      // too long: fall back to a shorter variant or hard-truncate
      const plain = stripAnsi(content);
      content = plain.slice(0, INNER - 1) + '…';
      pad = 1;
    }
    return c.cyan('  │ ') + content + ' '.repeat(Math.max(0, pad)) + c.cyan(' │');
  };
  const lines = [];
  lines.push(c.cyan('  ┌' + '─'.repeat(INNER) + '┐'));
  lines.push(boxLine(`${hex('▗▄▖', '#76B900')}${hex('▐▌ ▐▌', '#76B900')} ${c.bold('nullx11code')} ${c.dim('v' + VERSION)}`));
  lines.push(boxLine(c.dim('free-first AI coding agent · terminal + web')));
  lines.push(
    boxLine(c.dim(`${providers} key${providers === 1 ? '' : 's'} · ${skills} skill${skills === 1 ? '' : 's'} · /help for commands`))
  );
  lines.push(c.cyan('  └' + '─'.repeat(INNER) + '┘'));
  if (prov && model) {
    lines.push(`  ${c.dim('model')} ${modelBadge(prov, model)}`);
  }
  return lines.join('\n');
}

export function helpLine(cmd, desc) {
  const pad = Math.max(0, 14 - cmd.length);
  return `  ${c.cyan('/' + cmd)}${' '.repeat(pad)}${c.dim(desc)}`;
}

const SPINNER_FRAMES = process.platform === 'win32' ? ['-', '\\', '|', '/'] : ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  constructor(text = '') {
    this.text = text;
    this.timer = null;
    this.i = 0;
    this.active = false;
  }
  start(text) {
    if (text) this.text = text;
    if (!process.stdout.isTTY || noColorEnv) {
      process.stdout.write(c.dim(`… ${this.text}\n`));
      return this;
    }
    this.active = true;
    const frame = () => {
      if (!this.active) return;
      const f = hex(SPINNER_FRAMES[this.i++ % SPINNER_FRAMES.length], '#76B900');
      process.stdout.write(`\r\x1b[2K${f} ${c.dim(this.text)}`);
    };
    frame();
    this.timer = setInterval(frame, 90);
    this.timer.unref?.();
    return this;
  }
  stop(finalText = null) {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (process.stdout.isTTY && !noColorEnv) process.stdout.write('\r\x1b[2K');
    if (finalText) process.stdout.write(finalText + '\n');
    return this;
  }
}

/** Lightweight markdown → ANSI. Conservative: code fences, bold, inline code, headers, lists. */
export function md(text, cols = width()) {
  const src = String(text);
  const out = [];
  const lines = src.split('\n');
  let inCode = false;
  let codeBuf = [];

  const flushCode = () => {
    if (!codeBuf.length) return;
    const maxLen = Math.min(Math.max(...codeBuf.map((l) => l.length)), cols - 6);
    out.push(c.gray('  ┌' + '─'.repeat(maxLen + 2) + '┐'));
    for (const l of codeBuf) out.push(c.gray('  │ ') + c.white(l.slice(0, cols - 6).padEnd(maxLen)) + c.gray(' │'));
    out.push(c.gray('  └' + '─'.repeat(maxLen + 2) + '┘'));
    codeBuf = [];
  };

  for (const line of lines) {
    if (/^```/.test(line)) {
      if (inCode) flushCode();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      continue;
    }
    let l = line;
    l = l.replace(/`([^`]+)`/g, (_, s) => c.cyan(s));
    l = l.replace(/\*\*([^*]+)\*\*/g, (_, s) => c.bold(s));
    l = l.replace(/(^|\s)\*([^*]+)\*/g, (_, a, s) => a + c.italic(s));
    if (/^#{1,6}\s/.test(l)) l = c.bold(hex(l.replace(/^#{1,6}\s/, ''), '#76B900'));
    else if (/^\s*[-*+]\s/.test(l)) l = l.replace(/^(\s*)([-*+])\s/, `$1${hex('•', '#76B900')} `);
    else if (/^\s*\d+\.\s/.test(l)) l = l.replace(/^(\s*\d+\.)/, (_, n) => hex(n, '#76B900'));
    out.push(...wrap(l, cols).map((w, i) => (i === 0 ? w : '  ' + w)));
  }
  flushCode();
  return out.join('\n');
}

/** Simple aligned table. */
export function table(headers, rows) {
  const cols = headers.length;
  const widths = headers.map((h, i) => Math.max(stripAnsi(h).length, ...rows.map((r) => stripAnsi(String(r[i] ?? '')).length)));
  const sep = c.gray('─┼─'.repeat(cols).replace(/─┼.$/, '─'));
  const line = (cells) =>
    cells
      .map((cell, i) => {
        const pad = ' '.repeat(Math.max(0, widths[i] - stripAnsi(String(cell ?? '')).length));
        return String(cell ?? '') + pad;
      })
      .join(c.gray(' ─ ') || ' ')
      .replace(/ ─ $/, '');
  const head = c.bold(headers.map((h, i) => h + ' '.repeat(Math.max(0, widths[i] - stripAnsi(h).length))).join(c.gray(' ─ ')));
  const body = rows.map((r) => line(r));
  return [head, c.gray('─'.repeat(widths.reduce((a, b) => a + b, 0) + (cols - 1) * 3)), ...body].join('\n');
}

export { FAMILIES };
