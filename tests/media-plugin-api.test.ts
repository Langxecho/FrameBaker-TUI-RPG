import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { db, STORAGE_ROOT, uid } from "../apps/server/src/db";
import { assertStorageMediaPath, mediaContentTypeForPath } from "../apps/server/src/media";
import {
  deleteMediaPlugin,
  exportMediaPluginArchive,
  installMediaPluginArchive,
  listZipEntriesSync,
} from "../apps/server/src/mediaPlugins/installer";
import { getMediaPlugin, listInstalledMediaPlugins } from "../apps/server/src/mediaPlugins/registry";
import { updateMediaPluginParams, updateMediaPluginSecrets } from "../apps/server/src/mediaPlugins/secrets";
import { MediaPluginServiceError } from "../apps/server/src/mediaPlugins/types";
import { createZip } from "../apps/web/src/zip";

const tempRoot = mkdtempSync(join(tmpdir(), "framebaker-media-api-"));
const pluginStorageRoot = resolve(tempRoot, "media-plugins");
const previousPluginRoot = process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT;
const createdMaterialIds: string[] = [];
const createdProjectIds: string[] = [];
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
  rmSync(tempRoot, { recursive: true, force: true });
});

function trackMaterial(id: string) {
  createdMaterialIds.push(id);
  return id;
}

function trackProject(id: string) {
  createdProjectIds.push(id);
  return id;
}

function insertImageMaterial(name = "api-ref-image"): string {
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

function insertVideoMaterial(name = "api-media-video"): string {
  const id = uid();
  const dir = join(STORAGE_ROOT, "materials", id);
  mkdirSync(dir, { recursive: true });
  const rawPath = join(dir, "raw.mp4");
  writeFileSync(rawPath, Buffer.from("0123456789abcdef0123456789abcdef"));
  db.query(
    "INSERT INTO materials (id, name, raw_path, status, source, folder_id, metadata, created_at) VALUES (?, ?, ?, 'raw', 'upload', NULL, ?, ?)",
  ).run(id, name, rawPath, JSON.stringify({ mediaKind: "video" }), Date.now());
  return trackMaterial(id);
}

function insertAudioMaterial(name = "api-media-audio"): string {
  const id = uid();
  const dir = join(STORAGE_ROOT, "materials", id);
  mkdirSync(dir, { recursive: true });
  const rawPath = join(dir, "raw.mp3");
  writeFileSync(rawPath, Buffer.from("ID3fake-audio-bytes-0123456789"));
  db.query(
    "INSERT INTO materials (id, name, raw_path, status, source, folder_id, metadata, created_at) VALUES (?, ?, ?, 'raw', 'upload', NULL, ?, ?)",
  ).run(id, name, rawPath, JSON.stringify({ mediaKind: "audio" }), Date.now());
  return trackMaterial(id);
}

function createProject(kind: "frame" | "skeletal", name = "api-media-project"): string {
  const id = uid();
  db.query("INSERT INTO projects (id, name, kind, folder_id, created_at) VALUES (?, ?, ?, NULL, ?)").run(
    id,
    name,
    kind,
    Date.now(),
  );
  return trackProject(id);
}

async function packPlugin(files: Record<string, string>, filename: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const entries = Object.entries(files).map(([name, text]) => ({
    name,
    data: new TextEncoder().encode(text),
  }));
  const blob = await createZip(entries);
  return { bytes: new Uint8Array(await blob.arrayBuffer()), filename };
}

function baseManifest(
  kind: "image_api" | "video_api" | "audio_api",
  pluginId: string,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    plugin_id: pluginId,
    name,
    version: "1.0.0",
    kind,
    capabilities: kind === "image_api" ? ["t2i"] : kind === "video_api" ? ["t2v"] : ["t2a"],
    entry: { type: "python", module: "provider", function: "generate" },
    secrets: {
      api_key: { label: "API Key", required: true, secret: true, value: "super-secret" },
    },
    params_schema: {
      size: { type: "string", label: "尺寸", default: "1024x1024", enum: ["1024x1024", "512x512"] },
      count: { type: "integer", label: "数量", default: 1 },
    },
    constraints:
      kind === "image_api"
        ? { max_reference_images: 2, supports_text2image: true }
        : kind === "video_api"
          ? { max_reference_images: 1, supports_text2video: true }
          : { supports_text2audio: true },
    ...overrides,
  };
}

function imageManifest(overrides: Record<string, unknown> = {}) {
  return baseManifest("image_api", "demo_img", "Demo Img", overrides);
}

function videoManifest(overrides: Record<string, unknown> = {}) {
  return baseManifest("video_api", "demo_vid", "Demo Vid", overrides);
}

function audioManifest(overrides: Record<string, unknown> = {}) {
  return baseManifest("audio_api", "demo_aud", "Demo Aud", overrides);
}

const providerPy = "def generate(*, request, secrets, params, helpers):\n    return {'url': 'https://example.invalid/x.png'}\n";

describe("媒体插件安装/注册表/密钥服务 API", () => {
  test("拒绝非法扩展名", async () => {
    const { bytes } = await packPlugin(
      {
        "plugin.json": JSON.stringify(imageManifest()),
        "provider.py": providerPy,
      },
      "demo.zip",
    );
    expect(() => installMediaPluginArchive(bytes, "demo.zip", false)).toThrow(/extension|\.iap|\.vap|\.aap/i);
  });

  test("拒绝缺少 plugin.json / provider.py / 非法 kind，且错误码为 PLUGIN_PACKAGE_INVALID", async () => {
    const missingJson = await packPlugin({ "provider.py": providerPy }, "demo.iap");
    await expect(Promise.resolve().then(() => installMediaPluginArchive(missingJson.bytes, "demo.iap", false))).rejects.toThrow(
      /plugin\.json/i,
    );

    const missingProvider = await packPlugin(
      { "plugin.json": JSON.stringify(imageManifest()) },
      "demo.iap",
    );
    expect(() => installMediaPluginArchive(missingProvider.bytes, "demo.iap", false)).toThrow(/provider\.py/i);

    const mismatchedKind = await packPlugin(
      {
        "plugin.json": JSON.stringify(imageManifest({ kind: "video_api" })),
        "provider.py": providerPy,
      },
      "demo.iap",
    );
    try {
      installMediaPluginArchive(mismatchedKind.bytes, "demo.iap", false);
      throw new Error("expected kind mismatch");
    } catch (error) {
      expect(error).toBeInstanceOf(MediaPluginServiceError);
      const err = error as MediaPluginServiceError;
      expect(err.code).toBe("PLUGIN_PACKAGE_INVALID");
      expect(err.message).toMatch(/kind/i);
      expect(err.message).not.toMatch(/not valid JSON/i);
    }

    const invalidKind = await packPlugin(
      {
        "plugin.json": JSON.stringify(imageManifest({ kind: "not_a_plugin_kind" })),
        "provider.py": providerPy,
      },
      "demo.iap",
    );
    try {
      installMediaPluginArchive(invalidKind.bytes, "demo.iap", false);
      throw new Error("expected invalid kind");
    } catch (error) {
      expect(error).toBeInstanceOf(MediaPluginServiceError);
      const err = error as MediaPluginServiceError;
      expect(err.code).toBe("PLUGIN_PACKAGE_INVALID");
      expect(err.message).toMatch(/kind/i);
      expect(err.message).not.toMatch(/not valid JSON/i);
    }
  });

  test("成功安装 .iap / .vap / .aap，并覆盖扩展名与 kind 不匹配", async () => {
    const image = await packPlugin(
      {
        "plugin.json": JSON.stringify(imageManifest({ plugin_id: "ok_img" })),
        "provider.py": providerPy,
      },
      "ok.iap",
    );
    const imageDetail = installMediaPluginArchive(image.bytes, "ok.iap", false);
    expect(imageDetail.id).toBe("ok_img");
    expect(imageDetail.kind).toBe("image_api");
    expect(existsSync(join(pluginStorageRoot, "image_api", "ok_img", "provider.py"))).toBe(true);

    const video = await packPlugin(
      {
        "plugin.json": JSON.stringify(videoManifest({ plugin_id: "ok_vid" })),
        "provider.py": providerPy,
      },
      "ok.vap",
    );
    const videoDetail = installMediaPluginArchive(video.bytes, "ok.vap", false);
    expect(videoDetail.id).toBe("ok_vid");
    expect(videoDetail.kind).toBe("video_api");
    expect(listInstalledMediaPlugins("video_api").some((p) => p.id === "ok_vid")).toBe(true);

    const audio = await packPlugin(
      {
        "plugin.json": JSON.stringify(audioManifest({ plugin_id: "ok_aud" })),
        "provider.py": providerPy,
      },
      "ok.aap",
    );
    const audioDetail = installMediaPluginArchive(audio.bytes, "ok.aap", false);
    expect(audioDetail.id).toBe("ok_aud");
    expect(audioDetail.kind).toBe("audio_api");
    expect(listInstalledMediaPlugins("audio_api").some((p) => p.id === "ok_aud")).toBe(true);

    const vapAsImage = await packPlugin(
      {
        "plugin.json": JSON.stringify(videoManifest({ plugin_id: "mismatch_vid" })),
        "provider.py": providerPy,
      },
      "mismatch.iap",
    );
    try {
      installMediaPluginArchive(vapAsImage.bytes, "mismatch.iap", false);
      throw new Error("expected extension/kind mismatch");
    } catch (error) {
      expect(error).toBeInstanceOf(MediaPluginServiceError);
      expect((error as MediaPluginServiceError).code).toBe("PLUGIN_PACKAGE_INVALID");
      expect((error as MediaPluginServiceError).message).toMatch(/kind/i);
    }

    const iapAsVideo = await packPlugin(
      {
        "plugin.json": JSON.stringify(imageManifest({ plugin_id: "mismatch_img" })),
        "provider.py": providerPy,
      },
      "mismatch.vap",
    );
    try {
      installMediaPluginArchive(iapAsVideo.bytes, "mismatch.vap", false);
      throw new Error("expected extension/kind mismatch");
    } catch (error) {
      expect(error).toBeInstanceOf(MediaPluginServiceError);
      expect((error as MediaPluginServiceError).code).toBe("PLUGIN_PACKAGE_INVALID");
      expect((error as MediaPluginServiceError).message).toMatch(/kind/i);
    }

    deleteMediaPlugin("image_api", "ok_img");
    deleteMediaPlugin("video_api", "ok_vid");
    deleteMediaPlugin("audio_api", "ok_aud");
  });

  test("拒绝 Zip Slip 条目", async () => {
    const archive = await packPlugin(
      {
        "plugin.json": JSON.stringify(imageManifest()),
        "provider.py": providerPy,
        "../escape.txt": "pwned",
      },
      "slip.iap",
    );
    expect(() => installMediaPluginArchive(archive.bytes, "slip.iap", false)).toThrow(/zip.?slip|path|contain|escape/i);
    expect(existsSync(join(tempRoot, "escape.txt"))).toBe(false);
  });

  test("安装成功、列表脱敏、重复安装需确认", async () => {
    const archive = await packPlugin(
      {
        "plugin.json": JSON.stringify(imageManifest()),
        "provider.py": providerPy,
      },
      "demo.iap",
    );
    const detail = installMediaPluginArchive(archive.bytes, "demo.iap", false);
    expect(detail.id).toBe("demo_img");
    expect(detail.kind).toBe("image_api");
    expect(detail.configured).toBe(true);
    expect(detail.secrets.some((s) => s.id === "api_key" && s.configured)).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("super-secret");

    const listed = listInstalledMediaPlugins("image_api");
    expect(listed.some((p) => p.id === "demo_img")).toBe(true);
    expect(JSON.stringify(listed)).not.toContain("super-secret");

    try {
      installMediaPluginArchive(archive.bytes, "demo.iap", false);
      throw new Error("expected replace confirmation");
    } catch (error) {
      expect(error).toBeInstanceOf(MediaPluginServiceError);
      const err = error as MediaPluginServiceError;
      expect(err.code).toBe("PLUGIN_REPLACE_REQUIRED");
      expect(err.status).toBe(409);
    }

    const replaced = installMediaPluginArchive(
      (
        await packPlugin(
          {
            "plugin.json": JSON.stringify(imageManifest({ version: "1.0.1", secrets: { api_key: { label: "API Key", required: true, secret: true, value: "" } } })),
            "provider.py": providerPy,
          },
          "demo.iap",
        )
      ).bytes,
      "demo.iap",
      true,
    );
    expect(replaced.version).toBe("1.0.1");
    expect(replaced.configured).toBe(false);
  });

  test("密钥与参数更新保留结构且列表仍脱敏", async () => {
    writeFileSync(
      join(pluginStorageRoot, "image_api", "demo_img", "plugin.json"),
      JSON.stringify(
        imageManifest({
          secrets: { api_key: { label: "API Key", required: true, secret: true, value: "" } },
        }),
        null,
        2,
      ),
    );

    const withSecret = updateMediaPluginSecrets("image_api", "demo_img", { api_key: "new-secret-value" });
    expect(withSecret.configured).toBe(true);
    expect(JSON.stringify(withSecret)).not.toContain("new-secret-value");

    const onDiskAfterSecret = JSON.parse(
      readFileSync(join(pluginStorageRoot, "image_api", "demo_img", "plugin.json"), "utf8"),
    ) as { secrets: { api_key: { value: string } }; params_schema: { size: { default: string; label: string } } };
    expect(onDiskAfterSecret.secrets.api_key.value).toBe("new-secret-value");

    const withParams = updateMediaPluginParams("image_api", "demo_img", { size: "512x512" });
    expect(withParams.paramsSchema.size.default).toBe("512x512");
    const onDiskAfterParams = JSON.parse(
      readFileSync(join(pluginStorageRoot, "image_api", "demo_img", "plugin.json"), "utf8"),
    ) as { params_schema: { size: { default: string; label: string } } };
    expect(onDiskAfterParams.params_schema.size.label).toBe("尺寸");
    expect(onDiskAfterParams.params_schema.size.default).toBe("512x512");

    expect(() => updateMediaPluginParams("image_api", "demo_img", { unknown: 1 })).toThrow(/未知参数|param|invalid/i);
    expect(() => updateMediaPluginSecrets("image_api", "demo_img", { missing: "x" })).toThrow(/未知密钥|secret|invalid/i);

    const got = getMediaPlugin("image_api", "demo_img");
    expect(got?.id).toBe("demo_img");
    expect(JSON.stringify(got)).not.toContain("new-secret-value");

    deleteMediaPlugin("image_api", "demo_img");
    expect(getMediaPlugin("image_api", "demo_img")).toBeNull();
  });

  test("导出归档剥离 secrets.value，磁盘原值保留", async () => {
    const packed = await packPlugin(
      {
        "plugin.json": JSON.stringify(
          imageManifest({
            plugin_id: "export_strip",
            secrets: { api_key: { label: "API Key", required: true, secret: true, value: "keep-on-disk-secret" } },
          }),
        ),
        "provider.py": providerPy,
      },
      "export_strip.iap",
    );
    installMediaPluginArchive(packed.bytes, "export_strip.iap", false);
    const archived = await exportMediaPluginArchive("image_api", "export_strip");
    expect(archived.secretsStripped).toBe(true);
    const entries = listZipEntriesSync(archived.bytes);
    const pluginJson = entries.find((e) => e.name.replace(/\\/g, "/").endsWith("plugin.json"));
    expect(pluginJson).toBeTruthy();
    const exported = JSON.parse(new TextDecoder().decode(pluginJson!.data)) as {
      secrets: { api_key: { value: string } };
    };
    expect(exported.secrets.api_key.value).toBe("");
    expect(JSON.stringify(exported)).not.toContain("keep-on-disk-secret");
    const onDisk = JSON.parse(
      readFileSync(join(pluginStorageRoot, "image_api", "export_strip", "plugin.json"), "utf8"),
    ) as { secrets: { api_key: { value: string } } };
    expect(onDisk.secrets.api_key.value).toBe("keep-on-disk-secret");
    deleteMediaPlugin("image_api", "export_strip");
  });
});

describe("媒体插件 HTTP API 状态码", () => {
  async function call(path: string, init?: RequestInit): Promise<Response> {
    const { app } = await import("../apps/server/src/app");
    return app.handle(new Request(`http://localhost${path}`, init));
  }

  async function importPlugin(bytes: Uint8Array, filename: string, confirmReplace = false): Promise<Response> {
    const form = new FormData();
    form.append("plugin", new File([bytes], filename));
    form.append("confirm_replace", confirmReplace ? "true" : "false");
    return call("/api/media-plugins/import", { method: "POST", body: form });
  }

  test("非法包扩展名 → 400", async () => {
    const packed = await packPlugin(
      {
        "plugin.json": JSON.stringify(imageManifest({ plugin_id: "http_bad_ext" })),
        "provider.py": providerPy,
      },
      "bad.zip",
    );
    const res = await importPlugin(packed.bytes, "bad.zip");
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toMatch(/iap|vap|aap|extension|扩展/i);
    expect(text).not.toContain("super-secret");
  });

  test("非法 kind → 400；缺失插件 → 404", async () => {
    const badKind = await call("/api/media-plugins/not_a_kind");
    expect(badKind.status).toBe(400);

    const missing = await call("/api/media-plugins/image_api/no_such_plugin");
    expect(missing.status).toBe(404);
  });

  test("成功安装 → 200；重复安装 → 409；覆盖后仍脱敏", async () => {
    const packed = await packPlugin(
      {
        "plugin.json": JSON.stringify(imageManifest({ plugin_id: "http_ok_img" })),
        "provider.py": providerPy,
      },
      "http_ok.iap",
    );
    const ok = await importPlugin(packed.bytes, "http_ok.iap");
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { plugin: { id: string; kind: string }; secrets?: unknown };
    expect(body.plugin.id).toBe("http_ok_img");
    expect(body.plugin.kind).toBe("image_api");
    expect(JSON.stringify(body)).not.toContain("super-secret");

    const dup = await importPlugin(packed.bytes, "http_ok.iap", false);
    expect(dup.status).toBe(409);

    const replaced = await importPlugin(packed.bytes, "http_ok.iap", true);
    expect(replaced.status).toBe(200);
    expect(JSON.stringify(await replaced.json())).not.toContain("super-secret");

    const listed = await call("/api/media-plugins?kind=image_api");
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as { plugins: Array<{ id: string }>; installRoot?: string };
    expect(listBody.plugins.some((p) => p.id === "http_ok_img")).toBe(true);
    expect(listBody.installRoot).toBeTruthy();
    expect(JSON.stringify(listBody)).not.toContain("super-secret");

    await call("/api/media-plugins/image_api/http_ok_img", { method: "DELETE" });
  });

  test(
    "生成校验失败 → 400；成功入队 → 200",
    async () => {
      const packed = await packPlugin(
        {
          "plugin.json": JSON.stringify(
            imageManifest({
              plugin_id: "http_gen_img",
              secrets: { api_key: { label: "API Key", required: true, secret: true, value: "configured-key" } },
            }),
          ),
          "provider.py": providerPy,
        },
        "http_gen.iap",
      );
      expect((await importPlugin(packed.bytes, "http_gen.iap")).status).toBe(200);

      const invalid = await call("/api/media-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "image_api",
          pluginId: "http_gen_img",
          prompt: "",
        }),
      });
      expect(invalid.status).toBe(400);

      const unknownParam = await call("/api/media-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "image_api",
          pluginId: "http_gen_img",
          prompt: "pixel cat",
          params: { not_in_schema: 1 },
        }),
      });
      expect(unknownParam.status).toBe(400);

      const ok = await call("/api/media-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "image_api",
          pluginId: "http_gen_img",
          prompt: "pixel cat",
          count: 1,
        }),
      });
      expect(ok.status).toBe(200);
      const queued = (await ok.json()) as { jobId: string; jobIds: string[] };
      expect(queued.jobId).toBeTruthy();
      expect(queued.jobIds).toEqual([queued.jobId]);
      expect(JSON.stringify(queued)).not.toContain("configured-key");
      await call(`/api/jobs/${queued.jobId}/cancel`, { method: "POST" });

      await call("/api/media-plugins/image_api/http_gen_img", { method: "DELETE" });
    },
    30_000,
  );

  test("缺失插件 POST → 404；非法 project / 约束溢出 → 400", async () => {
    const packed = await packPlugin(
      {
        "plugin.json": JSON.stringify(
          imageManifest({
            plugin_id: "http_gen_constraints",
            secrets: { api_key: { label: "API Key", required: true, secret: true, value: "configured-key" } },
            constraints: {
              max_reference_images: 1,
              supports_text2image: true,
              supports_image2image: true,
            },
          }),
        ),
        "provider.py": providerPy,
      },
      "http_gen_constraints.iap",
    );
    expect((await importPlugin(packed.bytes, "http_gen_constraints.iap")).status).toBe(200);

    const missingPlugin = await call("/api/media-generation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "image_api",
        pluginId: "no_such_plugin_for_generation",
        prompt: "pixel cat",
      }),
    });
    expect(missingPlugin.status).toBe(404);

    const missingProject = await call("/api/media-generation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "image_api",
        pluginId: "http_gen_constraints",
        prompt: "pixel cat",
        projectId: "missing-project-id",
      }),
    });
    expect(missingProject.status).toBe(404);
    expect(await missingProject.text()).toMatch(/项目不存在|project/i);

    const skeletalProjectId = createProject("skeletal", "api-skeletal-target");
    const nonImageProject = await call("/api/media-generation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "image_api",
        pluginId: "http_gen_constraints",
        prompt: "pixel cat",
        projectId: skeletalProjectId,
      }),
    });
    expect(nonImageProject.status).toBe(400);
    expect(await nonImageProject.text()).toMatch(/逐帧|frame|项目/i);

    const refs = [insertImageMaterial("api-ref-a"), insertImageMaterial("api-ref-b")];
    const overflow = await call("/api/media-generation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "image_api",
        pluginId: "http_gen_constraints",
        prompt: "pixel cat",
        references: refs,
      }),
    });
    expect(overflow.status).toBe(400);
    expect(await overflow.text()).toMatch(/参考|限制|max|overflow|超过/i);

    await call("/api/media-plugins/image_api/http_gen_constraints", { method: "DELETE" });
  });

  test("媒体路径 containment、视频/音频 MIME、Range 206", async () => {
    expect(() => assertStorageMediaPath(join(tempRoot, "escape.png"))).toThrow(/STORAGE_ROOT|contain|路径/i);
    expect(mediaContentTypeForPath(join(STORAGE_ROOT, "x.mp4"))).toBe("video/mp4");
    expect(mediaContentTypeForPath(join(STORAGE_ROOT, "x.mp3"))).toBe("audio/mpeg");

    const videoId = insertVideoMaterial();
    const audioId = insertAudioMaterial();

    const videoRes = await call(`/api/materials/${videoId}/media`, {
      headers: { Range: "bytes=0-3" },
    });
    expect(videoRes.status).toBe(206);
    expect(videoRes.headers.get("Content-Type")).toMatch(/video\/mp4/i);
    expect(videoRes.headers.get("Content-Range")).toMatch(/^bytes 0-3\//);
    expect((await videoRes.arrayBuffer()).byteLength).toBe(4);

    const audioRes = await call(`/api/materials/${audioId}/media`, {
      headers: { Range: "bytes=0-5" },
    });
    expect(audioRes.status).toBe(206);
    expect(audioRes.headers.get("Content-Type")).toMatch(/audio\/mpeg/i);
    expect(audioRes.headers.get("Content-Range")).toMatch(/^bytes 0-5\//);
    expect((await audioRes.arrayBuffer()).byteLength).toBe(6);
  });

  test("视频 thumbnail 路由仅服务 STORAGE_ROOT 下 thumb.png，且序列化不泄露绝对路径", async () => {
    const id = uid();
    const dir = join(STORAGE_ROOT, "materials", id);
    mkdirSync(dir, { recursive: true });
    const rawPath = join(dir, "raw.mp4");
    const thumbPath = join(dir, "thumb.png");
    writeFileSync(rawPath, Buffer.from("0123456789abcdef"));
    writeFileSync(thumbPath, TINY_PNG);
    db.query(
      "INSERT INTO materials (id, name, raw_path, status, source, folder_id, metadata, created_at) VALUES (?, ?, ?, 'raw', 'upload', NULL, ?, ?)",
    ).run(
      id,
      "poster-video",
      rawPath,
      JSON.stringify({
        mediaKind: "video",
        thumbnailPath: thumbPath,
      }),
      Date.now(),
    );
    trackMaterial(id);

    const list = await call("/api/materials");
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      materials: Array<{ id: string; metadata: Record<string, unknown> }>;
    };
    const material = body.materials.find((row) => row.id === id);
    expect(material).toBeTruthy();
    expect(material!.metadata.thumbnailPath).toBeUndefined();
    expect(material!.metadata.hasThumbnail).toBe(true);
    expect(JSON.stringify(material!.metadata)).not.toContain("thumb.png");
    expect(JSON.stringify(material!.metadata)).not.toContain(dir);

    const thumbRes = await call(`/api/materials/${id}/thumbnail`);
    expect(thumbRes.status).toBe(200);
    expect(thumbRes.headers.get("Content-Type")).toMatch(/image\/png/i);
    expect((await thumbRes.arrayBuffer()).byteLength).toBe(TINY_PNG.byteLength);

    const missing = await call(`/api/materials/${insertVideoMaterial("no-thumb")}/thumbnail`);
    expect(missing.status).toBe(404);
  });

  test("导出 HTTP 剥离密钥；test 端点不归档素材", async () => {
    const TINY_B64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const packed = await packPlugin(
      {
        "plugin.json": JSON.stringify(
          imageManifest({
            plugin_id: "http_export_test",
            secrets: { api_key: { label: "API Key", required: true, secret: true, value: "configured-key" } },
          }),
        ),
        "provider.py":
          `def generate(*, request, secrets, params, helpers):\n    return {'base64': '${TINY_B64}', 'metadata': {'providerTag': 'test-ok'}}\n`,
      },
      "http_export_test.iap",
    );
    expect((await importPlugin(packed.bytes, "http_export_test.iap")).status).toBe(200);

    const exported = await call("/api/media-plugins/image_api/http_export_test/export");
    expect(exported.status).toBe(200);
    expect(exported.headers.get("X-FrameBaker-Secrets-Stripped")).toBe("1");
    const zipBytes = new Uint8Array(await exported.arrayBuffer());
    const entries = listZipEntriesSync(zipBytes);
    const pluginJson = entries.find((e) => e.name.replace(/\\/g, "/").endsWith("plugin.json"));
    expect(pluginJson).toBeTruthy();
    expect(new TextDecoder().decode(pluginJson!.data)).not.toContain("configured-key");

    const beforeCount = (
      db.query("SELECT COUNT(*) AS c FROM materials WHERE source = ?").get("media-plugin:http_export_test") as {
        c: number;
      }
    ).c;
    const testRes = await call("/api/media-plugins/image_api/http_export_test/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "connectivity" }),
    });
    expect(testRes.status).toBe(200);
    const testBody = (await testRes.json()) as {
      result: { ok: boolean; archived: boolean; outputCount: number };
    };
    expect(testBody.result.ok).toBe(true);
    expect(testBody.result.archived).toBe(false);
    expect(testBody.result.outputCount).toBeGreaterThan(0);
    const afterCount = (
      db.query("SELECT COUNT(*) AS c FROM materials WHERE source = ?").get("media-plugin:http_export_test") as {
        c: number;
      }
    ).c;
    expect(afterCount).toBe(beforeCount);

    const tooSmall = await call("/api/media-plugins/image_api/http_export_test/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "connectivity", durationSeconds: 0 }),
    });
    // Elysia schema validation uses 422 (same family as generation duration bounds).
    expect([400, 422]).toContain(tooSmall.status);

    const tooLarge = await call("/api/media-plugins/image_api/http_export_test/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "connectivity", durationSeconds: 601 }),
    });
    expect([400, 422]).toContain(tooLarge.status);

    await call("/api/media-plugins/image_api/http_export_test", { method: "DELETE" });
  });

  test("config/doctor 暴露媒体插件运行时诊断且不含密钥", async () => {
    const config = await call("/api/config");
    expect(config.status).toBe(200);
    const cfg = (await config.json()) as {
      mediaPlugins?: { pythonAvailable?: boolean; installedCount?: number; installRoot?: string };
    };
    expect(cfg.mediaPlugins).toBeTruthy();
    expect(typeof cfg.mediaPlugins?.pythonAvailable).toBe("boolean");
    expect(typeof cfg.mediaPlugins?.installedCount).toBe("number");
    expect(cfg.mediaPlugins?.installRoot).toBeTruthy();
    expect(JSON.stringify(cfg)).not.toMatch(/super-secret|api_key.?value|configured-key/i);

    const doctor = await call("/api/doctor");
    expect(doctor.status).toBe(200);
    const doc = (await doctor.json()) as { checks: Array<{ id: string; ok: boolean; label: string; detail: string }> };
    expect(doc.checks.some((c) => c.id === "media-python" || c.id.includes("media"))).toBe(true);
    expect(JSON.stringify(doc)).not.toMatch(/super-secret|configured-key/i);
  });
});
