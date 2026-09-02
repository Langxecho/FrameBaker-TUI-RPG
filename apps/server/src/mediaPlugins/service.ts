import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  MediaKind,
  MediaPluginGenerationRequest,
  MediaPluginKind,
  MaterialRow,
} from "@framebaker/shared";
import { db, getMaterial, serializeMaterial, STORAGE_ROOT, uid } from "../db";
import { broadcast } from "../ws";
import { JobCancelledError } from "../jobs/run";
import {
  assertSafeMediaPluginId,
  isPathInside,
  mediaPluginDir,
  mediaPluginKindRoot,
  mediaPluginRunsRoot,
} from "./paths";
import { getMediaPlugin } from "./registry";
import { cleanupMediaPluginRunDir, runMediaPluginPython } from "./runner";
import { readManifestFile, validateParamDefaults } from "./manifest";
import { downloadHttpUrlToFile } from "./safeDownload";
import { MediaPluginServiceError } from "./types";
import type { MediaPluginJobPayload } from "./types";

export type ArchiveMediaArtifactInput = {
  mediaKind: MediaKind;
  sourcePath: string;
  name: string;
  pluginId: string;
  pluginVersion: string;
  prompt: string;
  params: Record<string, unknown>;
  references: string[];
  folderId: string | null;
  projectId: string | null;
  providerMetadata: Record<string, unknown>;
  batchCount?: number;
  batchIndex?: number;
};

function mediaKindForPlugin(kind: MediaPluginKind): MediaKind {
  if (kind === "image_api") return "image";
  if (kind === "video_api") return "video";
  return "audio";
}

function jobTypeForPlugin(kind: MediaPluginKind): "media_plugin_image" | "media_plugin_video" | "media_plugin_audio" {
  if (kind === "image_api") return "media_plugin_image";
  if (kind === "video_api") return "media_plugin_video";
  return "media_plugin_audio";
}

function assertNonEmptyFile(path: string): void {
  if (!existsSync(path)) throw new Error(`插件产出文件不存在: ${path}`);
  const size = statSync(path).size;
  if (size <= 0) throw new Error(`插件产出文件为空: ${path}`);
}

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (/secret|api[_-]?key|token|password|authorization/i.test(k)) continue;
    out[k] = stripSecrets(v);
  }
  return out;
}

/** 仅接受 materials 表中的 ID；按插件媒体类型校验参考素材类型。 */
export function resolveMediaPluginReferences(
  kind: MediaPluginKind,
  references: string[] | undefined,
): { ids: string[]; imageUrls: string[]; audioUrls: string[] } {
  const ids = (references ?? []).map((id) => String(id ?? "").trim()).filter(Boolean);
  const imageUrls: string[] = [];
  const audioUrls: string[] = [];
  for (const id of ids) {
    if (id.includes("/") || id.includes("\\") || id.includes(":") || id.includes("..")) {
      throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `参考素材必须是素材 ID，不能是路径: ${id}`);
    }
    const row = getMaterial(id);
    if (!row) {
      throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `参考素材不存在: ${id}`, 404);
    }
    const material = serializeMaterial(row);
    const mediaKind = material.mediaKind;
    if (kind === "image_api" || kind === "video_api") {
      if (mediaKind !== "image") {
        throw new MediaPluginServiceError(
          "PLUGIN_PARAMETER_INVALID",
          `该插件仅接受图片参考素材，收到 ${mediaKind}: ${id}`,
        );
      }
      if (!row.raw_path || !existsSync(row.raw_path)) {
        throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `参考素材文件缺失: ${id}`);
      }
      imageUrls.push(pathToFileURL(resolve(row.raw_path)).href);
    } else {
      // audio_api：图片参考走 imageUrls，音频参考走 audioUrls
      if (mediaKind === "image") {
        if (!row.raw_path || !existsSync(row.raw_path)) {
          throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `参考素材文件缺失: ${id}`);
        }
        imageUrls.push(pathToFileURL(resolve(row.raw_path)).href);
      } else if (mediaKind === "audio") {
        if (!row.raw_path || !existsSync(row.raw_path)) {
          throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `参考素材文件缺失: ${id}`);
        }
        audioUrls.push(pathToFileURL(resolve(row.raw_path)).href);
      } else {
        throw new MediaPluginServiceError(
          "PLUGIN_PARAMETER_INVALID",
          `音频插件不支持视频参考素材: ${id}`,
        );
      }
    }
  }
  return { ids, imageUrls, audioUrls };
}

function importImageMaterialToProject(m: MaterialRow, projectId: string): void {
  const project = db.query("SELECT id FROM projects WHERE id = ?").get(projectId) as { id: string } | null;
  if (!project) throw new Error(`项目不存在: ${projectId}`);
  if (serializeMaterial(m).mediaKind !== "image") {
    throw new Error(`仅图片素材可导入项目帧`);
  }
  // 延迟导入，避免 service ↔ api/materials ↔ queue 循环依赖
  const { importMaterialToProject } = require("../api/materials") as typeof import("../api/materials");
  importMaterialToProject(m, projectId);
  broadcast("frames_changed", { projectId });
}

/** 统一归档媒体产物到 materials；图片可选导入项目（失败保留素材）。 */
export function archiveMediaArtifact(input: ArchiveMediaArtifactInput): { materialId: string; mediaKind: MediaKind } {
  assertNonEmptyFile(input.sourcePath);

  const materialId = uid();
  const dir = join(STORAGE_ROOT, "materials", materialId);
  mkdirSync(dir, { recursive: true });

  let rawPath: string;
  const providerMeta = (stripSecrets(input.providerMetadata) as Record<string, unknown>) ?? {};
  const metadata: Record<string, unknown> = {
    mediaKind: input.mediaKind,
    pluginId: input.pluginId,
    pluginVersion: input.pluginVersion,
    prompt: input.prompt,
    params: stripSecrets(input.params),
    references: input.references,
    batchCount: input.batchCount,
    batchIndex: input.batchIndex,
    ...providerMeta,
  };

  if (input.mediaKind === "image") {
    rawPath = join(dir, "raw.png");
    try {
      renameSync(input.sourcePath, rawPath);
    } catch {
      copyFileSync(input.sourcePath, rawPath);
      rmSync(input.sourcePath, { force: true });
    }
  } else if (input.mediaKind === "video") {
    const ext = extname(input.sourcePath) || ".mp4";
    rawPath = join(dir, `raw${ext.toLowerCase()}`);
    try {
      renameSync(input.sourcePath, rawPath);
    } catch {
      copyFileSync(input.sourcePath, rawPath);
      rmSync(input.sourcePath, { force: true });
    }
    // 同步尽力生成首帧；失败不阻断归档
    const ffmpeg = Bun.which("ffmpeg");
    if (ffmpeg) {
      const thumb = join(dir, "thumb.png");
      try {
        // 同步阻塞调用：测试环境可能无 ffmpeg，忽略失败
        const proc = Bun.spawnSync([ffmpeg, "-y", "-i", rawPath, "-frames:v", "1", thumb], {
          stdout: "ignore",
          stderr: "ignore",
        });
        if (proc.exitCode === 0 && existsSync(thumb) && statSync(thumb).size > 0) {
          metadata.thumbnailPath = thumb;
        } else {
          rmSync(thumb, { force: true });
        }
      } catch {
        rmSync(thumb, { force: true });
      }
    }
  } else {
    const ext = extname(input.sourcePath) || ".mp3";
    rawPath = join(dir, `raw${ext.toLowerCase()}`);
    try {
      renameSync(input.sourcePath, rawPath);
    } catch {
      copyFileSync(input.sourcePath, rawPath);
      rmSync(input.sourcePath, { force: true });
    }
    metadata.format = ext.replace(/^\./, "").toLowerCase() || "mp3";
    if (typeof providerMeta.durationSeconds === "number") metadata.durationSeconds = providerMeta.durationSeconds;
    else if (typeof providerMeta.duration === "number") metadata.durationSeconds = providerMeta.duration;
    if (typeof providerMeta.sampleRate === "number") metadata.sampleRate = providerMeta.sampleRate;
  }

  assertNonEmptyFile(rawPath);
  const source = `media-plugin:${input.pluginId}`;
  db.query(
    "INSERT INTO materials (id, name, raw_path, status, source, folder_id, metadata, created_at) VALUES (?, ?, ?, 'raw', ?, ?, ?, ?)",
  ).run(materialId, input.name, rawPath, source, input.folderId, JSON.stringify(metadata), Date.now());
  broadcast("materials_changed", {});

  if (input.projectId && input.mediaKind === "image") {
    try {
      const row = getMaterial(materialId);
      if (row) importImageMaterialToProject(row, input.projectId);
    } catch (error) {
      console.error(`[media-plugin] 素材已归档但导入项目失败 (${materialId}):`, error instanceof Error ? error.message : error);
    }
  }

  return { materialId, mediaKind: input.mediaKind };
}

function assertMaterialFolderId(folderId: string | null): string | null {
  if (!folderId) return null;
  const folder = db.query("SELECT id, kind FROM folders WHERE id = ?").get(folderId) as
    | { id: string; kind: string }
    | null;
  if (!folder) {
    throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `文件夹不存在: ${folderId}`, 404);
  }
  if (folder.kind !== "material") {
    throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `文件夹类型须为 material: ${folderId}`);
  }
  return folderId;
}

function nonNegativeInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  return fallback;
}

function constraintFlag(constraints: Record<string, unknown>, key: string, fallback: boolean): boolean {
  if (key in constraints) return Boolean(constraints[key]);
  return fallback;
}

function capabilityFallback(capabilities: string[], token: string): boolean {
  return capabilities.includes(token);
}

/** 入队前校验可选 projectId：必须存在且为逐帧（图片）项目。 */
function assertImageProjectTarget(kind: MediaPluginKind, projectId: string | null): string | null {
  if (!projectId) return null;
  if (mediaKindForPlugin(kind) !== "image") {
    throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", "仅图片插件支持导入项目");
  }
  const project = db.query("SELECT id, kind FROM projects WHERE id = ?").get(projectId) as
    | { id: string; kind: string }
    | null;
  if (!project) {
    throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `项目不存在: ${projectId}`, 404);
  }
  if (project.kind !== "frame") {
    throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `仅逐帧项目可作为图片生成导入目标: ${projectId}`);
  }
  return projectId;
}

/** 按插件 constraints 校验参考数量与推断模式，避免排队后才失败。 */
function assertManifestGenerationConstraints(
  kind: MediaPluginKind,
  detail: { capabilities: string[]; constraints: Record<string, unknown> },
  refs: { imageUrls: string[]; audioUrls: string[] },
): void {
  const constraints = detail.constraints ?? {};
  const capabilities = detail.capabilities ?? [];
  const imageCount = refs.imageUrls.length;
  const audioCount = refs.audioUrls.length;

  if (kind === "image_api") {
    const maxImages = nonNegativeInt(constraints.max_reference_images, 8);
    const supportsText = constraintFlag(constraints, "supports_text2image", true);
    const supportsImage = constraintFlag(constraints, "supports_image2image", true);
    const mode = imageCount >= 2 ? "multi_ref" : imageCount === 1 ? "i2i" : "t2i";
    if (mode === "t2i" && !supportsText) {
      throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", "该图片插件不支持文生图（t2i）");
    }
    if ((mode === "i2i" || mode === "multi_ref") && !supportsImage) {
      throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `该图片插件不支持 ${mode}`);
    }
    if (imageCount > maxImages) {
      throw new MediaPluginServiceError(
        "PLUGIN_PARAMETER_INVALID",
        `参考图片数量超过限制（最多 ${maxImages}）`,
      );
    }
    return;
  }

  if (kind === "video_api") {
    const maxImages = nonNegativeInt(constraints.max_reference_images, 1);
    const supportsText = constraintFlag(
      constraints,
      "supports_text2video",
      capabilityFallback(capabilities, "t2v"),
    );
    const supportsImage = constraintFlag(
      constraints,
      "supports_image2video",
      capabilityFallback(capabilities, "i2v"),
    );
    const mode = imageCount > 0 ? "i2v" : "t2v";
    if (mode === "t2v" && !supportsText) {
      throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", "该视频插件不支持文生视频（t2v）");
    }
    if (mode === "i2v" && !supportsImage) {
      throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", "该视频插件不支持图生视频（i2v）");
    }
    if (imageCount > maxImages) {
      throw new MediaPluginServiceError(
        "PLUGIN_PARAMETER_INVALID",
        `参考图片数量超过限制（最多 ${maxImages}）`,
      );
    }
    return;
  }

  const maxImages = nonNegativeInt(constraints.max_reference_images, 1);
  const maxAudios = nonNegativeInt(constraints.max_reference_audios, 1);
  const supportsText = constraintFlag(
    constraints,
    "supports_text2audio",
    capabilityFallback(capabilities, "t2a"),
  );
  const supportsImage = constraintFlag(
    constraints,
    "supports_image2audio",
    capabilityFallback(capabilities, "i2a"),
  );
  const supportsAudio = constraintFlag(
    constraints,
    "supports_audio2audio",
    capabilityFallback(capabilities, "a2a"),
  );
  const mode = audioCount > 0 ? "a2a" : imageCount > 0 ? "i2a" : "t2a";
  if (mode === "t2a" && !supportsText) {
    throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", "该音频插件不支持文生音频（t2a）");
  }
  if (mode === "i2a" && !supportsImage) {
    throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", "该音频插件不支持图生音频（i2a）");
  }
  if (mode === "a2a" && !supportsAudio) {
    throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", "该音频插件不支持音频参考（a2a）");
  }
  if (imageCount > maxImages) {
    throw new MediaPluginServiceError(
      "PLUGIN_PARAMETER_INVALID",
      `参考图片数量超过限制（最多 ${maxImages}）`,
    );
  }
  if (audioCount > maxAudios) {
    throw new MediaPluginServiceError(
      "PLUGIN_PARAMETER_INVALID",
      `参考音频数量超过限制（最多 ${maxAudios}）`,
    );
  }
}

export type MediaPluginTestResult = {
  ok: boolean;
  kind: MediaPluginKind;
  pluginId: string;
  mediaKind: MediaKind;
  latencyMs: number;
  outputCount: number;
  archived: false;
  code?: string;
  error?: string;
};

/** 同步连通测试：临时目录执行插件，校验产出后清理；永不创建 materials / jobs。 */
export async function testMediaPlugin(
  kind: MediaPluginKind,
  pluginIdRaw: string,
  options?: {
    prompt?: string;
    params?: Record<string, unknown>;
    durationSeconds?: number | null;
    bridgeTimeoutMs?: number;
  },
): Promise<MediaPluginTestResult> {
  const pluginId = assertSafeMediaPluginId(pluginIdRaw);
  const detail = getMediaPlugin(kind, pluginId);
  if (!detail) {
    throw new MediaPluginServiceError("PLUGIN_NOT_FOUND", `插件不存在: ${kind}/${pluginId}`, 404);
  }
  if (!detail.runnable) {
    throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `插件不可运行（缺少密钥或 provider.py）: ${pluginId}`);
  }
  const prompt = String(options?.prompt ?? "FrameBaker media plugin connectivity test").trim();
  if (!prompt) throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", "prompt 不能为空");
  const params = options?.params ?? {};
  validateParamDefaults(detail.paramsSchema, params);
  const mediaKind = mediaKindForPlugin(kind);
  const durationSeconds =
    options?.durationSeconds != null
      ? options.durationSeconds
      : mediaKind === "image"
        ? null
        : 2;
  const outputDir = join(mediaPluginRunsRoot(), `test_${pluginId}_${Date.now()}`);
  mkdirSync(outputDir, { recursive: true });
  const started = Date.now();
  try {
    const runnerPayload = await runMediaPluginPython(
      {
        kind,
        pluginId,
        pluginRoot: mediaPluginKindRoot(kind),
        prompt,
        imageUrls: [],
        audioUrls: [],
        durationSeconds,
        params,
        outputDir,
        bridgeTimeoutMs: options?.bridgeTimeoutMs ?? 120_000,
      },
      { bridgeTimeoutMs: options?.bridgeTimeoutMs ?? 120_000 },
    );
    if (!runnerPayload.ok) {
      return {
        ok: false,
        kind,
        pluginId,
        mediaKind,
        latencyMs: Date.now() - started,
        outputCount: 0,
        archived: false,
        code: runnerPayload.code,
        error: runnerPayload.error || runnerPayload.code || "插件测试失败",
      };
    }
    const materialized = materializeRunnerOutputs({
      kind,
      pluginId,
      result: runnerPayload.result,
      outputDir,
    });
    const localPaths: string[] = [];
    for (const item of materialized.paths) {
      if (item.startsWith("url:")) {
        const url = item.slice(4);
        const filename =
          materialized.mediaKind === "image" ? "result.png" : materialized.mediaKind === "video" ? "result.mp4" : "result.mp3";
        localPaths.push(await downloadUrlToOutput(url, outputDir, filename));
      } else {
        localPaths.push(item);
      }
    }
    for (const p of localPaths) assertNonEmptyFile(p);
    return {
      ok: true,
      kind,
      pluginId,
      mediaKind,
      latencyMs: Date.now() - started,
      outputCount: localPaths.length,
      archived: false,
    };
  } finally {
    cleanupMediaPluginRunDir(outputDir);
  }
}

export function createMediaGenerationJobs(request: MediaPluginGenerationRequest): string[] {
  const kind = request.kind;
  const pluginId = assertSafeMediaPluginId(request.pluginId);
  const detail = getMediaPlugin(kind, pluginId);
  if (!detail) {
    throw new MediaPluginServiceError("PLUGIN_NOT_FOUND", `插件不存在: ${kind}/${pluginId}`, 404);
  }
  if (!detail.runnable) {
    throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `插件不可运行（缺少密钥或 provider.py）: ${pluginId}`);
  }
  const prompt = String(request.prompt ?? "").trim();
  if (!prompt) throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", "prompt 不能为空");

  const params = request.params ?? {};
  validateParamDefaults(detail.paramsSchema, params);

  const refs = resolveMediaPluginReferences(kind, request.references);
  assertManifestGenerationConstraints(kind, detail, refs);
  const count = Math.max(1, Math.floor(request.count ?? 1));
  const jobCount = mediaKindForPlugin(kind) === "video" ? 1 : count;
  const name = (request.name?.trim() || prompt.slice(0, 40) || "media-plugin").slice(0, 200);
  const folderId = assertMaterialFolderId(request.folderId ?? null);
  const projectId = assertImageProjectTarget(kind, request.projectId ?? null);

  // 延迟导入避免 queue ↔ service 循环依赖
  const { createJob } = require("../queue") as typeof import("../queue");
  const ids: string[] = [];
  for (let batchIndex = 0; batchIndex < jobCount; batchIndex++) {
    const payload: MediaPluginJobPayload = {
      kind,
      pluginId,
      prompt,
      references: refs.ids,
      params,
      durationSeconds: request.durationSeconds ?? null,
      folderId,
      projectId,
      name: jobCount > 1 ? `${name} #${batchIndex + 1}` : name,
      batchCount: jobCount,
      batchIndex,
    };
    ids.push(createJob(projectId ?? "", jobTypeForPlugin(kind), { mediaPlugin: payload }));
  }
  return ids;
}

export function materializeRunnerOutputs(options: {
  kind: MediaPluginKind;
  pluginId: string;
  result: Record<string, unknown>;
  outputDir: string;
}): { mediaKind: MediaKind; paths: string[]; providerMetadata: Record<string, unknown> } {
  const mediaKind = mediaKindForPlugin(options.kind);
  const providerMetadata =
    options.result.metadata && typeof options.result.metadata === "object" && !Array.isArray(options.result.metadata)
      ? (options.result.metadata as Record<string, unknown>)
      : {};

  const ensureContained = (filePath: string) => {
    const resolved = resolve(filePath);
    if (!isPathInside(resolved, resolve(options.outputDir))) {
      throw new MediaPluginServiceError(
        "PLUGIN_OUTPUT_INVALID",
        `插件产出路径逃逸 outputDir: ${filePath}`,
      );
    }
    assertNonEmptyFile(resolved);
    return resolved;
  };

  if (mediaKind === "image") {
    const paths: string[] = [];
    const multi = Array.isArray(options.result.image_paths) ? options.result.image_paths : null;
    if (multi && multi.length > 0) {
      for (const item of multi) {
        if (typeof item !== "string" || !item.trim()) {
          throw new MediaPluginServiceError("PLUGIN_OUTPUT_INVALID", "插件 image_paths 含无效路径");
        }
        paths.push(ensureContained(item.trim()));
      }
    } else {
      const imagePath = typeof options.result.image_path === "string" ? options.result.image_path.trim() : "";
      if (imagePath) {
        paths.push(ensureContained(imagePath));
      } else if (typeof options.result.base64 === "string" && options.result.base64.trim()) {
        const dest = join(options.outputDir, "result.png");
        writeFileSync(dest, Buffer.from(options.result.base64.trim(), "base64"));
        paths.push(ensureContained(dest));
      } else if (typeof options.result.url === "string" && options.result.url.trim()) {
        // URL 由归档阶段有界下载到 outputDir（拒绝 file:）
        paths.push(`url:${options.result.url.trim()}`);
      } else {
        throw new MediaPluginServiceError(
          "PLUGIN_OUTPUT_INVALID",
          "插件未返回 image_path / image_paths / base64 / url",
        );
      }
    }
    return { mediaKind, paths, providerMetadata };
  }

  if (mediaKind === "video") {
    const videoPath = typeof options.result.video_path === "string" ? options.result.video_path.trim() : "";
    if (videoPath) {
      return { mediaKind, paths: [ensureContained(videoPath)], providerMetadata };
    }
    if (typeof options.result.url === "string" && options.result.url.trim()) {
      // URL 由归档阶段有界下载到 outputDir（拒绝 file:）
      return { mediaKind, paths: [`url:${options.result.url.trim()}`], providerMetadata };
    }
    throw new MediaPluginServiceError("PLUGIN_OUTPUT_INVALID", "插件未返回 video_path / url");
  }

  const audioPath = typeof options.result.audio_path === "string" ? options.result.audio_path.trim() : "";
  if (audioPath) {
    return { mediaKind, paths: [ensureContained(audioPath)], providerMetadata };
  }
  if (typeof options.result.url === "string" && options.result.url.trim()) {
    // URL 由归档阶段有界下载到 outputDir（拒绝 file:）
    return { mediaKind, paths: [`url:${options.result.url.trim()}`], providerMetadata };
  }
  throw new MediaPluginServiceError("PLUGIN_OUTPUT_INVALID", "插件未返回 audio_path / url");
}

export async function downloadUrlToOutput(url: string, outputDir: string, filename: string, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw new JobCancelledError();
  return downloadHttpUrlToFile(url, { outputDir, filename, signal });
}

export function readPluginVersion(kind: MediaPluginKind, pluginId: string): string {
  try {
    return readManifestFile(mediaPluginDir(kind, pluginId)).version;
  } catch {
    return "0.0.0";
  }
}

/** 多输出归档：任一失败则抛错，已成功归档的素材保留。 */
export function archiveMaterializedOutputs(input: {
  mediaKind: MediaKind;
  paths: string[];
  name: string;
  pluginId: string;
  pluginVersion: string;
  prompt: string;
  params: Record<string, unknown>;
  references: string[];
  folderId: string | null;
  projectId: string | null;
  providerMetadata: Record<string, unknown>;
  batchCount?: number;
  batchIndex?: number;
}): Array<{ materialId: string; mediaKind: MediaKind }> {
  if (!input.paths.length) throw new Error("插件未产出任何文件");
  const results: Array<{ materialId: string; mediaKind: MediaKind }> = [];
  for (let i = 0; i < input.paths.length; i++) {
    const archived = archiveMediaArtifact({
      mediaKind: input.mediaKind,
      sourcePath: input.paths[i]!,
      name: input.paths.length > 1 ? `${input.name} #${i + 1}` : input.name,
      pluginId: input.pluginId,
      pluginVersion: input.pluginVersion,
      prompt: input.prompt,
      params: input.params,
      references: input.references,
      folderId: input.folderId,
      projectId: input.projectId,
      providerMetadata: input.providerMetadata,
      batchCount: input.batchCount,
      batchIndex: input.batchIndex,
    });
    results.push(archived);
  }
  return results;
}
