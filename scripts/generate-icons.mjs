// Draws the extension's cursor icon as PNGs. Run: npm run generate:icons
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'chrome-extension/public/icons');

const ARROW = [[0.22, 0.14], [0.86, 0.5], [0.57, 0.58], [0.44, 0.88]];
const BACKGROUND = [27, 31, 51];
const CORAL = [255, 90, 54];
const SAMPLES = 4;

function inPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundedSquare(x, y, radius) {
  const dx = Math.max(radius - x, x - (1 - radius), 0);
  const dy = Math.max(radius - y, y - (1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

function png(size) {
  const rows = Buffer.alloc((size * 4 + 1) * size);
  let offset = 0;
  for (let py = 0; py < size; py += 1) {
    rows[offset] = 0;
    offset += 1;
    for (let px = 0; px < size; px += 1) {
      const sum = [0, 0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = (px + (sx + 0.5) / SAMPLES) / size;
          const y = (py + (sy + 0.5) / SAMPLES) / size;
          if (!inRoundedSquare(x, y, 0.2)) continue;
          const color = inPolygon(x, y, ARROW) ? CORAL : BACKGROUND;
          sum[0] += color[0];
          sum[1] += color[1];
          sum[2] += color[2];
          sum[3] += 255;
        }
      }
      const count = SAMPLES * SAMPLES;
      const covered = sum[3] / 255 || 1;
      rows[offset] = sum[0] / covered;
      rows[offset + 1] = sum[1] / covered;
      rows[offset + 2] = sum[2] / covered;
      rows[offset + 3] = sum[3] / count;
      offset += 4;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(outDir, { recursive: true });
for (const size of [16, 48, 128]) writeFileSync(resolve(outDir, `icon${size}.png`), png(size));
console.log(`Wrote icons to ${outDir}`);
