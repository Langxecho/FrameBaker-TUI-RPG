import type { Skeleton } from "../../../packages/shared/src/animation";
import { createImage, type RgbaImage } from "./png";
import { flattenChecker, imagePixelToWorld, isItemVisible, itemCorners, rasterize, upscale, worldToPixel, type Bounds, type DrawItem, type Raster, type Scene } from "./render";

export interface SeamSpec {
  handAttachmentId: string;
  /** 远臂链根骨骼；它及其子孙骨骼上的可见 binding 部件算「远臂」。 */
  farRootBone: string;
  /** 接缝带（美术原生像素，含端点），与 checkArt 的 openEdgeBand 同义。 */
  openBand: [number, number, number, number];
  nativeSize: [number, number];
  outline: [number, number, number];
}

export interface SeamThresholds {
  /** 切口外侧采样点落在远臂上的最低比例。 */
  minJoinRatio: number;
  /** 手与远臂之间透底缝像素上限（按 1 世界单位 = 1 px 计）。 */
  maxGapPixels: number;
}

export const DEFAULT_SEAM_THRESHOLDS: SeamThresholds = { minJoinRatio: 0.9, maxGapPixels: 4 };

export interface SeamMetrics {
  time: number;
  handVisible: boolean;
  farItems: string[];
  cuffPixels: number;
  /** 切口外侧采样点：落在远臂 / 露出（背景或其它部件） */
  beyondSamples: number;
  joined: number;
  exposed: number;
  joinRatio: number;
  /** 露出的切口外侧点到最近远臂像素的最大距离（世界单位）。 */
  maxGap: number;
  gapPixels: number;
  cuffCentroid: [number, number] | null;
  palmCentroid: [number, number] | null;
  verdict: "PASS" | "FAIL";
  reasons: string[];
}

export interface SeamResult {
  metrics: SeamMetrics;
  raster: Raster | null;
  overlay: RgbaImage | null;
}

export function descendantBones(skeleton: Skeleton, rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const bone of skeleton.bones) if (bone.parentId && out.has(bone.parentId) && !out.has(bone.id)) { out.add(bone.id); grew = true; }
  }
  return out;
}

export function farItemIndices(scene: Scene, skeleton: Skeleton, spec: SeamSpec): number[] {
  const bones = descendantBones(skeleton, spec.farRootBone);
  return scene.items.flatMap((item, index) => item.source === "binding" && bones.has(item.boneId) && isItemVisible(item) ? [index] : []);
}

const opaque = (image: RgbaImage, u: number, v: number) => u >= 0 && v >= 0 && u < image.width && v < image.height && image.data[(v * image.width + u) * 4 + 3]! >= 128;
const N4: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export interface CuffPixel { u: number; v: number; beyond: Array<[number, number]> }

/** 手图接缝带内未描边的边界像素 = 腕部切口；带内全描边时退回「朝左露出」的边界像素。 */
export function findCuff(image: RgbaImage, spec: SeamSpec): { cuff: CuffPixel[]; palm: Array<[number, number]> } {
  const fx = image.width / spec.nativeSize[0], fy = image.height / spec.nativeSize[1];
  const [bx0, by0, bx1, by1] = spec.openBand;
  const inBand = (u: number, v: number) => u >= bx0 * fx && u < (bx1 + 1) * fx && v >= by0 * fy && v < (by1 + 1) * fy;
  const isOutline = (u: number, v: number) => {
    const o = (v * image.width + u) * 4;
    return image.data[o] === spec.outline[0] && image.data[o + 1] === spec.outline[1] && image.data[o + 2] === spec.outline[2];
  };
  const cuff: CuffPixel[] = [], leftFacing: CuffPixel[] = [], palm: Array<[number, number]> = [];
  for (let v = 0; v < image.height; v += 1) for (let u = 0; u < image.width; u += 1) {
    if (!opaque(image, u, v)) continue;
    if (!inBand(u, v)) { palm.push([u, v]); continue; }
    const beyond = N4.filter(([du, dv]) => !opaque(image, u + du, v + dv)).map(([du, dv]) => [u + du, v + dv] as [number, number]);
    if (!beyond.length) continue;
    if (!isOutline(u, v)) cuff.push({ u, v, beyond });
    if (!opaque(image, u - 1, v)) leftFacing.push({ u, v, beyond: [[u - 1, v]] });
  }
  return { cuff: cuff.length >= 3 ? cuff : leftFacing, palm };
}

function chebyshevDistance(mask: Uint8Array, width: number, height: number, limit = 64): Uint16Array {
  const dist = new Uint16Array(width * height).fill(limit);
  const queue: number[] = [];
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) { dist[i] = 0; queue.push(i); }
  for (let head = 0; head < queue.length; head += 1) {
    const i = queue[head]!, x = i % width, y = (i - x) / width, d = dist[i]! + 1;
    if (d >= limit) continue;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (dist[j]! > d) { dist[j] = d; queue.push(j); }
    }
  }
  return dist;
}

function centroid(points: Array<[number, number]>): [number, number] | null {
  if (!points.length) return null;
  return [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
}

export function handRoi(item: DrawItem, pad: number): Bounds {
  const corners = itemCorners(item);
  return {
    minX: Math.min(...corners.map((p) => p[0])) - pad,
    minY: Math.min(...corners.map((p) => p[1])) - pad,
    maxX: Math.max(...corners.map((p) => p[0])) + pad,
    maxY: Math.max(...corners.map((p) => p[1])) + pad,
  };
}

function mark(image: RgbaImage, x: number, y: number, rgb: [number, number, number]) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const o = (y * image.width + x) * 4;
  image.data[o] = rgb[0]; image.data[o + 1] = rgb[1]; image.data[o + 2] = rgb[2]; image.data[o + 3] = 255;
}

/**
 * 量一帧的腕口：对每个切口像素，看它「切口外侧」那一格在合成图里是谁——远臂（接上）还是背景/其它部件（断腕露出）；
 * 再数手与远臂之间 2px 内两边都没覆盖的透底缝。overlay：绿=接上，红=露出，黄=透底缝。
 */
export function measureSeam(scene: Scene, images: Map<string, RgbaImage>, skeleton: Skeleton, spec: SeamSpec, options: { time: number; scale?: number; pad?: number; zoom?: number; thresholds?: SeamThresholds } = { time: 0 }): SeamResult {
  const thresholds = options.thresholds ?? DEFAULT_SEAM_THRESHOLDS;
  const scale = options.scale ?? 1;
  const handIndex = scene.items.findIndex((item) => item.attachmentId === spec.handAttachmentId && isItemVisible(item));
  const far = farItemIndices(scene, skeleton, spec);
  const base: SeamMetrics = { time: options.time, handVisible: handIndex >= 0, farItems: far.map((i) => scene.items[i]!.attachmentId), cuffPixels: 0, beyondSamples: 0, joined: 0, exposed: 0, joinRatio: 0, maxGap: 0, gapPixels: 0, cuffCentroid: null, palmCentroid: null, verdict: "FAIL", reasons: [] };
  if (handIndex < 0) return { metrics: { ...base, reasons: ["支撑手不可见"] }, raster: null, overlay: null };
  const hand = scene.items[handIndex]!;
  const handImage = images.get(hand.materialId);
  if (!handImage) return { metrics: { ...base, reasons: [`缺少支撑手素材 ${hand.materialId}`] }, raster: null, overlay: null };
  const missing = far.filter((i) => !images.has(scene.items[i]!.materialId)).map((i) => scene.items[i]!.attachmentId);
  const raster = rasterize(scene.items, images, { scale, bounds: handRoi(hand, options.pad ?? 48), track: [handIndex, ...far] });
  const { width, height } = raster.image;
  const farMask = new Uint8Array(width * height);
  for (const i of far) { const m = raster.coverage.get(i)!; for (let p = 0; p < m.length; p += 1) if (m[p]) farMask[p] = 1; }
  const handMask = raster.coverage.get(handIndex)!;
  const distFar = chebyshevDistance(farMask, width, height);
  const distHand = chebyshevDistance(handMask, width, height);
  const { cuff, palm } = findCuff(handImage, spec);
  const farSet = new Set(far);
  const toPx = (u: number, v: number) => {
    const [wx, wy] = imagePixelToWorld(hand, handImage, u, v);
    const [px, py] = worldToPixel(raster, wx, wy);
    return [Math.round(px), Math.round(py)] as [number, number];
  };
  const marks: Array<{ x: number; y: number; rgb: [number, number, number] }> = [];
  let joined = 0, exposed = 0, maxGap = 0, samples = 0;
  for (const pixel of cuff) for (const [u, v] of pixel.beyond) {
    const [x, y] = toPx(u, v);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    samples += 1;
    const p = y * width + x, who = raster.owner[p]!;
    if (farMask[p] || farSet.has(who)) { joined += 1; marks.push({ x, y, rgb: [40, 220, 90] }); continue; }
    exposed += 1;
    maxGap = Math.max(maxGap, distFar[p]! / scale);
    marks.push({ x, y, rgb: [235, 40, 40] });
  }
  let gapPixels = 0;
  const reach = 3 * scale;
  const hits = (mask: Uint8Array, x: number, y: number, dx: number, dy: number) => {
    for (let k = 1; k <= reach; k += 1) {
      const nx = x + dx * k, ny = y + dy * k;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return false;
      if (mask[ny * width + nx]) return true;
    }
    return false;
  };
  // 只数被手与远臂「两面夹住」的透底像素；外轮廓凹角处的背景不算断腕。
  const sandwiched = (x: number, y: number) => ([[1, 0], [0, 1], [1, 1], [1, -1]] as const).some(([dx, dy]) => (hits(handMask, x, y, dx, dy) && hits(farMask, x, y, -dx, -dy)) || (hits(farMask, x, y, dx, dy) && hits(handMask, x, y, -dx, -dy)));
  for (let p = 0; p < width * height; p += 1) {
    if (handMask[p] || farMask[p] || !far.length) continue;
    if (distHand[p]! > 2 * scale || distFar[p]! > 2 * scale) continue;
    const x = p % width, y = (p - x) / width;
    if (sandwiched(x, y)) { gapPixels += 1; marks.push({ x, y, rgb: [250, 210, 40] }); }
  }
  const worldOf = (points: Array<[number, number]>) => points.map(([u, v]) => imagePixelToWorld(hand, handImage, u, v));
  const metrics: SeamMetrics = {
    ...base,
    cuffPixels: cuff.length,
    beyondSamples: samples,
    joined,
    exposed,
    joinRatio: samples ? joined / samples : 0,
    maxGap,
    gapPixels: Math.round(gapPixels / (scale * scale)),
    cuffCentroid: centroid(worldOf(cuff.map((c) => [c.u, c.v]))),
    palmCentroid: centroid(worldOf(palm)),
  };
  const reasons: string[] = [];
  if (!far.length) reasons.push("远臂没有可见部件");
  if (missing.length) reasons.push(`远臂缺素材：${missing.join("、")}`);
  if (!cuff.length) reasons.push("手图接缝带内找不到腕部切口");
  if (metrics.joinRatio < thresholds.minJoinRatio) reasons.push(`切口外侧接上远臂 ${(metrics.joinRatio * 100).toFixed(0)}% < ${(thresholds.minJoinRatio * 100).toFixed(0)}%（露出 ${exposed} 点，最大空档 ${maxGap.toFixed(1)}）`);
  if (metrics.gapPixels > thresholds.maxGapPixels) reasons.push(`手与远臂之间透底缝 ${metrics.gapPixels} px`);
  metrics.reasons = reasons;
  metrics.verdict = reasons.length ? "FAIL" : "PASS";
  const zoom = options.zoom ?? 4;
  const overlay = upscale(flattenChecker(raster.image), zoom);
  for (const m of marks) for (let dy = 0; dy < zoom; dy += 1) for (let dx = 0; dx < zoom; dx += 1) if (dx === 0 || dy === 0 || dx === zoom - 1 || dy === zoom - 1) mark(overlay, m.x * zoom + dx, m.y * zoom + dy, m.rgb);
  return { metrics, raster, overlay };
}

/** 多张图横向拼接（高度取最大，底部对齐留白）。 */
export function hstack(images: RgbaImage[], gap = 8): RgbaImage {
  const width = images.reduce((s, im) => s + im.width, 0) + gap * Math.max(0, images.length - 1);
  const height = Math.max(1, ...images.map((im) => im.height));
  const out = createImage(width, height);
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 40; out.data[i + 1] = 40; out.data[i + 2] = 48; out.data[i + 3] = 255; }
  let x = 0;
  for (const im of images) {
    for (let y = 0; y < im.height; y += 1) out.data.set(im.data.subarray(y * im.width * 4, (y + 1) * im.width * 4), (y * width + x) * 4);
    x += im.width + gap;
  }
  return out;
}
