import { describe, expect, test } from "bun:test";
import {
  attachmentMediaKey,
  isPlaceholderMaterialId,
  promoteAttachmentsToProcessed,
  resolveAttachmentImageSlot,
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

  test("preview prefers processed after a flip/matte even if the binding still says raw", () => {
    expect(resolveAttachmentImageSlot("raw", true)).toBe("processed");
    expect(resolveAttachmentImageSlot("raw", false)).toBe("raw");
    expect(resolveAttachmentImageSlot("processed", false)).toBe("raw");
  });

  test("promotes newly processed materials once, then respects an explicit raw choice", () => {
    const attachments = [
      { id: "head", materialId: "mat-head", imageSlot: "raw" as const },
      { id: "chest", materialId: "mat-chest", imageSlot: "raw" as const },
    ];
    const first = promoteAttachmentsToProcessed(attachments, new Set(["mat-head"]), new Set());
    expect(first.changed).toBeTrue();
    expect(first.attachments[0]!.imageSlot).toBe("processed");
    expect(first.attachments[1]!.imageSlot).toBe("raw");

    const userChoseRaw = first.attachments.map((item) => item.id === "head" ? { ...item, imageSlot: "raw" as const } : item);
    const second = promoteAttachmentsToProcessed(userChoseRaw, new Set(["mat-head"]), first.known);
    expect(second.changed).toBeFalse();
    expect(second.attachments[0]!.imageSlot).toBe("raw");

    const afterClear = promoteAttachmentsToProcessed(second.attachments, new Set(), second.known);
    expect(afterClear.known.has("mat-head")).toBeFalse();
    const flippedAgain = promoteAttachmentsToProcessed(afterClear.attachments, new Set(["mat-head"]), afterClear.known);
    expect(flippedAgain.changed).toBeTrue();
    expect(flippedAgain.attachments[0]!.imageSlot).toBe("processed");
  });
});
