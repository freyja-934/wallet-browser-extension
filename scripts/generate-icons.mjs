import { createHash } from 'crypto';
import { deflateRawSync } from 'zlib';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(dir, { recursive: true });

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
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (size * 2);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = Math.round(153 + (0 - 153) * t);
      raw[o + 1] = Math.round(69 + (194 - 69) * t);
      raw[o + 2] = Math.round(255 + (255 - 255) * t);
      raw[o + 3] = 255;
      if (t > 0.35) {
        raw[o] = Math.round(20 + 200 * t);
        raw[o + 1] = Math.round(241 - 80 * t);
        raw[o + 2] = Math.round(149 + 80 * t);
      }
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
    chunk('IDAT', deflateRawSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  const file = join(dir, `icon-${size}.png`);
  writeFileSync(file, png(size));
  console.log(file, createHash('sha1').update(png(size)).digest('hex').slice(0, 8));
}
