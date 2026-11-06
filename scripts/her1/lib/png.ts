import { inflateSync } from "node:zlib";
import { encodeRgbaPng } from "../../lib/fixturePng";

export interface RgbaImage {
  width: number;
  height: number;
  /** 行优先 RGBA8，左上原点。 */
  data: Uint8Array;
}

export function createImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

export function encodePng(image: RgbaImage): Uint8Array {
  return encodeRgbaPng(image.width, image.height, image.data);
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function u32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** 解码非隔行 PNG（灰度/RGB/索引/灰度 alpha/RGBA，8 或 16 位）为 RGBA8。 */
export function decodePng(bytes: Uint8Array): RgbaImage {
  for (let i = 0; i < SIGNATURE.length; i += 1) if (bytes[i] !== SIGNATURE[i]) throw new Error("不是 PNG 文件");
  let offset = 8;
  let width = 0, height = 0, depth = 0, colorType = 0, interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (offset < bytes.length) {
    const length = u32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
    if (type === "IHDR") {
      width = u32(body, 0); height = u32(body, 4); depth = body[8]; colorType = body[9]; interlace = body[12];
    } else if (type === "PLTE") palette = body;
    else if (type === "tRNS") transparency = body;
    else if (type === "IDAT") idat.push(body);
    else if (type === "IEND") break;
  }
  if (!width || !height) throw new Error("PNG 缺少 IHDR");
  if (interlace) throw new Error("不支持隔行 PNG；请导出为非隔行");
  if (depth !== 8 && depth !== 16) throw new Error(`不支持 ${depth} 位 PNG；请导出 8 位 RGBA`);
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`未知 PNG colorType ${colorType}`);
  if (colorType === 3 && depth !== 8) throw new Error("索引色 PNG 仅支持 8 位");
  const total = idat.reduce((sum, part) => sum + part.length, 0);
  const joined = new Uint8Array(total);
  let cursor = 0;
  for (const part of idat) { joined.set(part, cursor); cursor += part.length; }
  const raw = new Uint8Array(inflateSync(joined));
  const bpp = channels * (depth / 8);
  const stride = width * bpp;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= bpp ? row[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let value = src[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) value += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`未知 PNG 过滤器 ${filter}`);
      row[x] = value & 255;
    }
  }
  const out = createImage(width, height);
  const sample = (index: number) => (depth === 16 ? pixels[index * 2] : pixels[index]);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    const base = i * channels;
    if (colorType === 6) { out.data[o] = sample(base); out.data[o + 1] = sample(base + 1); out.data[o + 2] = sample(base + 2); out.data[o + 3] = sample(base + 3); }
    else if (colorType === 2) {
      out.data[o] = sample(base); out.data[o + 1] = sample(base + 1); out.data[o + 2] = sample(base + 2); out.data[o + 3] = 255;
      if (transparency && depth === 8 && transparency.length >= 6 && out.data[o] === transparency[1] && out.data[o + 1] === transparency[3] && out.data[o + 2] === transparency[5]) out.data[o + 3] = 0;
    } else if (colorType === 0) { const v = sample(base); out.data[o] = v; out.data[o + 1] = v; out.data[o + 2] = v; out.data[o + 3] = 255; }
    else if (colorType === 4) { const v = sample(base); out.data[o] = v; out.data[o + 1] = v; out.data[o + 2] = v; out.data[o + 3] = sample(base + 1); }
    else {
      const index = pixels[i];
      if (!palette || index * 3 + 2 >= palette.length) throw new Error("索引色 PNG 调色板缺失或越界");
      out.data[o] = palette[index * 3]; out.data[o + 1] = palette[index * 3 + 1]; out.data[o + 2] = palette[index * 3 + 2];
      out.data[o + 3] = transparency && index < transparency.length ? transparency[index] : 255;
    }
  }
  return out;
}
