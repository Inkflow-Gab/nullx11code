// Generates provider + model-family SVG icons into assets/icons/.
// Run: node scripts/gen-icons.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PROV_DIR = path.join(ROOT, 'assets', 'icons', 'providers');
const MODEL_DIR = path.join(ROOT, 'assets', 'icons', 'models');
fs.mkdirSync(PROV_DIR, { recursive: true });
fs.mkdirSync(MODEL_DIR, { recursive: true });

const svg = (body, bg = '#0f141b') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img">\n  <rect width="64" height="64" rx="14" fill="${bg}"/>\n${body}\n</svg>\n`;

/* ── provider marks (original geometric art) ── */
const providers = {
  nvidia: svg(`
  <path d="M14 34c6-11 16-17 30-16-11 1-20 6-25 16 5 10 14 15 25 16-14 1-24-5-30-16z" fill="#76b900"/>
  <circle cx="34" cy="34" r="5" fill="#76b900"/>`),
  groq: svg(`
  <circle cx="32" cy="32" r="9" fill="#F55036"/>
  <g stroke="#F55036" stroke-width="4" stroke-linecap="round">
    <path d="M32 10v8M32 46v8M10 32h8M46 32h8M17 17l6 6M41 41l6 6M47 17l-6 6M23 41l-6 6"/>
  </g>`),
  cerebras: svg(`
  <g fill="#7C3AED">
    <rect x="14" y="14" width="14" height="14" rx="3"/>
    <rect x="36" y="14" width="14" height="14" rx="3"/>
    <rect x="14" y="36" width="14" height="14" rx="3"/>
    <rect x="36" y="36" width="14" height="14" rx="3" opacity=".55"/>
  </g>`),
  openrouter: svg(`
  <path d="M16 32h12M36 32h12" stroke="#6C72E5" stroke-width="5" stroke-linecap="round"/>
  <path d="M28 22l8 10-8 10" stroke="#6C72E5" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="16" cy="32" r="5" fill="#6C72E5"/>
  <circle cx="48" cy="32" r="5" fill="#6C72E5"/>`),
  gemini: svg(`
  <path d="M32 10c2.5 12 9.5 19.5 22 22-12.5 2.5-19.5 10-22 22-2.5-12-9.5-19.5-22-22 12.5-2.5 19.5-10 22-22z" fill="url(#gem)"/>
  <defs><linearGradient id="gem" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4E8CFF"/><stop offset="1" stop-color="#B36BFF"/></linearGradient></defs>`),
  mistral: svg(`
  <g fill="#FA5010">
    <rect x="14" y="14" width="36" height="8" rx="2"/>
    <rect x="14" y="28" width="24" height="8" rx="2"/>
    <rect x="14" y="42" width="36" height="8" rx="2"/>
    <rect x="44" y="28" width="6" height="8" rx="2" opacity=".55"/>
  </g>`),
  github: svg(`
  <circle cx="32" cy="32" r="17" fill="none" stroke="#EDEDED" stroke-width="4"/>
  <path d="M24 46c0-5 3-7 8-7s8 2 8 7" fill="none" stroke="#EDEDED" stroke-width="4" stroke-linecap="round"/>
  <circle cx="26" cy="29" r="3" fill="#EDEDED"/>
  <circle cx="38" cy="29" r="3" fill="#EDEDED"/>`),
  together: svg(`
  <path d="M32 12l5 14 14 5-14 5-5 14-5-14-14-5 14-5z" fill="#0B5FFF"/>`),
  openai: svg(`
  <g fill="none" stroke="#10A37F" stroke-width="4" stroke-linecap="round">
    <circle cx="32" cy="32" r="10"/>
    <path d="M32 12v10M32 42v10M12 32h10M42 32h10M18 18l7 7M39 39l7 7M46 18l-7 7M25 39l-7 7"/>
  </g>`),
  ollama: svg(`
  <path d="M18 44c0-12 6-22 14-22s14 10 14 22" fill="none" stroke="#B8BCC8" stroke-width="5" stroke-linecap="round"/>
  <circle cx="26" cy="30" r="3" fill="#B8BCC8"/>
  <circle cx="38" cy="30" r="3" fill="#B8BCC8"/>
  <path d="M14 24l6 6M50 24l-6 6" stroke="#B8BCC8" stroke-width="4" stroke-linecap="round"/>`),
  lmstudio: svg(`
  <path d="M32 12l17 10v20L32 52 15 42V22z" fill="none" stroke="#4C8BF5" stroke-width="4" stroke-linejoin="round"/>
  <path d="M26 40V26l14 14V26" fill="none" stroke="#4C8BF5" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`),
  custom: svg(`
  <path d="M20 24h24M20 40h24" stroke="#8B93A7" stroke-width="5" stroke-linecap="round"/>
  <path d="M26 16v16M38 32v16" stroke="#8B93A7" stroke-width="5" stroke-linecap="round"/>`),
};

/* ── model family marks ── */
const models = {
  llama: svg(`<path d="M16 46c0-14 7-26 16-26s16 12 16 26" fill="none" stroke="#0866FF" stroke-width="5" stroke-linecap="round"/>
    <path d="M20 22l-4-10 10 6M44 22l4-10-10 6" fill="none" stroke="#0866FF" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="27" cy="34" r="3" fill="#0866FF"/><circle cx="37" cy="34" r="3" fill="#0866FF"/>`),
  qwen: svg(`<text x="32" y="42" font-family="monospace" font-size="30" font-weight="700" fill="#6B4EFF" text-anchor="middle">Q</text>
    <path d="M40 46c4 2 8 1 10-2" stroke="#6B4EFF" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  deepseek: svg(`<path d="M12 36c8 6 18 8 30 4-4 8-14 12-22 8-6-3-9-8-8-12z" fill="#4D6BFE"/>
    <path d="M40 34c6-4 10-4 14-1-4 1-7 3-9 6" fill="#4D6BFE"/>
    <circle cx="24" cy="34" r="2.5" fill="#fff"/>`),
  nemotron: svg(`<path d="M18 46V18l14 16 14-16v28" fill="none" stroke="#76B900" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`),
  mistral: svg(`<g fill="#FA5010">
    <rect x="16" y="16" width="32" height="7" rx="2"/>
    <rect x="16" y="28.5" width="20" height="7" rx="2"/>
    <rect x="16" y="41" width="32" height="7" rx="2"/></g>`),
  gemma: svg(`<path d="M32 14c8 10 14 17 14 25a14 14 0 0 1-28 0c0-8 6-15 14-25z" fill="none" stroke="#3DDC84" stroke-width="5" stroke-linejoin="round"/>`),
  kimi: svg(`<circle cx="32" cy="32" r="16" fill="none" stroke="#16A37E" stroke-width="5"/>
    <path d="M38 18a16 16 0 0 0 0 28" fill="#16A37E"/>`),
  gpt: svg(`<g fill="none" stroke="#10A37F" stroke-width="4" stroke-linecap="round">
    <circle cx="32" cy="32" r="9"/>
    <path d="M32 14v9M32 41v9M14 32h9M41 32h9M20 20l6 6M38 38l6 6M44 20l-6 6M26 38l-6 6"/></g>`),
  claude: svg(`<g stroke="#D97757" stroke-width="4" stroke-linecap="round">
    <path d="M32 12v40M15 22l34 20M49 22L15 42"/></g>`),
  gemini: svg(`<path d="M32 10c2.5 12 9.5 19.5 22 22-12.5 2.5-19.5 10-22 22-2.5-12-9.5-19.5-22-22 12.5-2.5 19.5-10 22-22z" fill="#4E8CFF"/>`),
  cohere: svg(`<text x="32" y="42" font-family="monospace" font-size="28" font-weight="700" fill="#39594D" text-anchor="middle">C</text>`),
  phi: svg(`<text x="32" y="43" font-family="serif" font-size="34" font-weight="700" fill="#0078D4" text-anchor="middle">φ</text>`),
  glm: svg(`<text x="32" y="42" font-family="monospace" font-size="28" font-weight="700" fill="#2E6BFF" text-anchor="middle">G</text>`),
  yi: svg(`<text x="32" y="43" font-family="monospace" font-size="30" font-weight="700" fill="#00B8A9" text-anchor="middle">Yi</text>`),
  starcoder: svg(`<path d="M32 12l5 14 14 5-14 5-5 14-5-14-14-5 14-5z" fill="#F05138"/>`),
  granite: svg(`<rect x="16" y="16" width="32" height="32" rx="6" fill="none" stroke="#5B8DEF" stroke-width="5"/>
    <path d="M24 32h16" stroke="#5B8DEF" stroke-width="5" stroke-linecap="round"/>`),
  generic: svg(`<path d="M32 14l16 9v18l-16 9-16-9V23z" fill="none" stroke="#8B93A7" stroke-width="4" stroke-linejoin="round"/>`),
};

let n = 0;
for (const [name, content] of Object.entries(providers)) {
  fs.writeFileSync(path.join(PROV_DIR, `${name}.svg`), content);
  n++;
}
for (const [name, content] of Object.entries(models)) {
  fs.writeFileSync(path.join(MODEL_DIR, `${name}.svg`), content);
  n++;
}
console.log(`wrote ${n} icons → assets/icons/{providers,models}`);
