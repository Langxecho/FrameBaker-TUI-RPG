import { describe, expect, test } from "bun:test";
import {
  JOB_TYPES,
  MEDIA_KINDS,
  MEDIA_PLUGIN_ARCHIVE_EXTENSIONS,
  MEDIA_PLUGIN_KINDS,
  mediaPluginArchiveExtension,
  parseMediaKind,
  type MediaPluginDetail,
  type MediaPluginGenerationRequest,
  type MediaPluginResult,
  type MediaPluginSummary,
} from "../packages/shared/src";
import { serializeMaterial } from "../apps/server/src/db";

describe("媒体插件共享契约", () => {
  test("旧素材行反序列化为 mediaKind=image", () => {
    const material = serializeMaterial({
      id: "legacy-image",
      name: "旧图片",
      raw_path: "/tmp/legacy.png",
      processed_path: null,
      status: "raw",
      source: "upload",
      folder_id: null,
      metadata: "{}",
      created_at: 1,
    });

    expect(material.mediaKind).toBe("image");
    expect(material.kind).toBe("image");
    expect(MEDIA_KINDS).toContain("image");
    expect(MEDIA_KINDS).toContain("audio");
  });

  test("已有有效 mediaKind 元数据不会被路径推断覆盖", () => {
    const material = serializeMaterial({
      id: "video-meta",
      name: "视频",
      raw_path: "/tmp/demo.mp4",
      processed_path: null,
      status: "raw",
      source: "api",
      folder_id: null,
      metadata: JSON.stringify({ mediaKind: "video", provider: "dashscope" }),
      created_at: 1,
    });

    expect(material.mediaKind).toBe("video");
    expect(material.kind).toBe("video");
    expect(material.metadata).toMatchObject({ mediaKind: "video", provider: "dashscope" });
  });

  test("metadata 优先且 kind 与 mediaKind 同源；音频不会伪装成 image", () => {
    const metaImageOnMp4 = serializeMaterial({
      id: "meta-image-mp4",
      name: "元数据优先",
      raw_path: "/tmp/demo.mp4",
      processed_path: null,
      status: "raw",
      source: "api",
      folder_id: null,
      metadata: JSON.stringify({ mediaKind: "image" }),
      created_at: 1,
    });
    expect(metaImageOnMp4.mediaKind).toBe("image");
    expect(metaImageOnMp4.kind).toBe("image");

    const audioFromPath = serializeMaterial({
      id: "audio-path",
      name: "音频路径",
      raw_path: "/tmp/demo.wav",
      processed_path: null,
      status: "raw",
      source: "upload",
      folder_id: null,
      metadata: "{}",
      created_at: 1,
    });
    expect(audioFromPath.mediaKind).toBe("audio");
    expect(audioFromPath.kind).toBe("audio");
    expect(audioFromPath.kind).not.toBe("image");

    const audioFromMeta = serializeMaterial({
      id: "audio-meta",
      name: "音频元数据",
      raw_path: "/tmp/demo.bin",
      processed_path: null,
      status: "raw",
      source: "api",
      folder_id: null,
      metadata: JSON.stringify({ mediaKind: "audio" }),
      created_at: 1,
    });
    expect(audioFromMeta.mediaKind).toBe("audio");
    expect(audioFromMeta.kind).toBe("audio");
  });

  test("插件类型映射到归档扩展名", () => {
    expect(MEDIA_PLUGIN_KINDS).toEqual(["image_api", "video_api", "audio_api"]);
    expect(MEDIA_PLUGIN_ARCHIVE_EXTENSIONS).toEqual({
      image_api: ".iap",
      video_api: ".vap",
      audio_api: ".aap",
    });
    expect(mediaPluginArchiveExtension("image_api")).toBe(".iap");
    expect(mediaPluginArchiveExtension("video_api")).toBe(".vap");
    expect(mediaPluginArchiveExtension("audio_api")).toBe(".aap");
  });

  test("非法媒体类型被拒绝", () => {
    expect(() => parseMediaKind("pdf")).toThrow(/invalid media kind/i);
    expect(() => parseMediaKind(null)).toThrow(/invalid media kind/i);
    expect(parseMediaKind("audio")).toBe("audio");
  });

  test("任务类型包含媒体插件任务且保留旧任务", () => {
    expect(JOB_TYPES).toContain("extract_frames");
    expect(JOB_TYPES).toContain("generate_frames");
    expect(JOB_TYPES).toContain("matting");
    expect(JOB_TYPES).toContain("image_layers");
    expect(JOB_TYPES).toContain("media_plugin_image");
    expect(JOB_TYPES).toContain("media_plugin_video");
    expect(JOB_TYPES).toContain("media_plugin_audio");
  });

  test("API/MCP 共享的插件契约可序列化", () => {
    const summary: MediaPluginSummary = {
      id: "demo",
      name: "Demo",
      version: "1.0.0",
      kind: "image_api",
      capabilities: ["t2i"],
      configured: true,
      runnable: true,
    };
    const detail: MediaPluginDetail = {
      ...summary,
      paramsSchema: {
        size: { type: "string", label: "尺寸", default: "1024x1024", enum: ["1024x1024"] },
      },
      constraints: { max_reference_images: 2, supports_text2image: true },
      secrets: [{ id: "api_key", label: "API Key", required: true, configured: false }],
      entry: { type: "python", module: "provider", function: "generate" },
    };
    const request: MediaPluginGenerationRequest = {
      kind: "image_api",
      pluginId: "demo",
      prompt: "pixel warrior",
      references: ["mat-1"],
      params: { size: "1024x1024" },
      count: 1,
    };
    const result: MediaPluginResult = {
      materialId: "mat-2",
      mediaKind: "image",
      metadata: { pluginId: "demo" },
    };

    expect(JSON.parse(JSON.stringify(detail))).toMatchObject({ id: "demo", kind: "image_api" });
    expect(JSON.parse(JSON.stringify(request)).pluginId).toBe("demo");
    expect(JSON.parse(JSON.stringify(result)).mediaKind).toBe("image");
  });
});
