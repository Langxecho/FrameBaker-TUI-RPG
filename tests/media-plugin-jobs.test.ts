import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { db, getMaterial, serializeMaterial, STORAGE_ROOT, uid } from "../apps/server/src/db";
import { installMediaPluginArchive } from "../apps/server/src/mediaPlugins/installer";
import { createMediaGenerationJobs, archiveMediaArtifact } from "../apps/server/src/mediaPlugins/service";
import { runMediaPluginJob, type MediaPluginJobPayload } from "../apps/server/src/jobs/mediaPlugin";
import { JobCancelledError } from "../apps/server/src/jobs/run";
import { cancelJob } from "../apps/server/src/queue";
import { createZip } from "../apps/web/src/zip";

const tempRoot = mkdtempSync(join(tmpdir(), "framebaker-media-jobs-"));
const pluginStorageRoot = resolve(tempRoot, "media-plugins");
const previousPluginRoot = process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT;
const createdMaterialIds: string[] = [];
const createdProjectIds: string[] = [];
const createdJobIds: string[] = [];
const createdFolderIds: string[] = [];

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

beforeAll(() => {
  process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT = pluginStorageRoot;
  mkdirSync(pluginStorageRoot, { recursive: true });
});

afterAll(() => {
  if (previousPluginRoot === undefined) delete process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT;
  else process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT = previousPluginRoot;
  for (const id of createdMaterialIds) {
    try {
      db.query("DELETE FROM materials WHERE id = ?").run(id);
    } catch {
      /* ignore */
    }
    rmSync(join(STORAGE_ROOT, "materials", id), { recursive: true, force: true });
  }
  for (const id of createdProjectIds) {
    try {
      db.query("DELETE FROM frames WHERE project_id = ?").run(id);
      db.query("DELETE FROM projects WHERE id = ?").run(id);
    } catch {
      /* ignore */
    }
    rmSync(join(STORAGE_ROOT, "projects", id), { recursive: true, force: true });
  }
  for (const id of createdJobIds) {
    try {
      db.query("DELETE FROM jobs WHERE id = ?").run(id);
    } catch {
      /* ignore */
    }
  }
  for (const id of createdFolderIds) {
    try {
      db.query("DELETE FROM folders WHERE id = ?").run(id);
    } catch {
      /* ignore */
    }
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

beforeEach(() => {
  // no-op: each test uses unique plugin ids
});

async function packPlugin(files: Record<string, string>, filename: string): Promise<Uint8Array> {
  const entries = Object.entries(files).map(([name, text]) => ({
    name,
    data: new TextEncoder().encode(text),
  }));
  const blob = await createZip(entries);
  return new Uint8Array(await blob.arrayBuffer());
}

function trackMaterial(id: string) {
  createdMaterialIds.push(id);
  return id;
}

function insertImageMaterial(name = "ref-image"): string {
  const id = uid();
  const dir = join(STORAGE_ROOT, "materials", id);
  mkdirSync(dir, { recursive: true });
  const rawPath = join(dir, "raw.png");
  writeFileSync(rawPath, TINY_PNG);
  db.query(
    "INSERT INTO materials (id, name, raw_path, status, source, folder_id, metadata, created_at) VALUES (?, ?, ?, 'raw', 'upload', NULL, ?, ?)",
  ).run(id, name, rawPath, JSON.stringify({ mediaKind: "image" }), Date.now());
  return trackMaterial(id);
}

function insertVideoMaterial(name = "ref-video"): string {
  const id = uid();
  const dir = join(STORAGE_ROOT, "materials", id);
  mkdirSync(dir, { recursive: true });
  const rawPath = join(dir, "raw.mp4");
  writeFileSync(rawPath, Buffer.from("fake-mp4-bytes"));
  db.query(
    "INSERT INTO materials (id, name, raw_path, status, source, folder_id, metadata, created_at) VALUES (?, ?, ?, 'raw', 'upload', NULL, ?, ?)",
  ).run(id, name, rawPath, JSON.stringify({ mediaKind: "video" }), Date.now());
  return trackMaterial(id);
}

function insertAudioMaterial(name = "ref-audio"): string {
  const id = uid();
  const dir = join(STORAGE_ROOT, "materials", id);
  mkdirSync(dir, { recursive: true });
  const rawPath = join(dir, "raw.mp3");
  writeFileSync(rawPath, Buffer.from("fake-mp3-bytes"));
  db.query(
    "INSERT INTO materials (id, name, raw_path, status, source, folder_id, metadata, created_at) VALUES (?, ?, ?, 'raw', 'upload', NULL, ?, ?)",
  ).run(id, name, rawPath, JSON.stringify({ mediaKind: "audio" }), Date.now());
  return trackMaterial(id);
}

function createFolder(): string {
  const id = uid();
  db.query("INSERT INTO folders (id, kind, parent_id, name, sort, created_at) VALUES (?, 'material', NULL, ?, 0, ?)").run(
    id,
    "media-folder",
    Date.now(),
  );
  createdFolderIds.push(id);
  return id;
}

function createProject(name = "media-import-project"): string {
  const id = uid();
  db.query("INSERT INTO projects (id, name, kind, folder_id, created_at) VALUES (?, ?, 'frame', NULL, ?)").run(
    id,
    name,
    Date.now(),
  );
  createdProjectIds.push(id);
  return id;
}

function imageProviderBase64(): string {
  const b64 = TINY_PNG.toString("base64");
  return `def generate(*, request, secrets, params, helpers):\n    return {'base64': '${b64}', 'metadata': {'providerTag': 'img-ok'}}\n`;
}

function videoProviderLocal(): string {
  return [
    "from pathlib import Path",
    "def generate(*, request, secrets, params, helpers):",
    "    out = Path(request.output_dir) / 'result.mp4'",
    "    out.write_bytes(b'ftypISOM' + b'\\x00' * 32)",
    "    return {'video_path': str(out), 'metadata': {'providerTag': 'vid-ok'}}",
    "",
  ].join("\n");
}

function audioProviderLocal(): string {
  return [
    "from pathlib import Path",
    "def generate(*, request, secrets, params, helpers):",
    "    out = Path(request.output_dir) / 'result.mp3'",
    "    out.write_bytes(b'ID3' + b'\\x00' * 64)",
    "    return {'audio_path': str(out), 'metadata': {'providerTag': 'aud-ok', 'durationSeconds': 1.5, 'sampleRate': 44100}}",
    "",
  ].join("\n");
}

function missingOutputProvider(): string {
  return [
    "from pathlib import Path",
    "def generate(*, request, secrets, params, helpers):",
    "    missing = Path(request.output_dir) / 'missing.mp4'",
    "    return {'video_path': str(missing), 'metadata': {}}",
    "",
  ].join("\n");
}

function slowProvider(): string {
  return [
    "import time",
    "def generate(*, request, secrets, params, helpers):",
    "    time.sleep(30)",
    "    return {'base64': 'aa', 'metadata': {}}",
    "",
  ].join("\n");
}

function emptyFileProvider(): string {
  return [
    "from pathlib import Path",
    "def generate(*, request, secrets, params, helpers):",
    "    out = Path(request.output_dir) / 'result.mp4'",
    "    out.write_bytes(b'')",
    "    return {'video_path': str(out), 'metadata': {}}",
    "",
  ].join("\n");
}

async function installKind(
  kind: "image_api" | "video_api" | "audio_api",
  pluginId: string,
  providerPy: string,
  constraints: Record<string, unknown>,
  paramsSchema: Record<string, unknown> = {},
) {
  const ext = kind === "image_api" ? ".iap" : kind === "video_api" ? ".vap" : ".aap";
  const caps = kind === "image_api" ? ["t2i", "i2i"] : kind === "video_api" ? ["t2v", "i2v"] : ["t2a", "a2a"];
  const bytes = await packPlugin(
    {
      "plugin.json": JSON.stringify({
        plugin_id: pluginId,
        name: pluginId,
        version: "1.0.0",
        kind,
        capabilities: caps,
        entry: { type: "python", module: "provider", function: "generate" },
        secrets: {},
        params_schema: paramsSchema,
        constraints,
      }),
      "provider.py": providerPy,
    },
    `${pluginId}${ext}`,
  );
  return installMediaPluginArchive(bytes, `${pluginId}${ext}`, true);
}

function basePayload(overrides: Partial<MediaPluginJobPayload> & Pick<MediaPluginJobPayload, "kind" | "pluginId">): MediaPluginJobPayload {
  return {
    prompt: "pixel warrior",
    references: [],
    params: {},
    durationSeconds: null,
    folderId: null,
    projectId: null,
    name: "media-out",
    batchCount: 1,
    batchIndex: 0,
    bridgeTimeoutMs: 60_000,
    ...overrides,
  };
}

describe("媒体插件队列执行与归档", () => {
  test(
    "图片成功：归档 raw.png、source/metadata/folder，可选导入项目",
    async () => {
      await installKind("image_api", "job_img_ok", imageProviderBase64(), {
        supports_text2image: true,
        supports_image2image: true,
        max_reference_images: 2,
      });
      const folderId = createFolder();
      const projectId = createProject();
      const results = await runMediaPluginJob(
        basePayload({
          kind: "image_api",
          pluginId: "job_img_ok",
          folderId,
          projectId,
          name: "插件图片",
        }),
        () => {},
        undefined,
      );
      expect(results.length).toBe(1);
      const materialId = trackMaterial(results[0]!.materialId);
      expect(results[0]!.mediaKind).toBe("image");
      expect(results[0]!.materialId).toBeTruthy();
      const row = getMaterial(materialId)!;
      expect(row.source).toBe("media-plugin:job_img_ok");
      expect(row.folder_id).toBe(folderId);
      expect(row.raw_path?.endsWith("raw.png")).toBe(true);
      expect(existsSync(row.raw_path!)).toBe(true);
      expect(readFileSync(row.raw_path!).equals(TINY_PNG)).toBe(true);
      const material = serializeMaterial(row);
      expect(material.mediaKind).toBe("image");
      expect(material.metadata.mediaKind).toBe("image");
      expect(material.metadata.pluginId).toBe("job_img_ok");
      expect(material.metadata.prompt).toBe("pixel warrior");
      expect(JSON.stringify(material.metadata)).not.toMatch(/super-secret|api_key|sk-/i);
      const frames = db.query("SELECT id FROM frames WHERE project_id = ?").all(projectId) as Array<{ id: string }>;
      expect(frames.length).toBe(1);
    },
    60_000,
  );

  test(
    "视频成功：归档声明输出并写入 thumbnail/mediaKind metadata",
    async () => {
      await installKind("video_api", "job_vid_ok", videoProviderLocal(), {
        supports_text2video: true,
        supports_image2video: true,
        max_reference_images: 1,
        output_extensions: [".mp4"],
      });
      const results = await runMediaPluginJob(
        basePayload({ kind: "video_api", pluginId: "job_vid_ok", name: "插件视频", durationSeconds: 4 }),
        () => {},
      );
      expect(results.length).toBe(1);
      const materialId = trackMaterial(results[0]!.materialId);
      expect(results[0]!.mediaKind).toBe("video");
      const row = getMaterial(materialId)!;
      expect(row.source).toBe("media-plugin:job_vid_ok");
      expect(row.raw_path && /\.mp4$/i.test(row.raw_path)).toBe(true);
      expect(existsSync(row.raw_path!)).toBe(true);
      expect(readFileSync(row.raw_path!).byteLength).toBeGreaterThan(0);
      const material = serializeMaterial(row);
      expect(material.mediaKind).toBe("video");
      expect(material.metadata.mediaKind).toBe("video");
      expect(material.metadata.thumbnailPath).toBeUndefined();
      const thumbOnDisk = join(STORAGE_ROOT, "materials", materialId, "thumb.png");
      if (existsSync(thumbOnDisk)) {
        expect(material.metadata.hasThumbnail).toBe(true);
      } else {
        expect(material.metadata.hasThumbnail).not.toBe(true);
      }
      const stored = JSON.parse(row.metadata || "{}") as Record<string, unknown>;
      if (typeof stored.thumbnailPath === "string") {
        expect(stored.thumbnailPath).toContain(join("materials", materialId));
      }
    },
    60_000,
  );

  test(
    "音频成功：归档声明输出并写入 format/duration metadata",
    async () => {
      await installKind("audio_api", "job_aud_ok", audioProviderLocal(), {
        supports_text2audio: true,
        supports_audio2audio: true,
        max_reference_audios: 1,
        output_extensions: [".mp3"],
      });
      const results = await runMediaPluginJob(
        basePayload({ kind: "audio_api", pluginId: "job_aud_ok", name: "插件音频" }),
        () => {},
      );
      expect(results.length).toBe(1);
      const materialId = trackMaterial(results[0]!.materialId);
      expect(results[0]!.mediaKind).toBe("audio");
      const row = getMaterial(materialId)!;
      expect(row.source).toBe("media-plugin:job_aud_ok");
      expect(row.raw_path && /\.mp3$/i.test(row.raw_path)).toBe(true);
      const material = serializeMaterial(row);
      expect(material.mediaKind).toBe("audio");
      expect(material.metadata.mediaKind).toBe("audio");
      expect(material.metadata.format === "mp3" || String(material.metadata.format || "").includes("mp3")).toBe(true);
      expect(material.metadata.durationSeconds === 1.5 || material.metadata.duration != null).toBe(true);
    },
    60_000,
  );

  test("createMediaGenerationJobs：图片按 count 拆任务，视频单任务", async () => {
    await installKind("image_api", "job_img_batch", imageProviderBase64(), {
      supports_text2image: true,
      max_reference_images: 0,
    });
    await installKind("video_api", "job_vid_batch", videoProviderLocal(), {
      supports_text2video: true,
      output_extensions: [".mp4"],
    });
    const imageJobs = createMediaGenerationJobs({
      kind: "image_api",
      pluginId: "job_img_batch",
      prompt: "batch",
      count: 3,
      name: "batch-img",
    });
    createdJobIds.push(...imageJobs);
    expect(imageJobs.length).toBe(3);
    const videoJobs = createMediaGenerationJobs({
      kind: "video_api",
      pluginId: "job_vid_batch",
      prompt: "batch-v",
      count: 3,
      name: "batch-vid",
    });
    createdJobIds.push(...videoJobs);
    expect(videoJobs.length).toBe(1);
    for (const id of [...imageJobs, ...videoJobs]) {
      const row = db.query("SELECT type, status FROM jobs WHERE id = ?").get(id) as { type: string; status: string };
      expect(row.status === "queued" || row.status === "running" || row.status === "done" || row.status === "error" || row.status === "cancelled").toBe(true);
      cancelJob(id);
    }
    expect(
      (db.query("SELECT type FROM jobs WHERE id = ?").get(imageJobs[0]!) as { type: string }).type,
    ).toBe("media_plugin_image");
    expect(
      (db.query("SELECT type FROM jobs WHERE id = ?").get(videoJobs[0]!) as { type: string }).type,
    ).toBe("media_plugin_video");
  });

  test("拒绝非法参考：任意路径、不存在 ID、视频当图片参考", () => {
    expect(() =>
      createMediaGenerationJobs({
        kind: "image_api",
        pluginId: "job_img_batch",
        prompt: "x",
        references: ["C:\\\\Windows\\\\system32\\\\drivers"],
      }),
    ).toThrow(/参考|素材|reference/i);

    expect(() =>
      createMediaGenerationJobs({
        kind: "image_api",
        pluginId: "job_img_batch",
        prompt: "x",
        references: ["missing-material-id"],
      }),
    ).toThrow(/不存在|reference/i);

    const videoId = insertVideoMaterial();
    expect(() =>
      createMediaGenerationJobs({
        kind: "image_api",
        pluginId: "job_img_batch",
        prompt: "x",
        references: [videoId],
      }),
    ).toThrow(/图片|image|mediaKind|类型/i);
  });

  test("入队前拒绝非法 projectId / 非 frame 项目 / 约束溢出 / 不支持模式", async () => {
    await installKind("image_api", "job_img_constraints", imageProviderBase64(), {
      supports_text2image: true,
      supports_image2image: true,
      max_reference_images: 1,
    });
    await installKind("video_api", "job_vid_t2v_only", videoProviderLocal(), {
      supports_text2video: true,
      supports_image2video: false,
      max_reference_images: 1,
      output_extensions: [".mp4"],
    });

    expect(() =>
      createMediaGenerationJobs({
        kind: "image_api",
        pluginId: "job_img_constraints",
        prompt: "x",
        projectId: "missing-project",
      }),
    ).toThrow(/项目不存在|project/i);

    const skeletalId = uid();
    db.query("INSERT INTO projects (id, name, kind, folder_id, created_at) VALUES (?, ?, 'skeletal', NULL, ?)").run(
      skeletalId,
      "skeletal-target",
      Date.now(),
    );
    createdProjectIds.push(skeletalId);
    expect(() =>
      createMediaGenerationJobs({
        kind: "image_api",
        pluginId: "job_img_constraints",
        prompt: "x",
        projectId: skeletalId,
      }),
    ).toThrow(/逐帧|frame|项目/i);

    const refs = [insertImageMaterial("c-a"), insertImageMaterial("c-b")];
    expect(() =>
      createMediaGenerationJobs({
        kind: "image_api",
        pluginId: "job_img_constraints",
        prompt: "x",
        references: refs,
      }),
    ).toThrow(/参考|限制|超过|max/i);

    expect(() =>
      createMediaGenerationJobs({
        kind: "video_api",
        pluginId: "job_vid_t2v_only",
        prompt: "x",
        references: [insertImageMaterial("i2v-ref")],
      }),
    ).toThrow(/i2v|图生视频|不支持/i);
  });

  test(
    "缺少输出 / 空文件 / 路径逃逸时失败",
    async () => {
      await installKind("video_api", "job_vid_missing", missingOutputProvider(), {
        supports_text2video: true,
        output_extensions: [".mp4"],
      });
      await expect(
        runMediaPluginJob(basePayload({ kind: "video_api", pluginId: "job_vid_missing" }), () => {}),
      ).rejects.toThrow(/output|产出|missing|不存在|empty|空/i);

      await installKind("video_api", "job_vid_empty", emptyFileProvider(), {
        supports_text2video: true,
        output_extensions: [".mp4"],
      });
      await expect(
        runMediaPluginJob(basePayload({ kind: "video_api", pluginId: "job_vid_empty" }), () => {}),
      ).rejects.toThrow(/empty|空|产出/i);

      // Bun 侧 containment：即使 Python runtime 可能先拷贝，归档前仍拒绝逃逸路径
      const { materializeRunnerOutputs } = await import("../apps/server/src/mediaPlugins/service");
      const escapePath = join(tempRoot, `escape-${Date.now()}.mp4`);
      writeFileSync(escapePath, Buffer.from("ftypISOM\0\0\0\0"));
      expect(() =>
        materializeRunnerOutputs({
          kind: "video_api",
          pluginId: "job_vid_escape",
          result: { video_path: escapePath, metadata: {} },
          outputDir: join(tempRoot, "contained-run"),
        }),
      ).toThrow(/contain|逃逸|outside|路径/i);
    },
    90_000,
  );

  test(
    "取消会终止子进程",
    async () => {
      await installKind("image_api", "job_img_cancel", slowProvider(), {
        supports_text2image: true,
        max_reference_images: 0,
      });
      const ac = new AbortController();
      const pending = runMediaPluginJob(
        basePayload({ kind: "image_api", pluginId: "job_img_cancel", bridgeTimeoutMs: 60_000 }),
        () => {},
        ac.signal,
      );
      setTimeout(() => ac.abort(), 200);
      await expect(pending).rejects.toBeInstanceOf(JobCancelledError);
    },
    30_000,
  );

  test(
    "超时抛出 PLUGIN_RUNTIME_TIMEOUT",
    async () => {
      await installKind("image_api", "job_img_timeout", slowProvider(), {
        supports_text2image: true,
        max_reference_images: 0,
      });
      await expect(
        runMediaPluginJob(
          basePayload({ kind: "image_api", pluginId: "job_img_timeout", bridgeTimeoutMs: 500 }),
          () => {},
        ),
      ).rejects.toThrow(/PLUGIN_RUNTIME_TIMEOUT|timeout/i);
    },
    30_000,
  );

  test("项目导入失败时仍保留素材", async () => {
    const archived = archiveMediaArtifact({
      mediaKind: "image",
      sourcePath: (() => {
        const staging = join(tempRoot, `keep-${uid()}.png`);
        writeFileSync(staging, TINY_PNG);
        return staging;
      })(),
      name: "keep-on-import-fail",
      pluginId: "job_img_ok",
      pluginVersion: "1.0.0",
      prompt: "keep",
      params: {},
      references: [],
      folderId: null,
      projectId: "missing-project-should-fail-import",
      providerMetadata: {},
    });
    trackMaterial(archived.materialId);
    expect(getMaterial(archived.materialId)).not.toBeNull();
    expect(archived.mediaKind).toBe("image");
    const frames = db
      .query("SELECT id FROM frames WHERE project_id = ?")
      .all("missing-project-should-fail-import") as Array<{ id: string }>;
    expect(frames.length).toBe(0);
  });

  test("archiveMediaArtifact 拒绝空文件", () => {
    const empty = join(tempRoot, `empty-${uid()}.png`);
    writeFileSync(empty, Buffer.alloc(0));
    expect(() =>
      archiveMediaArtifact({
        mediaKind: "image",
        sourcePath: empty,
        name: "empty",
        pluginId: "x",
        pluginVersion: "1.0.0",
        prompt: "x",
        params: {},
        references: [],
        folderId: null,
        projectId: null,
        providerMetadata: {},
      }),
    ).toThrow(/empty|空/i);
  });

  test(
    "参考素材只接受 materials ID，并转为 file URL 传给 runner",
    async () => {
      await installKind("image_api", "job_img_ref", imageProviderBase64(), {
        supports_text2image: true,
        supports_image2image: true,
        max_reference_images: 2,
      });
      const ref = insertImageMaterial("ref-ok");
      const audio = insertAudioMaterial();
      expect(() =>
        createMediaGenerationJobs({
          kind: "image_api",
          pluginId: "job_img_ref",
          prompt: "with-ref",
          references: [ref, audio],
        }),
      ).toThrow(/图片|image|类型|audio/i);

      const results = await runMediaPluginJob(
        basePayload({
          kind: "image_api",
          pluginId: "job_img_ref",
          references: [ref],
          name: "with-ref",
        }),
        () => {},
      );
      trackMaterial(results[0]!.materialId);
      const material = serializeMaterial(getMaterial(results[0]!.materialId)!);
      expect(material.metadata.references).toEqual([ref]);
    },
    60_000,
  );

  test("归档 metadata 递归剥离 params/providerMetadata 中嵌套 secret-like 键", () => {
    const staging = join(tempRoot, `secret-nest-${uid()}.png`);
    writeFileSync(staging, TINY_PNG);
    const archived = archiveMediaArtifact({
      mediaKind: "image",
      sourcePath: staging,
      name: "secret-nest",
      pluginId: "job_img_ok",
      pluginVersion: "1.0.0",
      prompt: "redact-me",
      params: {
        size: "512x512",
        auth: { api_key: "sk-nested-params", note: "keep-me" },
        headers: [{ Authorization: "Bearer nested", accept: "image/png" }],
      },
      references: [],
      folderId: null,
      projectId: null,
      providerMetadata: {
        providerTag: "ok",
        credentials: { token: "provider-token", region: "cn" },
        nested: { password: "pw", safe: true },
      },
    });
    trackMaterial(archived.materialId);
    const material = serializeMaterial(getMaterial(archived.materialId)!);
    const json = JSON.stringify(material.metadata);
    expect(json).not.toMatch(/sk-nested-params|provider-token|Bearer nested|\bpw\b/i);
    expect(json).not.toMatch(/"api_key"|"token"|"password"|"Authorization"/i);
    expect(material.metadata.params).toMatchObject({ size: "512x512", auth: { note: "keep-me" } });
    expect(material.metadata.providerTag).toBe("ok");
    expect(material.metadata.credentials).toEqual({ region: "cn" });
    expect(material.metadata.nested).toEqual({ safe: true });
  });

  test("多输出部分归档失败时抛错，且已归档产物保留", async () => {
    const { archiveMaterializedOutputs, materializeRunnerOutputs } = await import("../apps/server/src/mediaPlugins/service");
    const outputDir = join(tempRoot, `partial-${uid()}`);
    mkdirSync(outputDir, { recursive: true });
    const okPath = join(outputDir, "a.png");
    const badPath = join(outputDir, "b.png");
    writeFileSync(okPath, TINY_PNG);
    writeFileSync(badPath, TINY_PNG);

    const materialized = materializeRunnerOutputs({
      kind: "image_api",
      pluginId: "job_img_partial",
      result: { image_paths: [okPath, badPath], metadata: { providerTag: "partial" } },
      outputDir,
    });
    expect(materialized.paths.length).toBe(2);
    // 模拟第二份输出在归档前变空：首个成功归档后保留，整体失败
    writeFileSync(badPath, Buffer.alloc(0));

    const before = new Set(
      (db.query("SELECT id FROM materials WHERE source = ?").all("media-plugin:job_img_partial") as Array<{ id: string }>).map(
        (r) => r.id,
      ),
    );
    expect(() =>
      archiveMaterializedOutputs({
        mediaKind: materialized.mediaKind,
        paths: materialized.paths,
        name: "partial-batch",
        pluginId: "job_img_partial",
        pluginVersion: "1.0.0",
        prompt: "partial",
        params: {},
        references: [],
        folderId: null,
        projectId: null,
        providerMetadata: materialized.providerMetadata,
        batchCount: 1,
        batchIndex: 0,
      }),
    ).toThrow(/empty|空|产出|archive|归档/i);

    const after = (
      db.query("SELECT id FROM materials WHERE source = ?").all("media-plugin:job_img_partial") as Array<{ id: string }>
    ).map((r) => r.id);
    const created = after.filter((id) => !before.has(id));
    expect(created.length).toBe(1);
    trackMaterial(created[0]!);
    expect(getMaterial(created[0]!)).not.toBeNull();
  });

  test("入队前按插件 params_schema 拒绝未知/非法参数，并校验 folderId 存在", async () => {
    await installKind(
      "image_api",
      "job_img_params",
      imageProviderBase64(),
      { supports_text2image: true, max_reference_images: 0 },
      {
        size: { type: "enum", enum: ["512x512", "1024x1024"], default: "512x512" },
        steps: { type: "integer", default: 20 },
      },
    );

    expect(() =>
      createMediaGenerationJobs({
        kind: "image_api",
        pluginId: "job_img_params",
        prompt: "ok",
        params: { unknown_param: 1 },
      }),
    ).toThrow(/未知参数|PLUGIN_PARAMETER_INVALID|unknown/i);

    expect(() =>
      createMediaGenerationJobs({
        kind: "image_api",
        pluginId: "job_img_params",
        prompt: "ok",
        params: { size: "256x256" },
      }),
    ).toThrow(/枚举|PLUGIN_PARAMETER_INVALID|enum/i);

    expect(() =>
      createMediaGenerationJobs({
        kind: "image_api",
        pluginId: "job_img_params",
        prompt: "ok",
        params: { steps: 1.5 },
      }),
    ).toThrow(/integer|整数|PLUGIN_PARAMETER_INVALID/i);

    expect(() =>
      createMediaGenerationJobs({
        kind: "image_api",
        pluginId: "job_img_params",
        prompt: "ok",
        folderId: "missing-folder-id",
      }),
    ).toThrow(/文件夹|folder|不存在/i);

    const folderId = createFolder();
    const jobs = createMediaGenerationJobs({
      kind: "image_api",
      pluginId: "job_img_params",
      prompt: "ok",
      params: { size: "512x512", steps: 10 },
      folderId,
    });
    createdJobIds.push(...jobs);
    expect(jobs.length).toBe(1);
    cancelJob(jobs[0]!);
  });
});
