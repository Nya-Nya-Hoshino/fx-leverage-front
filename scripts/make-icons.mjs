// 生成应用图标（纯 Node，无第三方依赖）：桌面 PNG/ICO 与安卓各密度启动图标。
// 用法：node scripts/make-icons.mjs [安卓 res 目录]
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** 在归一化坐标 (0..1) 上绘制：圆角深色底 + K 线 + 上升折线。fg=true 时只画前景（安卓自适应图标） */
function shade(x, y, fg, round) {
  const pad = fg ? 0.2 : 0.04;
  const u = (x - pad) / (1 - 2 * pad), v = (y - pad) / (1 - 2 * pad);
  let col = null;
  if (!fg) {
    if (round) {
      if ((x - 0.5) ** 2 + (y - 0.5) ** 2 > 0.47 ** 2) return null;
    } else {
      const r = 0.2, cx = Math.min(Math.max(x, r + 0.03), 0.97 - r), cy = Math.min(Math.max(y, r + 0.03), 0.97 - r);
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) return null;
    }
    const g = y;
    col = [11 + 10 * g, 18 + 14 * g, 38 + 26 * g, 255];
    if (Math.abs((x * 10) % 1) < 0.02 || Math.abs((y * 10) % 1) < 0.02) col = [24, 34, 62, 255];
  }
  // 蜡烛：x 位置、实体上下、影线上下、颜色
  const candles = [
    [0.18, 0.62, 0.78, 0.55, 0.86, [61, 139, 255]],
    [0.36, 0.48, 0.68, 0.40, 0.74, [255, 77, 109]],
    [0.54, 0.52, 0.64, 0.44, 0.70, [61, 139, 255]],
    [0.72, 0.26, 0.50, 0.16, 0.56, [255, 77, 109]],
  ];
  for (const [cx, b0, b1, w0, w1, c] of candles) {
    if (Math.abs(u - cx) < 0.065 && v > b0 && v < b1) return [...c, 255];
    if (Math.abs(u - cx) < 0.014 && v > w0 && v < w1) return [...c, 255];
  }
  // 金色上升折线
  const pts = [[0.06, 0.82], [0.36, 0.58], [0.54, 0.62], [0.94, 0.1]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const t = Math.max(0, Math.min(1, ((u - ax) * (bx - ax) + (v - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
    if (Math.hypot(u - (ax + t * (bx - ax)), v - (ay + t * (by - ay))) < 0.028) return [245, 197, 66, 255];
  }
  return col;
}

function render(size, { fg = false, round = false } = {}) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const c = shade((x + (i + 0.5) / ss) / size, (y + (j + 0.5) / ss) / size, fg, round);
      if (c) { r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3]; }
    }
    const o = (y * size + x) * 4;
    if (a > 0) { buf[o] = r / a; buf[o + 1] = g / a; buf[o + 2] = b / a; }
    buf[o + 3] = a / (ss * ss);
  }
  return png(size, buf);
}

function ico(pngBuf) {
  const h = Buffer.alloc(22);
  h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4);
  h[6] = 0; h[7] = 0; h[8] = 0; h[9] = 0; h.writeUInt16LE(1, 10); h.writeUInt16LE(32, 12);
  h.writeUInt32LE(pngBuf.length, 14); h.writeUInt32LE(22, 18);
  return Buffer.concat([h, pngBuf]);
}

const out = join(ROOT, 'build', 'icons');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'icon.png'), render(512));
writeFileSync(join(out, 'icon.ico'), ico(render(256)));
console.log('desktop icons →', out);

const res = process.argv[2];
if (res && existsSync(res)) {
  const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  for (const [d, k] of Object.entries(dens)) {
    const dir = join(res, `mipmap-${d}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ic_launcher.png'), render(Math.round(48 * k)));
    writeFileSync(join(dir, 'ic_launcher_round.png'), render(Math.round(48 * k), { round: true }));
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), render(Math.round(108 * k), { fg: true }));
  }
  console.log('android icons →', res);
}
