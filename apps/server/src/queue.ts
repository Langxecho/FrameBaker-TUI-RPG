import type { JobType } from "@framebaker/shared";
import { db, uid } from "./db";
import { broadcast } from "./ws";
import { buildGeneratedFollowUp, extractFrames, generateFrames, type ExtractPayload, type GeneratePayload } from "./jobs/extract";
import { getSettingJson } from "./provider";
import { matte } from "./jobs/matting";
import { JobCancelledError } from "./jobs/run";
import { splitImageLayers, type ImageLayersPayload } from "./jobs/imageLayers";
import { runMediaPluginJob } from "./jobs/mediaPlugin";
import { sanitizeMediaPluginDiagnostic } from "./mediaPlugins/diagnostics";
import type { MediaPluginJobPayload } from "./mediaPlugins/types";
import { applyMonsterPipelineProduct, enqueueMonsterPipelineStep, shouldPackMonsterExtractArchive } from "./monsterPipeline";
import { packMonsterExtractArchive } from "./monsterExtractArchive";
import type { MonsterPipelineRun } from "./monsterPipelineTypes";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { mediaPluginDir, mediaPluginRunsRoot } from "./mediaPlugins/paths";
import { compactMediaPluginRunDir } from "./mediaPlugins/runner";
import { releaseMediaPluginRuntimeRun } from "./mediaPlugins/runtime";
import { resolveMediaPythonExecutable } from "./mediaPlugins/pythonEnv";

export interface JobPayload {
  extract?: ExtractPayload;
  generate?: GeneratePayload;
  matting?: { target: "frame" | "material"; id: string };
  imageLayers?: ImageLayersPayload;
  mediaPlugin?: MediaPluginJobPayload;
  monsterPipeline?: MonsterPipelineRun;
}

// 任务负载只存内存（状态落 SQLite），重启后 queued/running 任务不会恢复
const payloads = new Map<string, JobPayload>();
const controllers = new Map<string, AbortController>();
const waiting: string[] = [];
let running = 0;
let pumpRetryTimer: ReturnType<typeof setTimeout> | null = null;
const PROCESS_OWNER = `${process.pid}:${uid()}`;
const JOB_LEASE_MS = 30_000;

type PersistedJob = {
  id: string;
  project_id: string;
  type: string;
  status: string;
  payload: string | null;
  payload_hash: string | null;
  run_owner: string | null;
  lease_expires_at: number | null;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function payloadHash(payload: JobPayload): string {
  return new Bun.CryptoHasher("sha256").update(stableJson(payload)).digest("hex");
}

function parsePayload(row: Pick<PersistedJob, "id" | "payload">): JobPayload | null {
  if (!row.payload) return null;
  try {
    const value = JSON.parse(row.payload) as JobPayload;
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function enqueuePersisted(row: PersistedJob): boolean {
  const payload = parsePayload(row);
  if (!payload) {
    db.query("UPDATE jobs SET status='error', error='任务输入缺失或损坏，无法恢复', execution_phase='blocked_invalid_payload', run_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?").run(Date.now(), row.id);
    return false;
  }
  payloads.set(row.id, payload);
  if (!waiting.includes(row.id)) waiting.push(row.id);
  return true;
}

type ComfyJournal = { status?: string; promptId?: string; output?: Record<string, unknown> };
type TerminalMediaReceipt = {
  schema?: string;
  jobId?: string;
  status?: string;
  materialIds?: unknown;
};

function mediaRunDir(jobId: string): string {
  return join(mediaPluginRunsRoot(), `job_${jobId}`);
}

function readComfyJournal(jobId: string): ComfyJournal | null {
  const path = join(mediaRunDir(jobId), "comfy-journal.json");
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")) as ComfyJournal; } catch { return { status: "invalid" }; }
}

function supportsKnownComfyJournalRecovery(payload: MediaPluginJobPayload): boolean {
  const pluginDir = mediaPluginDir(payload.kind, payload.pluginId);
  const providerPath = join(pluginDir, "provider.py");
  const helperPath = join(pluginDir, "comfy_workflow_provider.py");
  if (!existsSync(providerPath) || !existsSync(helperPath)) return false;
  try {
    if (statSync(providerPath).size > 256 * 1024 || statSync(helperPath).size > 512 * 1024) return false;
    const provider = readFileSync(providerPath, "utf8");
    const helper = readFileSync(helperPath, "utf8");
    return provider.includes("comfy_workflow_provider.py")
      && provider.includes("generate_comfy_video")
      && helper.includes("def generate_comfy_video")
      && helper.includes('if status == "completed"')
      && helper.includes("COMFY_SUBMISSION_STATE_UNKNOWN_RECONCILE_ONLY");
  } catch {
    return false;
  }
}

function readCompletedMediaReceipt(jobId: string): string[] | null {
  const path = join(mediaRunDir(jobId), "result.json");
  if (!existsSync(path) || statSync(path).size > 64 * 1024) return null;
  try {
    const receipt = JSON.parse(readFileSync(path, "utf8")) as TerminalMediaReceipt;
    if (
      receipt.schema !== "framebaker.media-plugin-terminal-result-v1" ||
      receipt.jobId !== jobId ||
      receipt.status !== "done" ||
      !Array.isArray(receipt.materialIds) ||
      receipt.materialIds.length === 0 ||
      !receipt.materialIds.every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)) ||
      new Set(receipt.materialIds).size !== receipt.materialIds.length
    ) return null;
    const outputIndexes = new Set<number>();
    for (const materialId of receipt.materialIds as string[]) {
      const material = db.query("SELECT raw_path,metadata FROM materials WHERE id=?").get(materialId) as {
        raw_path: string | null;
        metadata: string;
      } | null;
      if (!material?.raw_path || !existsSync(material.raw_path) || statSync(material.raw_path).size <= 0) return null;
      const metadata = JSON.parse(material.metadata || "{}") as Record<string, unknown>;
      if (metadata.mediaPluginJobId !== jobId) return null;
      if (typeof metadata.mediaPluginOutputIndex !== "number" || !Number.isInteger(metadata.mediaPluginOutputIndex) || metadata.mediaPluginOutputIndex < 0) return null;
      if (outputIndexes.has(metadata.mediaPluginOutputIndex)) return null;
      outputIndexes.add(metadata.mediaPluginOutputIndex);
    }
    return receipt.materialIds as string[];
  } catch {
    return null;
  }
}

function blockRecovery(id: string, message: string, phase: string): void {
  db.query("UPDATE jobs SET status='error', error=?, execution_phase=?, run_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?")
    .run(message, phase, Date.now(), id);
}

/**
 * 只恢复可证明安全的工作：queued 尚未提交；媒体任务若已知 promptId/完成输出则只 reconcile。
 * 未知提交状态 fail closed，普通 generation 的 running 也绝不盲重发外部请求。
 */
function recoverPersistedJobsUnsafe(now: number): number {
  let recovered = 0;
  const rows = db.query(`SELECT id,project_id,type,status,payload,payload_hash,run_owner,lease_expires_at FROM jobs
    WHERE status='queued' OR (status='running' AND COALESCE(lease_expires_at,0) < ?)
    ORDER BY created_at,id`).all(now) as PersistedJob[];
  for (const row of rows) {
    if (payloads.has(row.id) || waiting.includes(row.id) || controllers.has(row.id)) continue;
    if (row.status === "running") {
      const isMedia = row.type === "media_plugin_image" || row.type === "media_plugin_video" || row.type === "media_plugin_audio";
      if (isMedia) {
        const archivedMaterialIds = readCompletedMediaReceipt(row.id);
        if (archivedMaterialIds) {
          const progress = `完成 materialIds=${JSON.stringify(archivedMaterialIds)}`;
          db.query("UPDATE jobs SET status='done',progress=?,error=NULL,execution_phase='completed',run_owner=NULL,lease_expires_at=NULL,updated_at=? WHERE id=?")
            .run(progress, now, row.id);
          releaseMediaPluginRuntimeRun(`job:${row.id}`);
          recovered++;
          continue;
        }
        const journal = readComfyJournal(row.id);
        if (journal?.status === "submitted" && journal.promptId) {
          db.query("UPDATE jobs SET status='queued', progress='服务重启：恢复已知远端任务轮询', error=NULL, execution_phase='reconcile_known', run_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?").run(now, row.id);
        } else if (journal?.status === "completed" && journal.output) {
          db.query("UPDATE jobs SET status='queued', progress='服务重启：恢复已完成远端产物归档', error=NULL, execution_phase='reconcile_completed', run_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?").run(now, row.id);
        } else if (!journal) {
          blockRecovery(row.id, "服务重启时无法证明媒体任务尚未外部提交；已阻断以避免重复生成", "blocked_unknown_submission");
          continue;
        } else {
          blockRecovery(row.id, `媒体任务提交状态未知（${journal.status ?? "unknown"}），已阻断且不会重发`, "blocked_unknown_submission");
          continue;
        }
      } else if (row.type === "generate_frames") {
        blockRecovery(row.id, "服务重启时生成任务可能已提交外部服务；已阻断以避免重复生成", "blocked_unknown_submission");
        continue;
      } else {
        db.query("UPDATE jobs SET status='queued', progress='服务重启：恢复本地任务', error=NULL, execution_phase='recovered_local', run_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?").run(now, row.id);
      }
    }
    const refreshed = db.query("SELECT id,project_id,type,status,payload,payload_hash,run_owner,lease_expires_at FROM jobs WHERE id=?").get(row.id) as PersistedJob;
    if (enqueuePersisted(refreshed)) recovered++;
  }
  if (recovered) pump();
  return recovered;
}

export function recoverPersistedJobs(now = Date.now()): number {
  try {
    return recoverPersistedJobsUnsafe(now);
  } catch (error) {
    console.error("[queue] persisted-job recovery deferred:", error instanceof Error ? error.message : error);
    schedulePumpRetry();
    return 0;
  }
}

export type KnownMediaRecoveryResult =
  | { ok: true; jobId: string; phase: "reconcile_known" | "reconcile_completed"; promptId: string }
  | { ok: false; status: 404 | 409 | 503; code: string; message: string };

/**
 * Explicitly requeue the same media job only when a supported Comfy journal proves a known remote prompt.
 * Validation is read-only; the job row is changed only after every guard (including Python availability) passes.
 */
export function recoverKnownMediaPluginJob(id: string): KnownMediaRecoveryResult {
  const row = db.query("SELECT id,type,status,payload FROM jobs WHERE id=?").get(id) as {
    id: string;
    type: string;
    status: string;
    payload: string | null;
  } | null;
  if (!row) return { ok: false, status: 404, code: "JOB_NOT_FOUND", message: "任务不存在" };
  if (!isMediaPluginJobType(row.type)) {
    return { ok: false, status: 409, code: "JOB_RECOVERY_UNSUPPORTED", message: "仅媒体插件任务支持已知远端任务恢复" };
  }
  if (row.status === "queued" || row.status === "running") {
    return { ok: false, status: 409, code: "JOB_ALREADY_ACTIVE", message: `任务状态为 ${row.status}，无需重复恢复` };
  }
  if (row.status === "done" || row.status === "cancelled") {
    return { ok: false, status: 409, code: "JOB_TERMINAL_STATE", message: `任务状态为 ${row.status}，拒绝恢复` };
  }
  const payload = parsePayload({ id: row.id, payload: row.payload });
  const mediaPlugin = payload?.mediaPlugin;
  if (!payload || !mediaPlugin) {
    return { ok: false, status: 409, code: "JOB_PAYLOAD_INVALID", message: "任务输入缺失或损坏，无法恢复" };
  }
  const expectedType = mediaPlugin.kind === "image_api"
    ? "media_plugin_image"
    : mediaPlugin.kind === "video_api"
      ? "media_plugin_video"
      : "media_plugin_audio";
  if (row.type !== expectedType) {
    return { ok: false, status: 409, code: "JOB_PAYLOAD_INVALID", message: "任务类型与媒体插件输入不一致" };
  }
  const journal = readComfyJournal(id);
  const promptId = typeof journal?.promptId === "string" && journal.promptId.trim() ? journal.promptId.trim() : null;
  const phase = journal?.status === "completed" && journal.output && typeof journal.output.filename === "string"
    ? "reconcile_completed"
    : journal?.status === "submitted" && promptId
      ? "reconcile_known"
      : null;
  if (!phase || !promptId) {
    return { ok: false, status: 409, code: "KNOWN_REMOTE_JOURNAL_REQUIRED", message: "仅允许恢复包含已知 promptId 的 submitted/completed journal" };
  }
  if (!supportsKnownComfyJournalRecovery(mediaPlugin)) {
    return { ok: false, status: 409, code: "PLUGIN_RECOVERY_UNSUPPORTED", message: "该插件未声明受支持的 Comfy journal 恢复协议" };
  }
  try {
    resolveMediaPythonExecutable();
  } catch (error) {
    return {
      ok: false,
      status: 503,
      code: "PYTHON_RUNTIME_UNAVAILABLE",
      message: error instanceof Error ? error.message : "PYTHON_RUNTIME_UNAVAILABLE",
    };
  }
  const now = Date.now();
  const changed = db.query(`UPDATE jobs SET status='queued',progress=?,error=NULL,execution_phase=?,run_owner=NULL,lease_expires_at=NULL,updated_at=?
    WHERE id=? AND status=?`).run(
      phase === "reconcile_completed" ? "手动恢复：归档已完成远端产物" : "手动恢复：轮询已知远端任务",
      phase,
      now,
      id,
      row.status,
    ) as { changes?: number };
  if ((changed.changes ?? 0) === 0) {
    return { ok: false, status: 409, code: "JOB_STATE_CHANGED", message: "任务状态已变化，请刷新后重试" };
  }
  const refreshed = db.query("SELECT id,project_id,type,status,payload,payload_hash,run_owner,lease_expires_at FROM jobs WHERE id=?").get(id) as PersistedJob;
  if (!enqueuePersisted(refreshed)) {
    return { ok: false, status: 409, code: "JOB_PAYLOAD_INVALID", message: "任务输入缺失或损坏，无法恢复" };
  }
  pump();
  broadcast("job_queued", { id, projectId: refreshed.project_id, type: refreshed.type });
  return { ok: true, jobId: id, phase, promptId };
}

/**
 * 任务队列并发数：settings.queueConcurrency 优先（clamp 1~16），env FRAMEBAKER_QUEUE_CONCURRENCY 兜底，默认 2。
 * 每次实时读取，设置页改动即时生效（pump 频率低，单次轻量 DB 查询开销可忽略）。
 */
export function getQueueConcurrency(): number {
  const clamp = (n: number) => Math.max(1, Math.min(16, Math.floor(n)));
  const saved = getSettingJson<number>("queueConcurrency");
  if (typeof saved === "number" && saved >= 1) return clamp(saved);
  const env = Number(process.env.FRAMEBAKER_QUEUE_CONCURRENCY);
  if (Number.isFinite(env) && env >= 1) return clamp(env);
  return 2;
}

export function createJob(projectId: string, type: JobType, payload: JobPayload, options?: { idempotencyKey?: string }): string {
  const id = uid();
  const serialized = stableJson(payload);
  const hash = payloadHash(payload);
  const idempotencyKey = options?.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const existing = db.query("SELECT id,payload_hash FROM jobs WHERE project_id=? AND type=? AND idempotency_key=?").get(projectId, type, idempotencyKey) as { id: string; payload_hash: string | null } | null;
    if (existing) {
      if (existing.payload_hash !== hash) throw new Error("IDEMPOTENCY_KEY_CONFLICT: 相同幂等键对应不同任务输入");
      return existing.id;
    }
  }
  const now = Date.now();
  try {
    db.query("INSERT INTO jobs (id,project_id,type,status,payload,payload_hash,idempotency_key,execution_phase,created_at,updated_at) VALUES (?,?,?,'queued',?,?,?,'queued',?,?)")
      .run(id, projectId, type, serialized, hash, idempotencyKey, now, now);
  } catch (error) {
    if (!idempotencyKey) throw error;
    const existing = db.query("SELECT id,payload_hash FROM jobs WHERE project_id=? AND type=? AND idempotency_key=?").get(projectId, type, idempotencyKey) as { id: string; payload_hash: string | null } | null;
    if (existing?.payload_hash === hash) return existing.id;
    throw new Error("IDEMPOTENCY_KEY_CONFLICT: 相同幂等键对应不同任务输入");
  }
  payloads.set(id, payload);
  waiting.push(id);
  broadcast("job_queued", { id, projectId, type, pipelineId: payload.monsterPipeline?.pipelineId });
  pump();
  return id;
}

/** 图片批量生成拆成独立任务，由全局队列统一控制并发；视频仍只创建一个任务。 */
export function createGenerationJobs(projectId: string, generate: GeneratePayload, options?: { idempotencyKey?: string }): string[] {
  const count = generate.mediaKind === "video" ? 1 : generate.count;
  return Array.from({ length: count }, (_, batchIndex) =>
    createJob(projectId, "generate_frames", {
      generate: {
        ...generate,
        count: 1,
        batchCount: count,
        batchIndex,
      },
    }, { idempotencyKey: options?.idempotencyKey ? `${options.idempotencyKey}:${batchIndex}/${count}` : undefined })
  );
}

/**
 * 取消任务：queued 直接出队；running 触发 AbortSignal。
 * 返回 false 表示不存在或已结束不可取消。
 */
export function cancelJob(id: string): boolean {
  const job = db.query("SELECT id, project_id, type, status FROM jobs WHERE id = ?").get(id) as {
    id: string;
    project_id: string;
    type: string;
    status: string;
  } | null;
  if (!job) return false;
  if (job.status === "queued") {
    const idx = waiting.indexOf(id);
    if (idx >= 0) waiting.splice(idx, 1);
    setJob(id, "cancelled", "已取消", null);
    payloads.delete(id);
    broadcast("job_cancelled", { id, projectId: job.project_id, type: job.type });
    return true;
  }
  if (job.status === "running") {
    const c = controllers.get(id);
    if (!c) return false; // 可能由另一个仍持有 lease 的服务实例执行，不能伪报已取消。
    if (!c.signal.aborted) c.abort();
    return true;
  }
  return false;
}

/** 同一 frame/material 是否已有排队或运行中的抠图任务 */
export function findActiveMattingJob(target: "frame" | "material", targetId: string): string | null {
  for (const [jobId, payload] of payloads) {
    const m = payload.matting;
    if (!m || m.target !== target || m.id !== targetId) continue;
    const row = db.query("SELECT status FROM jobs WHERE id = ?").get(jobId) as { status: string } | null;
    if (row && (row.status === "queued" || row.status === "running")) return jobId;
  }
  return null;
}

/**
 * 入队抠图（同目标已有 queued/running 则拒绝，避免同一图无限重复抠）。
 * 返回 jobId，或已有任务 id（duplicate=true）。
 */
export function createMattingJob(
  projectId: string,
  target: "frame" | "material",
  targetId: string
): { jobId: string; duplicate: boolean } {
  const existing = findActiveMattingJob(target, targetId);
  if (existing) return { jobId: existing, duplicate: true };
  return { jobId: createJob(projectId, "matting", { matting: { target, id: targetId } }), duplicate: false };
}

function enqueueMatting(projectId: string, target: "frame" | "material", id: string) {
  createMattingJob(projectId, target, id); // 已有进行中任务则忽略（拆帧/生成后的自动抠图）
}

function continueMonsterPipeline(run: MonsterPipelineRun, materialIds: string[]) {
  const next = applyMonsterPipelineProduct(run, materialIds);
  if (shouldPackMonsterExtractArchive(run, next)) {
    const archiveId = packMonsterExtractArchive(next);
    if (archiveId) next.archiveMaterialId = archiveId;
  }
  enqueueMonsterPipelineStep(next);
}

function enqueueGeneratedFollowUp(source: GeneratePayload, referenceMaterialId: string) {
  const material = db.query("SELECT raw_path FROM materials WHERE id = ?").get(referenceMaterialId) as { raw_path: string | null } | null;
  if (!material?.raw_path) throw new Error("完整角色已生成，但素材文件缺失，无法继续拆分");
  const followUp = buildGeneratedFollowUp(source, referenceMaterialId, material.raw_path);
  if (!followUp) return;
  if (source.characterPartSetId) {
    // 首次生成建立身份基准；已有基准不可被后续试生成静默覆盖。
    db.query("UPDATE character_part_sets SET reference_material_id = ?, updated_at = ? WHERE id = ? AND reference_material_id IS NULL")
      .run(referenceMaterialId, Date.now(), source.characterPartSetId);
  }
  createJob("", "generate_frames", { generate: followUp });
}

function schedulePumpRetry(): void {
  if (pumpRetryTimer) return;
  pumpRetryTimer = setTimeout(() => {
    pumpRetryTimer = null;
    pump();
  }, 250);
  pumpRetryTimer.unref?.();
}

function pump(): void {
  let id: string | null = null;
  try {
    while (running < getQueueConcurrency() && waiting.length > 0) {
      id = waiting.shift()!;
      // 可能已被取消但尚未移出（竞态兜底）
      const claim = db.query(`UPDATE jobs SET status='running',run_owner=?,run_attempt=run_attempt+1,
        execution_phase=CASE WHEN execution_phase LIKE 'reconcile_%' THEN execution_phase ELSE 'running' END,
        lease_expires_at=?,updated_at=?,error=NULL
        WHERE id=? AND status='queued' AND (run_owner IS NULL OR COALESCE(lease_expires_at,0) < ?)`)
        .run(PROCESS_OWNER, Date.now() + JOB_LEASE_MS, Date.now(), id, Date.now()) as { changes?: number };
      if ((claim.changes ?? 0) === 0) {
        payloads.delete(id);
        id = null;
        continue;
      }
      running++;
      const runningId = id;
      id = null;
      void runJob(runningId).catch((error) => {
        console.error(`[queue] job ${runningId} escaped worker guard:`, error instanceof Error ? error.message : error);
      }).finally(() => {
        running--;
        pump();
      });
    }
  } catch (error) {
    if (id && !waiting.includes(id)) waiting.unshift(id);
    console.error("[queue] pump deferred:", error instanceof Error ? error.message : error);
    schedulePumpRetry();
  }
}

function setJob(id: string, status: string, progress?: string | null, error?: string | null) {
  db.query(`UPDATE jobs SET status=?, progress=COALESCE(?,progress), error=?, updated_at=?,
    execution_phase=CASE WHEN ?='done' THEN 'completed' WHEN ?='error' THEN 'failed' WHEN ?='cancelled' THEN 'cancelled' ELSE execution_phase END,
    run_owner=CASE WHEN ? IN ('done','error','cancelled') THEN NULL ELSE run_owner END,
    lease_expires_at=CASE WHEN ? IN ('done','error','cancelled') THEN NULL ELSE lease_expires_at END WHERE id=?`)
    .run(status, progress ?? null, error ?? null, Date.now(), status, status, status, status, status, id);
}

function isMediaPluginJobType(type: string): boolean {
  return type === "media_plugin_image" || type === "media_plugin_video" || type === "media_plugin_audio";
}

function finalizeMediaPluginRun(
  id: string,
  status: "done" | "error" | "cancelled",
  materialIds: string[] = [],
): boolean {
  const receiptCommitted = compactMediaPluginRunDir(mediaRunDir(id), { jobId: id, status, materialIds });
  releaseMediaPluginRuntimeRun(`job:${id}`);
  return receiptCommitted;
}

async function runJob(id: string) {
  const job = db.query("SELECT * FROM jobs WHERE id = ?").get(id) as {
    id: string;
    project_id: string;
    type: string;
    execution_phase: string | null;
  } | null;
  if (!job) return;
  const payload = payloads.get(id) ?? {};
  const ac = new AbortController();
  controllers.set(id, ac);
  const signal = ac.signal;
  const leaseTimer = setInterval(() => {
    try {
      db.query("UPDATE jobs SET lease_expires_at=?,updated_at=? WHERE id=? AND status='running' AND run_owner=?")
        .run(Date.now() + JOB_LEASE_MS, Date.now(), id, PROCESS_OWNER);
    } catch (error) {
      console.error(`[queue] lease heartbeat deferred for ${id}:`, error instanceof Error ? error.message : error);
    }
  }, Math.floor(JOB_LEASE_MS / 3));
  leaseTimer.unref?.();
  let generatedReferenceId: string | undefined;
  let producedMaterialIds: string[] = [];
  let successReceiptCommitted = false;
  let terminalSuccessPending = false;
  // 相同 progress 文本去重（如视频轮询每 5s 的重复心跳），避免无谓 DB 写 + 全局广播
  let lastProgress = "";
  const report = (p: string) => {
    if (signal.aborted) return;
    if (p === lastProgress) return;
    lastProgress = p;
    try {
      setJob(id, "running", p);
    } catch (error) {
      console.error(`[queue] progress persistence deferred for ${id}:`, error instanceof Error ? error.message : error);
    }
    broadcast("job_progress", { id, projectId: job.project_id, progress: p });
  };
  try {
    try {
      setJob(id, "running", "开始处理", null);
    } catch (error) {
      console.error(`[queue] running-state persistence deferred for ${id}:`, error instanceof Error ? error.message : error);
    }
    broadcast("job_running", { id, projectId: job.project_id });
    if (signal.aborted) throw new JobCancelledError();
    if (job.type === "extract_frames" && payload.extract) {
      producedMaterialIds = await extractFrames(payload.extract, report, enqueueMatting, signal);
    } else if (job.type === "generate_frames" && payload.generate) {
      const generated = await generateFrames(payload.generate, report, enqueueMatting, signal);
      producedMaterialIds = generated.map((item) => item.id);
      if (payload.generate.followUp && generated[0]?.kind === "image") generatedReferenceId = generated[0].id;
    } else if (job.type === "matting" && payload.matting) {
      if (signal.aborted) throw new JobCancelledError();
      const warn = await matte(payload.matting.target, payload.matting.id, signal);
      if (warn) report(warn); // 引擎缺失等警告写进 job.progress
    } else if (job.type === "image_layers" && payload.imageLayers) {
      await splitImageLayers(payload.imageLayers, report, signal);
    } else if (
      (job.type === "media_plugin_image" || job.type === "media_plugin_video" || job.type === "media_plugin_audio") &&
      payload.mediaPlugin
    ) {
      const results = await runMediaPluginJob(payload.mediaPlugin, report, signal, {
        jobId: id,
        outputDir: mediaRunDir(id),
        reconcileOnly: job.execution_phase === "reconcile_known" || job.execution_phase === "reconcile_completed",
      });
      if (signal.aborted) throw new JobCancelledError();
      producedMaterialIds = results.map((r) => r.materialId).filter(Boolean);
      if (payload.monsterPipeline) continueMonsterPipeline(payload.monsterPipeline, producedMaterialIds);
      const doneProgress =
        producedMaterialIds.length > 0
          ? `完成 materialIds=${JSON.stringify(producedMaterialIds)}`
          : "完成";
      // 先保留有界 receipt 并释放仅属于本 job 的恢复租约，再原子落终态；
      // 任一点崩溃时都不会同时失去 journal 与 running 状态。
      terminalSuccessPending = true;
      successReceiptCommitted = finalizeMediaPluginRun(id, "done", producedMaterialIds);
      if (!successReceiptCommitted) throw new Error("MEDIA_PLUGIN_TERMINAL_RECEIPT_WRITE_FAILED");
      setJob(id, "done", doneProgress);
      terminalSuccessPending = false;
      broadcast("job_done", {
        id,
        projectId: job.project_id,
        type: job.type,
        materialIds: producedMaterialIds,
        results,
        pipelineId: payload.monsterPipeline?.pipelineId,
      });
      return;
    } else {
      throw new Error(`未知任务类型: ${job.type}`);
    }
    if (signal.aborted) throw new JobCancelledError();
    if (generatedReferenceId && payload.generate) enqueueGeneratedFollowUp(payload.generate, generatedReferenceId);
    if (payload.monsterPipeline) continueMonsterPipeline(payload.monsterPipeline, producedMaterialIds);
    const doneProgress =
      producedMaterialIds.length > 0
        ? `完成 materialIds=${JSON.stringify(producedMaterialIds)}`
        : "完成";
    setJob(id, "done", doneProgress);
    broadcast("job_done", {
      id,
      projectId: job.project_id,
      type: job.type,
      materialIds: producedMaterialIds,
      pipelineId: payload.monsterPipeline?.pipelineId,
    });
  } catch (err) {
    if (terminalSuccessPending) {
      // Outputs are archived. Keep running + known journal/receipt recoverable instead of downgrading to error.
      console.error(`[queue] terminal DB update deferred for ${id}:`, err instanceof Error ? err.message : err);
      return;
    }
    if (err instanceof JobCancelledError || signal.aborted) {
      try {
        if (isMediaPluginJobType(job.type)) finalizeMediaPluginRun(id, "cancelled");
        setJob(id, "cancelled", "已取消", null);
        broadcast("job_cancelled", { id, projectId: job.project_id, type: job.type });
      } catch (finalizeError) {
        console.error(`[queue] cancellation persistence deferred for ${id}:`, finalizeError instanceof Error ? finalizeError.message : finalizeError);
      }
    } else {
      const raw = err instanceof Error ? err.message : String(err);
      let msg = raw;
      if (
        job.type === "media_plugin_image" ||
        job.type === "media_plugin_video" ||
        job.type === "media_plugin_audio"
      ) {
        const code =
          /PLUGIN_RUNTIME_TIMEOUT/.test(raw)
            ? "PLUGIN_RUNTIME_TIMEOUT"
            : /PLUGIN_DOWNLOAD_REJECTED/.test(raw)
              ? "PLUGIN_DOWNLOAD_REJECTED"
              : /PLUGIN_OUTPUT_INVALID/.test(raw)
                ? "PLUGIN_OUTPUT_INVALID"
                : "PLUGIN_RUNTIME_ERROR";
        const diag = sanitizeMediaPluginDiagnostic(raw, { code });
        console.error(`[job ${id}] ${job.type} 失败:`, diag.serverLog || raw);
        // 已是稳定短码文案则保留；含 traceback/密钥痕迹时改用对外安全文案
        msg = /traceback|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|stderr=/i.test(raw) ? diag.publicMessage : raw;
      } else {
        console.error(`[job ${id}] ${job.type} 失败:`, msg);
      }
      try {
        if (isMediaPluginJobType(job.type)) finalizeMediaPluginRun(id, "error");
        setJob(id, "error", null, msg);
        broadcast("job_error", { id, projectId: job.project_id, type: job.type, error: msg });
      } catch (finalizeError) {
        console.error(`[queue] error persistence deferred for ${id}:`, finalizeError instanceof Error ? finalizeError.message : finalizeError);
      }
    }
  } finally {
    clearInterval(leaseTimer);
    controllers.delete(id);
    payloads.delete(id);
  }
}

recoverPersistedJobs();
const recoveryTimer = setInterval(() => { recoverPersistedJobs(); }, 2_000);
recoveryTimer.unref?.();
