/** 新建装备/武器尚未选图时的占位素材 ID，不会出现在素材库里。 */
export const PLACEHOLDER_MATERIAL_ID = "mat-placeholder";

export type AttachmentImageSlot = "raw" | "processed";

/**
 * 素材编辑（镜像/旋转/擦除/抠图）写入 processed。绑定常残留 raw。
 * 预览与导出优先后处理图；没有 processed 时回退 raw。
 */
export function resolveAttachmentImageSlot(
  _stored: AttachmentImageSlot,
  hasProcessed: boolean,
): AttachmentImageSlot {
  return hasProcessed ? "processed" : "raw";
}

/** 素材刚出现后处理图时，把仍停在 raw 的附件切到 processed；用户事后改回原图的不会被反复覆盖。 */
export function promoteAttachmentsToProcessed<T extends { materialId: string; imageSlot: AttachmentImageSlot }>(
  attachments: readonly T[],
  processedMaterialIds: ReadonlySet<string>,
  previouslyKnownProcessed: ReadonlySet<string>,
): { attachments: T[]; changed: boolean; known: Set<string> } {
  const known = new Set(previouslyKnownProcessed);
  for (const id of [...known]) {
    if (!processedMaterialIds.has(id)) known.delete(id);
  }
  let changed = false;
  const next = attachments.map((attachment) => {
    const hasProcessed = processedMaterialIds.has(attachment.materialId);
    if (hasProcessed && !known.has(attachment.materialId) && attachment.imageSlot !== "processed") {
      changed = true;
      return { ...attachment, imageSlot: "processed" as const };
    }
    return attachment;
  });
  for (const id of processedMaterialIds) known.add(id);
  return { attachments: next, changed, known };
}

export function isPlaceholderMaterialId(materialId: string | undefined): boolean {
  return !materialId || materialId === PLACEHOLDER_MATERIAL_ID;
}

/** 同一附件换素材后必须换 key，否则预览会一直显示上次 404 的橙色占位框。 */
export function attachmentMediaKey(attachment: { id: string; materialId: string; imageSlot: string }): string {
  return `${attachment.id}:${attachment.materialId}:${attachment.imageSlot}`;
}

export function shouldShowAttachmentFallback(
  missingByMediaKey: Record<string, boolean>,
  attachment: { id: string; materialId: string; imageSlot: string },
): boolean {
  if (isPlaceholderMaterialId(attachment.materialId)) return true;
  return !!missingByMediaKey[attachmentMediaKey(attachment)];
}
