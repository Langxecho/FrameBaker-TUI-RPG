import type { CharacterBinding, MotionClip } from "../../../packages/shared/src/animation";
import type { EquipmentDefinition } from "../../../packages/shared/src/equipment";
import type { SkeletalProjectDocument } from "../../../packages/shared/src/skeletalProject";
import type { ArtTask } from "./checkArt";
import { actionIdFor, clipIdFor, type GunKey, type Her1State } from "./state";
import { auditClipVisibility, collectRestScales, deriveWiringClip, type VisibilityIssue } from "./visibility";

/** 与运行中服务 `aic_apply_operations` 的操作信封一致的子集。 */
export type AicOperation =
  | { type: "upsert-binding"; binding: CharacterBinding }
  | { type: "upsert-equipment"; equipment: EquipmentDefinition }
  | { type: "create-motion-clip"; asset: MotionClip }
  | { type: "upsert-action"; action: { id: string; name: string; motionClipId: string; speed: number; repeat: number; loop: boolean } };

export interface MaterialPatch {
  materialId: string;
  size: [number, number];
  pivot: [number, number];
}

export function assertAdditiveId(id: string): void {
  if (!id.includes("her1")) throw new Error(`「${id}」不是加性 her1 对象；live 轨禁止写入`);
}

export function rematerializeEquipmentAttachment(document: SkeletalProjectDocument, equipmentId: string, attachmentId: string, patch: MaterialPatch): EquipmentDefinition {
  assertAdditiveId(equipmentId);
  assertAdditiveId(attachmentId);
  const equipment = (document.equipment ?? []).find((item) => item.id === equipmentId);
  if (!equipment) throw new Error(`装备「${equipmentId}」不存在`);
  const next = structuredClone(equipment);
  const attachment = next.attachments.find((item) => item.id === attachmentId);
  if (!attachment) throw new Error(`装备「${equipmentId}」没有附件「${attachmentId}」`);
  attachment.materialId = patch.materialId;
  attachment.size = [...patch.size];
  attachment.pivot = [...patch.pivot];
  return next;
}

export function rematerializeBindingAttachment(binding: CharacterBinding, attachmentId: string, patch: MaterialPatch): CharacterBinding {
  assertAdditiveId(attachmentId);
  const next = structuredClone(binding);
  const attachment = next.attachments.find((item) => item.id === attachmentId);
  if (!attachment) throw new Error(`binding 没有附件「${attachmentId}」`);
  attachment.materialId = patch.materialId;
  attachment.size = [...patch.size];
  attachment.pivot = [...patch.pivot];
  return next;
}

function taskSprite(task: ArtTask, spriteId: string) {
  const sprite = task.sprites.find((item) => item.sprite_id === spriteId);
  if (!sprite) throw new Error(`${task.task_id} 没有 sprite ${spriteId}`);
  return sprite;
}

export function patchFor(task: ArtTask, spriteId: string, materialId: string): MaterialPatch {
  const sprite = taskSprite(task, spriteId);
  return { materialId, size: [sprite.native_size[0] * 2, sprite.native_size[1] * 2], pivot: [...sprite.pivot] };
}

/** T03c：只换两件 her1 G3 装备上的支撑手素材/尺寸/轴心；不改 clip。 */
export function planT03c(document: SkeletalProjectDocument, state: Her1State, task: ArtTask, materialId: string): AicOperation[] {
  const sprite = state.packs.T03c.sprites[0];
  if (sprite.target.kind !== "equipment-attachment") throw new Error("T03c 目标应是装备附件");
  const patch = patchFor(task, sprite.spriteId, materialId);
  const existing = sprite.target.equipment.filter((id) => (document.equipment ?? []).some((item) => item.id === id));
  if (!existing.length) throw new Error(`工程中找不到 ${sprite.target.equipment.join("、")}`);
  return existing.map((equipmentId) => ({ type: "upsert-equipment" as const, equipment: rematerializeEquipmentAttachment(document, equipmentId, (sprite.target as { attachmentId: string }).attachmentId, patch) }));
}

export interface WiringInput {
  gun: GunKey;
  baseTag: string;
  tag: string;
  phases: string[];
  show: string[];
  strip: string[];
  baseClips: Record<string, MotionClip>;
}

export interface WiringPlanResult {
  operations: AicOperation[];
  newClips: MotionClip[];
  issues: VisibilityIssue[];
}

/** 薄接线：从当前指针所在的基线 clip 派生新 tag，只改 show/strip 附件的 scale 轨，再把动作改指向新 clip。 */
export function planWiring(document: SkeletalProjectDocument, state: Her1State, input: WiringInput): WiringPlanResult {
  const gun = state.guns[input.gun];
  if (!gun?.actionPrefix) throw new Error(`${input.gun} 没有 her1bt 动作，不能接线`);
  if (input.tag === input.baseTag) throw new Error("新 tag 不能与基线 tag 相同");
  if (state.retiredClipTags[input.tag]) throw new Error(`tag ${input.tag} 已退役：${state.retiredClipTags[input.tag]}`);
  const restScales = collectRestScales(document);
  const operations: AicOperation[] = [];
  const newClips: MotionClip[] = [];
  const issues: VisibilityIssue[] = [];
  for (const phase of input.phases) {
    const baseId = clipIdFor(gun, phase, input.baseTag);
    const base = input.baseClips[phase];
    if (!base || base.id !== baseId) throw new Error(`缺少基线 clip ${baseId}`);
    const actionId = actionIdFor(gun, phase);
    const action = document.animations.find((item) => item.id === actionId);
    if (!action) throw new Error(`动作 ${actionId} 不存在`);
    if (action.motionClipId !== baseId) throw new Error(`动作 ${actionId} 当前指向 ${action.motionClipId}，不是 ${baseId}；先 probe 并更新 docs/her1`);
    const clip = deriveWiringClip(base, { newClipId: clipIdFor(gun, phase, input.tag), show: input.show, strip: input.strip }, restScales);
    issues.push(...auditClipVisibility(clip, restScales, state.visibility));
    newClips.push(clip);
    operations.push({ type: "create-motion-clip", asset: clip });
    operations.push({ type: "upsert-action", action: { id: action.id, name: action.name, motionClipId: clip.id, speed: action.speed, repeat: action.repeat, loop: action.loop } });
  }
  return { operations, newClips, issues };
}

export interface T10bPlanInput {
  materials: Record<string, string>;
  baseClips: Record<string, MotionClip>;
  tag: string;
  phases: string[];
  wiring: boolean;
}

/** T10b：rematerialize 交回的透视前臂（可选手肘），再从当前 G1 clip 派生新 tag，只 SHOW 交回的件、大臂保持 STRIP。 */
export function planT10b(document: SkeletalProjectDocument, state: Her1State, task: ArtTask, input: T10bPlanInput): WiringPlanResult {
  const pack = state.packs.T10b;
  if (!document.character) throw new Error("工程没有角色 binding");
  let binding = document.character.binding;
  const delivered: string[] = [];
  for (const sprite of pack.sprites) {
    const materialId = input.materials[sprite.spriteId];
    if (!materialId) {
      if (sprite.required) throw new Error(`缺少必交件 ${sprite.spriteId}`);
      continue;
    }
    binding = rematerializeBindingAttachment(binding, sprite.target.attachmentId, patchFor(task, sprite.spriteId, materialId));
    delivered.push(sprite.target.attachmentId);
  }
  const upsert: AicOperation = { type: "upsert-binding", binding };
  if (!input.wiring) return { operations: [upsert], newClips: [], issues: [] };
  const show = [...(pack.wiring.show ?? []), ...(pack.wiring.showIfDelivered ?? []).filter((id) => delivered.includes(id))];
  const strip = (pack.wiring.strip ?? []).filter((id) => !show.includes(id));
  const wiring = planWiring({ ...document, character: { binding } }, state, { gun: pack.gun, baseTag: pack.wiring.baseClipTag, tag: input.tag, phases: input.phases, show, strip, baseClips: input.baseClips });
  return { ...wiring, operations: [upsert, ...wiring.operations] };
}

/** 按写入前文档生成回退操作：binding/装备/动作恢复原值；新建的 clip 不删，只是不再被引用。 */
export function revertOperations(before: SkeletalProjectDocument, operations: AicOperation[]): AicOperation[] {
  const out: AicOperation[] = [];
  for (const operation of operations) {
    if (operation.type === "upsert-binding") {
      if (!before.character) throw new Error("写入前没有 binding，无法生成回退");
      out.push({ type: "upsert-binding", binding: structuredClone(before.character.binding) });
    } else if (operation.type === "upsert-equipment") {
      const original = (before.equipment ?? []).find((item) => item.id === operation.equipment.id);
      if (!original) throw new Error(`写入前没有装备 ${operation.equipment.id}，无法生成回退`);
      out.push({ type: "upsert-equipment", equipment: structuredClone(original) });
    } else if (operation.type === "upsert-action") {
      const original = before.animations.find((item) => item.id === operation.action.id);
      if (!original) throw new Error(`写入前没有动作 ${operation.action.id}，无法生成回退`);
      out.push({ type: "upsert-action", action: { id: original.id, name: original.name, motionClipId: original.motionClipId, speed: original.speed, repeat: original.repeat, loop: original.loop } });
    }
  }
  return out;
}

/** 回退文件只允许触碰 her1 装备与 her1bt 动作；binding 整体替换由写后 live 快照兜底。 */
export function assertRevertable(operations: AicOperation[]): void {
  if (!operations.length) throw new Error("回退文件没有操作");
  for (const operation of operations) {
    if (operation.type === "create-motion-clip") throw new Error("回退文件不应包含 create-motion-clip");
    if (operation.type === "upsert-equipment") assertAdditiveId(operation.equipment.id);
    if (operation.type === "upsert-action") assertAdditiveId(operation.action.id);
  }
}

/** live 快照：非 her1 的 binding 附件/槽、装备与动作。写入前后必须逐字节相同。 */
export function liveSnapshot(document: SkeletalProjectDocument): string {
  const binding = document.character?.binding;
  return JSON.stringify({
    attachments: (binding?.attachments ?? []).filter((item) => !item.id.includes("her1")),
    slots: (binding?.slots ?? []).filter((item) => !item.attachmentId.includes("her1")),
    equipment: (document.equipment ?? []).filter((item) => !item.id.includes("her1")),
    animations: document.animations.filter((item) => !item.id.includes("her1")),
  });
}

export interface LiveCheck { id: string; expected: string; actual: string | null; ok: boolean }

/** 对照 state.json 中记录的 live 素材前缀。 */
export function checkLiveMaterials(document: SkeletalProjectDocument, state: Her1State): LiveCheck[] {
  const out: LiveCheck[] = [];
  const attachments = document.character?.binding.attachments ?? [];
  for (const [id, expected] of Object.entries(state.live.bindingMaterials)) {
    const actual = attachments.find((item) => item.id === id)?.materialId ?? null;
    out.push({ id, expected, actual, ok: !!actual && actual.startsWith(expected) });
  }
  for (const [id, expected] of Object.entries(state.live.equipmentMaterials)) {
    const actual = (document.equipment ?? []).flatMap((item) => item.attachments).find((item) => item.id === id)?.materialId ?? null;
    out.push({ id, expected, actual, ok: !!actual && actual.startsWith(expected) });
  }
  return out;
}

export interface PointerCheck { gun: string; actionId: string; expected: string; actual: string | null; ok: boolean }

const CORE_PHASES = ["idle", "prepare", "aim", "fire", "recover"];

/** 核对 her1bt 动作指针；cancel/hit/enter 只有部分枪有，缺失时不报。 */
export function checkClipPointers(document: SkeletalProjectDocument, state: Her1State): PointerCheck[] {
  const out: PointerCheck[] = [];
  for (const [key, gun] of Object.entries(state.guns)) {
    if (!gun.actionPrefix || !gun.clipTag) continue;
    for (const phase of state.phases) {
      const actionId = actionIdFor(gun, phase);
      const action = document.animations.find((item) => item.id === actionId);
      if (!action && !CORE_PHASES.includes(phase)) continue;
      const expected = clipIdFor(gun, phase, gun.phaseClipTags?.[phase] ?? gun.clipTag);
      out.push({ gun: key, actionId, expected, actual: action?.motionClipId ?? null, ok: action?.motionClipId === expected });
    }
  }
  return out;
}
