import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  MONSTER_DEFAULT_HEIGHT,
  MONSTER_DEFAULT_SIZE,
  MONSTER_DEFAULT_VIDEO_PLUGIN_ID,
  MONSTER_DEFAULT_WIDTH,
  MONSTER_REFERENCE_STEM,
  buildMonsterActionStillPrompt,
  buildMonsterH3I2vaPrompt,
  buildMonsterReferencePrompt,
  clampMonsterPixel,
  collectFilledMonsterJobs,
  ensureMonsterIdleJob,
  MONSTER_DEFAULT_DURATION_SECONDS,
  MONSTER_IDLE_ACTION_ID,
  parseMonsterExtractFps,
  monsterActionById,
} from "@framebaker/shared";
import type { JobType } from "@framebaker/shared";
import { db, STORAGE_ROOT, uid, getMaterial, serializeMaterial } from "./db";
import { broadcast } from "./ws";
import type { ExtractPayload, GeneratePayload } from "./jobs/extract";
import { getMediaPlugin } from "./mediaPlugins/registry";
import { monsterImageJobFields } from "./monsterImage";
import { prepareMonsterI2vJpeg } from "./monsterI2vJpeg";
import type { MediaPluginJobPayload } from "./mediaPlugins/types";
import type { JobPayload } from "./queue";
import type { MonsterPipelineRun, MonsterPipelineStep } from "./monsterPipelineTypes";

export type { MonsterPipelineRun, MonsterPipelineStep } from "./monsterPipelineTypes";

export interface MonsterPipelineRequest {
  appearance?: string;
  name?: string;
  referenceMaterialId?: string | null;
  actions?: Record<string, string | null | undefined> | Array<string | null | undefined>;
  providerId?: string;
  model?: string;
  size?: string;
  width?: number;
  height?: number;
  videoPluginId?: string | null;
  durationSeconds?: number;
  extractFps?: number[];
  extraFps?: number | null;
  autoMatting?: boolean;
  bgKey?: "flood" | "none";
  folderId?: string | null;
  importProjectId?: string | null;
  videoPrompts?: Record<string, string | null | undefined> | Array<string | null | undefined>;
}

function createJob(projectId: string, type: JobType, payload: JobPayload): string {
  const { createJob: enqueue } = require("./queue") as typeof import("./queue");
  return enqueue(projectId, type, payload);
}

export function listMonsterPipelineSteps(run: MonsterPipelineRun): MonsterPipelineStep[] {
  const steps: MonsterPipelineStep[] = [];
  for (const action of run.actions) steps.push({ type: "still", actionId: action.id });
  if (run.videoPluginId) {
    for (const action of run.actions) {
      steps.push({ type: "video", actionId: action.id });
      for (const fps of run.extractFps) steps.push({ type: "extract", actionId: action.id, fps });
    }
  }
  return steps;
}

export function applyMonsterPipelineProduct(run: MonsterPipelineRun, materialIds: string[]): MonsterPipelineRun {
  const steps = listMonsterPipelineSteps(run);
  const step = steps[run.cursor];
  const produced = materialIds[0];
  if (!step) return { ...run, cursor: run.cursor + 1 };
  if (step.type === "extract") {
    if (!materialIds.length) return { ...run, cursor: run.cursor + 1 };
  } else if (!produced) {
    return { ...run, cursor: run.cursor + 1 };
  }
  const next: MonsterPipelineRun = {
    ...run,
    actionStillIds: { ...run.actionStillIds },
    actionVideoIds: { ...run.actionVideoIds },
    extractFrameIds: { ...run.extractFrameIds },
  };
  if (step.type === "reference") next.referenceMaterialId = produced;
  if (step.type === "still") next.actionStillIds[step.actionId] = produced;
  if (step.type === "video") next.actionVideoIds[step.actionId] = produced;
  if (step.type === "extract") next.extractFrameIds[`${step.actionId}:${step.fps}`] = [...materialIds];
  next.cursor = run.cursor + 1;
  return next;
}

export function shouldPackMonsterExtractArchive(before: MonsterPipelineRun, after: MonsterPipelineRun): boolean {
  const step = listMonsterPipelineSteps(before)[before.cursor];
  if (!step || step.type !== "extract") return false;
  return !listMonsterPipelineSteps(after).slice(after.cursor).some((item) => item.type === "extract");
}

function materialRawPath(id: string): string | null {
  const row = db.query("SELECT raw_path FROM materials WHERE id = ?").get(id) as { raw_path: string | null } | null;
  return row?.raw_path ?? null;
}

function ensureMaterialFolder(parentId: string | null, name: string): string {
  if (parentId) {
    const parent = db.query("SELECT id, kind FROM folders WHERE id = ?").get(parentId) as { id: string; kind: string } | null;
    if (!parent || parent.kind !== "material") throw new Error("素材文件夹不存在");
  }
  const id = uid();
  const folderName = (name.trim() || "怪物").slice(0, 48);
  const sortRow = db
    .query("SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM folders WHERE kind = ? AND parent_id IS ?")
    .get("material", parentId) as { next: number };
  db.query("INSERT INTO folders (id, kind, parent_id, name, sort, created_at) VALUES (?, 'material', ?, ?, ?, ?)").run(
    id,
    parentId,
    folderName,
    sortRow.next,
    Date.now(),
  );
  broadcast("folders_changed", { kind: "material" });
  return id;
}

function withPipeline(payload: JobPayload, run: MonsterPipelineRun): JobPayload {
  return { ...payload, monsterPipeline: run };
}

function withPixelLock(prompt: string, width: number, height: number): string {
  return `${prompt}\n\nOutput exactly ${width}×${height} pixels.`;
}

export function enqueueMonsterPipelineStep(run: MonsterPipelineRun): string | null {
  const steps = listMonsterPipelineSteps(run);
  const step = steps[run.cursor];
  if (!step) return null;
  const size = run.size || MONSTER_DEFAULT_SIZE;
  const autoMatting = run.autoMatting;
  if (step.type === "reference") {
    const generate: GeneratePayload = {
      prompt: withPixelLock(buildMonsterReferencePrompt(run.appearance), run.spriteFit.width, run.spriteFit.height),
      count: 1,
      autoMatting,
      target: { kind: "materials" },
      name: `${run.name} ${MONSTER_REFERENCE_STEM}`,
      providerId: run.providerId,
      model: run.model,
      size,
      spriteFit: run.spriteFit,
      folderId: run.folderId,
      intent: "monster-reference",
    };
    return createJob("", "generate_frames", withPipeline({ generate }, run));
  }
  if (step.type === "still") {
    const action = run.actions.find((item) => item.id === step.actionId);
    const refId = run.referenceMaterialId;
    if (!refId) throw new Error("缺少怪物参考图，无法生成动作关键帧");
    const refPath = materialRawPath(refId);
    if (!refPath) throw new Error("怪物参考图文件缺失");
    const generate: GeneratePayload = {
      prompt: withPixelLock(
        buildMonsterActionStillPrompt({
          appearance: run.appearance,
          actionPrompt: action?.prompt,
          hasReference: true,
          actionId: step.actionId,
        }),
        run.spriteFit.width,
        run.spriteFit.height,
      ),
      count: 1,
      autoMatting,
      target: { kind: "materials" },
      name: `${run.name} ${step.actionId}`,
      providerId: run.providerId,
      model: run.model,
      size,
      spriteFit: run.spriteFit,
      folderId: run.folderId,
      intent: "monster-action-still",
      referenceMaterialId: refId,
      referencePaths: [refPath],
    };
    return createJob("", "generate_frames", withPipeline({ generate }, run));
  }
  if (step.type === "video") {
    const pluginId = run.videoPluginId;
    if (!pluginId) throw new Error("未配置视频插件");
    const stillId = run.actionStillIds[MONSTER_IDLE_ACTION_ID] ?? run.referenceMaterialId;
    if (!stillId) throw new Error("缺少待机静图，无法图生视频");
    const jpegPath = prepareMonsterI2vJpeg(stillId);
    const action = run.actions.find((item) => item.id === step.actionId);
    const mediaPlugin: MediaPluginJobPayload = {
      kind: "video_api",
      pluginId,
      prompt: action?.videoPrompt?.trim() || buildMonsterH3I2vaPrompt({
        actionId: step.actionId,
        actionPrompt: action?.prompt,
        durationSeconds: run.durationSeconds,
      }),
      references: [stillId],
      referencePathOverrides: [jpegPath],
      params: {},
      durationSeconds: run.durationSeconds,
      folderId: run.folderId,
      projectId: null,
      name: `${run.name} ${step.actionId} 视频`,
      batchCount: 1,
      batchIndex: 0,
    };
    return createJob("", "media_plugin_video", withPipeline({ mediaPlugin }, run));
  }
  const videoId = run.actionVideoIds[step.actionId];
  if (!videoId) throw new Error("缺少动作视频，无法拆帧");
  const video = db.query("SELECT raw_path, name FROM materials WHERE id = ?").get(videoId) as { raw_path: string | null; name: string } | null;
  if (!video?.raw_path || !existsSync(video.raw_path)) throw new Error("动作视频文件缺失");
  const stagingId = uid();
  const dir = join(STORAGE_ROOT, "staging", stagingId);
  mkdirSync(dir, { recursive: true });
  const ext = video.raw_path.includes(".") ? video.raw_path.split(".").pop()!.toLowerCase() : "mp4";
  const stagingFile = join(dir, `input.${ext}`);
  copyFileSync(video.raw_path, stagingFile);
  const extract: ExtractPayload = {
    stagingFile,
    mediaType: "mp4",
    fps: step.fps,
    autoMatting,
    target: run.importProjectId ? { kind: "project", projectId: run.importProjectId } : { kind: "materials" },
    originName: `${run.name} ${step.actionId} fps${step.fps}`,
    folderId: run.folderId,
    spriteFit: run.spriteFit,
    bgKey: run.bgKey,
  };
  return createJob(run.importProjectId ?? "", "extract_frames", withPipeline({ extract }, run));
}

export function startMonsterReferenceJob(body: MonsterPipelineRequest): { jobId: string } {
  const appearance = (body.appearance ?? "").trim();
  if (!appearance) throw new Error("请填写怪物外貌");
  const width = clampMonsterPixel(body.width, MONSTER_DEFAULT_WIDTH);
  const height = clampMonsterPixel(body.height, MONSTER_DEFAULT_HEIGHT);
  const image = monsterImageJobFields();
  const name = (body.name?.trim() || appearance.slice(0, 24) || "怪物").slice(0, 48);
  const generate: GeneratePayload = {
    prompt: withPixelLock(buildMonsterReferencePrompt(appearance), width, height),
    count: 1,
    autoMatting: body.autoMatting !== false,
    target: { kind: "materials" },
    name: `${name} ${MONSTER_REFERENCE_STEM}`,
    providerId: image.providerId,
    model: image.model,
    size: image.size,
    spriteFit: { width, height },
    folderId: body.folderId ?? null,
    intent: "monster-reference",
  };
  return { jobId: createJob("", "generate_frames", { generate }) };
}

export function startMonsterPipeline(body: MonsterPipelineRequest): { pipelineId: string; jobId: string; folderId: string } {
  const appearance = (body.appearance ?? "").trim();
  const referenceMaterialId = body.referenceMaterialId?.trim() || undefined;
  if (!referenceMaterialId) throw new Error("请先选定或上传一张怪物参考图");
  const material = getMaterial(referenceMaterialId);
  if (!material) throw new Error("参考素材不存在");
  if (serializeMaterial(material).mediaKind !== "image") throw new Error("参考图必须是图片素材");
  let filled = collectFilledMonsterJobs(body.actions ?? {}, body.videoPrompts);
  if (!filled.length) throw new Error("请至少填写一个动作的静图或视频提示词");
  const videoPluginIdRaw = body.videoPluginId === undefined ? MONSTER_DEFAULT_VIDEO_PLUGIN_ID : body.videoPluginId;
  let videoPluginId = videoPluginIdRaw?.trim() || null;
  if (videoPluginId) {
    const plugin = getMediaPlugin("video_api", videoPluginId);
    const explicit = body.videoPluginId !== undefined && Boolean(String(body.videoPluginId).trim());
    if (!plugin || !plugin.runnable) {
      if (explicit) throw new Error(plugin ? `视频插件不可运行（缺少密钥或 provider.py）: ${videoPluginId}` : `视频插件不存在: ${videoPluginId}`);
      videoPluginId = null;
    }
  }
  if (videoPluginId) filled = ensureMonsterIdleJob(filled);
  if (body.importProjectId) {
    const project = db.query("SELECT id, kind FROM projects WHERE id = ?").get(body.importProjectId) as { id: string; kind: string } | null;
    if (!project) throw new Error("目标项目不存在");
    if (project.kind !== "frame") throw new Error("拆帧只能导入逐帧项目");
  }
  const name = (body.name?.trim() || appearance.slice(0, 24) || "怪物").slice(0, 48);
  const folderId = ensureMaterialFolder(body.folderId ?? null, name);
  const extractFps = parseMonsterExtractFps(body.extractFps ?? [4], body.extraFps ?? null);
  const width = clampMonsterPixel(body.width, MONSTER_DEFAULT_WIDTH);
  const height = clampMonsterPixel(body.height, MONSTER_DEFAULT_HEIGHT);
  const image = monsterImageJobFields();
  const run: MonsterPipelineRun = {
    pipelineId: uid(),
    appearance,
    name,
    folderId,
    providerId: image.providerId,
    model: image.model,
    size: image.size,
    videoPluginId: filled.length ? videoPluginId : null,
    durationSeconds: Math.max(4, Math.min(15, Number(body.durationSeconds ?? MONSTER_DEFAULT_DURATION_SECONDS) || MONSTER_DEFAULT_DURATION_SECONDS)),
    extractFps: extractFps.length ? extractFps : [4],
    autoMatting: body.autoMatting !== false,
    bgKey: body.bgKey === "none" ? "none" : "flood",
    importProjectId: body.importProjectId ?? null,
    spriteFit: { width, height },
    actions: filled,
    referenceMaterialId,
    actionStillIds: {},
    actionVideoIds: {},
    extractFrameIds: {},
    cursor: 0,
  };
  if (!listMonsterPipelineSteps(run).length) throw new Error("没有可执行的流水线步骤");
  const jobId = enqueueMonsterPipelineStep(run);
  if (!jobId) throw new Error("流水线没有可执行步骤");
  return { pipelineId: run.pipelineId, jobId, folderId };
}

export function monsterActionTitle(id: string): string {
  return monsterActionById(id)?.title ?? id;
}
