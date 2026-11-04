import { multiplyMatrices, quaternionFromZRotation, transformPoint, transformToMatrix, type Mat4, type MotionClip, type Skeleton, type Transform } from "../../../packages/shared/src/animation";
import type { EquipmentDefinition, TwoBoneIkConstraint } from "../../../packages/shared/src/equipment";
import type { SkeletalProjectDocument } from "../../../packages/shared/src/skeletalProject";
import type { RgbaImage } from "./png";
import { composeScene, imagePixelToWorld, invert2d, isItemVisible, matrixAngle, pickBodyProfile, rasterize, sceneBounds } from "./render";
import { descendantBones, findCuff, type SeamSpec } from "./seam";
import { MAX_ALIGN_DEG } from "./wristFix";

/**
 * 双手武器 IK 下的腕口：远臂由 IK 解（mix>0 时 clip 里的远臂旋转被覆盖），支撑手挂在 IK 末端骨上随手臂走，
 * 末端骨朝向在 alignEnd 时跟枪。能动的加性杠杆只在 her1 装备上：secondaryGrip（IK 目标）、支撑手 rest、bendDirection。
 */

export type WristVerdict = "wiring-fixable" | "needs-art" | "unreachable";
export const VERDICT_LABEL: Record<WristVerdict, string> = { "wiring-fixable": "接线可修", "needs-art": "仍需画师新手", unreachable: "够不着" };

export interface SupportIk { equipment: EquipmentDefinition; constraint: TwoBoneIkConstraint & { alignEnd?: boolean }; socketBone: string }

/** 支撑手所在 socket 骨骼落在 IK 链内且 mix>0 时返回约束；否则 null（clip 远臂旋转才有效）。 */
export function activeSupportIk(document: SkeletalProjectDocument, skeleton: Skeleton, equipmentId: string, handAttachmentId: string): SupportIk | null {
  const equipment = (document.equipment ?? []).find((item) => item.id === equipmentId);
  const constraint = equipment?.weapon?.secondaryHandConstraint;
  if (!equipment || !constraint || !(constraint.mix > 0) || !equipment.weapon?.secondaryGrip) return null;
  const attachment = equipment.attachments.find((item) => item.id === handAttachmentId);
  const body = pickBodyProfile(document, skeleton.id);
  const socket = body?.sockets.find((item) => item.id === attachment?.socket);
  if (!socket || !descendantBones(skeleton, constraint.upperBoneId).has(socket.boneId)) return null;
  return { equipment, constraint, socketBone: socket.boneId };
}

/** 腕口切口在附件局部（相对 pivot，世界单位，Y 向上）：中心点与「前臂进手」方向（弧度）。 */
export interface CutLocal { center: [number, number]; inward: number }

const cuffCache = new WeakMap<RgbaImage, Map<string, ReturnType<typeof findCuff>>>();

export function cutLocal(region: { size: [number, number]; pivot: [number, number] }, image: RgbaImage, spec: SeamSpec): CutLocal | null {
  const key = JSON.stringify([spec.openBand, spec.nativeSize, spec.outline]);
  const perImage = cuffCache.get(image) ?? new Map<string, ReturnType<typeof findCuff>>();
  cuffCache.set(image, perImage);
  if (!perImage.has(key)) perImage.set(key, findCuff(image, spec));
  const { cuff } = perImage.get(key)!;
  if (!cuff.length) return null;
  const local = (u: number, v: number): [number, number] => [((u + 0.5) / image.width - region.pivot[0]) * region.size[0], (1 - (v + 0.5) / image.height - region.pivot[1]) * region.size[1]];
  let cx = 0, cy = 0, ox = 0, oy = 0;
  for (const pixel of cuff) {
    const [x, y] = local(pixel.u, pixel.v);
    cx += x; cy += y;
    for (const [bu, bv] of pixel.beyond) { ox += (bu - pixel.u) * region.size[0] / image.width; oy -= (bv - pixel.v) * region.size[1] / image.height; }
  }
  return { center: [cx / cuff.length, cy / cuff.length], inward: Math.atan2(-oy, -ox) };
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const deg = (r: number) => r * 180 / Math.PI;

export interface IkWristSample {
  phase: string;
  time: number;
  reached: boolean;
  /** 前臂（肘→末端骨原点）与腕口进手方向夹角（度）。 */
  alignDeg: number;
  /** 腕口中心到前臂远端（末端骨原点）的距离（世界单位）。 */
  cutGap: number;
  /** 前臂朝向、腕口进手方向相对枪管（末端骨世界朝向）的角度（度）。 */
  forearmRelDeg: number;
  cutRelDeg: number;
}

export interface IkWristInput {
  document: SkeletalProjectDocument;
  skeleton: Skeleton;
  images: Map<string, RgbaImage>;
  equipmentId: string;
  spec: SeamSpec;
}

export function sampleIkWrist(input: IkWristInput, ik: SupportIk, clip: MotionClip, phase: string, time: number): IkWristSample | null {
  const scene = composeScene({ document: input.document, skeleton: input.skeleton, clip, time, equipmentIds: [input.equipmentId], ik: "weapon-align" });
  const hand = scene.items.find((item) => item.attachmentId === input.spec.handAttachmentId && isItemVisible(item));
  const image = hand && input.images.get(hand.materialId);
  if (!hand || !image) return null;
  const cut = cutLocal(hand, image, input.spec);
  if (!cut) return null;
  const e = scene.pose.worldMatrices[ik.constraint.lowerBoneId]!, h = scene.pose.worldMatrices[ik.constraint.endBoneId]!;
  const fore = Math.atan2(h[13] - e[13], h[12] - e[12]), gun = matrixAngle(h);
  const c = transformPoint(hand.world, [cut.center[0], cut.center[1], 0]);
  const cutIn = matrixAngle(hand.world) + cut.inward;
  return {
    phase,
    time,
    reached: !scene.diagnostics.some((line) => line.includes(ik.constraint.id) && line.includes("unreachable")),
    alignDeg: Math.abs(deg(wrap(fore - cutIn))),
    cutGap: Math.hypot(c[0] - h[12], c[1] - h[13]),
    forearmRelDeg: deg(wrap(fore - gun)),
    cutRelDeg: deg(wrap(cutIn - gun)),
  };
}

/** 装备杠杆：指节沿枪身平移（slide 沿枪管、lift 垂直）、手绕指节转 rotateDeg、IK 弯向；腕口中心移到 IK 目标。 */
export interface IkLever { slide: number; lift: number; rotateDeg: number; bend: "positive" | "negative" }

const translationOf = (m: Mat4): [number, number] => [m[12], m[13]];
const rotate = (v: [number, number], a: number): [number, number] => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];

/** 在文档副本里改 her1 装备（可换新 id）；IK 目标落在切口中心往掌心内收 overlap 处（前臂远端塞进腕口）。 */
export function applyIkLever(document: SkeletalProjectDocument, skeleton: Skeleton, equipmentId: string, handAttachmentId: string, cut: CutLocal, lever: IkLever, options: { newId?: string; overlap?: number } = {}): { document: SkeletalProjectDocument; equipment: EquipmentDefinition } {
  const { newId, overlap = 0 } = options;
  const doc = structuredClone(document);
  const source = doc.equipment!.find((item) => item.id === equipmentId)!;
  const equipment = newId ? { ...structuredClone(source), id: newId } : source;
  if (newId) doc.equipment = [...doc.equipment!.filter((item) => item.id !== newId), equipment];
  const weapon = equipment.weapon!;
  const attachment = equipment.attachments.find((item) => item.id === handAttachmentId)!;
  const socket = pickBodyProfile(doc, skeleton.id)!.sockets.find((item) => item.id === attachment.socket)!;
  const S = transformToMatrix(socket.rest), A = transformToMatrix(attachment.rest);
  const grip = transformToMatrix(weapon.secondaryGrip!);
  const gripAngle = matrixAngle(grip);
  const knuckle = translationOf(multiplyMatrices(grip, multiplyMatrices(S, A)));
  const cutInSocket = transformPoint(A, [cut.center[0] + Math.cos(cut.inward) * overlap, cut.center[1] + Math.sin(cut.inward) * overlap, 0]);
  const origin = transformPoint(invert2d(S), [0, 0, 0]);
  const d: [number, number] = [origin[0] - cutInSocket[0], origin[1] - cutInSocket[1]];
  const restT = attachment.rest.translation;
  attachment.rest = { ...attachment.rest, translation: [restT[0] + d[0], restT[1] + d[1], restT[2]] };
  const pivotInEnd = translationOf(multiplyMatrices(S, transformToMatrix(attachment.rest)));
  const angle = gripAngle + lever.rotateDeg * Math.PI / 180;
  const shift = rotate([lever.slide, lever.lift], gripAngle);
  const k = rotate(pivotInEnd, angle);
  const gt = weapon.secondaryGrip!.translation;
  const next: Transform = { translation: [knuckle[0] + shift[0] - k[0], knuckle[1] + shift[1] - k[1], gt[2]], rotation: quaternionFromZRotation(angle), scale: [...weapon.secondaryGrip!.scale] };
  equipment.weapon = { ...weapon, secondaryGrip: next, secondaryHandConstraint: { ...weapon.secondaryHandConstraint!, bendDirection: lever.bend } };
  return { document: doc, equipment };
}

export interface IkSearchSpace { slide: number[]; lift: number[]; rotateDeg: number[]; bends: Array<"positive" | "negative"> }
const range = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);
/** 手仍握在护木上：指节沿枪管 ±40、垂直 ±12，手转 ±20°。 */
export const DEFAULT_IK_SEARCH: IkSearchSpace = { slide: range(-40, 40, 10), lift: range(-12, 12, 6), rotateDeg: range(-20, 20, 5), bends: ["positive", "negative"] };

export interface IkCandidate { lever: IkLever; worstAlignDeg: number; unreachable: number; samples: IkWristSample[] }

export function searchIkLevers(input: IkWristInput, clips: Array<{ phase: string; clip: MotionClip; times: number[] }>, cut: CutLocal, space: IkSearchSpace = DEFAULT_IK_SEARCH, overlap = 0): IkCandidate {
  let best: IkCandidate | null = null;
  for (const bend of space.bends) for (const slide of space.slide) for (const lift of space.lift) for (const rotateDeg of space.rotateDeg) {
    const lever = { slide, lift, rotateDeg, bend };
    const { document } = applyIkLever(input.document, input.skeleton, input.equipmentId, input.spec.handAttachmentId, cut, lever, { overlap });
    const variant = { ...input, document };
    const ik = activeSupportIk(document, input.skeleton, input.equipmentId, input.spec.handAttachmentId)!;
    const samples = clips.flatMap(({ phase, clip, times }) => times.flatMap((t) => sampleIkWrist(variant, ik, clip, phase, t) ?? []));
    const candidate = { lever, samples, worstAlignDeg: Math.max(0, ...samples.map((s) => s.alignDeg)), unreachable: samples.filter((s) => !s.reached).length };
    if (!best || candidate.unreachable < best.unreachable || (candidate.unreachable === best.unreachable && candidate.worstAlignDeg < best.worstAlignDeg)) best = candidate;
  }
  return best!;
}

/** 远臂前臂图在该帧：可见比例（被躯干等遮住的不算）、图末端离前臂远端的距离、末端附近的宽度（世界单位）。 */
export interface ForearmProfile { visiblePct: number; tipGap: number; width: number }

export function forearmProfile(input: IkWristInput, ik: SupportIk, clip: MotionClip, time: number): ForearmProfile | null {
  const scene = composeScene({ document: input.document, skeleton: input.skeleton, clip, time, equipmentIds: [input.equipmentId], ik: "weapon-align" });
  const lower = ik.constraint.lowerBoneId;
  const track = scene.items.flatMap((item, i) => item.source === "binding" && item.boneId === lower && isItemVisible(item) && input.images.has(item.materialId) ? [i] : []);
  if (!track.length) return null;
  const raster = rasterize(scene.items, input.images, { bounds: sceneBounds(scene.items), track });
  let covered = 0, visible = 0;
  for (const i of track) { const m = raster.coverage.get(i)!; for (let p = 0; p < m.length; p += 1) if (m[p]) { covered += 1; if (raster.owner[p] === i) visible += 1; } }
  const e = scene.pose.worldMatrices[lower]!, h = scene.pose.worldMatrices[ik.constraint.endBoneId]!;
  const length = Math.hypot(h[12] - e[12], h[13] - e[13]) || 1;
  const axis = [(h[12] - e[12]) / length, (h[13] - e[13]) / length] as const;
  const points: Array<[number, number]> = [];
  for (const i of track) {
    const item = scene.items[i]!, image = input.images.get(item.materialId)!;
    for (let v = 0; v < image.height; v += 1) for (let u = 0; u < image.width; u += 1) {
      if (image.data[(v * image.width + u) * 4 + 3]! < 128) continue;
      const [x, y] = imagePixelToWorld(item, image, u, v), dx = x - e[12], dy = y - e[13];
      points.push([dx * axis[0] + dy * axis[1], -dx * axis[1] + dy * axis[0]]);
    }
  }
  const tip = Math.max(...points.map((p) => p[0]));
  const near = points.filter((p) => p[0] >= tip - 40 && p[0] <= tip - 10).map((p) => p[1]);
  return { visiblePct: covered ? Math.round(visible / covered * 100) : 0, tipGap: length - tip, width: near.length ? Math.max(...near) - Math.min(...near) : 0 };
}

export interface ArtSpecGroup { phases: string[]; forearmRelDeg: number; minDeg: number; maxDeg: number; cutOutwardRelDeg: number; forearm?: ForearmProfile | null }
export interface ArtSpec {
  pivot: string;
  groups: ArtSpecGroup[];
  transitions: Array<{ phase: string; fromDeg: number; toDeg: number; swapAt: number | null }>;
  current: { cutRelDeg: number; cutGap: number };
  notes: string[];
}

const median = (values: number[]) => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)]! : 0; };
const TRANSITION_SPREAD_DEG = 40, GROUP_GAP_DEG = 30, HIDDEN_FOREARM_PCT = 10;

/** 基线采样 → 给画师的腕口规格：按相位把前臂进手方向（相对枪管）聚成组，过渡相位给出换手时刻。 */
export function deriveArtSpec(samples: IkWristSample[]): ArtSpec {
  const phases = [...new Set(samples.map((s) => s.phase))];
  const steady: Array<{ phase: string; values: number[] }> = [];
  const transitions: ArtSpec["transitions"] = [];
  for (const phase of phases) {
    const list = samples.filter((s) => s.phase === phase).sort((a, b) => a.time - b.time);
    const values = list.map((s) => s.forearmRelDeg);
    if (Math.max(...values) - Math.min(...values) > TRANSITION_SPREAD_DEG) {
      const from = values[0]!, to = values.at(-1)!, mid = (from + to) / 2;
      const cross = list.findIndex((s, i) => i > 0 && (values[i - 1]! - mid) * (s.forearmRelDeg - mid) <= 0);
      transitions.push({ phase, fromDeg: from, toDeg: to, swapAt: cross > 0 ? list[cross]!.time : null });
    } else steady.push({ phase, values });
  }
  const groups: ArtSpecGroup[] = [];
  for (const entry of steady.sort((a, b) => median(a.values) - median(b.values))) {
    const m = median(entry.values), last = groups.at(-1);
    if (last && Math.abs(m - last.forearmRelDeg) <= GROUP_GAP_DEG) {
      last.phases.push(entry.phase);
      last.minDeg = Math.min(last.minDeg, ...entry.values);
      last.maxDeg = Math.max(last.maxDeg, ...entry.values);
    } else groups.push({ phases: [entry.phase], forearmRelDeg: m, minDeg: Math.min(...entry.values), maxDeg: Math.max(...entry.values), cutOutwardRelDeg: deg(wrap((m + 180) * Math.PI / 180)) });
  }
  const notes = [
    "角度在枪坐标系：0° = 沿枪管指向枪口，90° = 垂直枪管朝上（屏幕上方）；支撑手随枪转（alignEnd）。",
    "前臂进手方向 = 肘 → 腕；腕口切口应朝它的反方向（cutOutwardRelDeg），切口中心放在 pivot 上（= 前臂远端 = secondaryGrip）。",
  ];
  if (groups.length > 1) notes.push(`稳定态有 ${groups.length} 组前臂方向（相差 ${Math.round(Math.abs(groups.at(-1)!.forearmRelDeg - groups[0]!.forearmRelDeg))}°），一张刚性手图接不住，需要按组各画一张，过渡相位在 swapAt 用 att: scale 换显。`);
  return {
    pivot: "腕口切口中心 = pivot = 前臂远端（IK 末端骨原点）= secondaryGrip；指节/手指再向枪身延伸",
    groups,
    transitions,
    current: { cutRelDeg: median(samples.map((s) => s.cutRelDeg)), cutGap: median(samples.map((s) => s.cutGap)) },
    notes,
  };
}

export interface IkWristReport {
  constraintId: string;
  baseline: { worstAlignDeg: number; medianCutGap: number; unreachable: number; samples: IkWristSample[] };
  best: IkCandidate;
  geometricPass: boolean;
  artSpec: ArtSpec;
}

/** 基线体检 + 杠杆搜索；几何上过不了就不必再渲染验证。 */
export function analyzeIkWrist(input: IkWristInput, ik: SupportIk, clips: Array<{ phase: string; clip: MotionClip; times: number[] }>, space?: IkSearchSpace, overlap = 0): IkWristReport | string {
  const samples = clips.flatMap(({ phase, clip, times }) => times.flatMap((t) => sampleIkWrist(input, ik, clip, phase, t) ?? []));
  if (!samples.length) return "支撑手不可见或找不到腕口切口";
  const attachment = ik.equipment.attachments.find((item) => item.id === input.spec.handAttachmentId)!;
  const image = input.images.get(attachment.materialId);
  const cut = image && cutLocal(attachment, image, input.spec);
  if (!cut) return "找不到腕口切口";
  const best = searchIkLevers(input, clips, cut, space, overlap);
  const artSpec = deriveArtSpec(samples);
  for (const group of artSpec.groups) {
    const entry = clips.find((item) => item.phase === group.phases[0])!;
    group.forearm = forearmProfile(input, ik, entry.clip, entry.times[0]!);
    const f = group.forearm;
    if (!f) continue;
    artSpec.notes.push(f.visiblePct < HIDDEN_FOREARM_PCT
      ? `${group.phases.join("/")}：远臂前臂只露 ${f.visiblePct}%（在躯干后），手图腕口不能留开口——画收口袖口/把腕藏到枪身后，否则就是浮手断腕。`
      : `${group.phases.join("/")}：远臂前臂露 ${f.visiblePct}%，前臂图末端离 pivot ${f.tipGap.toFixed(0)}、宽 ${f.width.toFixed(0)}（世界单位）；腕口要沿前臂方向盖过末端 ≥4 并与该宽度一致。`);
  }
  return {
    constraintId: ik.constraint.id,
    baseline: { worstAlignDeg: Math.max(...samples.map((s) => s.alignDeg)), medianCutGap: median(samples.map((s) => s.cutGap)), unreachable: samples.filter((s) => !s.reached).length, samples },
    best,
    geometricPass: best.unreachable === 0 && best.worstAlignDeg <= MAX_ALIGN_DEG,
    artSpec,
  };
}

export function classifyIkWrist(report: IkWristReport, seamPass: boolean): WristVerdict {
  if (report.baseline.unreachable > 0 && report.best.unreachable > 0) return "unreachable";
  return report.geometricPass && seamPass ? "wiring-fixable" : "needs-art";
}

export function cutForEquipment(document: SkeletalProjectDocument, images: Map<string, RgbaImage>, equipmentId: string, spec: SeamSpec): CutLocal | null {
  const attachment = (document.equipment ?? []).find((item) => item.id === equipmentId)?.attachments.find((item) => item.id === spec.handAttachmentId);
  const image = attachment && images.get(attachment.materialId);
  return image ? cutLocal(attachment, image, spec) : null;
}
