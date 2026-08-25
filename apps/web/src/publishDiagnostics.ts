import {
  buildFbanimV3Entries,
  compileActionSet,
  getBoneEndpoint,
  sampleMotionClip,
  sha256Digest,
  validateBodyProfile,
  validateCharacterBinding,
  validateEquipmentDefinition,
  validateLoadout,
  validateMotionClip,
  validateReloadEventOrder,
  validateSkeleton,
  type ActionTemplate,
  type BodyProfile,
  type CharacterBinding,
  type CharacterLoadout,
  type EquipmentDefinition,
  type FbanimEntry,
  type FbanimV3PackageSource,
  type FbanimV3Requirements,
  type MotionClip,
  type SkeletalProjectDocument,
  type Skeleton,
  type TwoBoneIkConstraint,
  type ValidationIssue,
  ikDiagnosticsToIssues,
  validateTwoHandIkSample,
} from "@framebaker/shared";
import { validateActionEvents } from "./actionUiState";

/** Ten-stage publish order (spec). Stages always emit in this sequence. */
export const PUBLISH_STAGE_ORDER = [
  "schema",
  "referenceClosure",
  "loadoutConflict",
  "actionTemplate",
  "fullDurationIk",
  "socketEvent",
  "mirror",
  "runtimeCapability",
  "packageConstruction",
  "fbanimExport",
] as const;

export type PublishStage = (typeof PUBLISH_STAGE_ORDER)[number];
export type PublishSeverity = "error" | "warning";

export interface PublishDiagnostic {
  stage: PublishStage;
  severity: PublishSeverity;
  code: string;
  path: string;
  message: string;
}

export interface PublishInput {
  document: SkeletalProjectDocument;
  skeleton?: Skeleton | null;
  clips: Record<string, MotionClip>;
  /** attachmentId → PNG bytes already loaded (or empty placeholder when only checking presence). */
  textures: Array<{ attachmentId: string; bytes: Uint8Array }>;
  /** Optional prior package entries for version diff. */
  previousEntries?: FbanimEntry[];
  /** Override package tool identity. */
  createdBy?: { name: string; version: string };
  /** Explicit requirements to force (e.g. rejected capabilities). */
  requirementsOverride?: FbanimV3Requirements;
  /** Sample step for full-duration IK (seconds). */
  ikSampleStep?: number;
  /** Optional authoring-layer maps used only when composing publish runtime clips. */
  composition?: {
    stanceActions?: Record<string, string>;
    equipmentOverrides?: Record<string, string>;
    equipmentCorrections?: Record<string, string>;
  };
}

export interface PublishPackageSummary {
  bodyProfiles: string[];
  equipment: string[];
  actions: string[];
  actionProfiles: string[];
  textures: string[];
  constraints: string[];
  loadouts: number;
  requirements: FbanimV3Requirements;
}

export interface PublishVersionDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface PublishReport {
  diagnostics: PublishDiagnostic[];
  errors: PublishDiagnostic[];
  warnings: PublishDiagnostic[];
  canExport: boolean;
  requiresConfirm: boolean;
  summary: PublishPackageSummary;
  versionDiff: PublishVersionDiff | null;
  packageSource: FbanimV3PackageSource | null;
  entries: FbanimEntry[] | null;
}

const REJECTED = new Set(["runtimeWarp", "meshSkinning"]);
const IK_STEP_DEFAULT = 1 / 60;

function diag(
  stage: PublishStage,
  severity: PublishSeverity,
  code: string,
  path: string,
  message: string,
): PublishDiagnostic {
  return { stage, severity, code, path, message };
}

function stageBucket(): Record<PublishStage, PublishDiagnostic[]> {
  return Object.fromEntries(PUBLISH_STAGE_ORDER.map((s) => [s, [] as PublishDiagnostic[]])) as Record<
    PublishStage,
    PublishDiagnostic[]
  >;
}

function flatten(buckets: Record<PublishStage, PublishDiagnostic[]>): PublishDiagnostic[] {
  const out: PublishDiagnostic[] = [];
  for (const stage of PUBLISH_STAGE_ORDER) out.push(...buckets[stage]);
  return out;
}

function requiredTextureIds(binding: CharacterBinding, equipment: readonly EquipmentDefinition[]): Set<string> {
  const ids = new Set(binding.attachments.map((a) => a.id));
  for (const item of equipment) for (const a of item.attachments) ids.add(a.id);
  return ids;
}

function collectConstraints(equipment: readonly EquipmentDefinition[]): Array<{ id: string; constraint: TwoBoneIkConstraint; equipmentId: string }> {
  const out: Array<{ id: string; constraint: TwoBoneIkConstraint; equipmentId: string }> = [];
  for (const item of equipment) {
    const c = item.weapon?.secondaryHandConstraint;
    if (c) out.push({ id: c.id, constraint: c, equipmentId: item.id });
  }
  return out;
}

const IDENTITY_MAT4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
] as const;

function boneById(skeleton: Skeleton, id: string) {
  return skeleton.bones.find((b) => b.id === id);
}

/**
 * Full-duration two-hand IK sampling using primary-grip alignment + secondary
 * target + pure 2D two-bone solver (matches terminal skeletal_constraints.rs).
 */
function sampleIkReach(
  skeleton: Skeleton,
  clip: MotionClip,
  constraint: TwoBoneIkConstraint,
  equipment: EquipmentDefinition,
  body: BodyProfile | undefined,
  duration: number,
  step: number,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const path = `constraints.${constraint.id}`;
  const upperBone = boneById(skeleton, constraint.upperBoneId);
  const lowerBone = boneById(skeleton, constraint.lowerBoneId);
  const endBone = boneById(skeleton, constraint.endBoneId);
  for (const [id, bone] of [
    [constraint.upperBoneId, upperBone],
    [constraint.lowerBoneId, lowerBone],
    [constraint.endBoneId, endBone],
  ] as const) {
    if (!bone) {
      issues.push({ path: `${path}.${id}`, message: `IK 骨骼不存在：${id}` });
      return issues;
    }
  }
  const weapon = equipment.weapon;
  if (!weapon?.primaryGrip || !weapon.secondaryGrip) {
    issues.push({ path, message: "双手 IK 需要 primaryGrip 与 secondaryGrip" });
    return issues;
  }

  const primarySemantic = weapon.preferredPrimaryHand === "left" ? "weapon_hand_left" : "weapon_hand_right";
  const primarySocket = body?.sockets.find((s) => s.semantic === primarySemantic || s.id === primarySemantic)
    ?? body?.sockets.find((s) =>
      weapon.preferredPrimaryHand === "left"
        ? (s.semantic === "hand_left" || s.semantic === "weapon_hand_left")
        : (s.semantic === "hand_right" || s.semantic === "weapon_hand_right")
    );

  const samples = Math.max(1, Math.ceil(Math.max(duration, 0) / step) + 1);
  for (let i = 0; i < samples; i++) {
    const t = Math.min(duration, i * step);
    let pose;
    try {
      pose = sampleMotionClip(clip, skeleton, t);
    } catch {
      issues.push({ path, message: `t=${t.toFixed(4)} 采样失败` });
      continue;
    }

    const upperLocal = pose.local[constraint.upperBoneId];
    const lowerLocal = pose.local[constraint.lowerBoneId];
    const endLocal = pose.local[constraint.endBoneId];
    if (!upperLocal || !lowerLocal || !endLocal) {
      issues.push({ path, message: `t=${t.toFixed(4)} 无法解析 IK 局部变换` });
      continue;
    }

    const upperParentId = upperBone!.parentId;
    const upperParentWorld = upperParentId
      ? pose.worldMatrices[upperParentId] ?? IDENTITY_MAT4
      : IDENTITY_MAT4;

    let primaryHandWorld: number[] = [...IDENTITY_MAT4];
    if (primarySocket) {
      const boneWorld = pose.worldMatrices[primarySocket.boneId];
      if (boneWorld) {
        // socket local rest * bone world ≈ hand world (column-major TRS multiply)
        const rest = primarySocket.rest;
        const rx = rest.rotation;
        const sx = rest.scale;
        const xx = rx[0] * rx[0];
        const yy = rx[1] * rx[1];
        const zz = rx[2] * rx[2];
        const xy = rx[0] * rx[1];
        const xz = rx[0] * rx[2];
        const yz = rx[1] * rx[2];
        const wx = rx[3] * rx[0];
        const wy = rx[3] * rx[1];
        const wz = rx[3] * rx[2];
        const localM = [
          (1 - 2 * (yy + zz)) * sx[0], (2 * (xy + wz)) * sx[0], (2 * (xz - wy)) * sx[0], 0,
          (2 * (xy - wz)) * sx[1], (1 - 2 * (xx + zz)) * sx[1], (2 * (yz + wx)) * sx[1], 0,
          (2 * (xz + wy)) * sx[2], (2 * (yz - wx)) * sx[2], (1 - 2 * (xx + yy)) * sx[2], 0,
          rest.translation[0], rest.translation[1], rest.translation[2], 1,
        ];
        primaryHandWorld = new Array(16).fill(0);
        for (let col = 0; col < 4; col++) {
          for (let row = 0; row < 4; row++) {
            primaryHandWorld[col * 4 + row] =
              boneWorld[row]! * localM[col * 4]!
              + boneWorld[4 + row]! * localM[col * 4 + 1]!
              + boneWorld[8 + row]! * localM[col * 4 + 2]!
              + boneWorld[12 + row]! * localM[col * 4 + 3]!;
          }
        }
      }
    } else {
      // Fall back to end-bone world as primary hand when package sockets missing.
      const endWorld = pose.worldMatrices[constraint.endBoneId];
      if (endWorld) primaryHandWorld = [...endWorld];
      else {
        const tip = getBoneEndpoint(pose, skeleton, constraint.endBoneId);
        if (tip) {
          primaryHandWorld = [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            tip[0], tip[1], tip[2], 1,
          ];
        }
      }
    }

    const result = validateTwoHandIkSample({
      upperRest: upperLocal,
      lowerRest: lowerLocal,
      endRest: endLocal,
      upperParentWorld: [...upperParentWorld],
      primaryHandWorld,
      primaryGrip: weapon.primaryGrip,
      secondaryGrip: weapon.secondaryGrip,
      bendPositive: constraint.bendDirection !== "negative",
      stretch: constraint.stretch,
      maxStretch: constraint.maxStretch,
      mix: constraint.mix,
    });

    if (!result.reached || result.diagnostics.some((d) =>
      d.code === "zero_length_bone"
      || d.code === "nonfinite_target"
      || d.code === "nonfinite_rest"
      || d.code === "nonfinite_result"
      || d.code === "nonfinite_grip"
      || d.code === "singular_grip"
      || d.code === "singular_parent"
      || d.code === "nonfinite_world"
      || d.code === "degenerate_target"
      || d.code === "angle_limit"
    )) {
      const blocking = result.diagnostics.filter((d) =>
        d.code === "unreachable"
        || d.code === "zero_length_bone"
        || d.code === "nonfinite_target"
        || d.code === "nonfinite_rest"
        || d.code === "nonfinite_result"
        || d.code === "nonfinite_grip"
        || d.code === "singular_grip"
        || d.code === "singular_parent"
        || d.code === "nonfinite_world"
        || d.code === "degenerate_target"
        || d.code === "angle_limit"
      );
      if (blocking.length) {
        issues.push(...ikDiagnosticsToIssues(blocking, path, t.toFixed(4)));
        break;
      }
    }
  }
  return issues;
}

export function buildPublishPackageSource(input: PublishInput): FbanimV3PackageSource | null {
  if (!input.skeleton || !input.document.character) return null;
  const binding = input.document.character.binding;
  const templates = input.document.actionTemplates ?? [];
  const templateById = new Map(templates.map((t) => [t.id, t]));
  const composition = input.composition ?? {};
  const actionIds = input.document.animations.map((a) => a.id);
  const baseActions: Record<string, string> = {};
  for (const action of input.document.animations) {
    baseActions[action.id] = action.motionClipId;
    if (action.name !== action.id) baseActions[action.name] = action.motionClipId;
  }
  // Also map template ids that match animation names.
  for (const template of templates) {
    const match = input.document.animations.find((a) => a.id === template.id || a.name === template.id);
    if (match) baseActions[template.id] = match.motionClipId;
  }
  const hasCompositionLayers = Boolean(
    (composition.stanceActions && Object.keys(composition.stanceActions).length)
    || (composition.equipmentOverrides && Object.keys(composition.equipmentOverrides).length)
    || (composition.equipmentCorrections && Object.keys(composition.equipmentCorrections).length),
  );
  const compiledById = new Map(
    hasCompositionLayers
      ? compileActionSet({
          actionIds: actionIds.length ? actionIds : templates.map((t) => t.id),
          clips: input.clips,
          baseActions,
          stanceActions: composition.stanceActions,
          equipmentOverrides: composition.equipmentOverrides,
          equipmentCorrections: composition.equipmentCorrections,
          templates,
        }).actions.map((a) => [a.actionId, a] as const)
      : [],
  );
  const actions = input.document.animations.map((action) => {
    const raw = input.clips[action.motionClipId];
    if (!raw) throw new Error(`缺少动作剪辑：${action.motionClipId}`);
    const composed = compiledById.get(action.id) ?? compiledById.get(action.name);
    const template = templateById.get(action.id) ?? templateById.get(action.name);
    const needsCompose = Boolean(
      composition.stanceActions?.[action.id]
      || composition.stanceActions?.[action.name]
      || composition.equipmentOverrides?.[action.id]
      || composition.equipmentOverrides?.[action.name]
      || composition.equipmentCorrections?.[action.id]
      || composition.equipmentCorrections?.[action.name],
    );
    const motionClip = needsCompose && composed
      ? {
          ...composed.clip,
          id: `runtime:${action.id}`,
          name: action.name,
          skeletonId: raw.skeletonId || composed.clip.skeletonId,
        }
      : raw;
    // Layers are already resolved into motionClip; do not re-attach authoring layers.
    return {
      id: action.id,
      name: action.name,
      motionClip,
      speed: action.speed,
      repeat: action.repeat,
      loop: action.loop,
      ...(template?.fallbackAction ? { fallbackAction: template.fallbackAction } : {}),
    };
  });
  const constraints = collectConstraints(input.document.equipment ?? []).map(({ id, constraint }) => ({
    id,
    constraint,
  }));
  const requirements: FbanimV3Requirements = {
    ...(input.document.runtimePackageSettings?.requiredCapabilities as FbanimV3Requirements | undefined),
    ...input.requirementsOverride,
  };
  return {
    createdBy: input.createdBy ?? { name: "FrameBaker", version: "0.4.0" },
    skeleton: input.skeleton,
    characterBinding: binding,
    bodyProfiles: [...(input.document.bodyProfiles ?? [])],
    equipment: [...(input.document.equipment ?? [])],
    actions,
    actionProfiles: [...templates],
    constraints,
    textures: input.textures.map((t) => ({ attachmentId: t.attachmentId, bytes: t.bytes })),
    requirements: Object.keys(requirements).length ? requirements : undefined,
  };
}

export async function diffPackageEntries(
  current: FbanimEntry[],
  previous: FbanimEntry[],
): Promise<PublishVersionDiff> {
  const cur = new Map(current.map((e) => [e.path, e.bytes]));
  const prev = new Map(previous.map((e) => [e.path, e.bytes]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const path of cur.keys()) {
    if (!prev.has(path)) added.push(path);
    else {
      const a = await sha256Digest(cur.get(path)!);
      const b = await sha256Digest(prev.get(path)!);
      if (a !== b) changed.push(path);
    }
  }
  for (const path of prev.keys()) if (!cur.has(path)) removed.push(path);
  added.sort();
  removed.sort();
  changed.sort();
  return { added, removed, changed };
}

/**
 * Ordered publish diagnostics. Errors block export; warnings require askConfirm.
 * Stage order is exactly the ten stages from the approved publish spec.
 */
export async function collectPublishDiagnostics(input: PublishInput): Promise<PublishReport> {
  const buckets = stageBucket();
  const doc = input.document;
  const skeleton = input.skeleton ?? null;
  const bodyProfiles = doc.bodyProfiles ?? [];
  const equipment = doc.equipment ?? [];
  const loadouts = doc.loadouts ?? [];
  const templates = doc.actionTemplates ?? [];
  const binding = doc.character?.binding ?? null;
  const step = input.ikSampleStep ?? IK_STEP_DEFAULT;

  // 1. Schema validation
  if (!doc.character || !binding) {
    buckets.schema.push(diag("schema", "error", "SCHEMA_MISSING_CHARACTER", "character", "项目尚未组装角色"));
  }
  if (!skeleton) {
    buckets.schema.push(diag("schema", "error", "SCHEMA_MISSING_SKELETON", "skeleton", "缺少骨架资产"));
  } else {
    const sv = validateSkeleton(skeleton);
    if (!sv.ok) {
      for (const issue of sv.issues) {
        buckets.schema.push(diag("schema", "error", "SCHEMA_INVALID_SKELETON", issue.path, issue.message));
      }
    }
  }
  if (binding && skeleton) {
    const bv = validateCharacterBinding(binding, skeleton);
    if (!bv.ok) {
      for (const issue of bv.issues) {
        buckets.schema.push(diag("schema", "error", "SCHEMA_INVALID_BINDING", issue.path, issue.message));
      }
    }
  }
  if (doc.schemaVersion !== 2) {
    buckets.schema.push(diag("schema", "warning", "SCHEMA_VERSION_UNEXPECTED", "schemaVersion", `文档 schemaVersion=${doc.schemaVersion}`));
  }
  for (const profile of bodyProfiles) {
    if (!skeleton) break;
    const r = validateBodyProfile(profile, skeleton);
    if (!r.ok) {
      for (const issue of r.issues) {
        buckets.schema.push(diag("schema", "error", "SCHEMA_INVALID_BODY", `bodyProfiles.${profile.id}.${issue.path}`, issue.message));
      }
    }
  }
  const body0 = bodyProfiles[0];
  for (const item of equipment) {
    if (!body0) {
      buckets.schema.push(diag("schema", "error", "SCHEMA_EQUIPMENT_NEEDS_BODY", `equipment.${item.id}`, "装备需要至少一个 BodyProfile"));
      break;
    }
    const r = validateEquipmentDefinition(item, body0);
    if (!r.ok) {
      for (const issue of r.issues) {
        buckets.schema.push(diag("schema", "error", "SCHEMA_INVALID_EQUIPMENT", `equipment.${item.id}.${issue.path}`, issue.message));
      }
    }
  }
  for (const action of doc.animations) {
    const clip = input.clips[action.motionClipId];
    if (!clip || !skeleton) continue;
    const r = validateMotionClip(clip, skeleton);
    if (!r.ok) {
      for (const issue of r.issues) {
        buckets.schema.push(diag("schema", "error", "SCHEMA_INVALID_CLIP", `animations.${action.id}.${issue.path}`, issue.message));
      }
    }
  }

  // 2. Reference-closure validation
  if (binding && skeleton && binding.skeletonId !== skeleton.id) {
    buckets.referenceClosure.push(diag("referenceClosure", "error", "REF_SKELETON_MISMATCH", "character.binding.skeletonId", "绑定与骨架 ID 不匹配"));
  }
  for (const profile of bodyProfiles) {
    if (skeleton && profile.skeletonId !== skeleton.id) {
      buckets.referenceClosure.push(diag("referenceClosure", "error", "REF_BODY_SKELETON", `bodyProfiles.${profile.id}.skeletonId`, "BodyProfile 骨架引用无效"));
    }
  }
  for (const action of doc.animations) {
    const clip = input.clips[action.motionClipId];
    if (!clip) {
      buckets.referenceClosure.push(diag("referenceClosure", "error", "REF_MISSING_CLIP", `animations.${action.id}.motionClipId`, `缺少动作剪辑 ${action.motionClipId}`));
    } else if (skeleton && clip.skeletonId !== skeleton.id) {
      buckets.referenceClosure.push(diag("referenceClosure", "error", "REF_CLIP_SKELETON", `animations.${action.id}.motionClipId`, "动作剪辑骨架不匹配"));
    }
  }
  if (binding) {
    const required = requiredTextureIds(binding, equipment);
    const have = new Set(input.textures.map((t) => t.attachmentId));
    for (const id of required) {
      if (!have.has(id)) {
        buckets.referenceClosure.push(diag("referenceClosure", "error", "REF_MISSING_TEXTURE", `textures.${id}`, `附件缺少纹理：${id}`));
      }
    }
    for (const t of input.textures) {
      if (!required.has(t.attachmentId)) {
        buckets.referenceClosure.push(diag("referenceClosure", "warning", "REF_EXTRA_TEXTURE", `textures.${t.attachmentId}`, "纹理未引用"));
      }
      if (t.bytes.length < 8 || t.bytes[0] !== 137 || t.bytes[1] !== 80) {
        buckets.referenceClosure.push(diag("referenceClosure", "error", "REF_TEXTURE_NOT_PNG", `textures.${t.attachmentId}`, "纹理不是 PNG"));
      }
    }
  }
  for (const template of templates) {
    for (const eventType of template.requiredEvents) {
      if (!eventType.trim()) {
        buckets.referenceClosure.push(diag("referenceClosure", "error", "REF_TEMPLATE_EVENT", `actionTemplates.${template.id}`, "模板必需事件为空"));
      }
    }
  }

  // 3. Loadout conflict validation
  for (const [index, loadout] of loadouts.entries()) {
    const body = bodyProfiles.find((b) => b.id === loadout.bodyProfileId) ?? body0;
    if (!body) {
      buckets.loadoutConflict.push(diag("loadoutConflict", "error", "LOADOUT_NO_BODY", `loadouts[${index}]`, "试穿缺少 BodyProfile"));
      continue;
    }
    const r = validateLoadout(body, equipment, loadout);
    if (!r.ok) {
      for (const issue of r.issues) {
        buckets.loadoutConflict.push(diag("loadoutConflict", "error", "LOADOUT_CONFLICT", `loadouts[${index}].${issue.path}`, issue.message));
      }
    }
  }

  // 4. Action-template validation
  const templateById = new Map(templates.map((t) => [t.id, t]));
  for (const template of templates) {
    if (!template.id?.trim()) {
      buckets.actionTemplate.push(diag("actionTemplate", "error", "ACTION_TEMPLATE_ID", "actionTemplates", "动作模板 ID 无效"));
    }
    if (template.defaultBlendMs < 0 || !Number.isFinite(template.defaultBlendMs)) {
      buckets.actionTemplate.push(diag("actionTemplate", "error", "ACTION_TEMPLATE_BLEND", `actionTemplates.${template.id}.defaultBlendMs`, "混合毫秒无效"));
    }
    if (template.fallbackAction && !templateById.has(template.fallbackAction) && !doc.animations.some((a) => a.id === template.fallbackAction || a.name === template.fallbackAction)) {
      buckets.actionTemplate.push(diag("actionTemplate", "warning", "ACTION_FALLBACK_MISSING", `actionTemplates.${template.id}.fallbackAction`, `回退动作未定义：${template.fallbackAction}`));
    }
  }
  if (templates.length) {
    const baseActions: Record<string, string> = {};
    for (const template of templates) {
      const match = doc.animations.find((a) => a.name === template.id || a.id === template.id);
      if (match) baseActions[template.id] = match.motionClipId;
      else if (input.clips[`clip-${template.id}`]) baseActions[template.id] = `clip-${template.id}`;
    }
    try {
      const compiled = compileActionSet({
        actionIds: templates.map((t) => t.id),
        clips: input.clips,
        baseActions,
        templates,
      });
      for (const issue of compiled.diagnostics) {
        buckets.actionTemplate.push(diag("actionTemplate", "warning", "ACTION_COMPILE", issue.path, issue.message));
      }
    } catch (e) {
      buckets.actionTemplate.push(diag("actionTemplate", "error", "ACTION_COMPILE_FAILED", "actionTemplates", (e as Error).message));
    }
  }

  // 5. Full-duration IK sampling
  const constraints = collectConstraints(equipment);
  for (const { constraint, equipmentId } of constraints) {
    if (!skeleton) break;
    const item = equipment.find((e) => e.id === equipmentId);
    if (!item) continue;
    const clips = Object.values(input.clips);
    const sampleClips = clips.length ? clips : [];
    if (!sampleClips.length) {
      // Rest-pose only check via empty clip-like sampling at t=0 using a synthetic zero-duration path
      const dummy: MotionClip = {
        schemaVersion: 1,
        kind: "motion-clip",
        id: "_ik-rest",
        name: "rest",
        skeletonId: skeleton.id,
        duration: 0,
        loop: false,
        tracks: [],
        events: [],
      };
      for (const issue of sampleIkReach(skeleton, dummy, constraint, item, body0, 0, step)) {
        buckets.fullDurationIk.push(diag("fullDurationIk", "error", "IK_UNREACHABLE", `equipment.${equipmentId}.${issue.path}`, issue.message));
      }
      continue;
    }
    for (const clip of sampleClips) {
      for (const issue of sampleIkReach(skeleton, clip, constraint, item, body0, clip.duration, step)) {
        buckets.fullDurationIk.push(diag("fullDurationIk", "error", "IK_UNREACHABLE", `equipment.${equipmentId}.${issue.path}`, issue.message));
      }
    }
  }

  // 6. Socket and event validation
  const socketIds = new Set(bodyProfiles.flatMap((b) => b.sockets.map((s) => s.id)));
  for (const item of equipment) {
    for (const [ai, att] of item.attachments.entries()) {
      if (bodyProfiles.length && !socketIds.has(att.socket)) {
        buckets.socketEvent.push(diag("socketEvent", "error", "SOCKET_MISSING", `equipment.${item.id}.attachments[${ai}].socket`, `插座不存在：${att.socket}`));
      }
    }
    for (const [ei, effect] of (item.effectBindings ?? []).entries()) {
      if (effect.socket && bodyProfiles.length && !socketIds.has(effect.socket)) {
        buckets.socketEvent.push(diag("socketEvent", "error", "SOCKET_EFFECT", `equipment.${item.id}.effectBindings[${ei}].socket`, `效果插座不存在：${effect.socket}`));
      }
    }
  }
  for (const action of doc.animations) {
    const clip = input.clips[action.motionClipId];
    if (!clip) continue;
    const template = templates.find((t) => t.id === action.name || t.id === action.id);
    const events = validateActionEvents(clip.events, template);
    for (const issue of events.issues) {
      const severity: PublishSeverity = issue.message.includes("缺少必需") ? "error" : "warning";
      buckets.socketEvent.push(diag("socketEvent", severity, "EVENT_INVALID", `animations.${action.id}.${issue.path}`, issue.message));
    }
    for (const [ei, event] of clip.events.entries()) {
      if (event.type === "weapon.fire") {
        const socket = event.payload && typeof event.payload.socket === "string" ? event.payload.socket : undefined;
        if (!socket) {
          buckets.socketEvent.push(diag("socketEvent", "error", "EVENT_MUZZLE_REQUIRED", `animations.${action.id}.events[${ei}]`, "weapon.fire 需要 muzzle 插座"));
        } else if (bodyProfiles.length && !socketIds.has(socket)) {
          buckets.socketEvent.push(diag("socketEvent", "error", "EVENT_MUZZLE_SOCKET", `animations.${action.id}.events[${ei}].payload.socket`, `枪口插座不存在：${socket}`));
        }
      }
    }
    const reload = validateReloadEventOrder(clip.events);
    for (const issue of reload.issues) {
      buckets.socketEvent.push(diag("socketEvent", "error", "EVENT_RELOAD_ORDER", `animations.${action.id}.${issue.path}`, issue.message));
    }
  }

  // 7. Mirror validation
  for (const profile of bodyProfiles) {
    const sockets = new Map(profile.sockets.map((s) => [s.id, s]));
    for (const socket of profile.sockets) {
      if (socket.mirrorSocketId === undefined) continue;
      const mirror = sockets.get(socket.mirrorSocketId);
      if (!mirror) {
        buckets.mirror.push(diag("mirror", "error", "MIRROR_SOCKET_MISSING", `bodyProfiles.${profile.id}.sockets.${socket.id}`, "镜像插座不存在"));
        continue;
      }
      if (mirror.mirrorSocketId !== undefined && mirror.mirrorSocketId !== socket.id) {
        buckets.mirror.push(diag("mirror", "warning", "MIRROR_ASYMMETRIC", `bodyProfiles.${profile.id}.sockets.${socket.id}`, "镜像配对不对称"));
      }
    }
  }
  for (const item of equipment) {
    if (item.weapon && item.weapon.mirrorAllowed === false && item.weapon.holdMode === "either") {
      buckets.mirror.push(diag("mirror", "warning", "MIRROR_WEAPON_EITHER", `equipment.${item.id}.weapon`, "不可镜像武器声明 either 持握"));
    }
  }

  // 8. Runtime-capability validation
  const reqs: FbanimV3Requirements = {
    ...(doc.runtimePackageSettings?.requiredCapabilities as FbanimV3Requirements | undefined),
    ...input.requirementsOverride,
  };
  for (const key of REJECTED) {
    if (reqs[key as keyof FbanimV3Requirements] !== undefined) {
      buckets.runtimeCapability.push(diag(
        "runtimeCapability",
        "error",
        "CAPABILITY_REJECTED",
        `requirements.${key}`,
        `初始运行时不支持能力：${key}`,
      ));
    }
  }
  for (const [key, version] of Object.entries(reqs)) {
    if (version !== undefined && (!Number.isInteger(version) || version < 1)) {
      buckets.runtimeCapability.push(diag("runtimeCapability", "error", "CAPABILITY_VERSION", `requirements.${key}`, "能力版本必须是正整数"));
    }
  }

  // 9. Deterministic package construction
  let packageSource: FbanimV3PackageSource | null = null;
  let entries: FbanimEntry[] | null = null;
  const blockingBeforeBuild = flatten(buckets).some((d) => d.severity === "error");
  if (!blockingBeforeBuild) {
    try {
      packageSource = buildPublishPackageSource(input);
      if (!packageSource) {
        buckets.packageConstruction.push(diag("packageConstruction", "error", "PACKAGE_SOURCE_NULL", "$", "无法构建包源"));
      } else {
        entries = await buildFbanimV3Entries(packageSource);
        if (!entries.some((e) => e.path === "manifest.json")) {
          buckets.packageConstruction.push(diag("packageConstruction", "error", "PACKAGE_NO_MANIFEST", "manifest.json", "缺少 manifest"));
        }
      }
    } catch (e) {
      buckets.packageConstruction.push(diag("packageConstruction", "error", "PACKAGE_BUILD_FAILED", "package", (e as Error).message));
      packageSource = null;
      entries = null;
    }
  } else {
    buckets.packageConstruction.push(diag("packageConstruction", "error", "PACKAGE_SKIPPED", "package", "存在阻断错误，跳过包构建"));
  }

  // 10. .fbanim export gate
  const preExport = flatten(buckets);
  const errorsSoFar = preExport.filter((d) => d.severity === "error" && d.stage !== "fbanimExport");
  if (errorsSoFar.length) {
    buckets.fbanimExport.push(diag("fbanimExport", "error", "EXPORT_BLOCKED", "export", "存在错误，禁止导出 .fbanim"));
  } else if (!entries) {
    buckets.fbanimExport.push(diag("fbanimExport", "error", "EXPORT_NO_ENTRIES", "export", "无可导出条目"));
  }

  const diagnostics = flatten(buckets);
  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const canExport = errors.length === 0 && !!entries;
  const requiresConfirm = canExport && warnings.length > 0;

  let versionDiff: PublishVersionDiff | null = null;
  if (entries && input.previousEntries) {
    versionDiff = await diffPackageEntries(entries, input.previousEntries);
  }

  const summary: PublishPackageSummary = {
    bodyProfiles: bodyProfiles.map((b) => b.id).sort(),
    equipment: equipment.map((e) => e.id).sort(),
    actions: doc.animations.map((a) => a.id).sort(),
    actionProfiles: templates.map((t) => t.id).sort(),
    textures: input.textures.map((t) => t.attachmentId).sort(),
    constraints: constraints.map((c) => c.id).sort(),
    loadouts: loadouts.length,
    requirements: packageSource
      ? ((entries && JSON.parse(new TextDecoder().decode(entries.find((e) => e.path === "manifest.json")!.bytes)).requirements) as FbanimV3Requirements)
      : reqs,
  };

  return {
    diagnostics,
    errors,
    warnings,
    canExport,
    requiresConfirm,
    summary,
    versionDiff,
    packageSource,
    entries,
  };
}

export function diagnosticsByStage(diagnostics: readonly PublishDiagnostic[]): Record<PublishStage, PublishDiagnostic[]> {
  const buckets = stageBucket();
  for (const d of diagnostics) buckets[d.stage].push(d);
  return buckets;
}

export type { ActionTemplate, CharacterLoadout };
