/**
 * Rasterise the Cinder mark from `src/config/brand.ts` into the PNG sizes the
 * manifest and the Chrome Web Store ask for.
 *
 * `brand.ts` is the only definition of the mark — the Wallet Standard icon a
 * dApp renders comes from the same string — so the toolbar icon, the store
 * tile and the connect dialog cannot drift apart. The geometry is read out of
 * that SVG rather than duplicated here: the three `<rect>`s, the gradient
 * stops and the viewBox are parsed, then drawn with 4x4 supersampling.
 *
 * The mark is inset by 10 percent of each icon, which is what keeps the 128 px
 * store icon off the edge of its tile and the 16 px toolbar icon from looking
 * like a solid block. Everything outside it is transparent.
 *
 * No image dependency on purpose: this writes the PNG (one IDAT, RGBA8) itself.
 *
 * Run: node scripts/generate-icons.mjs
 */
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(repo, 'public', 'icons');
const SIZES = [16, 32, 48, 128];
/** Share of each edge left empty around the mark. */
const PADDING = 0.1;
/** Samples per pixel per axis. 4 is enough for edges this size and keeps this instant. */
const SUPERSAMPLE = 4;

// ---------------------------------------------------------------- read the mark

const brandSource = readFileSync(join(repo, 'src', 'config', 'brand.ts'), 'utf8');

/** `const BRAND_INK = '#010000';` → { BRAND_INK: '#010000' }, to resolve the template holes. */
const brandColors = Object.fromEntries(
  [...brandSource.matchAll(/const (BRAND_[A-Z]+) = '(#[0-9a-fA-F]{6})';/g)].map((m) => [m[1], m[2]]),
);
const resolve = (value) => value.replace(/\$\{(BRAND_[A-Z]+)\}/g, (_, name) => {
  if (!brandColors[name]) throw new Error(`brand.ts uses ${name} but does not define it as a hex literal`);
  return brandColors[name];
});

const attributesOf = (tag) =>
  Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], resolve(m[2])]));

const viewBox = brandSource.match(/viewBox="0 0 (\d+) (\d+)"/);
if (!viewBox) throw new Error('brand.ts: no viewBox on the mark');
const [markWidth, markHeight] = [Number(viewBox[1]), Number(viewBox[2])];

const stops = [...brandSource.matchAll(/<stop offset="([\d.]+)" stop-color="([^"]*)"\/>/g)].map((m) => ({
  offset: Number(m[1]),
  color: hexToRgb(resolve(m[2])),
}));
if (stops.length < 2) throw new Error('brand.ts: the mark needs two gradient stops');

const rects = [...brandSource.matchAll(/<rect[^>]*\/>/g)].map((m) => attributesOf(m[0]));
if (rects.length === 0) throw new Error('brand.ts: no <rect> in the mark');

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** The mark's one gradient runs corner to corner, so the ramp is the mean of the two axes. */
function gradientAt(x, y) {
  const t = Math.min(1, Math.max(0, (x / markWidth + y / markHeight) / 2));
  const span = stops[1].offset - stops[0].offset || 1;
  const k = Math.min(1, Math.max(0, (t - stops[0].offset) / span));
  return stops[0].color.map((c, i) => c + (stops[1].color[i] - c) * k);
}

function paintOf(value, x, y) {
  if (!value || value === 'none') return null;
  return value.startsWith('url(') ? gradientAt(x, y) : hexToRgb(value);
}

/** Point-in-rounded-rectangle, radius clamped to the box like an SVG renderer does. */
function inRoundedRect(x, y, left, top, width, height, radius) {
  if (width <= 0 || height <= 0) return false;
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const right = left + width;
  const bottom = top + height;
  if (x < left || x > right || y < top || y > bottom) return false;
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** The mark's colour at a point in its own 32-unit space, or null where it is transparent. */
function sampleMark(x, y) {
  let out = null;
  for (const rect of rects) {
    const left = Number(rect.x ?? 0);
    const top = Number(rect.y ?? 0);
    const width = Number(rect.width);
    const height = Number(rect.height);
    const radius = Number(rect.rx ?? 0);
    const alpha = rect.opacity === undefined ? 1 : Number(rect.opacity);

    const fill = paintOf(rect.fill, x, y);
    if (fill && inRoundedRect(x, y, left, top, width, height, radius)) {
      out = over(out, fill, alpha);
    }

    const stroke = paintOf(rect.stroke, x, y);
    if (stroke) {
      const w = Number(rect['stroke-width'] ?? 1) / 2;
      const onStroke =
        inRoundedRect(x, y, left - w, top - w, width + 2 * w, height + 2 * w, radius + w) &&
        !inRoundedRect(x, y, left + w, top + w, width - 2 * w, height - 2 * w, radius - w);
      if (onStroke) out = over(out, stroke, alpha);
    }
  }
  return out;
}

/** Source-over onto an opaque-or-nothing base; the mark never stacks two translucent layers. */
function over(base, color, alpha) {
  if (!base) return alpha >= 1 ? color.slice() : color.map((c) => c * alpha);
  return base.map((b, i) => b * (1 - alpha) + color[i] * alpha);
}

// ---------------------------------------------------------------- PNG writing

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size) {
  const pad = size * PADDING;
  const scale = (size - 2 * pad) / markWidth;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const step = 1 / SUPERSAMPLE;

  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const mx = (x + (sx + 0.5) * step - pad) / scale;
          const my = (y + (sy + 0.5) * step - pad) / scale;
          const color = sampleMark(mx, my);
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          hits++;
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const samples = SUPERSAMPLE * SUPERSAMPLE;
      if (hits === 0) continue; // stays transparent
      raw[o] = Math.round(r / hits);
      raw[o + 1] = Math.round(g / hits);
      raw[o + 2] = Math.round(b / hits);
      raw[o + 3] = Math.round((hits / samples) * 255);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(dir, { recursive: true });
for (const size of SIZES) {
  const file = join(dir, `icon-${size}.png`);
  const bytes = png(size);
  writeFileSync(file, bytes);
  console.log(file, bytes.length, createHash('sha1').update(bytes).digest('hex').slice(0, 8));
}
