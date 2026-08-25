import { Elysia, t } from "elysia";
import { isFbanimV2Id, migrateSkeletalProjectDocument, SKELETAL_PROJECT_SCHEMA_VERSION, validateBodyProfile, validateCharacterBinding, validateEquipmentDefinition, validateLoadout, type ActionTemplate, type BodyProfile, type CharacterBinding, type EquipmentDefinition, type SkeletalProjectDocument, type SkeletalProjectStanceProfile, type Skeleton } from "@framebaker/shared";
import { db } from "../db";

type ProjectRow = { id: string; kind: string };
type AssetRow = { kind: string; skeleton_id: string | null };

function project(id: string): ProjectRow | null {
  return (db.query("SELECT id, kind FROM projects WHERE id = ?").get(id) as ProjectRow | null) ?? null;
}

function emptyDocument(projectId: string): SkeletalProjectDocument {
  return migrateSkeletalProjectDocument({ schemaVersion: SKELETAL_PROJECT_SCHEMA_VERSION, projectId, character: null, animations: [], activeAnimationId: null });
}

function assetSkeleton(id: string): Skeleton | null {
  const row = db.query("SELECT data FROM animation_assets WHERE id = ? AND kind = 'skeleton'").get(id) as { data: string } | null;
  if (!row) return null;
  try { return JSON.parse(row.data) as Skeleton; } catch { return null; }
}

function validList(value: unknown, max: number): value is unknown[] { return Array.isArray(value) && value.length <= max; }

function validateDocument(value: unknown, projectId: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "骨骼项目文档必须是对象";
  const document = value as Partial<SkeletalProjectDocument>;
  if (document.schemaVersion !== SKELETAL_PROJECT_SCHEMA_VERSION) return "仅支持 schemaVersion 2";
  if (document.projectId !== projectId) return "文档 projectId 必须与 URL 项目一致";
  if (document.character !== null && (!document.character || typeof document.character !== "object" || Array.isArray(document.character))) return "character 无效";
  if (!Array.isArray(document.animations) || document.animations.length > 500) return "animations 必须是至多 500 项的数组";
  if (!validList(document.bodyProfiles, 500) || !validList(document.equipment, 1_000) || !validList(document.loadouts, 500) || !validList(document.actionTemplates, 500) || !validList(document.stanceProfiles, 500)) return "项目实体数量超出限制";
  if (document.activeAnimationId !== null && (typeof document.activeAnimationId !== "string" || !document.activeAnimationId.trim() || document.activeAnimationId.length > 128)) return "activeAnimationId 无效";

  const ids = new Set<string>(), names = new Set<string>();
  for (const item of document.animations) {
    if (!item || typeof item !== "object") return "动作配置必须是对象";
    if (!isFbanimV2Id(item.id)) return "动作 id 必须是可导出的 ASCII 标识符";
    if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 200) return "动作名称必须为非空且不超过 200 字符";
    if (ids.has(item.id) || names.has(item.name)) return "动作 id 与名称必须各自唯一";
    ids.add(item.id); names.add(item.name);
    if (typeof item.motionClipId !== "string" || !item.motionClipId.trim() || item.motionClipId.length > 128) return "motionClipId 无效";
    if (typeof item.speed !== "number" || !Number.isFinite(item.speed) || item.speed <= 0 || item.speed > 8) return "speed 必须大于 0 且不超过 8";
    if (!Number.isInteger(item.repeat) || item.repeat < 1 || item.repeat > 100) return "repeat 必须是 1..100 的整数";
    if (typeof item.loop !== "boolean") return "loop 必须是布尔值";
  }
  if (document.activeAnimationId !== null && !ids.has(document.activeAnimationId)) return "activeAnimationId 引用的动作不存在";
  if (!document.character && document.animations.length) return "未组装角色时不能配置动作";

  let skeletonId: string | null = null;
  if (document.character) {
    if (Object.keys(document.character).some((key) => key !== "binding")) return "character 只允许项目内 binding";
    const { binding } = document.character as { binding?: unknown };
    if (!binding || typeof binding !== "object") return "项目角色绑定无效";
    skeletonId = (binding as CharacterBinding).skeletonId;
    const skeleton = typeof skeletonId === "string" ? assetSkeleton(skeletonId) : null;
    if (!skeleton) return "项目角色引用的骨架不存在";
    const result = validateCharacterBinding(binding, skeleton);
    if (!result.ok) return `项目角色绑定无效：${result.issues[0]?.path ?? "binding"} ${result.issues[0]?.message ?? "格式错误"}`;
    for (const attachment of result.value.attachments) {
      if (!db.query("SELECT id FROM materials WHERE id = ?").get(attachment.materialId)) return `附件「${attachment.name}」引用的素材不存在`;
    }
  }
  const bodyProfiles = document.bodyProfiles ?? [];
  const equipment = document.equipment ?? [];
  const loadouts = document.loadouts ?? [];
  const actions = document.actionTemplates ?? [];
  const stances = document.stanceProfiles ?? [];
  const bodyById = new Map<string, BodyProfile>();
  for (const [index, body] of bodyProfiles.entries()) {
    if (bodyById.has(body?.id)) return `BodyProfile[${index}] ID 重复`;
    const skeleton = assetSkeleton(body?.skeletonId);
    if (!skeleton) return `BodyProfile「${body?.id ?? index}」引用的骨架不存在`;
    const result = validateBodyProfile(body, skeleton);
    if (!result.ok) return `BodyProfile「${body.id}」无效：${result.issues[0]?.message}`;
    bodyById.set(body.id, body);
  }
  const equipmentById = new Map<string, EquipmentDefinition>();
  for (const [index, item] of equipment.entries()) {
    if (equipmentById.has(item?.id)) return `装备[${index}] ID 重复`;
    const body = item && bodyProfiles.find((candidate) => candidate.slots.some((slot) => slot.id === item.primarySlot));
    if (!body) return `装备「${item?.id ?? index}」引用的 BodyProfile 不存在`;
    const result = validateEquipmentDefinition(item, body);
    if (!result.ok) return `装备「${item.id}」无效：${result.issues[0]?.message}`;
    for (const attachment of item.attachments) if (!db.query("SELECT id FROM materials WHERE id = ?").get(attachment.materialId)) return `附件「${attachment.name}」引用的素材不存在`;
    equipmentById.set(item.id, item);
  }
  const actionIds = new Set(actions.map((action) => action?.id));
  for (const [index, action] of actions.entries()) {
    if (!action || !isFbanimV2Id(action.id) || actionIds.size !== actions.length && [...actionIds].filter((id) => id === action.id).length > 1) return `ActionTemplate[${index}] ID 无效或重复`;
    if (action.fallbackAction && !actionIds.has(action.fallbackAction)) return `ActionTemplate「${action.id}」引用的 fallbackAction 不存在`;
  }
  const stanceIds = new Set(stances.map((stance) => stance?.id));
  for (const [index, stance] of stances.entries()) {
    if (!stance || !isFbanimV2Id(stance.id) || stanceIds.size !== stances.length) return `StanceProfile[${index}] ID 无效或重复`;
    if (![...stance.requiredActions, ...stance.optionalActions].every((id) => actionIds.has(id))) return `StanceProfile「${stance.id}」引用的动作不存在`;
  }
  for (const loadout of loadouts) {
    const body = bodyById.get(loadout?.bodyProfileId);
    if (!body) return "Loadout 引用的 BodyProfile 不存在";
    const definitions = equipment.filter((item) => loadout.equipment.some((entry) => entry.equipmentId === item.id));
    const result = validateLoadout(body, definitions, loadout);
    if (!result.ok) return `Loadout 无效：${result.issues[0]?.message}`;
  }
  for (const item of equipment) {
    if (item.actionProfile && !actionIds.has(item.actionProfile)) return `装备「${item.id}」引用的 actionProfile 不存在`;
    if (item.weapon?.stanceProfile && !stanceIds.has(item.weapon.stanceProfile)) return `装备「${item.id}」引用的 stanceProfile 不存在`;
  }
  for (const item of document.animations) {
    const clip = db.query("SELECT kind, skeleton_id FROM animation_assets WHERE id = ?").get(item.motionClipId) as AssetRow | null;
    if (!clip || clip.kind !== "motion-clip") return `动作「${item.name}」引用的 MotionClip 不存在`;
    if (clip.skeleton_id !== skeletonId) return `动作「${item.name}」与角色绑定使用的骨架不同`;
  }
  return null;
}

export const skeletalProjectsApi = new Elysia({ prefix: "/api" })
  .get("/projects/:id/skeletal-document", ({ params, status }) => {
    const row = project(params.id);
    if (!row) return status(404, "项目不存在");
    if (row.kind !== "skeletal") return status(409, "逐帧项目没有骨骼项目文档");
    const stored = db.query("SELECT document FROM skeletal_projects WHERE project_id = ?").get(params.id) as { document: string } | null;
    const document = stored ? migrateSkeletalProjectDocument(JSON.parse(stored.document)) : emptyDocument(params.id);
    if (!stored || JSON.stringify(document) !== stored.document) db.query("INSERT INTO skeletal_projects (project_id, document, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at").run(params.id, JSON.stringify(document), Date.now());
    return { document };
  })
  .put("/projects/:id/skeletal-document", ({ params, body, status }) => {
    const row = project(params.id);
    if (!row) return status(404, "项目不存在");
    if (row.kind !== "skeletal") return status(409, "逐帧项目不能保存骨骼项目文档");
    const document = migrateSkeletalProjectDocument(body);
    const error = validateDocument(document, params.id);
    if (error) return status(400, error);
    db.query("INSERT INTO skeletal_projects (project_id, document, updated_at) VALUES (?, ?, ?) ON CONFLICT(project_id) DO UPDATE SET document = excluded.document, updated_at = excluded.updated_at").run(params.id, JSON.stringify(document), Date.now());
    return { document };
  }, { body: t.Any() });
