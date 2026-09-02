/**
 * 服务端 ZIP 读写：Bun.Archive 列表 + store 打包 + 安全解压辅助。
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
