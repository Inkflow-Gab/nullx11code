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

/* filled disc with soft edge */
function drawCircle(c, cx, cy, r, col, alpha = 1) {
  const { buf, N, ss } = c;
  const half = 0.5 * ss;
  const x0 = Math.max(0, Math.floor(cx - r - 2)), x1 = Math.min(N, Math.ceil(cx + r + 2));
  const y0 = Math.max(0, Math.floor(cy - r - 2)), y1 = Math.min(N, Math.ceil(cy + r + 2));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy);
      const a = coverage(d, r) * alpha;
      if (a > 0) blend(buf, (py * N + px) * 4, col[0], col[1], col[2], a);
    }
  }
}

/* ring (for binary "0" and eye highlights) */
function drawRing(c, cx, cy, r, thickness, col, alpha = 1) {
  const { buf, N, ss } = c;
  const half = thickness / 2;
  const x0 = Math.max(0, Math.floor(cx - r - 2)), x1 = Math.min(N, Math.ceil(cx + r + 2));
  const y0 = Math.max(0, Math.floor(cy - r - 2)), y1 = Math.min(N, Math.ceil(cy + r + 2));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const d = Math.abs(Math.hypot(px + 0.5 - cx, py + 0.5 - cy) - r);
      const a = coverage(d, half) * alpha;
      if (a > 0) blend(buf, (py * N + px) * 4, col[0], col[1], col[2], a);
    }
  }
}

/* soft radial glow (alpha falls off to 0 at radius) */
function drawGlow(c, cx, cy, r, col, strength = 0.35) {
  const { buf, N } = c;
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(N, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(N, Math.ceil(cy + r));
  for (let py = y0; py < y1; py++) {
    for (let px = x0; px < x1; px++) {
      const t = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) / r;
      if (t >= 1) continue;
      const a = strength * (1 - t) * (1 - t);
      blend(buf, (py * N + px) * 4, col[0], col[1], col[2], a);
    }
  }
}

function drawTriangle(c, x1, y1, x2, y2, x3, y3, col, alpha = 1) {
  const { buf, N } = c;
  const minX = Math.max(0, Math.floor(Math.min(x1, x2, x3) - 2));
  const maxX = Math.min(N - 1, Math.ceil(Math.max(x1, x2, x3) + 2));
  const minY = Math.max(0, Math.floor(Math.min(y1, y2, y3) - 2));
  const maxY = Math.min(N - 1, Math.ceil(Math.max(y1, y2, y3) + 2));
  const edge = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const x = px + 0.5, y = py + 0.5;
      const d1 = edge(x1, y1, x2, y2, x, y);
      const d2 = edge(x2, y2, x3, y3, x, y);
      const d3 = edge(x3, y3, x1, y1, x, y);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) {
        // 1px AA via distance to edges
        blend(buf, (py * N + px) * 4, col[0], col[1], col[2], alpha);
      }
    }
  }
}

/* tiny binary glyphs: "0" ring / "1" bar — drawn as texture, not real text */
function drawBinary(c, x, y, kind, scale, col, alpha) {
  const u = scale;
  if (kind === '0') drawRing(c, x, y, 3.2 * u, 1.6 * u, col, alpha);
  else drawLine(c, x, y - 3.4 * u, x, y + 3.4 * u, 1.8 * u, col, alpha);
}

function renderIcon(size) {
  const c = makeCanvas(size, 3);
  const s = (c.ss * size) / 128; // design-unit → canvas px
  const D = (v) => v * s;

  const bg = hex('#10141c');
  const edge = hex('#2a3342');
  const green = hex('#76b900');
  const white = hex('#f2f6fc');
  const dark = hex('#131923');
  const blush = hex('#f7b8c4');

  // ── canvas: dark squircle ──
  drawRoundedRectScaled(c, 0, 0, 128, 128, 30, bg, 1, s);
  drawRoundedRectScaled(c, 3, 3, 122, 122, 28, edge, 1, s);
  drawRoundedRectScaled(c, 6, 6, 116, 116, 26, bg, 1, s);

  // ── flowing binary texture ──
  const bits = [
    [16, 24, '0', 1, green, 0.55], [16, 42, '1', 1, green, 0.5], [16, 78, '0', 1, green, 0.5],
    [28, 60, '1', 1, white, 0.3], [28, 24, '1', 1, white, 0.3], [28, 94, '0', 1, white, 0.28],
    [42, 42, '0', 1, white, 0.32], [42, 106, '1', 1, green, 0.5], [16, 102, '1', 1, green, 0.45],
    [104, 28, '1', 1, green, 0.5], [104, 64, '0', 1, green, 0.5], [94, 94, '1', 1, green, 0.45],
    [94, 28, '0', 1, white, 0.3], [104, 46, '1', 1, white, 0.28], [76, 20, '0', 1, white, 0.25],
    [60, 110, '1', 1, white, 0.25], [76, 110, '0', 1, white, 0.22], [16, 60, '0', 1, white, 0.22],
    [76, 42, '1', 1, white, 0.18], [104, 86, '0', 1, white, 0.2],
  ];
  for (const [x, y, k, sc, col, a] of bits) drawBinary(c, D(x), D(y), k, sc * s, col, a);

  // ── glow halo ──
  drawGlow(c, D(62), D(64), D(36), white, 0.22);

  // ── anime sprite (cat-eared spirit) ──
  const cx = D(62), cy = D(60), R = D(21);
  // ears (behind head)
  drawTriangle(c, D(44), D(48), D(40), D(26), D(58), D(40), white, 1);
  drawTriangle(c, D(80), D(48), D(84), D(26), D(66), D(40), white, 1);
  drawTriangle(c, D(46), D(44), D(44), D(32), D(54), D(40), blush, 0.85);
  drawTriangle(c, D(78), D(44), D(80), D(32), D(70), D(40), blush, 0.85);
  // body blob: head circle + lower rounded mass
  drawCircle(c, cx, cy, R, white, 1);
  drawRoundedRectScaled(c, 44, 66, 36, 30, 14, white, 1, s);
  // arms
  drawLine(c, D(42), D(70), D(39), D(78), D(5), white, 1);
  drawLine(c, D(82), D(70), D(85), D(78), D(5), white, 1);
  // blush
  drawCircle(c, D(48), D(60), D(4.2), blush, 0.75);
  drawCircle(c, D(76), D(60), D(4.2), blush, 0.75);
  // big anime eyes
  drawCircle(c, D(54), D(55), D(5.4), dark, 1);
  drawCircle(c, D(70), D(55), D(5.4), dark, 1);
  drawCircle(c, D(55.6), D(52.8), D(1.9), white, 1);
  drawCircle(c, D(71.6), D(52.8), D(1.9), white, 1);
  drawCircle(c, D(52.4), D(57.2), D(1), green, 0.9);
  drawCircle(c, D(68.4), D(57.2), D(1), green, 0.9);
  // smile
  drawLine(c, D(59), D(64), D(62), D(66), D(1.6), dark, 1);
  drawLine(c, D(62), D(66), D(65), D(64), D(1.6), dark, 1);

  // ── glowing prompt under sprite ──
  drawGlow(c, D(62), D(101), D(16), white, 0.14);
  drawLine(c, D(50), D(96), D(57), D(101), D(4.4), white, 1);
  drawLine(c, D(57), D(101), D(50), D(106), D(4.4), white, 1);
  drawLine(c, D(64), D(106), D(78), D(106), D(4.4), white, 1);

  // ── brand spark ──
  drawGlow(c, D(96), D(30), D(10), green, 0.25);
  drawStarScaled(c, D(96), D(30), D(10), hex('#d8f78a'), 1, 1);

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
