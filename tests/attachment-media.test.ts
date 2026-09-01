import { describe, expect, test } from "bun:test";
import {
  attachmentMediaKey,
  isPlaceholderMaterialId,
  shouldShowAttachmentFallback,
} from "../apps/web/src/attachmentMedia";

describe("attachment media fallback", () => {
  test("placeholder material always uses the fallback box", () => {
    expect(isPlaceholderMaterialId("mat-placeholder")).toBeTrue();
    expect(shouldShowAttachmentFallback({}, {
      id: "att-gun",
      materialId: "mat-placeholder",
      imageSlot: "raw",
    })).toBeTrue();
  });

  test("switching material retries the image instead of keeping the old missing flag", () => {
    const attachment = { id: "att-gun", materialId: "mat-placeholder", imageSlot: "raw" as const };
    const missing = { [attachmentMediaKey(attachment)]: true };
    expect(shouldShowAttachmentFallback(missing, attachment)).toBeTrue();
    expect(shouldShowAttachmentFallback(missing, { ...attachment, materialId: "mat-pistol" })).toBeFalse();
  });
});
