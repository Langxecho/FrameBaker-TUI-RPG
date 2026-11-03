import { inflateSync } from "node:zlib";
import { createImage, type RgbaImage } from "./png";

export interface PsdLayer {
  name: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  opacity: number;
  hidden: boolean;
  /** 图层自身矩形内的 RGBA8（未乘图层不透明度）。 */
  pixels: RgbaImage;
}

export interface PsdDocument {
  width: number;
  height: number;
  layers: PsdLayer[];
}

class Reader {
  offset = 0;
  private readonly view: DataView;
  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  u8() { return this.bytes[this.offset++]; }
  u16() { const v = this.view.getUint16(this.offset); this.offset += 2; return v; }
  i16() { const v = this.view.getInt16(this.offset); this.offset += 2; return v; }
  u32() { const v = this.view.getUint32(this.offset); this.offset += 4; return v; }
  i32() { const v = this.view.getInt32(this.offset); this.offset += 4; return v; }
  ascii(length: number) { const v = String.fromCharCode(...this.bytes.subarray(this.offset, this.offset + length)); this.offset += length; return v; }
  take(length: number) { const v = this.bytes.subarray(this.offset, this.offset + length); this.offset += length; return v; }
}

function unpackBits(source: Uint8Array, expected: number): Uint8Array {
  const out = new Uint8Array(expected);
  let i = 0, o = 0;
  while (i < source.length && o < expected) {
    const n = source[i++];
    if (n < 128) { for (let k = 0; k <= n && o < expected; k += 1) out[o++] = source[i++]; }
    else if (n > 128) { const value = source[i++]; for (let k = 0; k < 257 - n && o < expected; k += 1) out[o++] = value; }
  }
  return out;
}

function decodeChannel(data: Uint8Array, width: number, height: number): Uint8Array {
  const r = new Reader(data);
  const compression = r.u16();
  const size = width * height;
  if (size === 0) return new Uint8Array(0);
  if (compression === 0) return data.slice(2, 2 + size);
  if (compression === 1) {
    const counts: number[] = [];
    for (let y = 0; y < height; y += 1) counts.push(r.u16());
    const out = new Uint8Array(size);
    for (let y = 0; y < height; y += 1) out.set(unpackBits(r.take(counts[y]), width), y * width);
    return out;
  }
  if (compression === 2 || compression === 3) {
    const out = new Uint8Array(inflateSync(data.subarray(2))).slice(0, size);
    if (compression === 3) for (let y = 0; y < height; y += 1) for (let x = 1; x < width; x += 1) out[y * width + x] = (out[y * width + x] + out[y * width + x - 1]) & 255;
    return out;
  }
  throw new Error(`未知 PSD 通道压缩 ${compression}`);
}

function isSignatureAt(bytes: Uint8Array, offset: number): boolean {
  if (offset + 4 > bytes.length) return false;
  const value = String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
  return value === "8BIM" || value === "8B64";
}

/** 从附加图层信息中取 `luni` Unicode 名称；块长度在不同写入端按 2 或 4 字节对齐，逐字节对齐到下一个签名。 */
function unicodeName(extra: Uint8Array): string | null {
  const r = new Reader(extra);
  while (r.offset + 12 <= extra.length && isSignatureAt(extra, r.offset)) {
    r.ascii(4);
    const key = r.ascii(4);
    const length = r.u32();
    const start = r.offset;
    if (key === "luni") {
      const count = r.u32();
      let name = "";
      for (let i = 0; i < count; i += 1) name += String.fromCharCode(r.u16());
      return name.replace(/\0+$/, "");
    }
    r.offset = start + length;
    for (let pad = 0; pad < 4 && !isSignatureAt(extra, r.offset) && r.offset < extra.length; pad += 1) r.offset += 1;
  }
  return null;
}

/** 读取 8 位 RGB PSD 的图层像素；只服务美术包“在这里画”层的检查与入库。 */
export function readPsd(bytes: Uint8Array): PsdDocument {
  const r = new Reader(bytes);
  if (r.ascii(4) !== "8BPS") throw new Error("不是 PSD 文件");
  const version = r.u16();
  if (version !== 1) throw new Error("仅支持 PSD（version 1），不支持 PSB");
  r.take(6);
  r.u16();
  const height = r.u32();
  const width = r.u32();
  const depth = r.u16();
  const mode = r.u16();
  if (depth !== 8) throw new Error(`仅支持 8 位 PSD（当前 ${depth} 位）`);
  if (mode !== 3) throw new Error(`仅支持 RGB 颜色模式 PSD（当前 mode=${mode}）`);
  r.take(r.u32());
  r.take(r.u32());
  const layerAndMaskLength = r.u32();
  const layers: PsdLayer[] = [];
  if (layerAndMaskLength === 0) return { width, height, layers };
  const layerInfoLength = r.u32();
  if (layerInfoLength === 0) return { width, height, layers };
  const count = Math.abs(r.i16());
  const records: Array<{ top: number; left: number; bottom: number; right: number; channels: Array<{ id: number; length: number }>; opacity: number; hidden: boolean; name: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
    const channelCount = r.u16();
    const channels: Array<{ id: number; length: number }> = [];
    for (let c = 0; c < channelCount; c += 1) channels.push({ id: r.i16(), length: r.u32() });
    if (r.ascii(4) !== "8BIM") throw new Error("PSD 图层混合签名错误");
    r.ascii(4);
    const opacity = r.u8();
    r.u8();
    const flags = r.u8();
    r.u8();
    const extra = r.take(r.u32());
    const er = new Reader(extra);
    er.take(er.u32());
    er.take(er.u32());
    const nameStart = er.offset;
    const nameLength = er.u8();
    const pascal = String.fromCharCode(...er.take(nameLength));
    er.offset = nameStart + Math.ceil((1 + nameLength) / 4) * 4;
    const unicode = unicodeName(extra.subarray(Math.min(er.offset, extra.length)));
    records.push({ top, left, bottom, right, channels, opacity, hidden: (flags & 2) !== 0, name: unicode ?? pascal });
  }
  for (const record of records) {
    const w = Math.max(0, record.right - record.left);
    const h = Math.max(0, record.bottom - record.top);
    const pixels = createImage(w, h);
    pixels.data.fill(0);
    let hasAlpha = false;
    for (const channel of record.channels) {
      const data = r.take(channel.length);
      if (channel.id < -1 || channel.id > 2) continue;
      const plane = decodeChannel(data, w, h);
      const target = channel.id === -1 ? 3 : channel.id;
      if (channel.id === -1) hasAlpha = true;
      for (let i = 0; i < plane.length; i += 1) pixels.data[i * 4 + target] = plane[i];
    }
    if (!hasAlpha) for (let i = 0; i < w * h; i += 1) pixels.data[i * 4 + 3] = 255;
    layers.push({ name: record.name, top: record.top, left: record.left, bottom: record.bottom, right: record.right, opacity: record.opacity, hidden: record.hidden, pixels });
  }
  return { width, height, layers };
}

/** 把单个图层按画布坐标放回 PSD 画布尺寸，图层不透明度乘入 alpha。 */
export function layerToCanvas(document: PsdDocument, layer: PsdLayer): RgbaImage {
  const canvas = createImage(document.width, document.height);
  for (let y = 0; y < layer.pixels.height; y += 1) {
    const cy = layer.top + y;
    if (cy < 0 || cy >= document.height) continue;
    for (let x = 0; x < layer.pixels.width; x += 1) {
      const cx = layer.left + x;
      if (cx < 0 || cx >= document.width) continue;
      const s = (y * layer.pixels.width + x) * 4;
      const d = (cy * document.width + cx) * 4;
      canvas.data[d] = layer.pixels.data[s];
      canvas.data[d + 1] = layer.pixels.data[s + 1];
      canvas.data[d + 2] = layer.pixels.data[s + 2];
      canvas.data[d + 3] = Math.round((layer.pixels.data[s + 3] * layer.opacity) / 255);
    }
  }
  return canvas;
}

export function findLayer(document: PsdDocument, name: string): PsdLayer {
  const matches = document.layers.filter((layer) => layer.name === name);
  if (matches.length === 1) return matches[0];
  const names = document.layers.map((layer) => layer.name).join("、") || "（无图层）";
  if (matches.length > 1) throw new Error(`PSD 中有 ${matches.length} 个名为「${name}」的图层，请合并为一个；现有图层：${names}`);
  throw new Error(`PSD 中找不到图层「${name}」；现有图层：${names}`);
}
