import { describe, expect, test } from "bun:test";
import type { Folder, Material, MediaPluginParamSchema } from "../packages/shared/src";
import {
  acceptedReferenceMediaKinds,
  buildMediaGenerationRequest,
  canUseProjectTarget,
  createParamDefaults,
  filterMaterialsForPlugin,
  folderPathLabel,
  inferLocalReferenceKind,
  isAllowedPluginArchiveFilename,
  isHttpConflictStatus,
  localFileAcceptedAsReference,
  maxReferenceCountForPlugin,
  parseMaterialIdsFromJobProgress,
  pluginArchiveFileAccept,
  pluginKindForTab,
  referenceFileAccept,
  validateGenerationForm,
  validateMediaPluginParams,
} from "../apps/web/src/mediaPluginUiState";

function material(partial: Partial<Material> & Pick<Material, "id" | "kind" | "mediaKind">): Material {
  return {
    name: partial.name ?? partial.id,
    status: "raw",
    source: "upload",
    path: `${partial.id}.bin`,
    processed_path: null,
    folder_id: null,
    metadata: {},
    created_at: 0,
    ...partial,
  };
}

describe("media plugin ui state", () => {
  test("maps generate tabs to plugin kinds", () => {
    expect(pluginKindForTab("image")).toBe("image_api");
    expect(pluginKindForTab("video")).toBe("video_api");
    expect(pluginKindForTab("audio")).toBe("audio_api");
  });

  test("creates schema defaults and validates required fields", () => {
    const schema: Record<string, MediaPluginParamSchema> = {
      size: { type: "enum", enum: ["512x512", "1024x1024"], default: "512x512", required: true },
      steps: { type: "integer", default: 20 },
      flag: { type: "boolean" },
      meta: { type: "json", default: { a: 1 } },
      title: { type: "string", required: true },
    };
    const defaults = createParamDefaults(schema);
    expect(defaults).toEqual({
      size: "512x512",
      steps: 20,
      flag: false,
      meta: { a: 1 },
      title: "",
    });
    expect(validateMediaPluginParams(schema, defaults).title).toBe("required");
    expect(validateMediaPluginParams(schema, { ...defaults, title: "ok" })).toEqual({});
    expect(validateMediaPluginParams(schema, { ...defaults, title: "ok", steps: 1.5 }).steps).toBe("integer");
    expect(validateMediaPluginParams(schema, { ...defaults, title: "ok", meta: "{bad" }).meta).toBe("json");
  });

  test("filters reference materials by plugin constraints", () => {
    const mats = [
      material({ id: "i1", kind: "image", mediaKind: "image" }),
      material({ id: "v1", kind: "video", mediaKind: "video" }),
      material({ id: "a1", kind: "audio", mediaKind: "audio" }),
    ];
    expect(filterMaterialsForPlugin(mats, "image_api").map((m) => m.id)).toEqual(["i1"]);
    expect(filterMaterialsForPlugin(mats, "video_api").map((m) => m.id)).toEqual(["i1"]);
    expect(filterMaterialsForPlugin(mats, "audio_api", { max_reference_images: 0, max_reference_audios: 2 }).map((m) => m.id)).toEqual(["a1"]);
    expect(acceptedReferenceMediaKinds("audio_api", { max_reference_images: 1, max_reference_audios: 1 })).toEqual([
      "image",
      "audio",
    ]);
    expect(maxReferenceCountForPlugin("image_api", { max_reference_images: 3 })).toBe(3);
    expect(maxReferenceCountForPlugin("video_api", {})).toBe(1);
  });

  test("local drop files: still images can be references, gif/video cannot", () => {
    expect(inferLocalReferenceKind(new File([], "a.png", { type: "image/png" }))).toBe("image");
    expect(inferLocalReferenceKind(new File([], "a.gif"))).toBe("video");
    expect(localFileAcceptedAsReference(new File([], "a.png", { type: "image/png" }), ["image"])).toBeTrue();
    expect(localFileAcceptedAsReference(new File([], "a.gif"), ["image"])).toBeFalse();
    expect(referenceFileAccept(["image"])).toContain(".png");
  });

  test("project target is image-only and request strips projectId for non-image", () => {
    expect(canUseProjectTarget("image_api")).toBeTrue();
    expect(canUseProjectTarget("video_api")).toBeFalse();
    const req = buildMediaGenerationRequest({
      kind: "video_api",
      pluginId: "p1",
      prompt: "hello",
      projectId: "proj",
    });
    expect(req.projectId).toBeNull();
    expect(
      validateGenerationForm({
        pluginId: "p1",
        prompt: "x",
        schema: {},
        params: {},
        kind: "video_api",
        projectId: "proj",
      }),
    ).toEqual({ ok: false, field: "projectId", code: "image_only" });
  });

  test("i2v 插件可要求至少一张参考图", () => {
    expect(
      validateGenerationForm({
        pluginId: "minimax-h3-t8-i2v",
        prompt: "x",
        schema: {},
        params: {},
        kind: "video_api",
        references: [],
        constraints: { min_reference_images: 1 },
      }),
    ).toEqual({ ok: false, field: "references", code: "min_references" });
    expect(
      validateGenerationForm({
        pluginId: "minimax-h3-t8-i2v",
        prompt: "x",
        schema: {},
        params: {},
        kind: "video_api",
        references: ["m1"],
        constraints: { min_reference_images: 1 },
      }).ok,
    ).toBeTrue();
  });

  test("accepts only plugin archive extensions and treats 409 as replace conflict", () => {
    expect(isAllowedPluginArchiveFilename("demo.iap")).toBeTrue();
    expect(isAllowedPluginArchiveFilename("demo.VAP")).toBeTrue();
    expect(isAllowedPluginArchiveFilename("demo.aap")).toBeTrue();
    expect(isAllowedPluginArchiveFilename("demo.zip")).toBeFalse();
    expect(pluginArchiveFileAccept()).toBe(".iap,.vap,.aap");
    expect(pluginArchiveFileAccept()).not.toContain("zip");
    expect(isHttpConflictStatus(409)).toBeTrue();
    expect(isHttpConflictStatus(400)).toBeFalse();
  });

  test("parses materialIds from job progress without latest-material guessing", () => {
    expect(parseMaterialIdsFromJobProgress(`完成 materialIds=${JSON.stringify(["m1", "m2"])}`)).toEqual(["m1", "m2"]);
    expect(parseMaterialIdsFromJobProgress("完成 materialId=abc_123")).toEqual(["abc_123"]);
    expect(parseMaterialIdsFromJobProgress("完成")).toEqual([]);
    expect(parseMaterialIdsFromJobProgress(null)).toEqual([]);
  });

  test("folder selector labels use nested paths so same-name folders are distinguishable", () => {
    const folders: Folder[] = [
      { id: "root-a", kind: "material", parent_id: null, name: "角色", sort: 0, created_at: 0 },
      { id: "child-a", kind: "material", parent_id: "root-a", name: "待机", sort: 0, created_at: 0 },
      { id: "root-b", kind: "material", parent_id: null, name: "道具", sort: 1, created_at: 0 },
      { id: "child-b", kind: "material", parent_id: "root-b", name: "待机", sort: 0, created_at: 0 },
    ];
    expect(folderPathLabel(folders, "child-a")).toBe("角色 / 待机");
    expect(folderPathLabel(folders, "child-b")).toBe("道具 / 待机");
    expect(folderPathLabel(folders, "root-a")).toBe("角色");
    expect(folderPathLabel(folders, "missing")).toBe("");
  });
});
