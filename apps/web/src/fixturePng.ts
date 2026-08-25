/** Minimal deterministic RGBA8 PNG encoder (no Node deps). Filter 0 + stored DEFLATE. */

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c ^= bytes[i]!;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u32be(n: number): Uint8Array {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function u16le(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const len = u32be(data.length);
  const body = new Uint8Array(4 + data.length);
  body.set(typeBytes, 0);
  body.set(data, 4);
  const crc = u32be(crc32(body));
  const out = new Uint8Array(4 + body.length + 4);
  out.set(len, 0);
  out.set(body, 4);
  out.set(crc, 4 + body.length);
  return out;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib-wrapped DEFLATE with stored blocks only (deterministic, no Node zlib). */
function zlibStore(raw: Uint8Array): Uint8Array {
  const max = 65535;
  const blocks: Uint8Array[] = [];
  let offset = 0;
  while (offset < raw.length || (raw.length === 0 && blocks.length === 0)) {
    const remaining = raw.length - offset;
    const size = Math.min(max, remaining);
    const final = offset + size >= raw.length ? 1 : 0;
    const header = new Uint8Array(5);
    header[0] = final; // BFINAL + BTYPE=00
    header.set(u16le(size), 1);
    header.set(u16le(size ^ 0xffff), 3);
    const block = new Uint8Array(5 + size);
    block.set(header, 0);
    block.set(raw.subarray(offset, offset + size), 5);
    blocks.push(block);
    offset += size;
    if (raw.length === 0) break;
  }
  let total = 2 + 4; // zlib header + adler
  for (const b of blocks) total += b.length;
  const out = new Uint8Array(total);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (const b of blocks) {
    out.set(b, o);
    o += b.length;
  }
  out.set(u32be(adler32(raw)), o);
  return out;
}

/** Encode raw RGBA8 pixels (row-major, top-left origin, Y-down) as PNG. */
export function encodeRgbaPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (width < 1 || height < 1 || rgba.length !== width * height * 4) {
    throw new Error("encodeRgbaPng: invalid dimensions or buffer length");
  }
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    raw[rowStart] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), rowStart + 1);
  }
  const compressed = zlibStore(raw);
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", new Uint8Array(0))];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Solid-color RGBA texture PNG (size×size). */
export function solidTexturePng(size: number, rgba: [number, number, number, number]): Uint8Array {
  const buf = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    buf[i * 4] = rgba[0];
    buf[i * 4 + 1] = rgba[1];
    buf[i * 4 + 2] = rgba[2];
    buf[i * 4 + 3] = rgba[3];
  }
  return encodeRgbaPng(size, size, buf);
}
