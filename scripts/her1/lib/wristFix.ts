import {
  ATTACHMENT_TARGET_PREFIX,
  multiplyQuaternions,
  normalizeQuaternion,
  quaternionFromZRotation,
  sampleMotionClip,
  transformPoint,
  type AnyMotionTrack,
  type MotionClip,
  type Quaternion,
  type Skeleton,
} from "../../../packages/shared/src/animation";
import type { SkeletalProjectDocument } from "../../../packages/shared/src/skeletalProject";
import type { RgbaImage } from "./png";
import { composeScene, evaluatePose, imagePixelToWorld, invert2d, isItemVisible, type Scene } from "./render";
import { descendantBones, findCuff, type SeamSpec } from "./seam";

export interface WristFixSpec extends SeamSpec {
  upperBone: string;
  lowerBone: string;
  equipmentIds: string[];
  /** 前臂远端插进腕口的深度（世界单位，沿腕口→掌心方向）。 */
  overlap: number;
  /** 烘焙采样步长（秒）；另外总会包含原 clip 的所有关键帧时刻与 0/duration。 */
  step: number;
  /** 旋转增量上限（弧度）；超过视为该时刻无解。 */
  maxDelta: number;
}

export interface WristSample {
  time: number;
  target: [number, number] | null;
  before: number | null;
  after: number | null;
  deltaUpper: number;
  deltaLower: number;
  /** 修正后前臂轴与腕口→掌心方向的夹角（度）；角度大说明腕口朝向与远臂不一致，clip 修不了。 */
  alignDeg: number | null;
  note?: string;
}

/** 前臂轴与腕口朝向夹角超过该值即判为美术朝向问题（需要重画腕口延伸或手）。 */
export const MAX_ALIGN_DEG = 20;

export interface WristFixResult {
  clip: MotionClip;
  samples: WristSample[];
  /** 烘焙后在相邻采样中点复核的最大残差（世界单位）。 */
  maxResidual: number;
  diagnostics: string[];
}

interface Frame { target: [number, number]; anchorLocal: [number, number]; inward: [number, number] }

const EPS_TIME = 1e-6;

function sampleTimes(clip: MotionClip, step: number): number[] {
  const set = [0, clip.duration];
  for (const track of clip.tracks as AnyMotionTrack[]) for (const key of track.keyframes) set.push(key.time);
  if (clip.duration > 0 && step > 0) for (let t = step; t < clip.duration - EPS_TIME; t += step) set.push(t);
  const sorted = set.filter((t) => t >= 0 && t <= clip.duration + EPS_TIME).sort((a, b) => a - b);
  return sorted.filter((t, i) => i === 0 || t - sorted[i - 1]! > EPS_TIME).map((t) => Math.round(t * 1e6) / 1e6);
}

function boneAxisWorld(scene: Scene, skeleton: Skeleton, boneId: string): [number, number] {
  const bone = skeleton.bones.find((item) => item.id === boneId)!;
  const m = scene.pose.worldMatrices[boneId]!;
  const child = skeleton.bones.find((item) => item.parentId === boneId);
  const local = bone.tipOffset ?? (child ? child.rest.translation : [1, 0, 0]);
  const o = transformPoint(m, [0, 0, 0]), e = transformPoint(m, [local[0], local[1], 0]);
  const len = Math.hypot(e[0] - o[0], e[1] - o[1]) || 1;
  return [(e[0] - o[0]) / len, (e[1] - o[1]) / len];
}

/** 当前帧：腕口目标点（切口中心沿掌心方向内收 overlap）与前臂远端锚点（前臂骨局部坐标）。 */
function frameAt(scene: Scene, images: Map<string, RgbaImage>, skeleton: Skeleton, spec: WristFixSpec): Frame | string {
  const hand = scene.items.find((item) => item.attachmentId === spec.handAttachmentId && isItemVisible(item));
  if (!hand) return "支撑手不可见";
  const handImage = images.get(hand.materialId);
  if (!handImage) return "缺支撑手素材";
  const { cuff, palm } = findCuff(handImage, spec);
  if (!cuff.length || !palm.length) return "找不到腕口切口";
  const world = (points: Array<[number, number]>) => points.map(([u, v]) => imagePixelToWorld(hand, handImage, u, v));
  const avg = (points: Array<[number, number]>): [number, number] => [points.reduce((s, p) => s + p[0], 0) / points.length, points.reduce((s, p) => s + p[1], 0) / points.length];
  const cuffC = avg(world(cuff.map((c) => [c.u, c.v]))), palmC = avg(world(palm));
  const inward = [palmC[0] - cuffC[0], palmC[1] - cuffC[1]], len = Math.hypot(inward[0]!, inward[1]!) || 1;
  const target: [number, number] = [cuffC[0] + inward[0]! / len * spec.overlap, cuffC[1] + inward[1]! / len * spec.overlap];
  const lowerBones = descendantBones(skeleton, spec.lowerBone);
  const forearm = scene.items.filter((item) => item.source === "binding" && lowerBones.has(item.boneId) && isItemVisible(item) && images.has(item.materialId));
  if (!forearm.length) return `${spec.lowerBone} 上没有可见前臂部件`;
  const axis = boneAxisWorld(scene, skeleton, spec.lowerBone);
  const points: Array<[number, number]> = [];
  for (const item of forearm) {
    const image = images.get(item.materialId)!;
    for (let v = 0; v < image.height; v += 1) for (let u = 0; u < image.width; u += 1) if (image.data[(v * image.width + u) * 4 + 3]! >= 128) points.push(imagePixelToWorld(item, image, u, v));
  }
  const proj = points.map((p) => p[0] * axis[0] + p[1] * axis[1]);
  const maxProj = Math.max(...proj);
  // 像素中心常落在阈值上；留容差，避免不同旋转下浮点误差让整列像素进出、锚点抖动。
  const tip = avg(points.filter((_, i) => proj[i]! >= maxProj - 2 - 1e-6));
  const local = transformPoint(invert2d(scene.pose.worldMatrices[spec.lowerBone]!), [tip[0], tip[1], 0]);
  return { target, anchorLocal: [local[0], local[1]], inward: [inward[0]! / len, inward[1]! / len] };
}

function solvedPose(document: SkeletalProjectDocument, skeleton: Skeleton, clip: MotionClip, time: number, spec: WristFixSpec, d1: number, d2: number) {
  return evaluatePose({ document, skeleton, clip, time, equipmentIds: [], extraRotationOffsets: { [spec.upperBone]: d1, [spec.lowerBone]: d2 } }).pose;
}

function anchorWorld(document: SkeletalProjectDocument, skeleton: Skeleton, clip: MotionClip, time: number, spec: WristFixSpec, frame: Frame, d1: number, d2: number): [number, number] {
  const p = transformPoint(solvedPose(document, skeleton, clip, time, spec, d1, d2).worldMatrices[spec.lowerBone]!, [frame.anchorLocal[0], frame.anchorLocal[1], 0]);
  return [p[0], p[1]];
}

/** 前臂轴（肘→锚点）与腕口内收方向的夹角（度）。 */
function alignmentDeg(document: SkeletalProjectDocument, skeleton: Skeleton, clip: MotionClip, time: number, spec: WristFixSpec, frame: Frame, d1: number, d2: number): number {
  const m = solvedPose(document, skeleton, clip, time, spec, d1, d2).worldMatrices[spec.lowerBone]!;
  const o = transformPoint(m, [0, 0, 0]), a = transformPoint(m, [frame.anchorLocal[0], frame.anchorLocal[1], 0]);
  const dx = a[0] - o[0], dy = a[1] - o[1], len = Math.hypot(dx, dy) || 1;
  const cos = Math.max(-1, Math.min(1, (dx * frame.inward[0] + dy * frame.inward[1]) / len));
  return Math.acos(cos) * 180 / Math.PI;
}

/** 两未知数 Levenberg–Marquardt（数值雅可比），从给定起点收敛。 */
function solve(residual: (d1: number, d2: number) => [number, number], maxDelta: number, start: [number, number] = [0, 0]): { d1: number; d2: number; error: number } {
  let [d1, d2] = start, lambda = 1e-3;
  let r = residual(d1, d2), cost = r[0] ** 2 + r[1] ** 2;
  for (let iter = 0; iter < 60 && cost > 1e-8; iter += 1) {
    const h = 1e-4;
    const r1 = residual(d1 + h, d2), r2 = residual(d1, d2 + h);
    const j = [[(r1[0] - r[0]) / h, (r2[0] - r[0]) / h], [(r1[1] - r[1]) / h, (r2[1] - r[1]) / h]];
    const a = j[0]![0]! ** 2 + j[1]![0]! ** 2, b = j[0]![0]! * j[0]![1]! + j[1]![0]! * j[1]![1]!, c = j[0]![1]! ** 2 + j[1]![1]! ** 2;
    const g1 = j[0]![0]! * r[0] + j[1]![0]! * r[1], g2 = j[0]![1]! * r[0] + j[1]![1]! * r[1];
    let improved = false;
    for (let tries = 0; tries < 12 && !improved; tries += 1) {
      const A = a + lambda * (a || 1), C = c + lambda * (c || 1), det = A * C - b * b;
      if (Math.abs(det) < 1e-18) { lambda *= 10; continue; }
      const s1 = -(C * g1 - b * g2) / det, s2 = -(A * g2 - b * g1) / det;
      const n1 = Math.max(-maxDelta, Math.min(maxDelta, d1 + s1)), n2 = Math.max(-maxDelta, Math.min(maxDelta, d2 + s2));
      const nr = residual(n1, n2), ncost = nr[0] ** 2 + nr[1] ** 2;
      if (ncost < cost) { d1 = n1; d2 = n2; r = nr; cost = ncost; lambda = Math.max(1e-7, lambda / 3); improved = true; }
      else lambda *= 4;
    }
    if (!improved) break;
  }
  return { d1, d2, error: Math.sqrt(cost) };
}

const ALIGN_TIE_DEG = 5;

/**
 * 两骨点目标一般有两支肘向解；多起点求解后选「前臂最顺着腕口方向进」的那支，
 * 夹角相差不到 ALIGN_TIE_DEG 时取离上一采样最近的（避免逐帧跳支）。
 */
function solveBranches(residual: (d1: number, d2: number) => [number, number], align: (d1: number, d2: number) => number, maxDelta: number, previous: [number, number] | null) {
  const grid = [-1, -0.5, 0, 0.5, 1].map((k) => k * maxDelta);
  const starts: Array<[number, number]> = [[0, 0], ...(previous ? [previous] : []), ...grid.flatMap((a) => grid.map((b) => [a, b] as [number, number]))];
  const found = starts.map((start) => solve(residual, maxDelta, start));
  const converged = found.filter((item) => item.error <= 1);
  if (!converged.length) return found.reduce((best, item) => item.error < best.error ? item : best);
  const scored = converged.map((item) => ({ ...item, align: align(item.d1, item.d2) }));
  const bestAlign = Math.min(...scored.map((item) => item.align));
  const ref = previous ?? [0, 0];
  return scored.filter((item) => item.align <= bestAlign + ALIGN_TIE_DEG).reduce((best, item) => Math.hypot(item.d1 - ref[0], item.d2 - ref[1]) < Math.hypot(best.d1 - ref[0], best.d2 - ref[1]) ? item : best);
}

function hemisphere(keys: Quaternion[]): Quaternion[] {
  const out: Quaternion[] = [];
  for (const q of keys) {
    const prev = out.at(-1);
    out.push(prev && prev[0] * q[0] + prev[1] * q[1] + prev[2] * q[2] + prev[3] * q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q);
  }
  return out;
}

function bakedTrack(clip: MotionClip, boneId: string, times: number[], values: Quaternion[]): AnyMotionTrack {
  const fixed = hemisphere(values);
  if (clip.schemaVersion === 2) return { targetId: boneId, property: "rotation", keyframes: times.map((time, i) => ({ time, value: fixed[i]!, outInterpolation: i === times.length - 1 ? null : { type: "linear" as const } })) };
  return { targetId: boneId, property: "rotation", interpolation: "linear", keyframes: times.map((time, i) => ({ time, value: fixed[i]! })) };
}

/**
 * 派生加性新 clip：只替换远臂上臂/前臂两条旋转轨（逐采样烘焙「原轨值 × Z(Δ)」），其余轨道原样保留。
 * 支撑手所在 socket 骨骼若是远臂链子孙（手跟着手臂走），改旋转无效，直接拒绝。
 */
export function deriveWristFixClip(document: SkeletalProjectDocument, skeleton: Skeleton, images: Map<string, RgbaImage>, base: MotionClip, newClipId: string, spec: WristFixSpec): WristFixResult {
  if (newClipId === base.id) throw new Error("修腕口必须写新 clip id");
  if (!newClipId.includes("her1")) throw new Error(`新 clip「${newClipId}」不是加性 her1 对象`);
  const chain = descendantBones(skeleton, spec.upperBone);
  if (!chain.has(spec.lowerBone)) throw new Error(`${spec.lowerBone} 不是 ${spec.upperBone} 的子孙骨骼`);
  const probe = composeScene({ document, skeleton, clip: base, time: 0, equipmentIds: spec.equipmentIds });
  const hand = probe.items.find((item) => item.attachmentId === spec.handAttachmentId);
  if (hand && chain.has(hand.boneId)) throw new Error(`支撑手挂在 ${hand.boneId}（远臂链内），随手臂移动；腕口问题不能靠远臂旋转修，需改附件 rest/socket`);
  const diagnostics = [...new Set(probe.diagnostics)];
  const times = sampleTimes(base, spec.step);
  const samples: WristSample[] = [];
  const frames = new Map<number, Frame>();
  let previous: [number, number] | null = null;
  for (const time of times) {
    const scene = composeScene({ document, skeleton, clip: base, time, equipmentIds: spec.equipmentIds });
    const frame = frameAt(scene, images, skeleton, spec);
    if (typeof frame === "string") { samples.push({ time, target: null, before: null, after: null, deltaUpper: 0, deltaLower: 0, alignDeg: null, note: frame }); continue; }
    const residual = (d1: number, d2: number): [number, number] => {
      const p = anchorWorld(document, skeleton, base, time, spec, frame, d1, d2);
      return [p[0] - frame.target[0], p[1] - frame.target[1]];
    };
    const r0 = residual(0, 0);
    const align = (d1: number, d2: number) => alignmentDeg(document, skeleton, base, time, spec, frame, d1, d2);
    const solved = solveBranches(residual, align, spec.maxDelta, previous);
    frames.set(time, frame);
    if (solved.error <= 1) previous = [solved.d1, solved.d2];
    const clamped = Math.max(Math.abs(solved.d1), Math.abs(solved.d2)) >= spec.maxDelta - 1e-9;
    const alignDeg = align(solved.d1, solved.d2);
    const note = solved.error > 1
      ? clamped ? `需要超过 ${spec.maxDelta} rad 的旋转改动才能接上（姿势会明显走样）` : "够不着：远臂长度在该时刻无法把前臂远端送到腕口"
      : alignDeg > MAX_ALIGN_DEG ? `前臂斜着进腕口（夹角 ${alignDeg.toFixed(0)}°）：腕口延伸方向与远臂可达方向不一致，需对着画` : undefined;
    samples.push({ time, target: frame.target, before: Math.hypot(r0[0], r0[1]), after: solved.error, deltaUpper: solved.d1, deltaLower: solved.d2, alignDeg, note });
  }
  const upperValues: Quaternion[] = [], lowerValues: Quaternion[] = [];
  for (const sample of samples) {
    const raw = sampleMotionClip(base, skeleton, sample.time);
    upperValues.push(normalizeQuaternion(multiplyQuaternions(raw.local[spec.upperBone]!.rotation, quaternionFromZRotation(sample.deltaUpper))));
    lowerValues.push(normalizeQuaternion(multiplyQuaternions(raw.local[spec.lowerBone]!.rotation, quaternionFromZRotation(sample.deltaLower))));
  }
  const kept = (base.tracks as AnyMotionTrack[]).filter((track) => !(track.property === "rotation" && (track.targetId === spec.upperBone || track.targetId === spec.lowerBone)));
  const clip = {
    ...structuredClone(base),
    id: newClipId,
    name: newClipId,
    tracks: [...kept, bakedTrack(base, spec.upperBone, times, upperValues), bakedTrack(base, spec.lowerBone, times, lowerValues)],
  } as MotionClip;
  let maxResidual = 0;
  const checkTimes = [...times, ...times.slice(1).map((t, i) => (t + times[i]!) / 2)];
  for (const time of checkTimes) {
    const scene = composeScene({ document, skeleton, clip, time, equipmentIds: spec.equipmentIds });
    const frame = frameAt(scene, images, skeleton, spec);
    if (typeof frame === "string") continue;
    const nearest = [...frames.keys()].reduce<number | null>((best, t) => best === null || Math.abs(t - time) < Math.abs(best - time) ? t : best, null);
    const anchor = nearest === null ? frame.anchorLocal : frames.get(nearest)!.anchorLocal;
    const p = transformPoint(scene.pose.worldMatrices[spec.lowerBone]!, [anchor[0], anchor[1], 0]);
    maxResidual = Math.max(maxResidual, Math.hypot(p[0] - frame.target[0], p[1] - frame.target[1]));
  }
  if (kept.some((track) => track.targetId.startsWith(ATTACHMENT_TARGET_PREFIX) && track.targetId.slice(ATTACHMENT_TARGET_PREFIX.length) === spec.handAttachmentId)) diagnostics.push("基线 clip 对支撑手有 att: 轨，已原样保留");
  return { clip, samples, maxResidual, diagnostics };
}
