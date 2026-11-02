// @file mentions (opencode-style): expand @path tokens in user input.
// Text files are inlined as fenced blocks; images become multimodal parts.
import fs from 'node:fs';
import path from 'node:path';

const MAX_TEXT = 48 * 1024; // inline up to 48KB per file
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

/** Resolve a mention token to an absolute path inside the project root. */
function resolveMention(root, token) {
  const clean = token.replace(/^@/, '');
  if (!clean) return null;
  const abs = path.resolve(root, clean);
  const rel = path.relative(path.resolve(root), abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null; // escapes root
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    return { abs, rel, size: st.size };
  } catch {
    return null;
  }
}

/**
 * Expand @path tokens in `text`.
 * @returns {{ text: string, files: string[], images: {rel:string, dataUrl:string}[] }}
 *   text    — prompt with text files inlined (images left as plain mentions)
 *   files   — inlined text file rel paths
 *   images  — data URLs for image mentions (caller builds multimodal content)
 */
export function expandMentions(text, root) {
  const src = String(text || '');
  const files = [];
  const images = [];
  const re = /@([\w./\\-]+\.[A-Za-z0-9]{1,8})/g;
  const out = src.replace(re, (match, token) => {
    const hit = resolveMention(root, token);
    if (!hit) return match; // not a file — leave the text alone
    const ext = path.extname(hit.abs).toLowerCase();
    if (IMAGE_EXT.has(ext)) {
      if (hit.size > 8 * 1024 * 1024) return match; // too big for a data URL
      const dataUrl = `data:image/${ext.slice(1) === 'jpg' ? 'jpeg' : ext.slice(1)};base64,${fs
        .readFileSync(hit.abs)
        .toString('base64')}`;
      images.push({ rel: hit.rel, dataUrl });
      return match; // keep @mention visible; caller attaches the image part
    }
    if (hit.size > MAX_TEXT) return match;
    let body;
    try {
      body = fs.readFileSync(hit.abs, 'utf8');
    } catch {
      return match;
    }
    if (body.includes('\0')) return match; // binary
    files.push(hit.rel);
    const fence = body.includes('```') ? '````' : '```';
    const lang = ext.replace('.', '');
    return `\n${fence}${lang} file:${hit.rel}\n${body.trimEnd()}\n${fence}`;
  });
  return { text: out, files, images };
}

/** Build OpenAI-style content array when images are present, else plain string. */
export function buildContent(text, images) {
  if (!images?.length) return text;
  const parts = [{ type: 'text', text }];
  for (const img of images) {
    parts.push({ type: 'image_url', image_url: { url: img.dataUrl } });
  }
  return parts;
}
