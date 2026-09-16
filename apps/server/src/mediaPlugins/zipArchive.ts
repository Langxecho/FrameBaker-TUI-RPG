import { inflateRawSync } from "node:zlib";

/**
 * 服务端 ZIP 读写：Bun.Archive 列表 + store 打包 + 中央目录解压。
 * 不解压前先校验每个条目名，避免 Zip Slip。
 */

export type ZipArchiveEntry = {
  name: string;
  data: Uint8Array;
};

function normalizeEntryName(name: string): string {
  return String(name ?? "").replace(/\\/g, "/");
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** 从 .iap/.vap/.aap（ZIP）字节列出条目，不落盘。 */
export async function listZipEntries(bytes: Uint8Array): Promise<ZipArchiveEntry[]> {
  const archive = new Bun.Archive(bytes);
  const files = await archive.files();
  const entries: ZipArchiveEntry[] = [];
  for (const [rawName, file] of files) {
    const name = normalizeEntryName(rawName);
    if (!name || name.endsWith("/")) continue;
    const data = new Uint8Array(await file.arrayBuffer());
    entries.push({ name, data });
  }
  return entries;
}

export function findZipEntry(entries: ZipArchiveEntry[], exactName: string): ZipArchiveEntry | undefined {
  const target = normalizeEntryName(exactName);
  return entries.find((e) => normalizeEntryName(e.name) === target);
}

function findEocdOffset(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      const commentLen = view.getUint16(i + 20, true);
      if (i + 22 + commentLen === bytes.length) return i;
    }
  }
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  throw new Error("不是 ZIP（找不到中央目录）");
}

function readUtf8(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder().decode(bytes.subarray(start, start + length));
}

/** 按中央目录列出条目：兼容 data descriptor、资源管理器压缩包。 */
export function listZipPayloadEntries(
  bytes: Uint8Array,
  options: { maxEntries?: number; maxUncompressedBytes?: number } = {},
): ZipArchiveEntry[] {
  if (bytes.length < 22) throw new Error("不是 ZIP");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocdOffset(bytes);
  const diskEntries = view.getUint16(eocd + 8, true);
  const totalEntries = view.getUint16(eocd + 10, true);
  let cdSize = view.getUint32(eocd + 12, true);
  let cdOffset = view.getUint32(eocd + 16, true);
  let count = totalEntries || diskEntries;
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new Error("ZIP64 体积过大，请拆成普通 zip 再试");
  }
  const maxEntries = options.maxEntries ?? 16384;
  const maxUncompressed = options.maxUncompressedBytes ?? 2 * 1024 * 1024 * 1024;
  if (count > maxEntries) throw new Error("ZIP 文件数超限");
  const entries: ZipArchiveEntry[] = [];
  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;
  let totalUncompressed = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > bytes.length || pos + 46 > cdEnd + 46) throw new Error("ZIP 中央目录已截断");
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error("ZIP 中央目录损坏");
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const uncompressedSize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localOffset = view.getUint32(pos + 42, true);
    const name = normalizeEntryName(readUtf8(bytes, pos + 46, nameLen));
    pos += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith("/")) continue;
    if (flags & 0x1) throw new Error("不支持加密 ZIP");
    if (method !== 0 && method !== 8) throw new Error("ZIP 压缩方式不支持（请用存储或 deflate）");
    if (localOffset + 30 > bytes.length) throw new Error("ZIP 本地头已截断");
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error("ZIP 本地头损坏");
    const localNameLen = view.getUint16(localOffset + 26, true);
    const localExtraLen = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compressedSize > bytes.length) throw new Error("ZIP 文件已截断");
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    if (method === 0) data = new Uint8Array(compressed);
    else {
      try {
        data = new Uint8Array(inflateRawSync(compressed));
      } catch {
        throw new Error("ZIP 解压失败");
      }
    }
    totalUncompressed += data.byteLength;
    if (uncompressedSize && data.byteLength !== uncompressedSize) throw new Error("ZIP 解压长度不一致");
    if (totalUncompressed > maxUncompressed) throw new Error("ZIP 解压后过大");
    entries.push({ name, data });
  }
  if (!entries.length) throw new Error("ZIP 里没有文件");
  return entries;
}

/** 同步写入 store-method ZIP（无压缩），供导出且兼容 listZipEntriesSync。 */
export function createStoreZip(files: Record<string, Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  const names = Object.keys(files).sort();
  for (const rawName of names) {
    const name = normalizeEntryName(rawName);
    if (!name || name.endsWith("/")) continue;
    const data = files[rawName] ?? new Uint8Array(0);
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true); // store
    local.setUint16(10, 0, true);
    local.setUint16(12, 0, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);
    locals.push(new Uint8Array(local.buffer), nameBytes, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, 0, true);
    central.setUint16(14, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true);
    central.setUint16(32, 0, true);
    central.setUint16(34, 0, true);
    central.setUint16(36, 0, true);
    central.setUint32(38, 0, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }

  let cdSize = 0;
  for (const part of centrals) cdSize += part.length;
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, names.filter((n) => normalizeEntryName(n) && !normalizeEntryName(n).endsWith("/")).length, true);
  eocd.setUint16(10, names.filter((n) => normalizeEntryName(n) && !normalizeEntryName(n).endsWith("/")).length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  eocd.setUint16(20, 0, true);

  let total = 22;
  for (const part of locals) total += part.length;
  for (const part of centrals) total += part.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of locals) {
    out.set(part, o);
    o += part.length;
  }
  for (const part of centrals) {
    out.set(part, o);
    o += part.length;
  }
  out.set(new Uint8Array(eocd.buffer), o);
  return out;
}
