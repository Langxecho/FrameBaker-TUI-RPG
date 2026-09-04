import { describe, expect, test } from "bun:test";
import { inferMotionReferenceKind, mapClipTimeToMedia } from "../apps/web/src/motionReferenceSkin";

describe("inferMotionReferenceKind", () => {
  test("recognizes common video and image names", () => {
    expect(inferMotionReferenceKind("walk.mp4")).toBe("video");
    expect(inferMotionReferenceKind("ref.webm", "video/webm")).toBe("video");
    expect(inferMotionReferenceKind("pose.gif")).toBe("image");
    expect(inferMotionReferenceKind("sheet.png", "image/png")).toBe("image");
    expect(inferMotionReferenceKind("notes.txt")).toBeNull();
  });
});

describe("mapClipTimeToMedia", () => {
  test("stretch maps the clip range onto the video", () => {
    expect(mapClipTimeToMedia(0, 1, 2, "stretch")).toBe(0);
    expect(mapClipTimeToMedia(0.5, 1, 2, "stretch")).toBe(1);
    expect(mapClipTimeToMedia(1, 1, 2, "stretch")).toBe(2);
  });

  test("seconds mode clamps to media length", () => {
    expect(mapClipTimeToMedia(0.4, 1, 2, "seconds")).toBe(0.4);
    expect(mapClipTimeToMedia(3, 1, 2, "seconds")).toBe(2);
  });
});
