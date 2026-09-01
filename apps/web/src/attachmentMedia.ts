/** 新建装备/武器尚未选图时的占位素材 ID，不会出现在素材库里。 */
export const PLACEHOLDER_MATERIAL_ID = "mat-placeholder";

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
