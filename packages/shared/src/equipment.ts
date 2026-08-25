import type { CharacterBinding, Skeleton, Transform, ValidationIssue, ValidationResult } from "./animation";

export const EQUIPMENT_SCHEMA_VERSION = 1;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STANDARD_SEMANTICS = new Set([
  "head", "face", "eye_left", "eye_right", "ear_left", "ear_right", "neck", "chest", "back",
  "arm_left", "arm_right", "forearm_left", "forearm_right", "hand_left", "hand_right",
  "leg_left", "leg_right", "foot_left", "foot_right", "weapon_hand_left", "weapon_hand_right",
]);

export interface BodySlotDefinition { id: string; semantic: string; capacity: number; accepts: string[] }
export interface BodySocketDefinition { id: string; semantic: string; boneId: string; rest: Transform; accepts: string[]; mirrorSocketId?: string }
export interface BodyProfile { schemaVersion: number; id: string; name: string; skeletonId: string; mirrorAxis: "x"; slots: BodySlotDefinition[]; sockets: BodySocketDefinition[] }

export type EquipmentVisualMode = "none" | "attached" | "replacement" | "effect";
export interface EquipmentAttachment { id: string; name: string; socket: string; materialId: string; imageSlot: "raw" | "processed"; size: [number, number]; pivot: [number, number]; rest: Transform; drawGroup: string; drawOffset: number }
export interface EquipmentEffectBinding { event: string; effectId: string; socket?: string; enabledState?: string }
export interface TwoBoneIkConstraint { id: string; upperBoneId: string; lowerBoneId: string; endBoneId: string; targetSocket: string; bendDirection: "positive" | "negative"; mix: number; stretch: "forbid" | "limited"; maxStretch?: number }
export interface WeaponProfile { holdMode: "one_hand" | "two_hand" | "either"; preferredPrimaryHand: "left" | "right"; mirrorAllowed: boolean; primaryGrip: Transform; secondaryGrip?: Transform; muzzleSocket?: Transform; ejectSocket?: Transform; stanceProfile: string; recoilProfile?: string; secondaryHandConstraint?: TwoBoneIkConstraint }
export interface EquipmentDefinition { schemaVersion: number; id: string; name: string; tags: string[]; visualMode: EquipmentVisualMode; primarySlot: string; occupiedSlots: string[]; conflictTags: string[]; replacesParts: string[]; hidesSlots: string[]; attachments: EquipmentAttachment[]; actionProfile?: string; actionOverrides?: Record<string, string>; effectBindings?: EquipmentEffectBinding[]; weapon?: WeaponProfile }
export interface EquippedItem { equipmentId: string; instanceId?: string; primarySlot: string; variant?: string }
export interface CharacterLoadout { bodyProfileId: string; equipment: EquippedItem[] }
export type ActionInterrupt = "immediate" | "event-boundary" | "non-interruptible";
export interface ContactRule { semantic: string; requiredFrom: number; requiredUntil: number; tolerancePixels: number }
export interface ActionTemplate { id: string; loop: boolean; requiredTracks: string[]; requiredEvents: string[]; allowedEvents: string[]; contactRules: ContactRule[]; constraintRules: string[]; fallbackAction?: string; defaultInterrupt: ActionInterrupt; defaultBlendMs: number }

export interface AssembledLoadout { bodyProfileId: string; visibleParts: string[]; hiddenParts: string[]; attachments: EquipmentAttachment[]; occupiedSlots: string[]; effects: EquipmentEffectBinding[]; actionOverrides: Record<string, string>; diagnostics: ValidationIssue[] }

const issue = (path: string, message: string): ValidationIssue => ({ path, message });
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
function validId(value: unknown): value is string { return typeof value === "string" && ID.test(value); }
function validateTransform(value: unknown, path: string, issues: ValidationIssue[]) {
  if (!value || typeof value !== "object") { issues.push(issue(path, "必须是 Transform 对象")); return; }
  const transform = value as Transform;
  if (!Array.isArray(transform.translation) || transform.translation.length !== 3 || !transform.translation.every(finite)) issues.push(issue(`${path}.translation`, "必须包含 3 个有限数值"));
  if (!Array.isArray(transform.rotation) || transform.rotation.length !== 4 || !transform.rotation.every(finite)) issues.push(issue(`${path}.rotation`, "必须包含 4 个有限数值"));
  if (!Array.isArray(transform.scale) || transform.scale.length !== 3 || !transform.scale.every(finite)) issues.push(issue(`${path}.scale`, "必须包含 3 个有限数值"));
}
function unique(values: readonly string[], path: string, issues: ValidationIssue[]) { const seen = new Set<string>(); for (const [index, value] of values.entries()) { if (!validId(value)) issues.push(issue(`${path}[${index}]`, "必须是稳定 ID")); else if (seen.has(value)) issues.push(issue(`${path}[${index}]`, "ID 重复")); else seen.add(value); } }

export function validateBodyProfile(value: unknown, skeleton: Skeleton): ValidationResult<BodyProfile> {
  const issues: ValidationIssue[] = [];
  if (!value || typeof value !== "object") return { ok: false, issues: [issue("$", "BodyProfile 必须是对象")] };
  const body = value as BodyProfile;
  if (body.schemaVersion !== EQUIPMENT_SCHEMA_VERSION) issues.push(issue("schemaVersion", "版本无效"));
  if (!validId(body.id) || !body.name?.trim() || body.skeletonId !== skeleton.id || body.mirrorAxis !== "x") issues.push(issue("identity", "BodyProfile 标识或骨架引用无效"));
  const boneIds = new Set(skeleton.bones.map((bone) => bone.id));
  const slotIds = new Set<string>();
  if (!Array.isArray(body.slots)) issues.push(issue("slots", "必须是数组")); else for (const [index, slot] of body.slots.entries()) {
    const path = `slots[${index}]`; if (!slot || !validId(slot.id) || slotIds.has(slot.id)) issues.push(issue(`${path}.id`, "插槽 ID 无效或重复")); else slotIds.add(slot.id);
    if (!Number.isInteger(slot.capacity) || slot.capacity < 1 || slot.capacity > 32) issues.push(issue(`${path}.capacity`, "容量必须是 1..32 的整数"));
    if (!Array.isArray(slot.accepts)) issues.push(issue(`${path}.accepts`, "标签数组无效")); else unique(slot.accepts, `${path}.accepts`, issues);
  }
  const socketIds = new Set<string>();
  if (!Array.isArray(body.sockets)) issues.push(issue("sockets", "必须是数组")); else for (const [index, socket] of body.sockets.entries()) {
    const path = `sockets[${index}]`; if (!socket || !validId(socket.id) || socketIds.has(socket.id)) issues.push(issue(`${path}.id`, "插座 ID 无效或重复")); else socketIds.add(socket.id);
    if (!socket || (!STANDARD_SEMANTICS.has(socket.semantic) && !socket.semantic?.startsWith("custom:"))) issues.push(issue(`${path}.semantic`, "必须是标准语义或 custom: 自定义语义"));
    if (!socket || !boneIds.has(socket.boneId)) issues.push(issue(`${path}.boneId`, "骨骼不存在"));
    if (socket) { validateTransform(socket.rest, `${path}.rest`, issues); if (!Array.isArray(socket.accepts)) issues.push(issue(`${path}.accepts`, "标签数组无效")); else unique(socket.accepts, `${path}.accepts`, issues); }
  }
  if (Array.isArray(body.sockets)) for (const [index, socket] of body.sockets.entries()) if (socket.mirrorSocketId !== undefined && !socketIds.has(socket.mirrorSocketId)) issues.push(issue(`sockets[${index}].mirrorSocketId`, "镜像插座不存在"));
  return issues.length ? { ok: false, issues } : { ok: true, value: body, issues: [] };
}

export function validateEquipmentDefinition(value: unknown, body: BodyProfile): ValidationResult<EquipmentDefinition> {
  const issues: ValidationIssue[] = [];
  if (!value || typeof value !== "object") return { ok: false, issues: [issue("$", "EquipmentDefinition 必须是对象")] };
  const equipment = value as EquipmentDefinition; const slotIds = new Set(body.slots.map((slot) => slot.id)); const socketIds = new Set(body.sockets.map((socket) => socket.id));
  if (equipment.schemaVersion !== EQUIPMENT_SCHEMA_VERSION || !validId(equipment.id) || !equipment.name?.trim()) issues.push(issue("identity", "装备标识无效"));
  if (!["none", "attached", "replacement", "effect"].includes(equipment.visualMode)) issues.push(issue("visualMode", "视觉模式无效"));
  for (const [path, values] of [["tags", equipment.tags], ["occupiedSlots", equipment.occupiedSlots], ["conflictTags", equipment.conflictTags], ["replacesParts", equipment.replacesParts], ["hidesSlots", equipment.hidesSlots]] as const) { if (!Array.isArray(values)) issues.push(issue(path, "必须是数组")); else unique(values, path, issues); }
  if (!slotIds.has(equipment.primarySlot) || equipment.occupiedSlots?.some((id) => !slotIds.has(id))) issues.push(issue("occupiedSlots", "引用的插槽不存在"));
  if (equipment.visualMode === "none" || equipment.visualMode === "effect") { if (equipment.attachments?.length) issues.push(issue("attachments", `${equipment.visualMode} 模式不能有持久附件`)); }
  if (!Array.isArray(equipment.attachments)) issues.push(issue("attachments", "必须是数组")); else for (const [index, attachment] of equipment.attachments.entries()) {
    const path = `attachments[${index}]`; if (!validId(attachment.id) || !attachment.name?.trim() || !socketIds.has(attachment.socket) || !validId(attachment.materialId)) issues.push(issue(path, "附件标识、插座或素材引用无效"));
    if (attachment.imageSlot !== "raw" && attachment.imageSlot !== "processed") issues.push(issue(`${path}.imageSlot`, "图片槽位无效"));
    if (!Array.isArray(attachment.size) || attachment.size.length !== 2 || !attachment.size.every((n) => finite(n) && n > 0) || !Array.isArray(attachment.pivot) || attachment.pivot.length !== 2 || !attachment.pivot.every((n) => finite(n) && n >= 0 && n <= 1)) issues.push(issue(`${path}.geometry`, "附件几何参数无效"));
    validateTransform(attachment.rest, `${path}.rest`, issues);
  }
  if (equipment.weapon) { const weapon = equipment.weapon; validateTransform(weapon.primaryGrip, "weapon.primaryGrip", issues); if (weapon.holdMode === "two_hand" && (!weapon.secondaryGrip || equipment.occupiedSlots.length !== 2)) issues.push(issue("weapon", "two_hand 必须声明 secondaryGrip 且占用两个插槽")); if (weapon.secondaryGrip) validateTransform(weapon.secondaryGrip, "weapon.secondaryGrip", issues); if (!validId(weapon.stanceProfile)) issues.push(issue("weapon.stanceProfile", "姿态配置无效")); if (weapon.secondaryHandConstraint) { const c = weapon.secondaryHandConstraint; if (!validId(c.id) || !finite(c.mix) || c.mix < 0 || c.mix > 1 || (c.stretch === "limited" && (!finite(c.maxStretch) || c.maxStretch! < 1))) issues.push(issue("weapon.secondaryHandConstraint", "IK 参数无效")); } }
  return issues.length ? { ok: false, issues } : { ok: true, value: equipment, issues: [] };
}

export function validateLoadout(body: BodyProfile, definitions: readonly EquipmentDefinition[], loadout: CharacterLoadout): ValidationResult<CharacterLoadout> {
  const issues: ValidationIssue[] = []; const byId = new Map(definitions.map((item) => [item.id, item])); const counts = new Map<string, number>(); const tags = new Set<string>();
  if (loadout.bodyProfileId !== body.id) issues.push(issue("bodyProfileId", "BodyProfile 不匹配"));
  for (const [index, equipped] of loadout.equipment.entries()) { const path = `equipment[${index}]`; const definition = byId.get(equipped.equipmentId); if (!definition) { issues.push(issue(`${path}.equipmentId`, "装备不存在")); continue; } if (equipped.primarySlot !== definition.primarySlot) issues.push(issue(`${path}.primarySlot`, "主插槽不匹配")); for (const slot of definition.occupiedSlots) counts.set(slot, (counts.get(slot) ?? 0) + 1); for (const conflict of definition.conflictTags) if (tags.has(conflict) || loadout.equipment.some((other) => other !== equipped && byId.get(other.equipmentId)?.tags.includes(conflict))) issues.push(issue(path, "装备冲突")); for (const tag of definition.tags) tags.add(tag); }
  for (const [slot, count] of counts) { const capacity = body.slots.find((item) => item.id === slot)?.capacity ?? 0; if (count > capacity) issues.push(issue("equipment", `插槽 ${slot} 超出容量`)); }
  return issues.length ? { ok: false, issues } : { ok: true, value: loadout, issues: [] };
}

export function assembleLoadout(body: BodyProfile, binding: CharacterBinding, definitions: readonly EquipmentDefinition[], loadout: CharacterLoadout): ValidationResult<AssembledLoadout> {
  const valid = validateLoadout(body, definitions, loadout); if (!valid.ok) return { ok: false, issues: valid.issues };
  const byId = new Map(definitions.map((item) => [item.id, item])); const visibleParts = binding.slots.map((slot) => slot.id); const hiddenParts: string[] = []; const attachments: EquipmentAttachment[] = []; const effects: EquipmentEffectBinding[] = []; const occupiedSlots = new Set<string>(); const actionOverrides: Record<string, string> = {};
  for (const equipped of [...loadout.equipment].sort((a, b) => a.equipmentId.localeCompare(b.equipmentId))) { const definition = byId.get(equipped.equipmentId)!; definition.occupiedSlots.forEach((slot) => occupiedSlots.add(slot)); if (definition.visualMode === "effect") effects.push(...(definition.effectBindings ?? [])); if (definition.visualMode === "attached" || definition.visualMode === "replacement") attachments.push(...definition.attachments); for (const part of definition.replacesParts) { hiddenParts.push(part); const index = visibleParts.indexOf(part); if (index >= 0) visibleParts.splice(index, 1); } for (const slot of definition.hidesSlots) hiddenParts.push(slot); Object.assign(actionOverrides, definition.actionOverrides); }
  return { ok: true, value: { bodyProfileId: body.id, visibleParts, hiddenParts: [...new Set(hiddenParts)], attachments, occupiedSlots: [...occupiedSlots].sort(), effects, actionOverrides, diagnostics: [] }, issues: [] };
}
