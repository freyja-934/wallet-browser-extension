import { createHash } from 'crypto';
import { deflateSync } from 'zlib';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(dir, { recursive: true });

const BG = [1, 0, 0, 255];
const RING = [255, 123, 22, 255];

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

function inRoundedSquare(x, y, size, inset, radius) {
  const left = inset;
  const right = size - 1 - inset;
  const top = inset;
  const bottom = size - 1 - inset;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, top + radius), bottom - radius);
  if (x >= left + radius && x <= right - radius && y >= top && y <= bottom) return true;
  if (y >= top + radius && y <= bottom - radius && x >= left && x <= right) return true;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const pad = Math.max(1, Math.round(size * 0.14));
  const stroke = Math.max(1, Math.round(size * 0.1));
  const radius = Math.max(1, Math.round(size * 0.22));

  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const outer = inRoundedSquare(x, y, size, pad, radius);
      const inner = inRoundedSquare(x, y, size, pad + stroke, Math.max(1, radius - stroke));
      const color = outer && !inner ? RING : BG;
      raw[o] = color[0];
      raw[o + 1] = color[1];
      raw[o + 2] = color[2];
      raw[o + 3] = color[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  const file = join(dir, `icon-${size}.png`);
  const bytes = png(size);
  writeFileSync(file, bytes);
  console.log(file, bytes.length, createHash('sha1').update(bytes).digest('hex').slice(0, 8));
}
