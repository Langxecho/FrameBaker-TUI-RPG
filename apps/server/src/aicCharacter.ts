import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildFbanimV3Entries,
  getBoneEndpoint,
  migrateSkeletalProjectDocument,
  multiplyMatrices,
  sampleMotionClip,
  sha256Digest,
  transformPoint,
  transformToMatrix,
  upsertMotionKeyframe,
  validateBodyProfile,
  validateCharacterBinding,
  validateEquipmentDefinition,
  validateMotionClip,
  validateSkeleton,
  type AnimationAsset,
  type BodyProfile,
  type CharacterBinding,
  type EquipmentDefinition,
  type FbanimEntry,
  type FbanimV3PackageSource,
  type Mat4,
  type MotionClip,
  type SkeletalProjectDocument,
  type Skeleton,
  type ValidationIssue,
} from "@framebaker/shared";
import { db } from "./db";
import { STORAGE_ROOT } from "./db";
import { createZip } from "../../web/src/zip";

export type AicDiagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  path: string;
  message: string;
  time?: number;
};

export type AicOperation =
  | { type: "create-skeleton"; asset: Skeleton }
  | { type: "create-motion-clip"; asset: MotionClip }
  | { type: "upsert-binding"; binding: CharacterBinding }
  | { type: "upsert-keyframe"; clipId: string; targetId: string; property: "translation" | "rotation" | "scale" | "deform" | "warp"; time: number; value: number[] }
  | { type: "upsert-body-profile"; profile: BodyProfile }
  | { type: "upsert-equipment"; equipment: EquipmentDefinition }
  | { type: "upsert-action"; action: { id: string; name: string; motionClipId: string; speed: number; repeat: number; loop: boolean } }
  | { type: "set-runtime-capabilities"; requiredCapabilities: Record<string, number> };

type ProjectRow = { id: string; kind: string };
type RevisionRow = { document: string; revision: number };
type AssetRow = { id: string; kind: string; data: string; name: string; skeleton_id: string | null };

export class AicError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400, public readonly details?: unknown) {
    super(message);
  }
}

function ensureAicSchema(): void {
  const columns = db.query("PRAGMA table_info(skeletal_projects)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "revision")) db.exec("ALTER TABLE skeletal_projects ADD COLUMN revision INTEGER NOT NULL DEFAULT 0");
  db.exec(`CREATE TABLE IF NOT EXISTS aic_operations (
    project_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    input_hash TEXT NOT NULL,
    result TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, idempotency_key)
  )`);
}

ensureAicSchema();

export const AIC_CAPABILITIES = {
  apiVersion: "aic-fb-01",
  coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "normalized" },
  motionTimeUnit: "seconds",
  transformOrder: "T*R*S",
  attachmentModel: "region",
  supported: ["skeleton", "characterBinding", "bodyProfile", "equipment", "motionClip", "keyframe", "regionRendering", "v3Publish"],
  rejected: ["runtimeWarp", "meshSkinning"],
  notes: ["参考蒙皮只作为编辑器叠加，不是发布蒙皮", "动作语义 ID 由项目文档映射，不猜测注册键"],
} as const;

function projectRow(projectId: string): ProjectRow {
  const row = db.query("SELECT id, kind FROM projects WHERE id = ?").get(projectId) as ProjectRow | null;
  if (!row) throw new AicError("PROJECT_NOT_FOUND", "项目不存在", 404);
  if (row.kind !== "skeletal") throw new AicError("PROJECT_NOT_SKELETAL", "仅骨骼项目支持 AI 角色操作", 409);
  return row;
}

function ensureProjectRow(projectId: string): RevisionRow {
  projectRow(projectId);
  const row = db.query("SELECT document, revision FROM skeletal_projects WHERE project_id = ?").get(projectId) as RevisionRow | null;
  if (row) return row;
  const doc = migrateSkeletalProjectDocument({ schemaVersion: 2, projectId, character: null, animations: [], activeAnimationId: null });
  db.query("INSERT INTO skeletal_projects (project_id, document, updated_at, revision) VALUES (?, ?, ?, 0)").run(projectId, JSON.stringify(doc), Date.now());
  return { document: JSON.stringify(doc), revision: 0 };
}

function parseDocument(projectId: string): { document: SkeletalProjectDocument; revision: number } {
  const row = ensureProjectRow(projectId);
  return { document: migrateSkeletalProjectDocument(JSON.parse(row.document)), revision: row.revision ?? 0 };
}

function assets(): Map<string, AnimationAsset> {
  const rows = db.query("SELECT id, kind, data, name, skeleton_id FROM animation_assets WHERE kind IN ('skeleton', 'motion-clip')").all() as AssetRow[];
  const out = new Map<string, AnimationAsset>();
  for (const row of rows) {
    try { out.set(row.id, JSON.parse(row.data) as AnimationAsset); } catch { /* malformed legacy rows are reported by diagnostics */ }
  }
  return out;
}

function issue(code: string, path: string, message: string, severity: AicDiagnostic["severity"] = "error", time?: number): AicDiagnostic {
  return { severity, code, path, message, ...(time === undefined ? {} : { time }) };
}

function validationIssues(code: string, path: string, issues: ValidationIssue[]): AicDiagnostic[] {
  return issues.slice(0, 24).map((item) => issue(code, `${path}.${item.path}`, item.message));
}

function stateDiagnostics(projectId: string, document: SkeletalProjectDocument, map: Map<string, AnimationAsset>): AicDiagnostic[] {
  const out: AicDiagnostic[] = [];
  const skeletonId = document.character?.binding.skeletonId;
  const skeletonAsset = skeletonId ? map.get(skeletonId) : undefined;
  const skeleton = skeletonAsset?.kind === "skeleton" ? skeletonAsset : undefined;
  if (!document.character) out.push(issue("SCHEMA_MISSING_CHARACTER", "character", "项目尚未组装角色"));
  if (!skeleton || skeleton.kind !== "skeleton") out.push(issue("SCHEMA_MISSING_SKELETON", "character.binding.skeletonId", "角色骨架不存在"));
  else {
    const sv = validateSkeleton(skeleton);
    if (!sv.ok) out.push(...validationIssues("SCHEMA_INVALID_SKELETON", "skeleton", sv.issues));
    if (document.character) {
      const bv = validateCharacterBinding(document.character.binding, skeleton);
      if (!bv.ok) out.push(...validationIssues("SCHEMA_INVALID_BINDING", "character.binding", bv.issues));
      for (const attachment of document.character.binding.attachments) {
        if (!db.query("SELECT id FROM materials WHERE id = ?").get(attachment.materialId)) out.push(issue("REF_MISSING_MATERIAL", `character.binding.attachments.${attachment.id}.materialId`, `素材不存在：${attachment.materialId}`));
        if (attachment.warp) out.push(issue("UNSUPPORTED_RUNTIME_WARP", `character.binding.attachments.${attachment.id}.warp`, "v3 不支持 runtimeWarp", "error"));
      }
    }
  }
  for (const [index, animation] of document.animations.entries()) {
    const clip = map.get(animation.motionClipId);
    if (!clip || clip.kind !== "motion-clip") { out.push(issue("REF_MISSING_CLIP", `animations[${index}].motionClipId`, `动作不存在：${animation.motionClipId}`)); continue; }
    if (!skeleton || skeleton.kind !== "skeleton") continue;
    const cv = validateMotionClip(clip, skeleton);
    if (!cv.ok) out.push(...validationIssues("SCHEMA_INVALID_CLIP", `animations[${index}]`, cv.issues));
    for (const track of clip.tracks) if (track.property === "warp") out.push(issue("UNSUPPORTED_RUNTIME_WARP", `animations.${animation.id}.tracks.${track.targetId}`, "v3 不支持 runtimeWarp"));
  }
  const bodyProfiles = document.bodyProfiles ?? [];
  for (const [index, profile] of bodyProfiles.entries()) {
    if (!skeleton || profile.skeletonId !== skeleton.id) { out.push(issue("REF_BODY_SKELETON", `bodyProfiles[${index}].skeletonId`, "BodyProfile 骨架引用无效")); continue; }
    const pv = validateBodyProfile(profile, skeleton);
    if (!pv.ok) out.push(...validationIssues("SCHEMA_INVALID_BODY", `bodyProfiles[${index}]`, pv.issues));
  }
  const body = bodyProfiles[0];
  for (const [index, equipment] of (document.equipment ?? []).entries()) {
    if (!body || !skeleton) { out.push(issue("REF_EQUIPMENT_BODY", `equipment[${index}]`, "装备缺少 BodyProfile")); continue; }
    const ev = validateEquipmentDefinition(equipment, body);
    if (!ev.ok) out.push(...validationIssues("SCHEMA_INVALID_EQUIPMENT", `equipment[${index}]`, ev.issues));
  }
  const requirements = document.runtimePackageSettings?.requiredCapabilities ?? {};
  for (const key of ["runtimeWarp", "meshSkinning"]) if (requirements[key] !== undefined) out.push(issue("UNSUPPORTED_CAPABILITY", `runtimePackageSettings.requiredCapabilities.${key}`, `${key} 在 v3 中被拒绝`));
  return out.slice(0, 100);
}

function applyOperationState(projectId: string, document: SkeletalProjectDocument, map: Map<string, AnimationAsset>, operation: AicOperation): { changed: string[]; inserted: AnimationAsset[]; updated: AnimationAsset[] } {
  const inserted: AnimationAsset[] = [], updated: AnimationAsset[] = [];
  if (operation.type === "create-skeleton") {
    const result = validateSkeleton(operation.asset);
    if (!result.ok) throw new AicError("INVALID_SKELETON", "骨架无效", 400, result.issues);
    if (map.has(operation.asset.id)) throw new AicError("ASSET_EXISTS", `资产 ID 已存在：${operation.asset.id}`, 409);
    map.set(operation.asset.id, operation.asset); inserted.push(operation.asset);
    return { changed: [`skeleton:${operation.asset.id}`], inserted, updated };
  }
  if (operation.type === "create-motion-clip") {
    const skeleton = map.get(operation.asset.skeletonId);
    if (!skeleton || skeleton.kind !== "skeleton") throw new AicError("MISSING_SKELETON", "动作引用的骨架不存在", 400);
    const result = validateMotionClip(operation.asset, skeleton);
    if (!result.ok) throw new AicError("INVALID_MOTION_CLIP", "MotionClip 无效", 400, result.issues);
    if (map.has(operation.asset.id)) throw new AicError("ASSET_EXISTS", `资产 ID 已存在：${operation.asset.id}`, 409);
    map.set(operation.asset.id, operation.asset); inserted.push(operation.asset);
    return { changed: [`motionClip:${operation.asset.id}`], inserted, updated };
  }
  const skeletonId = document.character?.binding.skeletonId;
  const skeleton = skeletonId ? map.get(skeletonId) : undefined;
  if (operation.type === "upsert-binding") {
    const bindingSkeleton = map.get(operation.binding.skeletonId);
    if (!bindingSkeleton || bindingSkeleton.kind !== "skeleton") throw new AicError("MISSING_SKELETON", "绑定引用的骨架不存在", 400);
    const result = validateCharacterBinding(operation.binding, bindingSkeleton);
    if (!result.ok) throw new AicError("INVALID_BINDING", "CharacterBinding 无效", 400, result.issues);
    document.character = { binding: operation.binding };
    return { changed: ["character.binding"], inserted, updated };
  }
  if (operation.type === "upsert-keyframe") {
    const clip = map.get(operation.clipId);
    if (!clip || clip.kind !== "motion-clip") throw new AicError("MISSING_MOTION_CLIP", "动作片段不存在", 404);
    if (!skeleton || skeleton.kind !== "skeleton") throw new AicError("MISSING_SKELETON", "动作所属骨架不存在", 400);
    if (!Number.isFinite(operation.time) || operation.time < 0 || operation.time > clip.duration) throw new AicError("INVALID_TIME", "关键帧时间必须位于动作秒数范围内", 400);
    const next = upsertMotionKeyframe(clip, operation.targetId, operation.property, operation.time, operation.value);
    const result = validateMotionClip(next, skeleton);
    if (!result.ok) throw new AicError("INVALID_MOTION_CLIP", "写入关键帧后动作无效", 400, result.issues);
    map.set(next.id, next); updated.push(next);
    return { changed: [`motionClip:${next.id}`, `track:${operation.targetId}:${operation.property}`], inserted, updated };
  }
  if (operation.type === "upsert-body-profile") {
    if (!skeleton || skeleton.kind !== "skeleton") throw new AicError("MISSING_SKELETON", "BodyProfile 所属骨架不存在", 400);
    const result = validateBodyProfile(operation.profile, skeleton);
    if (!result.ok) throw new AicError("INVALID_BODY_PROFILE", "BodyProfile 无效", 400, result.issues);
    document.bodyProfiles = [...(document.bodyProfiles ?? []).filter((item) => item.id !== operation.profile.id), operation.profile];
    return { changed: [`bodyProfile:${operation.profile.id}`], inserted, updated };
  }
  if (operation.type === "upsert-equipment") {
    const body = (document.bodyProfiles ?? []).find((item) => item.slots.some((slot) => slot.id === operation.equipment.primarySlot));
    if (!body) throw new AicError("MISSING_BODY_PROFILE", "装备引用的 BodyProfile 不存在", 400);
    const result = validateEquipmentDefinition(operation.equipment, body);
    if (!result.ok) throw new AicError("INVALID_EQUIPMENT", "装备定义无效", 400, result.issues);
    document.equipment = [...(document.equipment ?? []).filter((item) => item.id !== operation.equipment.id), operation.equipment];
    return { changed: [`equipment:${operation.equipment.id}`], inserted, updated };
  }
  if (operation.type === "upsert-action") {
    const clip = map.get(operation.action.motionClipId);
    if (!clip || clip.kind !== "motion-clip") throw new AicError("MISSING_MOTION_CLIP", "动作映射引用的 MotionClip 不存在", 404);
    if (!Number.isFinite(operation.action.speed) || operation.action.speed <= 0 || operation.action.speed > 8 || !Number.isInteger(operation.action.repeat) || operation.action.repeat < 1 || operation.action.repeat > 100 || !operation.action.id.trim() || !operation.action.name.trim()) throw new AicError("INVALID_ACTION", "动作映射字段无效", 400);
    document.animations = [...document.animations.filter((item) => item.id !== operation.action.id), operation.action];
    if (document.activeAnimationId === null) document.activeAnimationId = operation.action.id;
    return { changed: [`action:${operation.action.id}`], inserted, updated };
  }
  if (operation.type === "set-runtime-capabilities") {
    document.runtimePackageSettings = { requiredCapabilities: { ...operation.requiredCapabilities } };
    return { changed: ["runtimePackageSettings.requiredCapabilities"], inserted, updated };
  }
  throw new AicError("UNKNOWN_OPERATION", "不支持的 AIC 操作", 400);
}

function persistAsset(asset: AnimationAsset, projectId: string): void {
  const now = Date.now();
  db.query("INSERT INTO animation_assets (id, kind, name, skeleton_id, folder_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)").run(asset.id, asset.kind, asset.name, asset.kind === "motion-clip" ? asset.skeletonId : null, JSON.stringify(asset), now, now);
}

export async function applyAicOperations(projectId: string, baseRevision: number, idempotencyKey: string, operations: AicOperation[]): Promise<unknown> {
  if (!Number.isInteger(baseRevision) || baseRevision < 0) throw new AicError("INVALID_REVISION", "baseRevision 必须是非负整数");
  if (!idempotencyKey || idempotencyKey.length > 200) throw new AicError("INVALID_IDEMPOTENCY_KEY", "幂等键不能为空且不超过 200 字符");
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 64) throw new AicError("INVALID_OPERATIONS", "operations 数量须为 1..64");
  const inputHash = await sha256Digest(new TextEncoder().encode(JSON.stringify({ baseRevision, operations })));
  const output = db.transaction(() => {
    const existing = db.query("SELECT input_hash, result FROM aic_operations WHERE project_id = ? AND idempotency_key = ?").get(projectId, idempotencyKey) as { input_hash: string; result: string } | null;
    if (existing) {
      if (existing.input_hash !== inputHash) throw new AicError("IDEMPOTENCY_CONFLICT", "幂等键已用于另一组输入", 409);
      return JSON.parse(existing.result);
    }
    const current = parseDocument(projectId);
    if (current.revision !== baseRevision) throw new AicError("REVISION_CONFLICT", `项目 revision 已是 ${current.revision}`, 409, { currentRevision: current.revision });
    const map = assets();
    const changed = new Set<string>();
    const inserted: AnimationAsset[] = [], updated: AnimationAsset[] = [];
    for (const operation of operations) {
      const result = applyOperationState(projectId, current.document, map, operation);
      result.changed.forEach((item) => changed.add(item)); inserted.push(...result.inserted); updated.push(...result.updated);
    }
    const diagnostics = stateDiagnostics(projectId, current.document, map);
    // Skeleton/clip authoring is intentionally staged: an empty project may be valid between
    // create-skeleton and upsert-binding operations. Referential and schema errors still abort.
    const errors = diagnostics.filter((item) => item.severity === "error" && item.code !== "SCHEMA_MISSING_CHARACTER" && item.code !== "SCHEMA_MISSING_SKELETON");
    if (errors.length) throw new AicError("INVALID_PROJECT_STATE", "操作后项目未通过结构校验", 400, errors.slice(0, 24));
    for (const asset of inserted) persistAsset(asset, projectId);
    for (const asset of updated) db.query("UPDATE animation_assets SET name = ?, data = ?, updated_at = ? WHERE id = ?").run(asset.name, JSON.stringify(asset), Date.now(), asset.id);
    const revision = current.revision + 1;
    db.query("UPDATE skeletal_projects SET document = ?, revision = ?, updated_at = ? WHERE project_id = ? AND revision = ?").run(JSON.stringify(current.document), revision, Date.now(), projectId, current.revision);
    const result = { projectId, revision, changed: [...changed], diagnostics: diagnostics.filter((item) => item.severity !== "error").slice(0, 24) };
    db.query("INSERT INTO aic_operations (project_id, idempotency_key, input_hash, result, created_at) VALUES (?, ?, ?, ?, ?)").run(projectId, idempotencyKey, inputHash, JSON.stringify(result), Date.now());
    return result;
  })();
  return output;
}

type AicSummaryFilter = {
  boneId?: string;
  attachmentId?: string;
  actionId?: string;
  targetId?: string;
  startTime?: number;
  endTime?: number;
  boneOffset?: number;
  boneLimit?: number;
  attachmentOffset?: number;
  attachmentLimit?: number;
};

const AIC_PAGE_DEFAULT = 64;
const AIC_PAGE_MAX = 256;
const AIC_POSE_SELECTION_MAX = 128;

function boundedPage(value: number | undefined, fallback: number, name: string, max = AIC_PAGE_MAX): number {
  const result = value === undefined ? fallback : value;
  if (!Number.isInteger(result) || result < 0 || result > max) throw new AicError("INVALID_QUERY", `${name} 必须是 0-${max} 的整数`, 400);
  return result;
}

function boundedSelection(values: string[] | undefined, name: string): string[] | undefined {
  if (values === undefined) return undefined;
  if (values.length > AIC_POSE_SELECTION_MAX) throw new AicError("POSE_BUDGET_EXCEEDED", `${name} 最多 ${AIC_POSE_SELECTION_MAX} 项`, 400);
  const seen = new Set<string>();
  for (const value of values) {
    if (!value || seen.has(value)) throw new AicError("INVALID_POSE_SELECTION", `${name} 含空值或重复 ID`, 400);
    seen.add(value);
  }
  return values;
}

export function getAicSummary(projectId: string, filter?: AicSummaryFilter): unknown {
  const { document, revision } = parseDocument(projectId);
  const map = assets();
  const boundSkeletonId = document.character?.binding.skeletonId;
  const skeleton = boundSkeletonId ? map.get(boundSkeletonId) : undefined;
  const boneOffset = boundedPage(filter?.boneOffset, 0, "boneOffset", 4096);
  const boneLimit = boundedPage(filter?.boneLimit, AIC_PAGE_DEFAULT, "boneLimit");
  const attachmentOffset = boundedPage(filter?.attachmentOffset, 0, "attachmentOffset", 4096);
  const attachmentLimit = boundedPage(filter?.attachmentLimit, AIC_PAGE_DEFAULT, "attachmentLimit");
  const allBones = skeleton?.kind === "skeleton" ? skeleton.bones.filter((bone) => !filter?.boneId || bone.id === filter.boneId).map((bone) => ({ id: bone.id, name: bone.name, parentId: bone.parentId, semantic: bone.semantic, rest: bone.rest })) : [];
  const bones = allBones.slice(boneOffset, boneOffset + boneLimit);
  const allAttachments = document.character?.binding.attachments.filter((attachment) => !filter?.attachmentId || attachment.id === filter.attachmentId).map((attachment) => ({ id: attachment.id, name: attachment.name, type: attachment.type, materialId: attachment.materialId, boneId: document.character!.binding.slots.find((slot) => slot.attachmentId === attachment.id)?.boneId ?? null, rest: attachment.rest })) ?? [];
  const attachments = allAttachments.slice(attachmentOffset, attachmentOffset + attachmentLimit);
  const actions = document.animations.filter((action) => !filter?.actionId || action.id === filter.actionId || action.name === filter.actionId).map((action) => {
    const clip = map.get(action.motionClipId);
    if (!clip || clip.kind !== "motion-clip") return { ...action, missing: true };
    const wantsTrackDetail = filter?.targetId !== undefined || filter?.startTime !== undefined || filter?.endTime !== undefined;
    const tracks = clip.tracks.filter((track) => (!filter?.targetId || track.targetId === filter.targetId) && (!wantsTrackDetail || track.keyframes.some((key) => (filter?.startTime === undefined || key.time >= filter.startTime) && (filter?.endTime === undefined || key.time <= filter.endTime)))).map((track) => wantsTrackDetail ? { ...track, keyframes: track.keyframes.filter((key) => (filter?.startTime === undefined || key.time >= filter.startTime!) && (filter?.endTime === undefined || key.time <= filter.endTime!)) } : undefined);
    return { id: action.id, name: action.name, motionClipId: clip.id, duration: clip.duration, speed: action.speed, repeat: action.repeat, loop: action.loop, clipLoop: clip.loop, trackCount: clip.tracks.length, ...(wantsTrackDetail ? { tracks: tracks.filter(Boolean) } : {}) };
  });
  return { projectId, revision, coordinateSystem: skeleton?.kind === "skeleton" ? skeleton.coordinateSystem : AIC_CAPABILITIES.coordinateSystem, motionTimeUnit: "seconds", skeleton: skeleton?.kind === "skeleton" ? { id: skeleton.id, name: skeleton.name, boneCount: allBones.length, boneOffset, boneLimit, bones, bonesTruncated: boneOffset + bones.length < allBones.length } : null, binding: document.character ? { skeletonId: document.character.binding.skeletonId, attachmentCount: allAttachments.length, attachmentOffset, attachmentLimit, attachments, attachmentsTruncated: attachmentOffset + attachments.length < allAttachments.length } : null, bodyProfiles: (document.bodyProfiles ?? []).map((profile) => ({ id: profile.id, name: profile.name, skeletonId: profile.skeletonId, slotCount: profile.slots.length })), equipment: (document.equipment ?? []).map((item) => ({ id: item.id, name: item.name, primarySlot: item.primarySlot })), actions, diagnostics: stateDiagnostics(projectId, document, map).slice(0, 24) };
}

export function sampleAicPose(projectId: string, options: { actionId: string; timeSeconds: number; boneIds?: string[]; socketIds?: string[]; bodyProfileId?: string }): unknown {
  if (!options.actionId || !Number.isFinite(options.timeSeconds) || options.timeSeconds < 0) throw new AicError("INVALID_POSE_QUERY", "actionId 必须有效，timeSeconds 必须是非负有限数值", 400);
  const requestedBoneIds = boundedSelection(options.boneIds, "boneIds");
  const requestedSocketIds = boundedSelection(options.socketIds, "socketIds") ?? [];
  const { document, revision } = parseDocument(projectId);
  const map = assets();
  const character = document.character;
  const skeletonId = character?.binding.skeletonId;
  const skeleton = skeletonId ? map.get(skeletonId) : undefined;
  if (!skeleton || skeleton.kind !== "skeleton") throw new AicError("POSE_MISSING_SKELETON", "采样需要角色绑定的骨架", 409);
  const exactAction = document.animations.find((item) => item.id === options.actionId);
  const namedActions = document.animations.filter((item) => item.name === options.actionId);
  const action = exactAction ?? (namedActions.length === 1 ? namedActions[0] : undefined);
  const actionResolvedBy = exactAction ? "id" : "name";
  if (!action && namedActions.length > 1) throw new AicError("POSE_ACTION_AMBIGUOUS", `动作名称不唯一，请使用 actionId：${options.actionId}`, 400);
  if (!action) throw new AicError("POSE_ACTION_NOT_FOUND", `动作不存在：${options.actionId}`, 404);
  const clip = map.get(action.motionClipId);
  if (!clip || clip.kind !== "motion-clip") throw new AicError("POSE_CLIP_NOT_FOUND", `动作剪辑不存在：${action.motionClipId}`, 409);
  const boneIds = requestedBoneIds ?? skeleton.bones.slice(0, AIC_PAGE_DEFAULT).map((bone) => bone.id);
  const boneMap = new Map(skeleton.bones.map((bone) => [bone.id, bone]));
  for (const boneId of boneIds) if (!boneMap.has(boneId)) throw new AicError("POSE_UNKNOWN_BONE", `骨骼不存在：${boneId}`, 400);
  const profiles = (document.bodyProfiles ?? []).filter((profile) => profile.skeletonId === skeleton.id);
  if (options.bodyProfileId !== undefined && !profiles.some((profile) => profile.id === options.bodyProfileId)) throw new AicError("POSE_UNKNOWN_BODY_PROFILE", `BodyProfile 不存在：${options.bodyProfileId}`, 400);
  if (requestedSocketIds.length && options.bodyProfileId === undefined && profiles.length > 1) throw new AicError("POSE_BODY_PROFILE_REQUIRED", "多个 BodyProfile 存在时查询 socket 必须指定 bodyProfileId", 400);
  const selectedProfiles = options.bodyProfileId === undefined ? profiles : profiles.filter((profile) => profile.id === options.bodyProfileId);
  const socketMap = new Map(selectedProfiles.flatMap((profile) => profile.sockets).map((socket) => [socket.id, socket]));
  for (const socketId of requestedSocketIds) if (!socketMap.has(socketId)) throw new AicError("POSE_UNKNOWN_SOCKET", `插槽不存在：${socketId}`, 400);
  const scaledActionTime = options.timeSeconds * action.speed;
  const duration = clip.duration;
  const totalDuration = duration * action.repeat;
  const clipTimeSeconds = action.loop
    ? (duration > 0 ? ((scaledActionTime % duration) + duration) % duration : 0)
    : (scaledActionTime >= totalDuration ? duration : duration > 0 ? ((scaledActionTime % duration) + duration) % duration : 0);
  // Action loop/repeat define playback lifetime. clip.loop is authoring metadata only here:
  // clipTimeSeconds is already resolved per action cycle, and final finite playback must sample
  // the duration endpoint instead of allowing a looping clip to wrap back to zero.
  const samplingClip = clip.loop ? { ...clip, loop: false } as MotionClip : clip;
  const pose = sampleMotionClip(samplingClip, skeleton, clipTimeSeconds, character?.binding.boneRotationOffsets);
  const bones = boneIds.map((boneId) => {
    const bone = boneMap.get(boneId)!;
    return { id: bone.id, parentId: bone.parentId, local: pose.local[bone.id], worldMatrix: pose.worldMatrices[bone.id], tip: getBoneEndpoint(pose, skeleton, bone.id) };
  });
  const sockets = requestedSocketIds.map((socketId) => {
    const socket = socketMap.get(socketId)!;
    const boneWorld = pose.worldMatrices[socket.boneId];
    if (!boneWorld) throw new AicError("POSE_SOCKET_BONE_MISSING", `插槽骨骼不存在：${socket.boneId}`, 409);
    const worldMatrix = multiplyMatrices(boneWorld, transformToMatrix(socket.rest)) as Mat4;
    return { id: socket.id, boneId: socket.boneId, semantic: socket.semantic, worldMatrix, position: transformPoint(worldMatrix, [0, 0, 0]) };
  });
  return { projectId, revision, action: { id: action.id, name: action.name, resolvedBy: actionResolvedBy, motionClipId: clip.id, duration: clip.duration, loop: action.loop, speed: action.speed, repeat: action.repeat }, clip: { id: clip.id, duration: clip.duration, loop: clip.loop }, coordinateSystem: skeleton.coordinateSystem, timeSeconds: pose.time, requestedTimeSeconds: options.timeSeconds, scaledActionTimeSeconds: scaledActionTime, clipTimeSeconds, playback: { loop: action.loop, repeat: action.repeat, ended: !action.loop && scaledActionTime >= totalDuration }, skeleton: { id: skeleton.id, boneCount: skeleton.bones.length }, bones, sockets, bodyProfileId: options.bodyProfileId ?? (selectedProfiles.length === 1 ? selectedProfiles[0]!.id : undefined), bonesTruncated: requestedBoneIds === undefined && boneIds.length < skeleton.bones.length };
}

export function getAicDiagnostics(projectId: string): { projectId: string; revision: number; diagnostics: AicDiagnostic[] } {
  const { document, revision } = parseDocument(projectId);
  return { projectId, revision, diagnostics: stateDiagnostics(projectId, document, assets()) };
}

function projectPackageSource(projectId: string, document: SkeletalProjectDocument): FbanimV3PackageSource {
  const map = assets();
  const skeleton = document.character?.binding.skeletonId ? map.get(document.character.binding.skeletonId) : undefined;
  if (!skeleton || skeleton.kind !== "skeleton" || !document.character) throw new AicError("PUBLISH_MISSING_CHARACTER", "发布需要角色绑定和骨架", 400);
  const clips: Record<string, MotionClip> = {};
  const actions = document.animations.map((action) => {
    const clip = map.get(action.motionClipId);
    if (!clip || clip.kind !== "motion-clip") throw new AicError("PUBLISH_MISSING_CLIP", `发布缺少动作剪辑：${action.motionClipId}`, 400);
    clips[clip.id] = clip;
    return { id: action.id, name: action.name, motionClip: clip, speed: action.speed, repeat: action.repeat, loop: action.loop };
  });
  const attachmentSources = [...document.character.binding.attachments];
  const seenAttachmentIds = new Set(attachmentSources.map((attachment) => attachment.id));
  for (const item of document.equipment ?? []) for (const attachment of item.attachments ?? []) {
    if (seenAttachmentIds.has(attachment.id)) continue;
    seenAttachmentIds.add(attachment.id);
    attachmentSources.push({ id: attachment.id, name: attachment.name, type: "region", materialId: attachment.materialId, imageSlot: attachment.imageSlot, size: attachment.size, pivot: attachment.pivot, rest: attachment.rest });
  }
  const textures = attachmentSources.map((attachment) => {
    const material = db.query("SELECT processed_path, raw_path FROM materials WHERE id = ?").get(attachment.materialId) as { processed_path: string | null; raw_path: string | null } | null;
    const requestedPath = attachment.imageSlot === "processed" ? material?.processed_path : material?.raw_path;
    const path = requestedPath && existsSync(requestedPath) ? requestedPath : null;
    if (!path) throw new AicError("PUBLISH_MISSING_TEXTURE", `发布缺少纹理：${attachment.materialId}（${attachment.imageSlot}）`, 400);
    return { attachmentId: attachment.id, bytes: new Uint8Array(readFileSync(path)) };
  });
  return { createdBy: { name: "FrameBaker", version: "0.4.0" }, skeleton, characterBinding: document.character.binding, bodyProfiles: [...(document.bodyProfiles ?? [])], equipment: [...(document.equipment ?? [])], actions, actionProfiles: [...(document.actionTemplates ?? [])], constraints: [], textures, requirements: document.runtimePackageSettings?.requiredCapabilities };
}

export async function publishAicV3(projectId: string): Promise<unknown> {
  const diagnostics = getAicDiagnostics(projectId);
  if (diagnostics.diagnostics.some((item) => item.severity === "error")) throw new AicError("PUBLISH_BLOCKED", "诊断包含错误，已阻止 v3 发布", 409, diagnostics);
  const frozen = parseDocument(projectId);
  let entries: FbanimEntry[];
  try { entries = await buildFbanimV3Entries(projectPackageSource(projectId, frozen.document)); } catch (error) { throw new AicError("PUBLISH_FAILED", (error as Error).message, 400); }
  const latest = parseDocument(projectId);
  if (latest.revision !== frozen.revision) throw new AicError("REVISION_CONFLICT", "发布期间项目 revision 已变化，请重试", 409, { currentRevision: latest.revision, publishedRevision: frozen.revision });
  const zipBlob = await createZip(entries.map((entry) => ({ name: entry.path, data: entry.bytes })));
  const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());
  const digest = await sha256Digest(zipBytes);
  const digestPart = digest.slice("sha256:".length);
  const dir = join(STORAGE_ROOT, "aic-published");
  mkdirSync(dir, { recursive: true });
  const artifactPath = join(dir, `${digestPart}.fbanim`);
  if (!existsSync(artifactPath)) writeFileSync(artifactPath, zipBytes);
  const manifestBytes = entries.find((entry) => entry.path === "manifest.json")?.bytes;
  const manifest = manifestBytes ? JSON.parse(new TextDecoder().decode(manifestBytes)) : null;
  return { projectId, revision: frozen.revision, artifactId: digest, digest, byteLength: zipBytes.length, downloadPath: `/api/aic-artifacts/${digestPart}.fbanim`, manifest, entries: await Promise.all(entries.map(async (entry) => ({ path: entry.path, byteLength: entry.bytes.length, digest: await sha256Digest(entry.bytes) }))), entryCount: entries.length };
}
