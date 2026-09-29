import { db } from "../db";
import { MediaPluginServiceError } from "./types";
import type { MediaPluginKind } from "@framebaker/shared";

export type PluginRef = { kind: MediaPluginKind; pluginId: string; runtimeKey?: string };
export type MediaPluginCleanupResult = { ok: true; detail?: string } | { ok: false; code?: string; detail: string };
export type MediaPluginCleanup = (previous: PluginRef | null, next: PluginRef) => Promise<MediaPluginCleanupResult>;
export type MediaPluginRuntimeKeyResolver = (ref: PluginRef) => string | null;

type RuntimeRow = { loaded_kind: MediaPluginKind | null; loaded_plugin_id: string | null; runtime_key: string | null; active_run_id: string | null; status: string; blocked: number; last_error: string | null };

let cleanupHandler: MediaPluginCleanup | null = null;
let runtimeKeyResolver: MediaPluginRuntimeKeyResolver | null = null;
let queueTail: Promise<void> = Promise.resolve();
type ReleaseRetryState = { attempts: number; timer: ReturnType<typeof setTimeout> | null };
const releaseRetries = new Map<string, ReleaseRetryState>();
const configuredReleaseRetryMax = Number(process.env.FRAMEBAKER_RUNTIME_RELEASE_RETRY_MAX);
const configuredReleaseRetryBaseMs = Number(process.env.FRAMEBAKER_RUNTIME_RELEASE_RETRY_BASE_MS);
const RELEASE_RETRY_MAX = Number.isInteger(configuredReleaseRetryMax) && configuredReleaseRetryMax >= 0
  ? Math.min(100, configuredReleaseRetryMax)
  : 20;
const RELEASE_RETRY_BASE_MS = Number.isFinite(configuredReleaseRetryBaseMs) && configuredReleaseRetryBaseMs >= 1
  ? Math.min(10_000, Math.floor(configuredReleaseRetryBaseMs))
  : 100;

function ensureRuntimeTable(): void {
  db.exec(`CREATE TABLE IF NOT EXISTS media_plugin_runtime (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    loaded_kind TEXT,
    loaded_plugin_id TEXT,
    runtime_key TEXT,
    active_run_id TEXT,
    status TEXT NOT NULL DEFAULT 'idle',
    blocked INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at INTEGER NOT NULL
  )`);
  db.query("INSERT OR IGNORE INTO media_plugin_runtime (id, status, updated_at) VALUES (1, 'idle', ?)").run(Date.now());
  const columns = db.query("PRAGMA table_info(media_plugin_runtime)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "runtime_key")) db.exec("ALTER TABLE media_plugin_runtime ADD COLUMN runtime_key TEXT");
}

ensureRuntimeTable();

function row(): RuntimeRow {
  return db.query("SELECT loaded_kind, loaded_plugin_id, runtime_key, active_run_id, status, blocked, last_error FROM media_plugin_runtime WHERE id = 1").get() as RuntimeRow;
}

function update(fields: Partial<RuntimeRow>): void {
  const keys = Object.keys(fields) as Array<keyof RuntimeRow>;
  if (!keys.length) return;
  db.query(`UPDATE media_plugin_runtime SET ${keys.map((key) => `${key} = ?`).join(", ")}, updated_at = ? WHERE id = 1`).run(...keys.map((key) => fields[key] ?? null), Date.now());
}

export function setMediaPluginRuntimeCleanup(handler: MediaPluginCleanup | null): void {
  cleanupHandler = handler;
}

/** Return a shared residency key (for example comfyui:<endpoint>); null bypasses the shared GPU lease. */
export function setMediaPluginRuntimeKeyResolver(resolver: MediaPluginRuntimeKeyResolver | null): void {
  runtimeKeyResolver = resolver;
}

export function getMediaPluginRuntimeState(): RuntimeRow {
  return row();
}

/** Release only the exact persisted run lease; never clear another job's active run. */
function isSqliteBusy(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  const message = error instanceof Error ? error.message : String(error);
  return code === "SQLITE_BUSY" || code === "SQLITE_LOCKED" || /database (?:is )?(?:busy|locked)/i.test(message);
}

function clearReleaseRetry(runId: string): void {
  const state = releaseRetries.get(runId);
  if (state?.timer) clearTimeout(state.timer);
  releaseRetries.delete(runId);
}

function attemptRelease(runId: string): "released" | "not-owned" | "busy" | "error" {
  try {
    const result = db.query(
      "UPDATE media_plugin_runtime SET active_run_id = NULL, status = 'idle', updated_at = ? WHERE id = 1 AND active_run_id = ?",
    ).run(Date.now(), runId) as { changes?: number };
    return (result.changes ?? 0) > 0 ? "released" : "not-owned";
  } catch (error) {
    console.error(`[media-plugin-runtime] release ${runId} failed:`, error instanceof Error ? error.message : error);
    return isSqliteBusy(error) ? "busy" : "error";
  }
}

function scheduleReleaseRetry(runId: string, state: ReleaseRetryState): void {
  if (state.timer || state.attempts >= RELEASE_RETRY_MAX) {
    if (state.attempts >= RELEASE_RETRY_MAX) {
      releaseRetries.delete(runId);
      console.error(`[media-plugin-runtime] release ${runId} exhausted ${RELEASE_RETRY_MAX} busy retries`);
    }
    return;
  }
  const delay = Math.min(2_000, RELEASE_RETRY_BASE_MS * 2 ** state.attempts);
  state.timer = setTimeout(() => {
    state.timer = null;
    state.attempts++;
    const outcome = attemptRelease(runId);
    if (outcome === "busy") {
      scheduleReleaseRetry(runId, state);
    } else {
      clearReleaseRetry(runId);
    }
  }, delay);
  state.timer.unref?.();
  releaseRetries.set(runId, state);
}

export function releaseMediaPluginRuntimeRun(runId: string): boolean {
  const outcome = attemptRelease(runId);
  if (outcome === "released" || outcome === "not-owned") {
    clearReleaseRetry(runId);
    return outcome === "released";
  }
  if (outcome === "busy" && RELEASE_RETRY_MAX > 0 && !releaseRetries.has(runId)) {
    const state: ReleaseRetryState = { attempts: 0, timer: null };
    scheduleReleaseRetry(runId, state);
  }
  return false;
}

/** A failed switch blocks subsequent submissions until an owner explicitly confirms cleanup. */
export function clearMediaPluginRuntimeFailure(): void {
  update({ blocked: 0, last_error: null, status: "idle", active_run_id: null });
}

function refFromRow(runtime: RuntimeRow): PluginRef | null {
  return runtime.loaded_kind && runtime.loaded_plugin_id ? { kind: runtime.loaded_kind, pluginId: runtime.loaded_plugin_id, runtimeKey: runtime.runtime_key ?? undefined } : null;
}

function resourceKey(ref: PluginRef): string | null {
  return ref.runtimeKey ?? runtimeKeyResolver?.(ref) ?? null;
}

async function runLease<T>(ref: PluginRef, runId: string, task: () => Promise<T>): Promise<T> {
  const nextKey = resourceKey(ref);
  if (!nextKey) return task();
  let previous: PluginRef | null = null;
  let previousKey: string | null = null;
  let claimed = false;
  for (let attempt = 0; attempt < 600; attempt++) {
    const runtime = row();
    if (runtime.blocked) throw new MediaPluginServiceError("PLUGIN_RUNTIME_CLEANUP_FAILED", runtime.last_error || "媒体插件运行时处于阻断状态，请先确认清理", 409);
    if (runtime.active_run_id && runtime.active_run_id !== runId) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    previous = refFromRow(runtime);
    previousKey = runtime.runtime_key;
    const result = db.query("UPDATE media_plugin_runtime SET active_run_id = ?, status = 'switching', updated_at = ? WHERE id = 1 AND active_run_id IS NULL AND blocked = 0").run(runId, Date.now()) as { changes?: number };
    if ((result.changes ?? 0) > 0 || runtime.active_run_id === runId) { claimed = true; break; }
  }
  if (!claimed) throw new MediaPluginServiceError("PLUGIN_RUNTIME_CLEANUP_FAILED", "前一媒体插件任务未在超时时间内终结，拒绝切换", 409);
  const switching = previous && (previousKey !== nextKey || previous.kind !== ref.kind || previous.pluginId !== ref.pluginId);
  // First entry also invokes cleanup(previous=null): another process may have loaded models before this server tracked a provider.
  if (switching || !previous) {
    if (!cleanupHandler) {
      const message = switching ? `切换插件前缺少可观测清理能力：${previous!.kind}/${previous!.pluginId}` : "首次使用共享媒体运行时缺少可观测清理能力";
      update({ active_run_id: null, blocked: 1, status: "blocked", last_error: message });
      throw new MediaPluginServiceError("PLUGIN_RUNTIME_CLEANUP_FAILED", message, 409);
    }
    let result: MediaPluginCleanupResult;
    try { result = await cleanupHandler(previous, ref); } catch (error) { result = { ok: false, detail: (error as Error).message }; }
    if (!result.ok) {
      const message = result.detail || (previous ? `未确认已清理 ${previous.kind}/${previous.pluginId}` : "未确认共享运行时首次清理");
      update({ active_run_id: null, blocked: 1, status: "blocked", last_error: message });
      throw new MediaPluginServiceError("PLUGIN_RUNTIME_CLEANUP_FAILED", message, 409);
    }
  }
  update({ loaded_kind: ref.kind, loaded_plugin_id: ref.pluginId, runtime_key: nextKey, active_run_id: runId, status: "running", blocked: 0, last_error: null });
  try {
    return await task();
  } finally {
    releaseMediaPluginRuntimeRun(runId);
  }
}

/** Serialize all media-plugin executions. A switch waits for the previous job and fails closed if cleanup is not confirmed. */
export function withMediaPluginRuntime<T>(ref: PluginRef, task: () => Promise<T>, runId: string = crypto.randomUUID()): Promise<T> {
  const run = queueTail.then(() => runLease(ref, runId, task));
  queueTail = run.then(() => undefined, () => undefined);
  return run;
}

export function resetMediaPluginRuntimeForTests(): void {
  cleanupHandler = null;
  runtimeKeyResolver = null;
  queueTail = Promise.resolve();
  for (const retry of releaseRetries.values()) if (retry.timer) clearTimeout(retry.timer);
  releaseRetries.clear();
  update({ loaded_kind: null, loaded_plugin_id: null, runtime_key: null, active_run_id: null, status: "idle", blocked: 0, last_error: null });
}
