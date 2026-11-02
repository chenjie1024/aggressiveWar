// 共享的纯 Node PNG 编码与图标绘制（无第三方依赖）
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA 像素缓冲（size*size*4）编码为 PNG */
export function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG = [0x0b, 0x20, 0x33];
const GOLD = [0xff, 0xd3, 0x4d];
const BLADE = [0xe8, 0xee, 0xf1];
const CORE = [0xd9, 0x53, 0x4f];

/**
 * 绘制图标主体。
 * @param {number} size 画布边长
 * @param {boolean} transparentBg true = 只画图案（自适应图标前景层用）
 * @param {number} scale 图案缩放（1 = 占满画布）
 */
export function drawIcon(size, transparentBg = false, scale = 1) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const ringInner = size * 0.34 * scale;
  const ringOuter = size * 0.4 * scale;
  const bladeHalf = Math.max(1, size * 0.055 * scale);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const d = Math.hypot(x - c, y - c);
      let r = BG[0];
      let g = BG[1];
      let b = BG[2];
      let a = 255;
      if (transparentBg) {
        r = 0;
        g = 0;
        b = 0;
        a = 0;
      }
      if (d >= ringInner && d <= ringOuter) {
        [r, g, b] = GOLD;
        a = 255;
      }
      // 中央十字（剑）形状
      const inV = Math.abs(x - c) <= bladeHalf && Math.abs(y - c) <= size * 0.3 * scale;
      const inH = Math.abs(y - c) <= bladeHalf && Math.abs(x - c) <= size * 0.16 * scale;
      if (inV || inH) {
        [r, g, b] = BLADE;
        a = 255;
      }
      if (d <= size * 0.1 * scale) {
        [r, g, b] = CORE;
        a = 255;
      }
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = a;
    }
  }
  return px;
}
