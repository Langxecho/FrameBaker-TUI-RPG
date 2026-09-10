/** 精灵去背与贴画：四角连通抠色、品红键、nearest 居中贴进固定画布。 */

export const MAGENTA: [number, number, number] = [255, 0, 255];
export const SPRITE_KEY_TOLERANCE = 24;

/** 从 PNG IHDR 读宽高，避免为静图去背再依赖 ffprobe。 */
export function readPngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return null;
  if (bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width < 1 || height < 1) return null;
  return { width, height };
}

function distSq(r: number, g: number, b: number, rgb: readonly [number, number, number]): number {
  const dr = r - rgb[0];
  const dg = g - rgb[1];
  const db = b - rgb[2];
  return dr * dr + dg * dg + db * db;
}

export function detectCornerBackground(data: Uint8ClampedArray, width: number, height: number): [number, number, number] {
  const corners = [
    [0, 0],
    [width - 1, 0],
    [0, height - 1],
    [width - 1, height - 1],
  ] as const;
  let blackVotes = 0;
  for (const [x, y] of corners) {
    const i = (y * width + x) * 4;
    const black = distSq(data[i]!, data[i + 1]!, data[i + 2]!, [0, 0, 0]);
    const white = distSq(data[i]!, data[i + 1]!, data[i + 2]!, [255, 255, 255]);
    if (black <= white) blackVotes++;
  }
  return blackVotes > 2 ? [0, 0, 0] : [255, 255, 255];
}

function nearColor(data: Uint8ClampedArray, i: number, rgb: readonly [number, number, number], tolerance: number): boolean {
  return distSq(data[i]!, data[i + 1]!, data[i + 2]!, rgb) <= tolerance * tolerance;
}

function floodFromBorder(eligible: Uint8Array, width: number, height: number): Uint8Array {
  const mask = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];
  const seed = (x: number, y: number) => {
    const idx = y * width + x;
    if (visited[idx]) return;
    visited[idx] = 1;
    if (!eligible[idx]) return;
    mask[idx] = 1;
    queue.push(idx);
  };
  for (let x = 0; x < width; x++) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    seed(0, y);
    seed(width - 1, y);
  }
  while (queue.length) {
    const idx = queue.pop()!;
    const x = idx % width;
    const y = (idx - x) / width;
    if (y > 0) seed(x, y - 1);
    if (y + 1 < height) seed(x, y + 1);
    if (x > 0) seed(x - 1, y);
    if (x + 1 < width) seed(x + 1, y);
  }
  return mask;
}

/** 抠掉边框连通的底色，并去掉品红像素（无论是否连通）。已全透明四角则只去品红。 */
export function keySpriteBackground(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = SPRITE_KEY_TOLERANCE,
): void {
  const magentaTol = Math.max(tolerance, 32);
  for (let i = 0; i < data.length; i += 4) {
    if (nearColor(data, i, MAGENTA, magentaTol)) data[i + 3] = 0;
  }
  const cornersTransparent = [0, width - 1, (height - 1) * width, height * width - 1].every((idx) => data[idx * 4 + 3]! === 0);
  if (cornersTransparent) return;
  const background = detectCornerBackground(data, width, height);
  const eligible = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3]! === 0) continue;
      if (nearColor(data, i, background, tolerance)) eligible[y * width + x] = 1;
    }
  }
  const mask = floodFromBorder(eligible, width, height);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const pi = i * 4;
    const d = Math.sqrt(distSq(data[pi]!, data[pi + 1]!, data[pi + 2]!, background));
    const t = d / Math.max(tolerance, 1);
    const steep = Math.max(0, Math.min(1, (t - 0.25) / 0.75));
    data[pi + 3] = Math.min(data[pi + 3]!, Math.round(steep * 255));
  }
}

export function fitSpriteNearest(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  outW: number,
  outH: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const canvas = new Uint8ClampedArray(outW * outH * 4);
  if (outW <= 0 || outH <= 0) return { data: canvas, width: outW, height: outH };
  const scale = Math.min(outW / Math.max(width, 1), outH / Math.max(height, 1));
  const newW = Math.max(1, Math.round(width * scale));
  const newH = Math.max(1, Math.round(height * scale));
  const ox = Math.floor((outW - newW) / 2);
  const oy = Math.floor((outH - newH) / 2);
  for (let y = 0; y < newH; y++) {
    const srcY = Math.min(height - 1, Math.floor(y / scale));
    for (let x = 0; x < newW; x++) {
      const srcX = Math.min(width - 1, Math.floor(x / scale));
      const si = (srcY * width + srcX) * 4;
      const di = ((y + oy) * outW + (x + ox)) * 4;
      canvas[di] = data[si]!;
      canvas[di + 1] = data[si + 1]!;
      canvas[di + 2] = data[si + 2]!;
      canvas[di + 3] = data[si + 3]!;
    }
  }
  return { data: canvas, width: outW, height: outH };
}

export type SpriteFit = { width: number; height: number };

export function processSpritePixels(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: { bgKey?: "flood" | "none"; spriteFit?: SpriteFit; tolerance?: number },
): { data: Uint8ClampedArray; width: number; height: number } {
  const next = new Uint8ClampedArray(data);
  if (options.bgKey === "flood") keySpriteBackground(next, width, height, options.tolerance);
  else {
    const magentaTol = Math.max(options.tolerance ?? SPRITE_KEY_TOLERANCE, 32);
    for (let i = 0; i < next.length; i += 4) {
      if (nearColor(next, i, MAGENTA, magentaTol)) next[i + 3] = 0;
    }
  }
  if (options.spriteFit) {
    return fitSpriteNearest(next, width, height, options.spriteFit.width, options.spriteFit.height);
  }
  return { data: next, width, height };
}
