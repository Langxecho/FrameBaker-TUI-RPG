import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { AnyMotionTrack, MotionClip, Skeleton } from "../../../packages/shared/src/animation";
import type { SkeletalProjectDocument } from "../../../packages/shared/src/skeletalProject";
import { decodePng, type RgbaImage } from "./png";
import { composeScene, isItemVisible } from "./render";
import { descendantBones } from "./seam";

/**
 * 只读快照：ECHO 上导出工程文档 + 骨架 + 某把枪 her1bt 五态 clip + 涉及素材 PNG（+ 可选 ECHO 参考渲染），
 * 提交进仓库后云端可离线渲染、量腕口、求解修复 clip。快照不含任何写操作。
 */
export interface SnapshotManifest {
  schemaVersion: 1;
  createdAt: string;
  projectId: string;
  revision: number;
  gun: string;
  equipmentIds: string[];
  skeletonId: string;
  actions: Array<{ phase: string; actionId: string; motionClipId: string; clipFile: string }>;
  materials: Array<{ materialId: string; file: string; imageSlot: "raw" | "processed"; attachmentIds: string[]; size: [number, number] }>;
  missingMaterials: Array<{ materialId: string; error: string }>;
  renderTool?: { name: string; inputSchema?: unknown };
  references: Array<{ phase: string; time: number; file: string; equipmentId?: string }>;
  notes: string[];
}

export interface LoadedSnapshot {
  dir: string;
  manifest: SnapshotManifest;
  document: SkeletalProjectDocument;
  skeleton: Skeleton;
  clips: Record<string, MotionClip>;
  images: Map<string, RgbaImage>;
}

export const safeFileName = (id: string) => id.replace(/[^A-Za-z0-9._-]/g, "_");

export function clipKeyTimes(clip: MotionClip, extra: number[] = []): number[] {
  const times = [0, clip.duration, ...extra];
  for (const track of clip.tracks as AnyMotionTrack[]) for (const key of track.keyframes) times.push(key.time);
  const sorted = times.filter((t) => t >= 0 && t <= clip.duration + 1e-6).map((t) => Math.round(t * 1000) / 1000).sort((a, b) => a - b);
  return sorted.filter((t, i) => i === 0 || t !== sorted[i - 1]);
}

/** 需要下载的素材：所选装备的全部附件 + 五态任一采样时刻可见的 binding 部件 + 远臂链上全部部件（含当前隐藏的备选件）。 */
export function selectMaterials(document: SkeletalProjectDocument, skeleton: Skeleton, clips: MotionClip[], equipmentIds: string[], farRootBone: string): Map<string, { imageSlot: "raw" | "processed"; attachmentIds: Set<string> }> {
  const out = new Map<string, { imageSlot: "raw" | "processed"; attachmentIds: Set<string> }>();
  const add = (materialId: string, imageSlot: "raw" | "processed", attachmentId: string) => {
    const entry = out.get(materialId) ?? { imageSlot, attachmentIds: new Set<string>() };
    entry.attachmentIds.add(attachmentId);
    out.set(materialId, entry);
  };
  for (const id of equipmentIds) for (const attachment of (document.equipment ?? []).find((item) => item.id === id)?.attachments ?? []) add(attachment.materialId, attachment.imageSlot, attachment.id);
  const binding = document.character?.binding;
  const farBones = skeleton.bones.some((bone) => bone.id === farRootBone) ? descendantBones(skeleton, farRootBone) : new Set<string>();
  for (const slot of binding?.slots ?? []) {
    if (!farBones.has(slot.boneId)) continue;
    const attachment = binding!.attachments.find((item) => item.id === slot.attachmentId);
    if (attachment) add(attachment.materialId, attachment.imageSlot, attachment.id);
  }
  for (const clip of clips) for (const time of clipKeyTimes(clip)) {
    const scene = composeScene({ document, skeleton, clip, time, equipmentIds });
    for (const item of scene.items) if (isItemVisible(item)) add(item.materialId, item.imageSlot, item.attachmentId);
  }
  return out;
}

export function writeJsonFile(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** 快照内相对路径一律用 `/`；ECHO（Windows）旧快照里是 `\`，读取时兼容。 */
export const snapshotPath = (...parts: string[]) => posix.join(...parts.map((part) => part.replace(/\\/g, "/")));

export function loadSnapshot(dir: string): LoadedSnapshot {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as SnapshotManifest;
  const document = JSON.parse(readFileSync(join(dir, "document.json"), "utf8")) as SkeletalProjectDocument;
  const skeleton = JSON.parse(readFileSync(join(dir, "skeleton.json"), "utf8")) as Skeleton;
  for (const action of manifest.actions) action.clipFile = snapshotPath(action.clipFile);
  for (const item of [...manifest.materials, ...manifest.references]) item.file = snapshotPath(item.file);
  const clips: Record<string, MotionClip> = {};
  for (const action of manifest.actions) clips[action.phase] = JSON.parse(readFileSync(join(dir, action.clipFile), "utf8")) as MotionClip;
  const images = new Map<string, RgbaImage>();
  for (const material of manifest.materials) {
    const path = join(dir, material.file);
    if (existsSync(path)) images.set(material.materialId, decodePng(new Uint8Array(readFileSync(path))));
  }
  return { dir, manifest, document, skeleton, clips, images };
}

/** 给离线渲染用的额外 clip（例如修复计划里的新 clip），按 motionClipId 覆盖动作。 */
export function loadPlanClips(planDir: string): MotionClip[] {
  return readdirSync(planDir).filter((name) => name.endsWith(".clip.json")).map((name) => JSON.parse(readFileSync(join(planDir, name), "utf8")) as MotionClip);
}

export function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}
