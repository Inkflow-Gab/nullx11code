// Generates PNG app icons (192/512/apple-touch) by rasterizing the app design.
// Pure Node: hand-rolled PNG encoder via node:zlib. Run: node scripts/gen-png-icons.js
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'assets', 'icons', 'png');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- tiny PNG encoder (RGBA8) ---------- */
function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- rasterizer ---------- */
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function makeCanvas(size, ss = 3) {
  const N = size * ss;
  const buf = new Float32Array(N * N * 4); // premult-free RGBA, alpha 0..1
  return { size, ss, N, buf };
}

function blend(buf, i, r, g, b, a) {
  const da = buf[i + 3];
  const outA = a + da * (1 - a);
  if (outA <= 0) return;
  buf[i] = (r * a + buf[i] * da * (1 - a)) / outA;
  buf[i + 1] = (g * a + buf[i + 1] * da * (1 - a)) / outA;
  buf[i + 2] = (b * a + buf[i + 2] * da * (1 - a)) / outA;
  buf[i + 3] = outA;
}

function coverage(dist, half) {
  return Math.max(0, Math.min(1, half + 0.75 - dist));
}

function drawRoundedRect(c, x, y, w, h, r, [R, G, B], alpha = 1) {
  const { buf, N, ss } = c;
  const X = x * ss, Y = y * ss, W = w * ss, H = h * ss, Rr = r * ss;
  const half = 0.5 * ss;
  for (let py = Math.max(0, Y - 2) | 0; py < Math.min(N, Y + H + 2); py++) {
    for (let px = Math.max(0, X - 2) | 0; px < Math.min(N, X + W + 2); px++) {
      const cx = X + Rr, cy = Y + Rr;
      const qx = Math.max(Math.max(cx - px, px - (X + W - Rr)), 0);
      const qy = Math.max(Math.max(cy - py, py - (Y + H - Rr)), 0);
      const dx = Math.max(qx, 0), dy = Math.max(qy, 0);
      const outsideCorner = qx > 0 && qy > 0;
      let dist;
      if (outsideCorner) dist = Math.hypot(dx - 0, dy - 0) - Rr;
      else dist = Math.max(qx - Rr, qy - Rr, -(Math.min(px - X, X + W - px, py - Y, Y + H - py)));
      // simpler exact SDF for rounded box:
      const bx = X + Rr, by = Y + Rr;
      const ex = Math.max(X + Rr - px, px - (X + W - Rr), 0);
      const ey = Math.max(Y + Rr - py, py - (Y + H - Rr), 0);
      dist = Math.hypot(ex, ey) + Math.min(Math.max(X + Rr - px, px - (X + W - Rr)), Math.max(Y + Rr - py, py - (Y + H - Rr)), 0) - Rr;
      const a = coverage(dist, half) * alpha;
      if (a > 0) blend(buf, (py * N + px) * 4, R, G, B, a);
    }
  }
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function drawLine(c, x1, y1, x2, y2, w, [R, G, B], alpha = 1) {
  // coordinates are already in canvas pixels (see drawLineScaled)
  const { buf, N } = c;
  const X1 = x1, Y1 = y1, X2 = x2, Y2 = y2, W = w;
  const half = W / 2;
  const minX = Math.max(0, Math.floor(Math.min(X1, X2) - half - 2));
  const maxX = Math.min(N - 1, Math.ceil(Math.max(X1, X2) + half + 2));
  const minY = Math.max(0, Math.floor(Math.min(Y1, Y2) - half - 2));
  const maxY = Math.min(N - 1, Math.ceil(Math.max(Y1, Y2) + half + 2));
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const d = distToSeg(px + 0.5, py + 0.5, X1, Y1, X2, Y2);
      const a = coverage(d, half) * alpha;
      if (a > 0) blend(buf, (py * N + px) * 4, R, G, B, a);
    }
  }
}

function drawStar(c, cx, cy, R, [r, g, b], alpha = 1) {
  // astroid-ish 4-point star: sqrt(|x|)+sqrt(|y|) <= sqrt(R); coords already canvas px
  const { buf, N } = c;
  const CX = cx, CY = cy, Rr = R;
  const sqR = Math.sqrt(Rr);
  const minX = Math.max(0, Math.floor(CX - Rr - 2));
  const maxX = Math.min(N - 1, Math.ceil(CX + Rr + 2));
  const minY = Math.max(0, Math.floor(CY - Rr - 2));
  const maxY = Math.min(N - 1, Math.ceil(CY + Rr + 2));
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const x = Math.abs(px + 0.5 - CX);
      const y = Math.abs(py + 0.5 - CY);
      const v = Math.sqrt(x) + Math.sqrt(y);
      const a = Math.max(0, Math.min(1, sqR + 0.75 - v)) * alpha;
      if (a > 0) blend(buf, (py * N + px) * 4, r, g, b, a);
    }
  }
}

function downsample(c, size) {
  const { buf, N, ss } = c;
  const out = Buffer.alloc(size * size * 4);
  const S = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const i = ((y * ss + sy) * N + (x * ss + sx)) * 4;
          const al = buf[i + 3];
          r += buf[i] * al;
          g += buf[i + 1] * al;
          b += buf[i + 2] * al;
          a += al;
        }
      }
      const o = (y * size + x) * 4;
      out[o] = a ? Math.round(r / a) : 0;
      out[o + 1] = a ? Math.round(g / a) : 0;
      out[o + 2] = a ? Math.round(b / a) : 0;
      out[o + 3] = Math.round((a / S) * 255);
    }
  }
  return out;
}

function renderIcon(size) {
  const c = makeCanvas(size, 3);
  // design in 128-unit space
  const k = 128 / size; // px → design units inverse handled by scaling coords: we pass design units directly
  // draw in design-unit coordinates (canvas maps design units * ss since makeCanvas N = size*ss and design spans 0..128 scaled by size/128... )
  // simpler: scale factor from design units to canvas pixels:
  const s = c.ss * size / 128;
  const S = (v) => v * s;
  const bg = hex('#0a0d12');
  const edge = hex('#232c39');
  const green = hex('#76b900');
  const light = hex('#e6ebf2');
  const spark = hex('#b7f04a');

  // rounded square (full-bleed)
  drawRoundedRectScaled(c, 0, 0, 128, 128, 30, bg, 1, s);
  drawRoundedRectScaled(c, 3, 3, 122, 122, 28, edge, 1, s);
  drawRoundedRectScaled(c, 6, 6, 116, 116, 26, bg, 1, s);
  // chevron (round join/caps approximated by segments)
  drawLineScaled(c, 34, 44, 56, 64, 9, green, 1, s);
  drawLineScaled(c, 56, 64, 34, 84, 9, green, 1, s);
  // prompt bar
  drawLineScaled(c, 66, 84, 96, 84, 9, light, 1, s);
  // spark
  drawStarScaled(c, 92, 34, 13, spark, 1, s);
  return downsample(c, size);
}

function drawRoundedRectScaled(c, x, y, w, h, r, col, alpha, s) {
  const { buf, N, ss } = c;
  const X = x * s, Y = y * s, W = w * s, H = h * s, Rr = r * s;
  const half = 0.5 * ss;
  const y0 = Math.max(0, Math.floor(Y - 2)), y1 = Math.min(N, Math.ceil(Y + H + 2));
  const x0 = Math.max(0, Math.floor(X - 2)), x1 = Math.min(N, Math.ceil(X + W + 2));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const ex = Math.max(X + Rr - (px + 0.5), px + 0.5 - (X + W - Rr), 0);
      const ey = Math.max(Y + Rr - (py + 0.5), py + 0.5 - (Y + H - Rr), 0);
      const dist = Math.hypot(ex, ey) + Math.min(Math.max(X + Rr - (px + 0.5), px + 0.5 - (X + W - Rr)), Math.max(Y + Rr - (py + 0.5), py + 0.5 - (Y + H - Rr)), 0) - Rr;
      const a = coverage(dist, half) * alpha;
      if (a > 0) blend(buf, (py * N + px) * 4, col[0], col[1], col[2], a);
    }
  }
}
function drawLineScaled(c, x1, y1, x2, y2, w, col, alpha, s) {
  drawLine(c, x1 * s, y1 * s, x2 * s, y2 * s, w * s, col, alpha);
}
function drawStarScaled(c, cx, cy, R, col, alpha, s) {
  drawStar(c, cx * s, cy * s, R * s, col, alpha);
}

/* ---------- write files ---------- */
const sizes = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon.png', 64],
];
for (const [name, size] of sizes) {
  const rgba = renderIcon(size);
  const png = encodePNG(size, size, rgba);
  fs.writeFileSync(path.join(OUT, name), png);
  console.log(`wrote ${name} (${size}x${size}, ${png.length} bytes)`);
}
