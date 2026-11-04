import {
  multiplyMatrices,
  quaternionFromZRotation,
  reparentTransform2d,
  sampleMotionClip,
  transformPoint,
  transformToMatrix,
  type AttachmentOffset,
  type CharacterBinding,
  type EvaluatedPose,
  type Mat4,
  type MotionClip,
  type Skeleton,
  type Transform,
} from "../../../packages/shared/src/animation";
import type { BodyProfile, BodySocketDefinition as BodySocket, EquipmentDefinition } from "../../../packages/shared/src/equipment";
import type { SkeletalProjectDocument } from "../../../packages/shared/src/skeletalProject";
import { createImage, type RgbaImage } from "./png";

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/**
 * 与 FB 预览一致的单帧场景：slot 按 drawOrder 排，部件世界矩阵 = 骨骼世界 × rest × att: 偏移；
 * 装备附件先把 socket.rest 与附件 rest 合成（reparentTransform2d），再插到 socket 骨骼最后一个 slot 之后 + drawOffset。
 * pivot 原点在图片左下角，世界 Y 向上。
 */
export interface DrawItem {
  slotId: string;
  attachmentId: string;
  boneId: string;
  materialId: string;
  imageSlot: "raw" | "processed";
  size: [number, number];
  pivot: [number, number];
  world: Mat4;
  source: "binding" | "equipment";
  equipmentId?: string;
}

/** 双手武器 IK：`weapon` 只解两骨；`weapon-align` 另按 alignEnd 让末端骨朝向跟 secondaryGrip。 */
export type IkMode = "off" | "weapon" | "weapon-align";

export interface SceneInput {
  document: SkeletalProjectDocument;
  skeleton: Skeleton;
  clip: MotionClip | null;
  time: number;
  equipmentIds: string[];
  bodyProfileId?: string;
  /** 叠加在 binding.boneRotationOffsets 之上的额外 Z 旋转（弧度），求解器用。 */
  extraRotationOffsets?: Record<string, number>;
  ik?: IkMode;
}

export interface Scene {
  pose: EvaluatedPose;
  items: DrawItem[];
  diagnostics: string[];
}

function offsetMatrix(offset: AttachmentOffset | undefined): Mat4 | undefined {
  if (!offset || (!offset.translation && !offset.rotation && !offset.scale)) return undefined;
  return transformToMatrix({ translation: offset.translation ?? [0, 0, 0], rotation: offset.rotation ?? [0, 0, 0, 1], scale: offset.scale ?? [1, 1, 1] });
}

function composeSocketRest(socketRest: Transform, attachmentRest: Transform): Transform {
  try {
    return reparentTransform2d(attachmentRest, transformToMatrix(socketRest), IDENTITY);
  } catch {
    return structuredClone(attachmentRest);
  }
}

export function pickBodyProfile(document: SkeletalProjectDocument, skeletonId: string, id?: string): BodyProfile | undefined {
  const profiles = document.bodyProfiles ?? [];
  if (id) return profiles.find((item) => item.id === id);
  return profiles.find((item) => item.skeletonId === skeletonId) ?? profiles[0];
}

/** ECHO 版 binding 可能带 attachmentVisibility（共享类型里没有）；false / "hidden" 视为隐藏。 */
function hiddenByVisibility(binding: CharacterBinding, attachmentId: string): boolean {
  const table = (binding as unknown as { attachmentVisibility?: Record<string, unknown> }).attachmentVisibility;
  if (!table || typeof table !== "object") return false;
  const value = table[attachmentId];
  return value === false || value === "hidden";
}

function mergedOffsets(binding: CharacterBinding, extra?: Record<string, number>): Record<string, number> | undefined {
  if (!binding.boneRotationOffsets && !extra) return undefined;
  const out: Record<string, number> = { ...(binding.boneRotationOffsets ?? {}) };
  for (const [id, value] of Object.entries(extra ?? {})) out[id] = (out[id] ?? 0) + value;
  return out;
}

function zAngle(q: readonly number[]): number {
  return 2 * Math.atan2(q[2]!, q[3]!);
}

function recomputeWorld(skeleton: Skeleton, local: Record<string, Transform>): Record<string, Mat4> {
  const world: Record<string, Mat4> = {};
  const pending = new Set(skeleton.bones.map((bone) => bone.id));
  while (pending.size) {
    let progressed = false;
    for (const bone of skeleton.bones) {
      if (!pending.has(bone.id) || (bone.parentId && !world[bone.parentId])) continue;
      const m = transformToMatrix(local[bone.id]!);
      world[bone.id] = bone.parentId ? multiplyMatrices(world[bone.parentId]!, m) : m;
      pending.delete(bone.id);
      progressed = true;
    }
    if (!progressed) throw new Error("骨架层级无效");
  }
  return world;
}

export function invert2d(m: Mat4): Mat4 {
  const det = m[0] * m[5] - m[1] * m[4];
  if (Math.abs(det) < 1e-12) throw new Error("二维矩阵不可逆");
  const a = m[5] / det, b = -m[1] / det, c = -m[4] / det, d = m[0] / det;
  return [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, -(a * m[12] + c * m[13]), -(b * m[12] + d * m[13]), 0, 1];
}

export const matrixAngle = (m: Mat4) => Math.atan2(m[1], m[0]);

/**
 * 两骨解析 IK，按骨骼实际朝向（子骨 rest 平移方向）求旋转；
 * shared 的 solveTwoBoneIk2d 假设骨骼沿局部 +x，本骨架远臂朝下，直接用会整条臂转错 ~90°。
 */
function solveTwoBoneDirected(upper: Transform, lower: Transform, end: Transform, target: [number, number], bendPositive: boolean, mix: number) {
  const s: [number, number] = [upper.translation[0], upper.translation[1]];
  const l1 = Math.hypot(lower.translation[0], lower.translation[1]), l2 = Math.hypot(end.translation[0], end.translation[1]);
  const phi1 = Math.atan2(lower.translation[1], lower.translation[0]), phi2 = Math.atan2(end.translation[1], end.translation[0]);
  const dx = target[0] - s[0], dy = target[1] - s[1];
  const raw = Math.hypot(dx, dy);
  const d = Math.min(l1 + l2 - 1e-6, Math.max(Math.abs(l1 - l2) + 1e-6, raw));
  const sign = bendPositive ? 1 : -1;
  const shoulder = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const alpha = Math.atan2(dy, dx) - sign * shoulder;
  const elbow: [number, number] = [s[0] + l1 * Math.cos(alpha), s[1] + l1 * Math.sin(alpha)];
  const wrist: [number, number] = [s[0] + dx / raw * d, s[1] + dy / raw * d];
  const beta = Math.atan2(wrist[1] - elbow[1], wrist[0] - elbow[0]);
  const r1 = alpha - phi1, r2 = beta - alpha + phi1 - phi2;
  const u0 = zAngle(upper.rotation), w0 = zAngle(lower.rotation);
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const fu = u0 + wrap(r1 - u0) * mix, fl = w0 + wrap(r2 - w0) * mix;
  return {
    reached: raw <= l1 + l2 + 1e-6 && raw >= Math.abs(l1 - l2) - 1e-6,
    upperLocal: { ...upper, rotation: quaternionFromZRotation(fu) },
    lowerLocal: { ...lower, rotation: quaternionFromZRotation(fl) },
  };
}

function socketWorld(pose: EvaluatedPose, socket: BodySocket): Mat4 | undefined {
  const bone = pose.worldMatrices[socket.boneId];
  return bone ? multiplyMatrices(bone, transformToMatrix(socket.rest)) : undefined;
}

/** 与 publishDiagnostics 的 sampleIkReach 相同的主手 socket 选择（按 preferredPrimaryHand 的 semantic）。 */
function primaryHandSocket(body: BodyProfile, item: EquipmentDefinition): BodySocket | undefined {
  const left = item.weapon?.preferredPrimaryHand === "left";
  const semantic = left ? "weapon_hand_left" : "weapon_hand_right";
  return body.sockets.find((s) => s.semantic === semantic || s.id === semantic)
    ?? body.sockets.find((s) => left ? s.semantic === "hand_left" || s.semantic === "weapon_hand_left" : s.semantic === "hand_right" || s.semantic === "weapon_hand_right");
}

/**
 * 双手武器 IK（终端 skeletal_constraints / validateTwoHandIkSample 语义）：
 * 武器世界 = 主手 socket 世界 × primaryGrip⁻¹，目标 = 武器世界 × secondaryGrip 的平移，在上臂父空间解两骨。
 * alignEnd 时末端骨世界朝向对齐 secondaryGrip 世界朝向（手跟枪走）。
 */
function applyWeaponIk(pose: EvaluatedPose, skeleton: Skeleton, body: BodyProfile, equipment: EquipmentDefinition[], diagnostics: string[], alignEnd: boolean): EvaluatedPose {
  let current = pose;
  for (const item of equipment) {
    const c = item.weapon?.secondaryHandConstraint;
    const weapon = item.weapon;
    if (!c || !weapon?.primaryGrip || !weapon.secondaryGrip) continue;
    const socket = primaryHandSocket(body, item);
    const hand = socket ? socketWorld(current, socket) : undefined;
    const upper = skeleton.bones.find((bone) => bone.id === c.upperBoneId);
    if (!hand || !upper) { diagnostics.push(`IK ${c.id}: 缺少主手 socket 或骨骼 ${c.upperBoneId}`); continue; }
    const secondary = multiplyMatrices(multiplyMatrices(hand, invert2d(transformToMatrix(weapon.primaryGrip))), transformToMatrix(weapon.secondaryGrip));
    const parentWorld = upper.parentId ? current.worldMatrices[upper.parentId]! : IDENTITY;
    const t = transformPoint(invert2d(parentWorld), [secondary[12], secondary[13], 0]);
    const result = solveTwoBoneDirected(current.local[c.upperBoneId]!, current.local[c.lowerBoneId]!, current.local[c.endBoneId]!, [t[0], t[1]], c.bendDirection !== "negative", c.mix);
    if (!result.reached) diagnostics.push(`IK ${c.id}: unreachable`);
    let local = { ...current.local, [c.upperBoneId]: result.upperLocal, [c.lowerBoneId]: result.lowerLocal };
    let world = recomputeWorld(skeleton, local);
    if (alignEnd && (c as { alignEnd?: boolean }).alignEnd) {
      const end = skeleton.bones.find((bone) => bone.id === c.endBoneId);
      const parent = end?.parentId ? world[end.parentId] : undefined;
      if (parent) {
        const angle = matrixAngle(secondary) - matrixAngle(parent);
        local = { ...local, [c.endBoneId]: { ...local[c.endBoneId]!, rotation: quaternionFromZRotation(angle) } };
        world = recomputeWorld(skeleton, local);
      }
    }
    current = { ...current, local, worldMatrices: world };
  }
  return current;
}

export function evaluatePose(input: SceneInput): { pose: EvaluatedPose; body?: BodyProfile; equipment: EquipmentDefinition[]; diagnostics: string[] } {
  const binding = input.document.character?.binding;
  if (!binding) throw new Error("工程没有角色 binding");
  const diagnostics: string[] = [];
  const clip = input.clip ?? { schemaVersion: 1, kind: "motion-clip", id: "rest", name: "rest", skeletonId: input.skeleton.id, duration: 0, loop: false, tracks: [], events: [] } as MotionClip;
  let pose = sampleMotionClip(clip, input.skeleton, input.time, mergedOffsets(binding, input.extraRotationOffsets));
  const equipment = input.equipmentIds.map((id) => {
    const found = (input.document.equipment ?? []).find((item) => item.id === id);
    if (!found) throw new Error(`装备 ${id} 不存在`);
    return found;
  });
  const body = pickBodyProfile(input.document, binding.skeletonId, input.bodyProfileId);
  if (input.ik && input.ik !== "off" && body) pose = applyWeaponIk(pose, input.skeleton, body, equipment, diagnostics, input.ik === "weapon-align");
  return { pose, body, equipment, diagnostics };
}

export function composeScene(input: SceneInput): Scene {
  const binding = input.document.character!.binding;
  const { pose, body, equipment, diagnostics } = evaluatePose(input);
  if (equipment.some((item) => item.attachments.length) && !body) diagnostics.push("工程没有 bodyProfile，装备附件无法定位");
  const hidden = new Set<string>();
  for (const item of equipment) for (const part of [...(item.visualMode === "replacement" ? item.replacesParts : []), ...item.hidesSlots]) hidden.add(part);
  const ordered = binding.slots.filter((slot) => !hidden.has(slot.id)).sort((a, b) => a.drawOrder - b.drawOrder || a.id.localeCompare(b.id));
  type Entry = { slotId: string; boneId: string; attachmentId: string; source: "binding" | "equipment"; equipmentId?: string; rest: Transform; region: { materialId: string; imageSlot: "raw" | "processed"; size: [number, number]; pivot: [number, number] } };
  const entries: Entry[] = [];
  for (const slot of ordered) {
    const attachment = binding.attachments.find((item) => item.id === slot.attachmentId);
    if (!attachment) continue;
    if (hiddenByVisibility(binding, attachment.id)) continue;
    if (attachment.deform || attachment.warp) diagnostics.push(`${attachment.id}: 带 deform/warp，离线渲染按未变形绘制`);
    entries.push({ slotId: slot.id, boneId: slot.boneId, attachmentId: attachment.id, source: "binding", rest: attachment.rest, region: attachment });
  }
  for (const item of equipment) {
    if (item.visualMode !== "attached" && item.visualMode !== "replacement") continue;
    for (const attachment of item.attachments) {
      const socket = body?.sockets.find((entry) => entry.id === attachment.socket);
      if (!socket) { diagnostics.push(`${attachment.id}: socket ${attachment.socket} 不在 bodyProfile`); continue; }
      let anchor = -1;
      for (let i = 0; i < entries.length; i += 1) if (entries[i]!.boneId === socket.boneId) anchor = i;
      const at = Math.max(0, Math.min(entries.length, (anchor < 0 ? entries.length : anchor + 1) + attachment.drawOffset));
      entries.splice(at, 0, { slotId: `eq:${attachment.id}`, boneId: socket.boneId, attachmentId: attachment.id, source: "equipment", equipmentId: item.id, rest: composeSocketRest(socket.rest, attachment.rest), region: attachment });
    }
  }
  const items: DrawItem[] = [];
  for (const entry of entries) {
    const bone = pose.worldMatrices[entry.boneId];
    if (!bone) { diagnostics.push(`${entry.attachmentId}: 骨骼 ${entry.boneId} 不存在`); continue; }
    const restWorld = multiplyMatrices(bone, transformToMatrix(entry.rest));
    const offset = offsetMatrix(pose.attachmentOffsets[entry.attachmentId]);
    const offsetEntry = pose.attachmentOffsets[entry.attachmentId];
    if (offsetEntry?.deformBend !== undefined || offsetEntry?.deformWarp) diagnostics.push(`${entry.attachmentId}: clip 有 deform/warp 轨，离线渲染忽略`);
    items.push({
      slotId: entry.slotId,
      attachmentId: entry.attachmentId,
      boneId: entry.boneId,
      materialId: entry.region.materialId,
      imageSlot: entry.region.imageSlot,
      size: [entry.region.size[0], entry.region.size[1]],
      pivot: [entry.region.pivot[0], entry.region.pivot[1]],
      world: offset ? multiplyMatrices(restWorld, offset) : restWorld,
      source: entry.source,
      equipmentId: entry.equipmentId,
    });
  }
  return { pose, items, diagnostics };
}

/** 部件在世界中的有效线性尺度（两轴最小值）；SHOW/HIDE-scale 后 < 0.01 视为不可见。 */
export function itemScale(item: DrawItem): number {
  return Math.min(Math.hypot(item.world[0], item.world[1]), Math.hypot(item.world[4], item.world[5]));
}

export function isItemVisible(item: DrawItem): boolean {
  return itemScale(item) >= 0.01;
}

export function itemCorners(item: DrawItem): Array<[number, number]> {
  const [w, h] = item.size, [px, py] = item.pivot;
  return ([[-px * w, -py * h], [(1 - px) * w, -py * h], [(1 - px) * w, (1 - py) * h], [-px * w, (1 - py) * h]] as const).map(([x, y]) => {
    const p = transformPoint(item.world, [x, y, 0]);
    return [p[0], p[1]];
  });
}

/** 图片像素中心（左上原点）→ 世界坐标。 */
export function imagePixelToWorld(item: DrawItem, image: RgbaImage, u: number, v: number): [number, number] {
  const lx = ((u + 0.5) / image.width - item.pivot[0]) * item.size[0];
  const ly = (1 - (v + 0.5) / image.height - item.pivot[1]) * item.size[1];
  const p = transformPoint(item.world, [lx, ly, 0]);
  return [p[0], p[1]];
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface Raster {
  image: RgbaImage;
  /** 每像素最上层 alpha≥128 的部件下标；-1 为空。 */
  owner: Int32Array;
  /** track 指定部件的覆盖（alpha≥128，不考虑遮挡）。 */
  coverage: Map<number, Uint8Array>;
  scale: number;
  bounds: Bounds;
}

export function sceneBounds(items: DrawItem[], pad = 8): Bounds {
  const points = items.filter(isItemVisible).flatMap(itemCorners);
  if (!points.length) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return {
    minX: Math.min(...points.map((p) => p[0])) - pad,
    minY: Math.min(...points.map((p) => p[1])) - pad,
    maxX: Math.max(...points.map((p) => p[0])) + pad,
    maxY: Math.max(...points.map((p) => p[1])) + pad,
  };
}

export function worldToPixel(raster: Pick<Raster, "scale" | "bounds">, x: number, y: number): [number, number] {
  return [(x - raster.bounds.minX) * raster.scale - 0.5, (raster.bounds.maxY - y) * raster.scale - 0.5];
}

export interface RasterOptions {
  scale?: number;
  bounds?: Bounds;
  background?: [number, number, number, number];
  track?: number[];
}

/** 最近邻采样 + 直通 alpha 的 src-over 合成（像素风素材不插值）。缺图的部件跳过并由调用方报告。 */
export function rasterize(items: DrawItem[], images: Map<string, RgbaImage>, options: RasterOptions = {}): Raster {
  const scale = options.scale ?? 1;
  const bounds = options.bounds ?? sceneBounds(items);
  const width = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) * scale));
  const height = Math.max(1, Math.ceil((bounds.maxY - bounds.minY) * scale));
  const image = createImage(width, height);
  const bg = options.background ?? [0, 0, 0, 0];
  for (let i = 0; i < width * height; i += 1) image.data.set(bg, i * 4);
  const owner = new Int32Array(width * height).fill(-1);
  const coverage = new Map<number, Uint8Array>();
  for (const index of options.track ?? []) coverage.set(index, new Uint8Array(width * height));
  items.forEach((item, index) => {
    if (!isItemVisible(item)) return;
    const texture = images.get(item.materialId);
    if (!texture) return;
    const inverse = invert2d(item.world);
    const corners = itemCorners(item).map(([x, y]) => worldToPixel({ scale, bounds }, x, y));
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0])))), x1 = Math.min(width - 1, Math.ceil(Math.max(...corners.map((p) => p[0]))));
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1])))), y1 = Math.min(height - 1, Math.ceil(Math.max(...corners.map((p) => p[1]))));
    const [w, h] = item.size, [pivotX, pivotY] = item.pivot;
    const track = coverage.get(index);
    for (let py = y0; py <= y1; py += 1) for (let px = x0; px <= x1; px += 1) {
      const wx = bounds.minX + (px + 0.5) / scale, wy = bounds.maxY - (py + 0.5) / scale;
      const lx = inverse[0] * wx + inverse[4] * wy + inverse[12], ly = inverse[1] * wx + inverse[5] * wy + inverse[13];
      const u = Math.floor((lx / w + pivotX) * texture.width), v = Math.floor((1 - (ly / h + pivotY)) * texture.height);
      if (u < 0 || v < 0 || u >= texture.width || v >= texture.height) continue;
      const s = (v * texture.width + u) * 4, a = texture.data[s + 3]!;
      if (!a) continue;
      const o = (py * width + px) * 4, da = image.data[o + 3]! / 255, sa = a / 255, outA = sa + da * (1 - sa);
      for (let c = 0; c < 3; c += 1) image.data[o + c] = Math.round((texture.data[s + c]! * sa + image.data[o + c]! * da * (1 - sa)) / outA);
      image.data[o + 3] = Math.round(outA * 255);
      if (a >= 128) {
        owner[py * width + px] = index;
        if (track) track[py * width + px] = 1;
      }
    }
  });
  return { image, owner, coverage, scale, bounds };
}

/** 最近邻放大（预览/看图用）。 */
export function upscale(image: RgbaImage, factor: number): RgbaImage {
  const out = createImage(image.width * factor, image.height * factor);
  for (let y = 0; y < out.height; y += 1) for (let x = 0; x < out.width; x += 1) {
    const s = (Math.floor(y / factor) * image.width + Math.floor(x / factor)) * 4;
    out.data.set(image.data.subarray(s, s + 4), (y * out.width + x) * 4);
  }
  return out;
}

export function crop(image: RgbaImage, x0: number, y0: number, width: number, height: number): RgbaImage {
  const out = createImage(width, height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sx = x0 + x, sy = y0 + y;
    if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
    const s = (sy * image.width + sx) * 4;
    out.data.set(image.data.subarray(s, s + 4), (y * width + x) * 4);
  }
  return out;
}

/** 把透明底铺成棋盘格，方便看出空档。 */
export function flattenChecker(image: RgbaImage, cell = 4): RgbaImage {
  const out = createImage(image.width, image.height);
  for (let y = 0; y < image.height; y += 1) for (let x = 0; x < image.width; x += 1) {
    const o = (y * image.width + x) * 4, a = image.data[o + 3]! / 255;
    const bg = ((Math.floor(x / cell) + Math.floor(y / cell)) % 2) ? 200 : 235;
    for (let c = 0; c < 3; c += 1) out.data[o + c] = Math.round(image.data[o + c]! * a + bg * (1 - a));
    out.data[o + 3] = 255;
  }
  return out;
}

export function zRotationOf(transform: Transform): number {
  return zAngle(transform.rotation);
}
