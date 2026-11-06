import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnyMotionTrack, MotionClip, Vec3 } from "../../../packages/shared/src/animation";
import { ATTACHMENT_TARGET_PREFIX } from "../../../packages/shared/src/animation";
import type { EquipmentAttachment, EquipmentDefinition } from "../../../packages/shared/src/equipment";
import type { SkeletalProjectDocument } from "../../../packages/shared/src/skeletalProject";
import { checkSprite, type ArtTask, type CheckReport } from "./checkArt";
import { assertAdditiveId, type AicOperation } from "./plans";
import { decodePng, type RgbaImage } from "./png";
import { actionIdFor, clipIdFor, type GunKey, type Her1State } from "./state";
import { auditClipVisibility, collectRestScales, type VisibilityIssue } from "./visibility";

/** 多张支撑手按前臂进手角分档：全部 rest 隐藏 0.001，clip 用 att: scale 换显（SHOW 1000 / IDENT 1）。 */
export interface HandSetSprite {
  key: string;
  file: string;
  attachmentId: string;
  nativeSize: [number, number];
  pivot: [number, number];
  /** 腕口切口所在的豁免带 [x0, y0, x1, y1]；收口手为 null。 */
  openBand: [number, number, number, number] | null;
}

export interface HandSet {
  kind: "her1-hand-set";
  version: 1;
  pack: string;
  gun: GunKey;
  snapshotRevision: number;
  baseTag: string;
  tag: string;
  equipmentIds: string[];
  replaceAttachmentId: string;
  baseEquipmentSha: Record<string, string>;
  baseClipSha: Record<string, string>;
  sprites: HandSetSprite[];
  /** 每相位 [起始时刻, 手 key]，按时间升序，首项必须在 0。 */
  schedule: Record<string, Array<[number, string]>>;
  selfQc: { verdict: "PASS" | "FAIL"; summary: string; [key: string]: unknown };
}

const HIDDEN: Vec3 = [0.001, 0.001, 1];
const SHOW: Vec3 = [1000, 1000, 1];
const IDENT: Vec3 = [1, 1, 1];
/** 相邻换手时刻的最小间隔（s）。 */
const MIN_GAP = 0.001;

export const stableSha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function loadHandSet(dir: string): HandSet {
  const set = JSON.parse(readFileSync(join(dir, "handset.json"), "utf8")) as HandSet;
  if (set.kind !== "her1-hand-set" || set.version !== 1) throw new Error("不是 her1-hand-set v1");
  if (set.baseTag === set.tag) throw new Error("新 tag 不能与基线 tag 相同");
  const keys = new Set(set.sprites.map((sprite) => sprite.key));
  if (keys.size !== set.sprites.length) throw new Error("手图 key 重复");
  for (const sprite of set.sprites) {
    assertAdditiveId(sprite.attachmentId);
    if (!existsSync(join(dir, sprite.file))) throw new Error(`缺少手图 ${sprite.file}`);
  }
  for (const [phase, marks] of Object.entries(set.schedule)) {
    if (!marks.length || marks[0]![0] !== 0) throw new Error(`${phase} 换手表必须从 0 开始`);
    marks.forEach(([time, key], i) => {
      if (!keys.has(key)) throw new Error(`${phase} 换手表引用了未知手图 ${key}`);
      if (i > 0 && time - marks[i - 1]![0] < MIN_GAP) throw new Error(`${phase} 换手时刻 ${time} 与前一档相距不足 ${MIN_GAP}s`);
    });
  }
  return set;
}

export function handSetImages(dir: string, set: HandSet): Map<string, RgbaImage> {
  return new Map(set.sprites.map((sprite) => [sprite.key, decodePng(readFileSync(join(dir, sprite.file)))]));
}

/** 按美术包色板与描边规则逐张检查；尺寸与豁免带取手图自己的声明。 */
export function checkHandSet(images: Map<string, RgbaImage>, set: HandSet, task: ArtTask): Array<{ key: string; report: CheckReport }> {
  return set.sprites.map((sprite) => ({
    key: sprite.key,
    report: checkSprite(images.get(sprite.key)!, task, {
      sprite_id: sprite.key,
      sprite_png: sprite.file,
      native_size: sprite.nativeSize,
      rig_size: [sprite.nativeSize[0] * 2, sprite.nativeSize[1] * 2],
      pivot: sprite.pivot,
      ...(sprite.openBand ? { intended_open_edge_band: sprite.openBand } : {}),
    }),
  }));
}

export function handSetEquipment(equipment: EquipmentDefinition, set: HandSet, materials: Record<string, string>): EquipmentDefinition {
  assertAdditiveId(equipment.id);
  const next = structuredClone(equipment);
  const index = next.attachments.findIndex((item) => item.id === set.replaceAttachmentId);
  if (index < 0) throw new Error(`装备「${equipment.id}」没有附件「${set.replaceAttachmentId}」`);
  const base = next.attachments[index]!;
  const parts: EquipmentAttachment[] = set.sprites.map((sprite) => {
    const materialId = materials[sprite.key];
    if (!materialId) throw new Error(`手图 ${sprite.key} 没有素材 id`);
    return { ...structuredClone(base), id: sprite.attachmentId, name: `副握手 ${sprite.key} [her1 ${set.tag}]`, materialId, size: [sprite.nativeSize[0] * 2, sprite.nativeSize[1] * 2], pivot: [...sprite.pivot], rest: { ...structuredClone(base.rest), scale: [...HIDDEN] } };
  });
  next.attachments.splice(index, 1, ...parts);
  return next;
}

/** 阶跃显隐轨：每段起点一个 key，段内保持；末尾补一个 key 让整段有定义。 */
function visibilityTrack(attachmentId: string, clip: MotionClip, segments: Array<[number, boolean]>): AnyMotionTrack {
  const times = segments.map(([start]) => start);
  const values = segments.map(([, on]) => (on ? SHOW : IDENT));
  if (times.at(-1)! < clip.duration) { times.push(clip.duration); values.push(values.at(-1)!); }
  const targetId = `${ATTACHMENT_TARGET_PREFIX}${attachmentId}`;
  if (clip.schemaVersion === 2) return { targetId, property: "scale", keyframes: times.map((time, i) => ({ time, value: [...values[i]!] as Vec3, outInterpolation: i === times.length - 1 ? null : { type: "step" as const } })) };
  return { targetId, property: "scale", interpolation: "step", keyframes: times.map((time, i) => ({ time, value: [...values[i]!] as Vec3 })) };
}

/** 从基线 clip 派生新 tag：去掉旧的支撑手轨，按换手表给用到的手图各加一条显隐轨，其余轨原样。 */
export function handSetClip(base: MotionClip, set: HandSet, phase: string, newClipId: string): MotionClip {
  const marks = set.schedule[phase];
  if (!marks) throw new Error(`换手表缺少相位 ${phase}`);
  const ids = new Set([set.replaceAttachmentId, ...set.sprites.map((sprite) => sprite.attachmentId)].map((id) => `att:${id}`));
  const tracks = (base.tracks as AnyMotionTrack[]).filter((track) => !ids.has(track.targetId));
  for (const sprite of set.sprites) {
    if (!marks.some(([, key]) => key === sprite.key)) continue;
    tracks.push(visibilityTrack(sprite.attachmentId, base, marks.map(([start, key]) => [start, key === sprite.key])));
  }
  return { ...structuredClone(base), id: newClipId, name: `${base.name} · ${set.tag}`, tracks } as MotionClip;
}

export interface HandSetPlan { operations: AicOperation[]; newClips: MotionClip[]; issues: VisibilityIssue[] }

/** 闸门：装备与基线 clip 内容须与自审时的快照逐字节相同、动作仍指向基线 tag；只写 her1 对象。 */
export function planHandSet(document: SkeletalProjectDocument, state: Her1State, set: HandSet, materials: Record<string, string>, baseClips: Record<string, MotionClip>): HandSetPlan {
  const gun = state.guns[set.gun];
  if (state.retiredClipTags[set.tag]) throw new Error(`tag ${set.tag} 已退役：${state.retiredClipTags[set.tag]}`);
  const operations: AicOperation[] = [];
  const equipment: EquipmentDefinition[] = [];
  for (const id of set.equipmentIds) {
    const current = (document.equipment ?? []).find((item) => item.id === id);
    if (!current) throw new Error(`工程中找不到装备 ${id}`);
    if (stableSha(current) !== set.baseEquipmentSha[id]) throw new Error(`装备 ${id} 与自审快照不同；重新快照并重跑自审`);
    equipment.push(handSetEquipment(current, set, materials));
  }
  for (const item of equipment) operations.push({ type: "upsert-equipment", equipment: item });
  const restScales = collectRestScales({ ...document, equipment: [...(document.equipment ?? []).filter((item) => !set.equipmentIds.includes(item.id)), ...equipment] });
  const newClips: MotionClip[] = [];
  const issues: VisibilityIssue[] = [];
  for (const phase of Object.keys(set.schedule)) {
    const baseId = clipIdFor(gun, phase, set.baseTag);
    const base = baseClips[phase];
    if (!base || base.id !== baseId) throw new Error(`缺少基线 clip ${baseId}`);
    if (stableSha(base) !== set.baseClipSha[phase]) throw new Error(`${baseId} 内容与自审快照不同；重新快照并重跑自审`);
    const actionId = actionIdFor(gun, phase);
    const action = document.animations.find((item) => item.id === actionId);
    if (!action) throw new Error(`动作 ${actionId} 不存在`);
    if (action.motionClipId !== baseId) throw new Error(`动作 ${actionId} 当前指向 ${action.motionClipId}，不是 ${baseId}；先 probe 并更新 docs/her1`);
    const clip = handSetClip(base, set, phase, clipIdFor(gun, phase, set.tag));
    issues.push(...auditClipVisibility(clip, restScales, state.visibility));
    newClips.push(clip);
    operations.push({ type: "create-motion-clip", asset: clip });
    operations.push({ type: "upsert-action", action: { id: action.id, name: action.name, motionClipId: clip.id, speed: action.speed, repeat: action.repeat, loop: action.loop } });
  }
  return { operations, newClips, issues };
}
