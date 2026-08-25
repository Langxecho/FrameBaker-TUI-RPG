import {
  validateCharacterBinding,
  validateMotionClip,
  validateSkeleton,
  type CharacterBinding,
  type MotionClip,
  type Skeleton,
  type ValidationIssue,
  type ValidationResult,
} from "./animation";
import type { FbanimEntry, FbanimLimits, FbanimToolIdentity, Sha256Digest } from "./animationPackage";
import {
  FBANIM_V2_LIMITS,
  type FbanimV2PackageSource,
} from "./animationPackageV2";
import { compileActionSet } from "./actionComposition";
import {
  validateBodyProfile,
  validateEquipmentDefinition,
  type ActionTemplate,
  type BodyProfile,
  type EquipmentDefinition,
  type TwoBoneIkConstraint,
} from "./equipment";
import { canonicalizeJson, parseCanonicalJson, sha256Digest, type JsonObject } from "./json";

export const FBANIM_V3_FORMAT = "fbanim" as const;
export const FBANIM_V3_VERSION = 3 as const;
export const FBANIM_V3_LIMITS: FbanimLimits = { ...FBANIM_V2_LIMITS };

export type FbanimV3Capability =
  | "regionRendering"
  | "equipmentAssembly"
  | "motionEvents"
  | "twoBoneIk"
  | "runtimeWarp"
  | "meshSkinning";

export type FbanimV3Requirements = Partial<Record<FbanimV3Capability, number>>;

export interface FbanimV3FileDescriptor { path: string; digest: Sha256Digest; byteLength: number }
export interface FbanimV3NamedFile extends FbanimV3FileDescriptor { id: string }
export interface FbanimV3Action extends FbanimV3FileDescriptor {
  id: string;
  name: string;
  motionClipId: string;
  speed: number;
  repeat: number;
  loop: boolean;
  /** Declared missing-action fallback; optional for backward compatibility. */
  fallbackAction?: string;
  dependencies: { skeletonId: string };
}
export interface FbanimV3Texture extends FbanimV3FileDescriptor { attachmentId: string }
export interface FbanimManifestV3 {
  format: typeof FBANIM_V3_FORMAT;
  version: typeof FBANIM_V3_VERSION;
  createdBy: FbanimToolIdentity;
  requirements: FbanimV3Requirements;
  entry: {
    skeleton: FbanimV3NamedFile;
    characterBinding: FbanimV3NamedFile & { dependencies: { skeletonId: string } };
    bodyProfiles: FbanimV3NamedFile[];
    equipment: FbanimV3NamedFile[];
    actions: FbanimV3Action[];
    actionProfiles: FbanimV3NamedFile[];
    constraints: FbanimV3NamedFile[];
    textures: FbanimV3Texture[];
  };
}

export interface FbanimV3ActionSource {
  id: string;
  name: string;
  /** Base (or already-composed) motion clip. */
  motionClip: MotionClip;
  speed: number;
  repeat: number;
  loop: boolean;
  /** Optional authoring layers; package build composes them into runtime motion. */
  stanceClip?: MotionClip;
  equipmentClip?: MotionClip;
  correctionClip?: MotionClip;
  fallbackAction?: string;
}
export interface FbanimV3TextureSource { attachmentId: string; bytes: Uint8Array }
export interface FbanimV3ConstraintSource { id: string; constraint: TwoBoneIkConstraint }
export interface FbanimV3PackageSource {
  createdBy: FbanimToolIdentity;
  skeleton: Skeleton;
  characterBinding: CharacterBinding;
  bodyProfiles: BodyProfile[];
  equipment: EquipmentDefinition[];
  actions: FbanimV3ActionSource[];
  actionProfiles: ActionTemplate[];
  constraints: FbanimV3ConstraintSource[];
  textures: FbanimV3TextureSource[];
  requirements?: FbanimV3Requirements;
}

export interface VerifiedFbanimV3Package {
  manifest: FbanimManifestV3;
  manifestDigest: Sha256Digest;
  skeleton: Skeleton;
  characterBinding: CharacterBinding;
  bodyProfiles: BodyProfile[];
  equipment: EquipmentDefinition[];
  actions: Array<{
    id: string;
    name: string;
    motionClip: MotionClip;
    speed: number;
    repeat: number;
    loop: boolean;
    fallbackAction?: string;
  }>;
  actionProfiles: ActionTemplate[];
  constraints: FbanimV3ConstraintSource[];
  textures: FbanimV3TextureSource[];
}

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const JSON_PATH = /^(skeletons|bindings|body-profiles|equipment|motions|action-profiles|constraints)\/[a-f0-9]{64}\.json$/;
const PNG_PATH = /^textures\/[a-f0-9]{64}\.png$/;
const pngSignature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const enc = new TextEncoder();
const compareCodeUnits = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const record = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const REJECTED_CAPABILITIES = new Set<FbanimV3Capability>(["runtimeWarp", "meshSkinning"]);
const CAPABILITY_KEYS: FbanimV3Capability[] = [
  "regionRendering",
  "equipmentAssembly",
  "motionEvents",
  "twoBoneIk",
  "runtimeWarp",
  "meshSkinning",
];

function unknown(v: Record<string, unknown>, keys: string[], path: string, out: ValidationIssue[]) {
  const allowed = new Set(keys);
  for (const k of Object.keys(v)) if (!allowed.has(k)) out.push({ path: `${path}.${k}`, message: "未知字段" });
}

function validFile(v: unknown, path: string, pattern: RegExp, limits: FbanimLimits, out: ValidationIssue[]): v is Record<string, unknown> {
  if (!record(v)) { out.push({ path, message: "必须是文件描述对象" }); return false; }
  if (typeof v.path !== "string" || !pattern.test(v.path) || enc.encode(v.path).length > limits.maxPathBytes) out.push({ path: `${path}.path`, message: "路径无效" });
  if (typeof v.digest !== "string" || !DIGEST.test(v.digest)) out.push({ path: `${path}.digest`, message: "摘要无效" });
  if (!Number.isInteger(v.byteLength) || (v.byteLength as number) < 0 || (v.byteLength as number) > limits.maxAssetBytes) out.push({ path: `${path}.byteLength`, message: "字节数无效或超限" });
  return true;
}

function limits(overrides: Partial<FbanimLimits>): FbanimLimits {
  const out = { ...FBANIM_V3_LIMITS };
  for (const k of Object.keys(out) as (keyof FbanimLimits)[]) {
    const n = overrides[k];
    if (typeof n === "number" && Number.isFinite(n) && n >= 0) out[k] = Math.min(out[k], Math.floor(n));
  }
  return out;
}

function validateNamedSorted(items: unknown, path: string, root: string, lim: FbanimLimits, issues: ValidationIssue[]) {
  if (!Array.isArray(items) || items.length > lim.maxEntries - 3) {
    issues.push({ path, message: "必须是有界数组" });
    return;
  }
  let previous = "";
  const ids = new Set<string>();
  items.forEach((item, i) => {
    const p = `${path}[${i}]`;
    if (!validFile(item, p, JSON_PATH, lim, issues)) return;
    unknown(item, ["id", "path", "digest", "byteLength"], p, issues);
    if (typeof item.id !== "string" || !ID.test(item.id)) issues.push({ path: `${p}.id`, message: "ID 无效" });
    else {
      if (ids.has(item.id)) issues.push({ path: `${p}.id`, message: "ID 重复" });
      if (previous && item.id <= previous) issues.push({ path: `${p}.id`, message: "必须按 ID 严格排序" });
      ids.add(item.id);
      previous = item.id;
    }
    if (typeof item.path === "string" && !item.path.startsWith(`${root}/`)) issues.push({ path: `${p}.path`, message: "目录不匹配" });
  });
}

export function validateFbanimV3Manifest(value: unknown, limitOverrides: Partial<FbanimLimits> = {}): ValidationResult<FbanimManifestV3> {
  const issues: ValidationIssue[] = [];
  const lim = limits(limitOverrides);
  if (!record(value)) return { ok: false, issues: [{ path: "$", message: "manifest 必须是对象" }] };
  unknown(value, ["format", "version", "createdBy", "requirements", "entry"], "$", issues);
  if (value.format !== FBANIM_V3_FORMAT) issues.push({ path: "format", message: "必须是 fbanim" });
  if (value.version !== 3) issues.push({ path: "version", message: "仅支持版本 3" });
  if (!record(value.createdBy)) issues.push({ path: "createdBy", message: "工具标识无效" });
  else {
    unknown(value.createdBy, ["name", "version"], "createdBy", issues);
    if (typeof value.createdBy.name !== "string" || !value.createdBy.name || typeof value.createdBy.version !== "string" || !value.createdBy.version) {
      issues.push({ path: "createdBy", message: "工具名称和版本不能为空" });
    }
  }
  if (!record(value.requirements)) issues.push({ path: "requirements", message: "能力需求无效" });
  else {
    unknown(value.requirements, CAPABILITY_KEYS, "requirements", issues);
    for (const key of CAPABILITY_KEYS) {
      const version = value.requirements[key];
      if (version === undefined) continue;
      if (!Number.isInteger(version) || (version as number) < 1) issues.push({ path: `requirements.${key}`, message: "能力版本必须是正整数" });
      if (REJECTED_CAPABILITIES.has(key)) issues.push({ path: `requirements.${key}`, message: "初始运行时不支持该能力" });
    }
  }
  if (!record(value.entry)) issues.push({ path: "entry", message: "入口无效" });
  else {
    const e = value.entry;
    unknown(e, ["skeleton", "characterBinding", "bodyProfiles", "equipment", "actions", "actionProfiles", "constraints", "textures"], "entry", issues);
    if (validFile(e.skeleton, "entry.skeleton", JSON_PATH, lim, issues)) {
      unknown(e.skeleton, ["id", "path", "digest", "byteLength"], "entry.skeleton", issues);
      if (typeof e.skeleton.id !== "string" || !ID.test(e.skeleton.id)) issues.push({ path: "entry.skeleton.id", message: "ID 无效" });
      if (typeof e.skeleton.path === "string" && !e.skeleton.path.startsWith("skeletons/")) issues.push({ path: "entry.skeleton.path", message: "目录不匹配" });
    }
    if (validFile(e.characterBinding, "entry.characterBinding", JSON_PATH, lim, issues)) {
      unknown(e.characterBinding, ["id", "path", "digest", "byteLength", "dependencies"], "entry.characterBinding", issues);
      if (typeof e.characterBinding.id !== "string" || !ID.test(e.characterBinding.id)) issues.push({ path: "entry.characterBinding.id", message: "ID 无效" });
      if (typeof e.characterBinding.path === "string" && !e.characterBinding.path.startsWith("bindings/")) issues.push({ path: "entry.characterBinding.path", message: "目录不匹配" });
      if (!record(e.characterBinding.dependencies)) issues.push({ path: "entry.characterBinding.dependencies", message: "依赖无效" });
      else {
        unknown(e.characterBinding.dependencies, ["skeletonId"], "entry.characterBinding.dependencies", issues);
        if (typeof e.characterBinding.dependencies.skeletonId !== "string") issues.push({ path: "entry.characterBinding.dependencies.skeletonId", message: "依赖无效" });
      }
    }
    validateNamedSorted(e.bodyProfiles, "entry.bodyProfiles", "body-profiles", lim, issues);
    validateNamedSorted(e.equipment, "entry.equipment", "equipment", lim, issues);
    validateNamedSorted(e.actionProfiles, "entry.actionProfiles", "action-profiles", lim, issues);
    validateNamedSorted(e.constraints, "entry.constraints", "constraints", lim, issues);
    if (!Array.isArray(e.actions) || e.actions.length > lim.maxEntries - 3) issues.push({ path: "entry.actions", message: "必须是有界数组" });
    if (!Array.isArray(e.textures) || e.textures.length > lim.maxEntries - 3) issues.push({ path: "entry.textures", message: "必须是有界数组" });
    if (Array.isArray(e.actions)) {
      let previous = "";
      const actionIds = new Set<string>();
      e.actions.forEach((a, i) => {
        const p = `entry.actions[${i}]`;
        if (!validFile(a, p, JSON_PATH, lim, issues)) return;
        unknown(a, ["id", "name", "motionClipId", "path", "digest", "byteLength", "speed", "repeat", "loop", "fallbackAction", "dependencies"], p, issues);
        if (typeof a.id !== "string" || !ID.test(a.id) || typeof a.name !== "string" || !a.name || typeof a.motionClipId !== "string" || !ID.test(a.motionClipId)) {
          issues.push({ path: p, message: "动作身份无效" });
        } else {
          if (actionIds.has(a.id)) issues.push({ path: `${p}.id`, message: "动作 ID 重复" });
          if (previous && a.id <= previous) issues.push({ path: `${p}.id`, message: "动作必须按 ID 严格排序" });
          actionIds.add(a.id);
          previous = a.id;
        }
        if (typeof a.path === "string" && !a.path.startsWith("motions/")) issues.push({ path: `${p}.path`, message: "目录不匹配" });
        if (typeof a.speed !== "number" || !Number.isFinite(a.speed) || a.speed <= 0 || a.speed > 8 || typeof a.repeat !== "number" || !Number.isInteger(a.repeat) || a.repeat < 1 || a.repeat > 100 || typeof a.loop !== "boolean") {
          issues.push({ path: p, message: "动作播放参数无效" });
        }
        if (a.fallbackAction !== undefined && (typeof a.fallbackAction !== "string" || !ID.test(a.fallbackAction))) {
          issues.push({ path: `${p}.fallbackAction`, message: "fallbackAction 无效" });
        }
        if (!record(a.dependencies) || typeof a.dependencies.skeletonId !== "string") issues.push({ path: `${p}.dependencies`, message: "依赖无效" });
        else unknown(a.dependencies, ["skeletonId"], `${p}.dependencies`, issues);
      });
    }
    if (Array.isArray(e.textures)) {
      let previous = "";
      const attachmentIds = new Set<string>();
      e.textures.forEach((t, i) => {
        const p = `entry.textures[${i}]`;
        if (!validFile(t, p, PNG_PATH, lim, issues)) return;
        unknown(t, ["attachmentId", "path", "digest", "byteLength"], p, issues);
        if (typeof t.attachmentId !== "string" || !ID.test(t.attachmentId)) issues.push({ path: `${p}.attachmentId`, message: "附件 ID 无效" });
        else {
          if (attachmentIds.has(t.attachmentId)) issues.push({ path: `${p}.attachmentId`, message: "附件 ID 重复" });
          if (previous && t.attachmentId <= previous) issues.push({ path: `${p}.attachmentId`, message: "纹理必须按附件 ID 严格排序" });
          attachmentIds.add(t.attachmentId);
          previous = t.attachmentId;
        }
      });
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: value as unknown as FbanimManifestV3, issues: [] };
}

function hasRuntimeWarp(binding: CharacterBinding, actions: readonly FbanimV3ActionSource[]): boolean {
  if (binding.attachments.some((attachment) => attachment.warp !== undefined)) return true;
  return actions.some((action) => action.motionClip.tracks.some((track) => track.property === "warp"));
}

function deriveRequirements(source: FbanimV3PackageSource): FbanimV3Requirements {
  if (source.requirements) {
    const ordered: FbanimV3Requirements = {};
    for (const key of CAPABILITY_KEYS) {
      const version = source.requirements[key];
      if (version !== undefined) ordered[key] = version;
    }
    return ordered;
  }
  const requirements: FbanimV3Requirements = { regionRendering: 1 };
  if (source.bodyProfiles.length > 0 || source.equipment.length > 0) requirements.equipmentAssembly = 1;
  if (source.actions.some((action) => action.motionClip.events.length > 0)) requirements.motionEvents = 1;
  if (
    source.constraints.length > 0
    || source.equipment.some((item) => item.weapon?.secondaryHandConstraint !== undefined)
  ) {
    requirements.twoBoneIk = 1;
  }
  return requirements;
}

function assertSupportedRequirements(requirements: FbanimV3Requirements): void {
  for (const key of REJECTED_CAPABILITIES) {
    if (requirements[key] !== undefined) throw new Error(`初始运行时不支持能力：${key}`);
  }
}

function requiredTextureIds(source: FbanimV3PackageSource): Set<string> {
  const ids = new Set(source.characterBinding.attachments.map((attachment) => attachment.id));
  for (const item of source.equipment) {
    for (const attachment of item.attachments) ids.add(attachment.id);
  }
  return ids;
}

/** Compose optional authoring layers into one runtime motion clip. */
function compileRuntimeClip(action: FbanimV3ActionSource): MotionClip {
  const hasLayers = action.stanceClip || action.equipmentClip || action.correctionClip;
  if (!hasLayers) {
    // Preserve raw clip identity for layer-free packages (compat with existing fixtures).
    return structuredClone(action.motionClip);
  }
  const clips: Record<string, MotionClip> = {
    [`base:${action.id}`]: action.motionClip,
  };
  const baseActions: Record<string, string> = { [action.id]: `base:${action.id}` };
  const stanceActions: Record<string, string> = {};
  const equipmentOverrides: Record<string, string> = {};
  const equipmentCorrections: Record<string, string> = {};
  if (action.stanceClip) {
    clips[`stance:${action.id}`] = action.stanceClip;
    stanceActions[action.id] = `stance:${action.id}`;
  }
  if (action.equipmentClip) {
    clips[`equip:${action.id}`] = action.equipmentClip;
    equipmentOverrides[action.id] = `equip:${action.id}`;
  }
  if (action.correctionClip) {
    clips[`corr:${action.id}`] = action.correctionClip;
    equipmentCorrections[action.id] = `corr:${action.id}`;
  }
  const composed = compileActionSet({
    actionIds: [action.id],
    clips,
    baseActions,
    stanceActions,
    equipmentOverrides,
    equipmentCorrections,
    templates: action.fallbackAction
      ? [{
          id: action.id,
          loop: action.loop,
          requiredTracks: [],
          requiredEvents: [],
          allowedEvents: [],
          contactRules: [],
          constraintRules: [],
          fallbackAction: action.fallbackAction,
          defaultInterrupt: "immediate",
          defaultBlendMs: 0,
        }]
      : undefined,
  });
  const result = composed.actions[0];
  if (!result) return structuredClone(action.motionClip);
  return {
    ...result.clip,
    id: `runtime:${action.id}`,
    name: action.name || action.id,
    skeletonId: action.motionClip.skeletonId,
  };
}

export function migrateV2PackageSource(source: FbanimV2PackageSource): FbanimV3PackageSource {
  if (hasRuntimeWarp(source.characterBinding, source.actions)) {
    throw new Error("含 runtime Warp 的 v2 包不能迁移为初始 v3 运行时表示");
  }
  return {
    createdBy: source.createdBy,
    skeleton: source.skeleton,
    characterBinding: source.characterBinding,
    bodyProfiles: [],
    equipment: [],
    actions: source.actions.map((action) => ({ ...action })),
    actionProfiles: [],
    constraints: [],
    textures: source.textures.map((texture) => ({ ...texture })),
  };
}

export async function buildFbanimV3Entries(source: FbanimV3PackageSource): Promise<FbanimEntry[]> {
  const sv = validateSkeleton(source.skeleton);
  const bv = validateCharacterBinding(source.characterBinding, source.skeleton);
  if (!sv.ok) throw new Error(`骨架无效：${sv.issues[0]!.path}`);
  if (!bv.ok) throw new Error(`绑定无效：${bv.issues[0]!.path}`);
  if (source.characterBinding.skeletonId !== source.skeleton.id) throw new Error("绑定与骨架不匹配");
  if (hasRuntimeWarp(source.characterBinding, source.actions)) throw new Error("初始运行时不支持 runtime Warp");

  const bodyProfiles = [...source.bodyProfiles].sort((a, b) => compareCodeUnits(a.id, b.id));
  const equipment = [...source.equipment].sort((a, b) => compareCodeUnits(a.id, b.id));
  const actionProfiles = [...source.actionProfiles].sort((a, b) => compareCodeUnits(a.id, b.id));
  const constraints = [...source.constraints].sort((a, b) => compareCodeUnits(a.id, b.id));
  const bodyById = new Map<string, BodyProfile>();
  for (const profile of bodyProfiles) {
    if (bodyById.has(profile.id)) throw new Error(`BodyProfile ID 重复：${profile.id}`);
    const validated = validateBodyProfile(profile, source.skeleton);
    if (!validated.ok) throw new Error(`BodyProfile 无效：${validated.issues[0]!.path}`);
    bodyById.set(profile.id, profile);
  }
  for (const item of equipment) {
    const body = bodyProfiles[0];
    if (!body) throw new Error("装备需要至少一个 BodyProfile");
    const validated = validateEquipmentDefinition(item, body);
    if (!validated.ok) throw new Error(`装备无效：${validated.issues[0]!.path}`);
  }

  const requirements = deriveRequirements({ ...source, bodyProfiles, equipment, actionProfiles, constraints });
  assertSupportedRequirements(requirements);

  const entries: FbanimEntry[] = [];
  const add = async (root: string, value: JsonObject) => {
    const bytes = canonicalizeJson(value);
    const digest = await sha256Digest(bytes);
    const path = `${root}/${digest.slice(7)}.json`;
    if (!entries.some((entry) => entry.path === path)) entries.push({ path, bytes });
    return { path, digest, byteLength: bytes.length };
  };

  const skeletonDesc: FbanimV3NamedFile = { id: source.skeleton.id, ...await add("skeletons", source.skeleton as unknown as JsonObject) };
  const characterBinding: FbanimManifestV3["entry"]["characterBinding"] = {
    id: source.characterBinding.id,
    ...await add("bindings", source.characterBinding as unknown as JsonObject),
    dependencies: { skeletonId: source.skeleton.id },
  };

  const bodyProfileDescriptors: FbanimV3NamedFile[] = [];
  for (const profile of bodyProfiles) {
    bodyProfileDescriptors.push({ id: profile.id, ...await add("body-profiles", profile as unknown as JsonObject) });
  }
  const equipmentDescriptors: FbanimV3NamedFile[] = [];
  for (const item of equipment) {
    equipmentDescriptors.push({ id: item.id, ...await add("equipment", item as unknown as JsonObject) });
  }
  const actionProfileDescriptors: FbanimV3NamedFile[] = [];
  for (const profile of actionProfiles) {
    actionProfileDescriptors.push({ id: profile.id, ...await add("action-profiles", profile as unknown as JsonObject) });
  }
  const constraintDescriptors: FbanimV3NamedFile[] = [];
  for (const item of constraints) {
    constraintDescriptors.push({ id: item.id, ...await add("constraints", item.constraint as unknown as JsonObject) });
  }

  const actionIds = new Set<string>();
  const actions: FbanimV3Action[] = [];
  for (const action of source.actions) {
    if (actionIds.has(action.id)) throw new Error(`动作 ID 重复：${action.id}`);
    actionIds.add(action.id);
    const compiled = compileRuntimeClip(action);
    const validated = validateMotionClip(compiled, source.skeleton);
    if (!validated.ok || compiled.skeletonId !== source.skeleton.id) throw new Error(`动作 ${action.id} 与骨架不匹配或无效`);
    const profileFallback = source.actionProfiles.find((p) => p.id === action.id)?.fallbackAction;
    const fallbackAction = action.fallbackAction ?? profileFallback;
    actions.push({
      id: action.id,
      name: action.name,
      motionClipId: compiled.id,
      speed: action.speed,
      repeat: action.repeat,
      loop: action.loop,
      ...(fallbackAction ? { fallbackAction } : {}),
      ...await add("motions", compiled as unknown as JsonObject),
      dependencies: { skeletonId: source.skeleton.id },
    });
  }

  const requiredTextures = requiredTextureIds(source);
  const seenTextures = new Set<string>();
  const textures: FbanimV3Texture[] = [];
  for (const texture of source.textures) {
    if (seenTextures.has(texture.attachmentId) || !requiredTextures.has(texture.attachmentId)) {
      throw new Error(`纹理附件重复或不存在：${texture.attachmentId}`);
    }
    seenTextures.add(texture.attachmentId);
    if (texture.bytes.length < 8 || pngSignature.some((b, i) => texture.bytes[i] !== b)) {
      throw new Error(`纹理不是 PNG：${texture.attachmentId}`);
    }
    const digest = await sha256Digest(texture.bytes);
    const path = `textures/${digest.slice(7)}.png`;
    if (!entries.some((entry) => entry.path === path)) entries.push({ path, bytes: texture.bytes });
    textures.push({ attachmentId: texture.attachmentId, path, digest, byteLength: texture.bytes.length });
  }
  for (const id of requiredTextures) if (!seenTextures.has(id)) throw new Error(`附件缺少纹理：${id}`);

  actions.sort((a, b) => compareCodeUnits(a.id, b.id));
  textures.sort((a, b) => compareCodeUnits(a.attachmentId, b.attachmentId));
  entries.sort((a, b) => compareCodeUnits(a.path, b.path));

  const manifest: FbanimManifestV3 = {
    format: "fbanim",
    version: 3,
    createdBy: source.createdBy,
    requirements,
    entry: {
      skeleton: skeletonDesc,
      characterBinding,
      bodyProfiles: bodyProfileDescriptors,
      equipment: equipmentDescriptors,
      actions,
      actionProfiles: actionProfileDescriptors,
      constraints: constraintDescriptors,
      textures,
    },
  };
  const mv = validateFbanimV3Manifest(manifest);
  if (!mv.ok) throw new Error(`manifest 无效：${mv.issues[0]!.path} ${mv.issues[0]!.message}`);
  const bytes = canonicalizeJson(manifest as unknown as JsonObject);
  if (
    entries.length + 1 > FBANIM_V3_LIMITS.maxEntries
    || bytes.length > FBANIM_V3_LIMITS.maxManifestBytes
    || entries.reduce((n, e) => n + e.bytes.length, bytes.length) > FBANIM_V3_LIMITS.maxTotalBytes
  ) {
    throw new Error("包体积或文件数超限");
  }
  return [{ path: "manifest.json", bytes }, ...entries];
}

export async function verifyFbanimV3Entries(input: Iterable<FbanimEntry>, overrides: Partial<FbanimLimits> = {}): Promise<ValidationResult<VerifiedFbanimV3Package>> {
  const lim = limits(overrides);
  const issues: ValidationIssue[] = [];
  const byPath = new Map<string, Uint8Array>();
  let total = 0;
  let count = 0;
  for (const entry of input) {
    if (++count > lim.maxEntries) return { ok: false, issues: [{ path: "$", message: "文件数超限" }] };
    if (!entry || typeof entry.path !== "string" || !(entry.bytes instanceof Uint8Array)) {
      issues.push({ path: `entries[${count - 1}]`, message: "条目无效" });
      continue;
    }
    if (entry.path !== "manifest.json" && !JSON_PATH.test(entry.path) && !PNG_PATH.test(entry.path)) {
      issues.push({ path: entry.path, message: "路径无效或存在穿越" });
    }
    if (enc.encode(entry.path).length > lim.maxPathBytes || byPath.has(entry.path)) {
      issues.push({ path: entry.path, message: "路径过长或重复" });
    }
    if (entry.bytes.length > (entry.path === "manifest.json" ? lim.maxManifestBytes : lim.maxAssetBytes)) {
      issues.push({ path: entry.path, message: "文件体积超限" });
    }
    byPath.set(entry.path, entry.bytes);
    total += entry.bytes.length;
    if (total > lim.maxTotalBytes) return { ok: false, issues: [{ path: "$", message: "总字节预算超限" }] };
  }

  const manifestBytes = byPath.get("manifest.json");
  if (!manifestBytes) return { ok: false, issues: [...issues, { path: "manifest.json", message: "缺少 manifest" }] };
  const parsedManifest = parseCanonicalJson(manifestBytes);
  if (!parsedManifest.ok) return parsedManifest;
  const manifestValidation = validateFbanimV3Manifest(parsedManifest.value, lim);
  if (!manifestValidation.ok) return { ok: false, issues: [...issues, ...manifestValidation.issues] };
  const manifest = manifestValidation.value;

  const descriptors: FbanimV3FileDescriptor[] = [
    manifest.entry.skeleton,
    manifest.entry.characterBinding,
    ...manifest.entry.bodyProfiles,
    ...manifest.entry.equipment,
    ...manifest.entry.actions,
    ...manifest.entry.actionProfiles,
    ...manifest.entry.constraints,
    ...manifest.entry.textures,
  ];
  const expectedRoot = (descriptor: FbanimV3FileDescriptor): string => {
    if (descriptor === manifest.entry.skeleton) return "skeletons";
    if (descriptor === manifest.entry.characterBinding) return "bindings";
    if (manifest.entry.bodyProfiles.includes(descriptor as FbanimV3NamedFile)) return "body-profiles";
    if (manifest.entry.equipment.includes(descriptor as FbanimV3NamedFile)) return "equipment";
    if (manifest.entry.actionProfiles.includes(descriptor as FbanimV3NamedFile)) return "action-profiles";
    if (manifest.entry.constraints.includes(descriptor as FbanimV3NamedFile)) return "constraints";
    if (manifest.entry.textures.includes(descriptor as FbanimV3Texture)) return "textures";
    return "motions";
  };
  const listed = new Set(["manifest.json", ...descriptors.map((descriptor) => descriptor.path)]);
  for (const path of byPath.keys()) if (!listed.has(path)) issues.push({ path, message: "未在 manifest 中列出" });
  for (const descriptor of descriptors) {
    const root = expectedRoot(descriptor);
    const expectedPath = `${root}/${descriptor.digest.slice(7)}.${root === "textures" ? "png" : "json"}`;
    if (descriptor.path !== expectedPath) issues.push({ path: descriptor.path, message: "路径与内容摘要不匹配" });
    const bytes = byPath.get(descriptor.path);
    if (!bytes) { issues.push({ path: descriptor.path, message: "文件缺失" }); continue; }
    if (bytes.length !== descriptor.byteLength || await sha256Digest(bytes) !== descriptor.digest) {
      issues.push({ path: descriptor.path, message: "字节数或摘要不匹配" });
    }
  }
  if (issues.length) return { ok: false, issues };

  const parsedAssets = new Map<string, unknown>();
  for (const descriptor of [
    manifest.entry.skeleton,
    manifest.entry.characterBinding,
    ...manifest.entry.bodyProfiles,
    ...manifest.entry.equipment,
    ...manifest.entry.actions,
    ...manifest.entry.actionProfiles,
    ...manifest.entry.constraints,
  ]) {
    if (parsedAssets.has(descriptor.path)) continue;
    const parsed = parseCanonicalJson(byPath.get(descriptor.path)!);
    if (!parsed.ok) issues.push(...parsed.issues.map((issue) => ({ path: `${descriptor.path}:${issue.path}`, message: issue.message })));
    else parsedAssets.set(descriptor.path, parsed.value);
  }
  if (issues.length) return { ok: false, issues };

  const asset = <T>(descriptor: FbanimV3FileDescriptor) => parsedAssets.get(descriptor.path) as T;
  const skeleton = asset<Skeleton>(manifest.entry.skeleton);
  const binding = asset<CharacterBinding>(manifest.entry.characterBinding);
  const skeletonValidation = validateSkeleton(skeleton);
  const bindingValidation = validateCharacterBinding(binding, skeleton);
  if (
    !skeletonValidation.ok
    || !bindingValidation.ok
    || skeleton.id !== manifest.entry.skeleton.id
    || binding.id !== manifest.entry.characterBinding.id
    || binding.skeletonId !== skeleton.id
    || manifest.entry.characterBinding.dependencies.skeletonId !== skeleton.id
  ) {
    issues.push({ path: "entry", message: "骨架或绑定身份/引用不匹配" });
  }
  if (hasRuntimeWarp(binding, [])) issues.push({ path: "entry.characterBinding", message: "初始运行时不支持 runtime Warp" });

  const bodyProfiles: BodyProfile[] = [];
  for (const descriptor of manifest.entry.bodyProfiles) {
    const profile = asset<BodyProfile>(descriptor);
    const validated = validateBodyProfile(profile, skeleton);
    if (!validated.ok || profile.id !== descriptor.id || profile.skeletonId !== skeleton.id) {
      issues.push({ path: descriptor.path, message: "BodyProfile 身份或引用不匹配" });
    }
    bodyProfiles.push(profile);
  }

  const equipment: EquipmentDefinition[] = [];
  for (const descriptor of manifest.entry.equipment) {
    const item = asset<EquipmentDefinition>(descriptor);
    const body = bodyProfiles[0];
    if (!body) issues.push({ path: descriptor.path, message: "装备缺少 BodyProfile" });
    else {
      const validated = validateEquipmentDefinition(item, body);
      if (!validated.ok || item.id !== descriptor.id) issues.push({ path: descriptor.path, message: "装备身份或引用不匹配" });
    }
    equipment.push(item);
  }

  const actionProfiles: ActionTemplate[] = [];
  for (const descriptor of manifest.entry.actionProfiles) {
    const profile = asset<ActionTemplate>(descriptor);
    if (!profile || profile.id !== descriptor.id) issues.push({ path: descriptor.path, message: "动作配置身份不匹配" });
    actionProfiles.push(profile);
  }

  const constraints: FbanimV3ConstraintSource[] = [];
  for (const descriptor of manifest.entry.constraints) {
    const constraint = asset<TwoBoneIkConstraint>(descriptor);
    if (!constraint || constraint.id !== descriptor.id) issues.push({ path: descriptor.path, message: "约束身份不匹配" });
    constraints.push({ id: descriptor.id, constraint });
  }

  const actions: VerifiedFbanimV3Package["actions"] = [];
  for (const descriptor of manifest.entry.actions) {
    const clip = asset<MotionClip>(descriptor);
    const validation = validateMotionClip(clip, skeleton);
    if (
      !validation.ok
      || clip.id !== descriptor.motionClipId
      || clip.skeletonId !== skeleton.id
      || descriptor.dependencies.skeletonId !== skeleton.id
      || clip.tracks.some((track) => track.property === "warp")
    ) {
      issues.push({ path: descriptor.path, message: "动作身份、骨架或内容不匹配" });
    }
    actions.push({
      id: descriptor.id,
      name: descriptor.name,
      motionClip: clip,
      speed: descriptor.speed,
      repeat: descriptor.repeat,
      loop: descriptor.loop,
      ...(descriptor.fallbackAction ? { fallbackAction: descriptor.fallbackAction } : {}),
    });
  }

  const requiredTextures = new Set([
    ...binding.attachments.map((attachment) => attachment.id),
    ...equipment.flatMap((item) => item.attachments.map((attachment) => attachment.id)),
  ]);
  const textures: FbanimV3TextureSource[] = [];
  for (const descriptor of manifest.entry.textures) {
    const bytes = byPath.get(descriptor.path)!;
    if (!requiredTextures.has(descriptor.attachmentId) || bytes.length < 8 || pngSignature.some((value, index) => bytes[index] !== value)) {
      issues.push({ path: descriptor.path, message: "纹理引用无效或不是 PNG" });
    }
    textures.push({ attachmentId: descriptor.attachmentId, bytes });
  }
  if (
    new Set(manifest.entry.textures.map((texture) => texture.attachmentId)).size !== requiredTextures.size
    || [...requiredTextures].some((id) => !manifest.entry.textures.some((texture) => texture.attachmentId === id))
  ) {
    issues.push({ path: "entry.textures", message: "纹理必须与附件一一对应" });
  }

  return issues.length
    ? { ok: false, issues }
    : {
      ok: true,
      value: {
        manifest,
        manifestDigest: await sha256Digest(manifestBytes),
        skeleton,
        characterBinding: binding,
        bodyProfiles,
        equipment,
        actions,
        actionProfiles,
        constraints,
        textures,
      },
      issues: [],
    };
}
