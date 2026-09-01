import {
  reparentTransform2d,
  transformToMatrix,
  type AssembledLoadout,
  type BodyProfile,
  type CharacterBinding,
  type CharacterSlot,
  type EquipmentAttachment,
  type EquipmentDefinition,
  type Mat4,
  type RegionAttachment,
  type Transform,
} from "@framebaker/shared";

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export interface LoadoutPreviewOptions {
  /** 保留被替换/隐藏的基础部件，便于对照。 */
  showHiddenBase?: boolean;
  /** 只显示这些装备附件，用于隔离检查。 */
  isolateAttachmentIds?: readonly string[];
}

export function composeSocketRest(socketRest: Transform, attachmentRest: Transform): Transform {
  try {
    return reparentTransform2d(attachmentRest, transformToMatrix(socketRest), IDENTITY);
  } catch {
    return {
      translation: [...attachmentRest.translation] as Transform["translation"],
      rotation: [...attachmentRest.rotation] as Transform["rotation"],
      scale: [...attachmentRest.scale] as Transform["scale"],
    };
  }
}

/** 把预览里的合成 rest 还原成装备附件自己的 rest（去掉插座偏移）。 */
export function attachmentRestFromComposed(socketRest: Transform, composed: Transform): Transform {
  try {
    return reparentTransform2d(composed, IDENTITY, transformToMatrix(socketRest));
  } catch {
    return {
      translation: [...composed.translation] as Transform["translation"],
      rotation: [...composed.rotation] as Transform["rotation"],
      scale: [...composed.scale] as Transform["scale"],
    };
  }
}

function toRegionAttachment(attachment: EquipmentAttachment, rest: Transform): RegionAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    type: "region",
    materialId: attachment.materialId,
    imageSlot: attachment.imageSlot,
    size: [attachment.size[0], attachment.size[1]],
    pivot: [attachment.pivot[0], attachment.pivot[1]],
    rest: {
      translation: [...rest.translation] as Transform["translation"],
      rotation: [...rest.rotation] as Transform["rotation"],
      scale: [...rest.scale] as Transform["scale"],
    },
  };
}

function lastIndexOnBone(slots: CharacterSlot[], boneId: string): number {
  let index = -1;
  for (let i = 0; i < slots.length; i++) {
    if (slots[i]?.boneId === boneId) index = i;
  }
  return index;
}

function withInsertedEquipmentSlots(
  baseSlots: CharacterSlot[],
  additions: Array<{ slot: Omit<CharacterSlot, "drawOrder">; drawOffset: number }>,
): CharacterSlot[] {
  const ordered = [...baseSlots].sort((a, b) => a.drawOrder - b.drawOrder || a.id.localeCompare(b.id));
  for (const addition of additions) {
    const anchor = lastIndexOnBone(ordered, addition.slot.boneId);
    const insertAt = Math.max(0, Math.min(
      ordered.length,
      (anchor < 0 ? ordered.length : anchor + 1) + addition.drawOffset,
    ));
    ordered.splice(insertAt, 0, { ...addition.slot, drawOrder: 0 });
  }
  return ordered.map((slot, drawOrder) => ({ ...slot, drawOrder }));
}
export function bindingWithAssembledLoadout(
  binding: CharacterBinding,
  body: BodyProfile,
  assembled: AssembledLoadout,
  options: LoadoutPreviewOptions = {},
): CharacterBinding {
  const isolate = options.isolateAttachmentIds;
  const hidden = new Set(assembled.hiddenParts);
  const sockets = new Map(body.sockets.map((socket) => [socket.id, socket]));
  const baseSlots = options.showHiddenBase
    ? binding.slots
    : binding.slots.filter((slot) => !hidden.has(slot.id));
  const visibleBaseSlots = isolate ? [] : baseSlots;
  const usedBaseIds = new Set(visibleBaseSlots.map((slot) => slot.attachmentId));
  const baseAttachments = binding.attachments.filter((attachment) => usedBaseIds.has(attachment.id));
  const pendingSlots: Array<{ slot: Omit<CharacterSlot, "drawOrder">; drawOffset: number }> = [];
  const equipmentAttachments: RegionAttachment[] = [];

  for (const attachment of assembled.attachments) {
    if (isolate && !isolate.includes(attachment.id)) continue;
    const socket = sockets.get(attachment.socket);
    if (!socket) continue;
    equipmentAttachments.push(toRegionAttachment(attachment, composeSocketRest(socket.rest, attachment.rest)));
    pendingSlots.push({
      drawOffset: attachment.drawOffset,
      slot: {
        id: `eq:${attachment.id}`,
        name: attachment.name,
        boneId: socket.boneId,
        attachmentId: attachment.id,
      },
    });
  }

  return {
    ...binding,
    slots: withInsertedEquipmentSlots(visibleBaseSlots, pendingSlots),
    attachments: [...baseAttachments, ...equipmentAttachments],
  };
}

/** 编辑中的装备即使未点「试穿」也叠进预览，否则画布上没有可拖的附件。 */
export function overlayDraftEquipment(
  assembled: AssembledLoadout | null,
  draft: EquipmentDefinition | null,
  bodyProfileId: string,
): AssembledLoadout {
  const empty: AssembledLoadout = {
    bodyProfileId,
    visibleParts: [],
    hiddenParts: [],
    attachments: [],
    occupiedSlots: [],
    effects: [],
    actionOverrides: {},
    diagnostics: [],
  };
  const base = assembled ?? empty;
  if (!draft) return base;
  const showVisual = draft.visualMode === "attached" || draft.visualMode === "replacement";
  const draftIds = new Set(draft.attachments.map((item) => item.id));
  const attachments = [
    ...base.attachments.filter((item) => !draftIds.has(item.id)),
    ...(showVisual ? draft.attachments : []),
  ];
  const hiddenParts = [...new Set([
    ...base.hiddenParts,
    ...(draft.visualMode === "replacement" ? draft.replacesParts : []),
    ...draft.hidesSlots,
  ])];
  return {
    ...base,
    attachments,
    hiddenParts,
    occupiedSlots: [...new Set([...base.occupiedSlots, ...draft.occupiedSlots])],
  };
}
