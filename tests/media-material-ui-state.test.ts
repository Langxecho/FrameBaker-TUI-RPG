import { describe, expect, test } from "bun:test";
import type { Material } from "../packages/shared/src";
import {
  filterMaterialsByMediaKind,
  formatMaterialDuration,
  materialActionAvailability,
  materialDurationSeconds,
  materialPosterUrl,
  normalizeMaterial,
  resolveClientMediaKind,
  type MaterialMediaFilter,
} from "../apps/web/src/mediaMaterialUiState";

function material(partial: Partial<Material> & Pick<Material, "id">): Material {
  return {
    name: partial.name ?? partial.id,
    raw_path: partial.raw_path ?? `${partial.id}.png`,
    processed_path: partial.processed_path ?? null,
    status: partial.status ?? "raw",
    source: partial.source ?? "upload",
    folder_id: partial.folder_id ?? null,
    metadata: partial.metadata ?? {},
    created_at: partial.created_at ?? 0,
    kind: partial.kind ?? "image",
    mediaKind: partial.mediaKind ?? "image",
    ...partial,
  };
}

describe("media material ui state", () => {
  test("filters materials by all/image/video/audio/archive", () => {
    const mats = [
      material({ id: "i1", kind: "image", mediaKind: "image" }),
      material({ id: "v1", kind: "video", mediaKind: "video", raw_path: "v1.mp4" }),
      material({ id: "a1", kind: "audio", mediaKind: "audio", raw_path: "a1.mp3" }),
      material({ id: "z1", kind: "archive", mediaKind: "archive", raw_path: "z1.zip" }),
    ];
    const cases: Array<[MaterialMediaFilter, string[]]> = [
      ["all", ["i1", "v1", "a1", "z1"]],
      ["image", ["i1"]],
      ["video", ["v1"]],
      ["audio", ["a1"]],
      ["archive", ["z1"]],
    ];
    for (const [filter, ids] of cases) {
      expect(filterMaterialsByMediaKind(mats, filter).map((m) => m.id)).toEqual(ids);
    }
  });

  test("unknown/legacy metadata falls back to image; path can still infer video/audio", () => {
    expect(resolveClientMediaKind({ metadata: {} })).toBe("image");
    expect(resolveClientMediaKind({ metadata: { mediaKind: "weird" } })).toBe("image");
    expect(resolveClientMediaKind({ kind: "nope", metadata: null })).toBe("image");
    expect(resolveClientMediaKind({ raw_path: "clip.mp4", metadata: {} })).toBe("video");
    expect(resolveClientMediaKind({ raw_path: "pack.zip", metadata: {} })).toBe("archive");
    expect(resolveClientMediaKind({ mediaKind: "audio", raw_path: "x.png", metadata: {} })).toBe("audio");
    expect(resolveClientMediaKind({ metadata: { mediaKind: "video" }, raw_path: "x.png" })).toBe("video");
  });

  test("normalizeMaterial parses untrusted API payloads once at the boundary", () => {
    const legacy = normalizeMaterial({
      id: "legacy",
      name: "旧图",
      raw_path: "a.png",
      processed_path: null,
      status: "raw",
      source: "upload",
      folder_id: null,
      metadata: {},
      created_at: 1,
    });
    expect(legacy.mediaKind).toBe("image");
    expect(legacy.kind).toBe("image");

    const bad = normalizeMaterial({
      id: "bad",
      name: "坏元数据",
      raw_path: "b.mp3",
      processed_path: null,
      status: "raw",
      source: "upload",
      folder_id: null,
      metadata: { mediaKind: "banana", durationSeconds: "4.5" },
      created_at: 2,
      kind: "garbage",
      mediaKind: "garbage",
    });
    expect(bad.mediaKind).toBe("audio");
    expect(bad.kind).toBe("audio");
    expect(materialDurationSeconds(bad.metadata)).toBe(4.5);

    const explicit = normalizeMaterial({
      id: "vid",
      name: "视频",
      raw_path: "c.bin",
      processed_path: null,
      status: "raw",
      source: "api",
      folder_id: null,
      metadata: { mediaKind: "video", durationSeconds: 12 },
      created_at: 3,
    });
    expect(explicit.mediaKind).toBe("video");
    expect(explicit.kind).toBe("video");
    expect(formatMaterialDuration(12)).toBe("0:12");
  });

  test("materialPosterUrl only returns API URLs and never filesystem paths", () => {
    const withThumb = material({
      id: "vid-poster",
      kind: "video",
      mediaKind: "video",
      raw_path: "vid.mp4",
      metadata: {
        mediaKind: "video",
        hasThumbnail: true,
        thumbnailPath: "F:\\CodeProject\\storage\\materials\\vid-poster\\thumb.png",
      },
    });
    const poster = materialPosterUrl(withThumb, 9);
    expect(poster).toBe("/api/materials/vid-poster/thumbnail?v=9");
    expect(poster).not.toMatch(/^[A-Za-z]:[\\/]/);
    expect(poster).not.toContain("storage");
    expect(poster).not.toContain("thumb.png");

    expect(
      materialPosterUrl(
        material({
          id: "vid-none",
          kind: "video",
          mediaKind: "video",
          metadata: { mediaKind: "video", hasThumbnail: false },
        }),
      ),
    ).toBeNull();
    expect(
      materialPosterUrl(
        material({
          id: "img",
          kind: "image",
          mediaKind: "image",
          metadata: { hasThumbnail: true },
        }),
      ),
    ).toBeNull();
  });

  test("video poster rendering data prefers hasThumbnail API URL for cards", () => {
    const video = normalizeMaterial({
      id: "card-v",
      name: "clip",
      raw_path: "c.mp4",
      processed_path: null,
      status: "raw",
      source: "api",
      folder_id: null,
      metadata: { mediaKind: "video", hasThumbnail: true, durationSeconds: 3 },
      created_at: 1,
    });
    expect(video.mediaKind).toBe("video");
    expect(materialPosterUrl(video)).toBe("/api/materials/card-v/thumbnail");
    expect(formatMaterialDuration(materialDurationSeconds(video.metadata))).toBe("0:03");
    expect(materialActionAvailability(video.mediaKind).showPlayer).toBe(true);
  });

  test("action availability keeps crop/matting/layers/import image-only", () => {
    expect(materialActionAvailability("image")).toEqual({
      crop: true,
      matting: true,
      layers: true,
      importToProject: true,
      extractFrames: false,
      download: true,
      showPlayer: false,
      showDuration: false,
      imageOnlyExplanation: false,
    });
    expect(materialActionAvailability("video")).toEqual({
      crop: false,
      matting: false,
      layers: false,
      importToProject: false,
      extractFrames: true,
      download: true,
      showPlayer: true,
      showDuration: true,
      imageOnlyExplanation: true,
    });
    expect(materialActionAvailability("audio")).toEqual({
      crop: false,
      matting: false,
      layers: false,
      importToProject: false,
      extractFrames: false,
      download: true,
      showPlayer: true,
      showDuration: true,
      imageOnlyExplanation: true,
    });
    expect(materialActionAvailability("archive")).toEqual({
      crop: false,
      matting: false,
      layers: false,
      importToProject: false,
      extractFrames: false,
      download: true,
      showPlayer: false,
      showDuration: false,
      imageOnlyExplanation: true,
    });
  });
});
