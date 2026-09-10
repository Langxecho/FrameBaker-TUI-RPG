import { mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { MediaPluginResult } from "@framebaker/shared";
import { JobCancelledError } from "./run";
import { getMediaPlugin } from "../mediaPlugins/registry";
import { mediaPluginKindRoot, mediaPluginRunsRoot } from "../mediaPlugins/paths";
import { cleanupMediaPluginRunDir, runMediaPluginPython, type RunMediaPluginOptions } from "../mediaPlugins/runner";
import type { MediaPluginRunnerPayload, MediaPluginRunnerRequest } from "../mediaPlugins/pythonEnv";
import {
  archiveMaterializedOutputs,
  downloadUrlToOutput,
  materializeRunnerOutputs,
  readPluginVersion,
  resolveMediaPluginReferences,
} from "../mediaPlugins/service";
import { MediaPluginServiceError, type MediaPluginJobPayload } from "../mediaPlugins/types";

export type { MediaPluginJobPayload };

/** 执行媒体插件任务：校验 → Python runner → 产出校验 → 归档。 */
export async function runMediaPluginJob(
  payload: MediaPluginJobPayload,
  report: (progress: string) => void,
  signal?: AbortSignal,
): Promise<MediaPluginResult[]> {
  if (signal?.aborted) throw new JobCancelledError();

  const detail = getMediaPlugin(payload.kind, payload.pluginId);
  if (!detail) {
    throw new MediaPluginServiceError("PLUGIN_NOT_FOUND", `插件不存在: ${payload.kind}/${payload.pluginId}`, 404);
  }

  report(`正在准备插件 ${payload.pluginId}`);
  const refs = resolveMediaPluginReferences(payload.kind, payload.references, payload.referencePathOverrides);
  // Python runtime 扫描的是 kind 根目录（其下每个 plugin_id 子目录），不是单个插件目录
  const pluginRoot = mediaPluginKindRoot(payload.kind);
  const outputDir = join(mediaPluginRunsRoot(), `${payload.pluginId}_${Date.now()}_${payload.batchIndex}`);
  mkdirSync(outputDir, { recursive: true });

  try {
    if (signal?.aborted) throw new JobCancelledError();
    report("正在调用插件");

    const runnerPayload = await runMediaPluginPythonWithUploadRetry(
      {
        kind: payload.kind,
        pluginId: payload.pluginId,
        pluginRoot,
        prompt: payload.prompt,
        imageUrls: refs.imageUrls,
        audioUrls: refs.audioUrls,
        durationSeconds: payload.durationSeconds,
        params: payload.params ?? {},
        outputDir,
        bridgeTimeoutMs: payload.bridgeTimeoutMs,
      },
      { signal, bridgeTimeoutMs: payload.bridgeTimeoutMs },
      report,
    );

    if (signal?.aborted) throw new JobCancelledError();
    if (!runnerPayload.ok) {
      const code = runnerPayload.code || "PLUGIN_RUNTIME_ERROR";
      const message = runnerPayload.error || "插件运行失败";
      throw new MediaPluginServiceError(
        code === "PLUGIN_RUNTIME_TIMEOUT" ? "PLUGIN_RUNTIME_TIMEOUT" : "PLUGIN_RUNTIME_ERROR",
        message.startsWith(code) ? message : `${code}: ${message}`,
        code === "PLUGIN_RUNTIME_TIMEOUT" ? 504 : 500,
      );
    }

    report("正在整理输出");
    const materialized = materializeRunnerOutputs({
      kind: payload.kind,
      pluginId: payload.pluginId,
      result: runnerPayload.result,
      outputDir,
    });

    const localPaths: string[] = [];
    for (let i = 0; i < materialized.paths.length; i++) {
      const item = materialized.paths[i]!;
      if (item.startsWith("url:")) {
        const url = item.slice(4);
        const filename =
          materialized.mediaKind === "image"
            ? `result_${i + 1}.png`
            : materialized.mediaKind === "video"
              ? "result.mp4"
              : "result.mp3";
        report(`正在下载结果 ${i + 1}/${materialized.paths.length}`);
        localPaths.push(await downloadUrlToOutput(url, outputDir, filename, signal));
      } else {
        localPaths.push(item);
      }
    }

    if (signal?.aborted) throw new JobCancelledError();
    report("正在归档素材");
    const version = readPluginVersion(payload.kind, payload.pluginId);
    const archived = archiveMaterializedOutputs({
      mediaKind: materialized.mediaKind,
      paths: localPaths,
      name: payload.name,
      pluginId: payload.pluginId,
      pluginVersion: version,
      prompt: payload.prompt,
      params: payload.params ?? {},
      references: refs.ids,
      folderId: payload.folderId,
      projectId: payload.projectId,
      providerMetadata: materialized.providerMetadata,
      batchCount: payload.batchCount,
      batchIndex: payload.batchIndex,
    });
    return archived.map((item) => ({
      materialId: item.materialId,
      mediaKind: item.mediaKind,
      metadata: { batchIndex: payload.batchIndex, batchCount: payload.batchCount },
    }));
  } finally {
    cleanupMediaPluginRunDir(outputDir);
  }
}

export function isRetryableMediaPluginUploadError(message: string): boolean {
  return /上传参考图失败 HTTP 50[234]/.test(message);
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new JobCancelledError();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new JobCancelledError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function runMediaPluginPythonWithUploadRetry(
  request: MediaPluginRunnerRequest,
  options: RunMediaPluginOptions,
  report: (progress: string) => void,
): Promise<MediaPluginRunnerPayload> {
  const maxAttempts = 4;
  let last: MediaPluginRunnerPayload | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      report(`参考图网关繁忙，正在重试（${attempt}/${maxAttempts - 1}）`);
      try {
        unlinkSync(join(request.outputDir, "result.json"));
      } catch {
        /* ignore */
      }
      await sleep(2000 * attempt, options.signal);
    }
    try {
      last = await runMediaPluginPython(request, options);
    } catch (error) {
      if (error instanceof JobCancelledError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (attempt < maxAttempts - 1 && isRetryableMediaPluginUploadError(message)) continue;
      throw error;
    }
    if (last.ok) return last;
    const message = `${last.error ?? ""} ${last.code ?? ""}`;
    if (attempt < maxAttempts - 1 && isRetryableMediaPluginUploadError(message)) continue;
    return last;
  }
  return last!;
}
