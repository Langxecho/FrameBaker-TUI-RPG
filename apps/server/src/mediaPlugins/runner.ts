import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { JobCancelledError } from "../jobs/run";
import { sanitizeMediaPluginDiagnostic } from "./diagnostics";
import { terminateSpawnedProcessTree } from "./processKill";
import {
  MEDIA_PLUGIN_RUNNER_DEFAULT_TIMEOUT_MS,
  MEDIA_PLUGIN_RUNNER_SCRIPT,
  resolveMediaPythonExecutable,
  type MediaPluginRunnerPayload,
  type MediaPluginRunnerRequest,
} from "./pythonEnv";
import { MediaPluginServiceError } from "./types";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

export type RunMediaPluginOptions = {
  signal?: AbortSignal;
  bridgeTimeoutMs?: number;
};

/** Bun↔Python 桥接：写 request.json、spawn runner、解析 result.json；支持超时与 AbortSignal。 */
export async function runMediaPluginPython(
  request: MediaPluginRunnerRequest,
  options: RunMediaPluginOptions = {},
): Promise<MediaPluginRunnerPayload> {
  if (options.signal?.aborted) throw new JobCancelledError();
  const python = resolveMediaPythonExecutable();
  mkdirSync(request.outputDir, { recursive: true });
  const requestPath = join(request.outputDir, "request.json");
  const resultPath = join(request.outputDir, "result.json");
  writeFileSync(requestPath, JSON.stringify(request), "utf8");

  const bridgeTimeoutMs =
    typeof options.bridgeTimeoutMs === "number" && Number.isFinite(options.bridgeTimeoutMs) && options.bridgeTimeoutMs > 0
      ? Math.floor(options.bridgeTimeoutMs)
      : typeof request.bridgeTimeoutMs === "number" && Number.isFinite(request.bridgeTimeoutMs) && request.bridgeTimeoutMs > 0
        ? Math.floor(request.bridgeTimeoutMs)
        : MEDIA_PLUGIN_RUNNER_DEFAULT_TIMEOUT_MS;

  const proc = Bun.spawn(
    [python, MEDIA_PLUGIN_RUNNER_SCRIPT, "--request", requestPath, "--result", resultPath],
    {
      cwd: REPO_ROOT,
      stdout: "ignore",
      stderr: "pipe",
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
    },
  );

  const killProc = () => terminateSpawnedProcessTree(proc);

  const onAbort = () => killProc();
  options.signal?.addEventListener("abort", onAbort, { once: true });

  const stderrPromise = new Response(proc.stderr).text();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    killProc();
  }, bridgeTimeoutMs);

  let exitCode: number;
  try {
    exitCode = await proc.exited;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
  const stderr = await stderrPromise;

  if (options.signal?.aborted) throw new JobCancelledError();
  if (timedOut) {
    throw new MediaPluginServiceError(
      "PLUGIN_RUNTIME_TIMEOUT",
      `PLUGIN_RUNTIME_TIMEOUT: media plugin runner exceeded ${bridgeTimeoutMs}ms`,
      504,
    );
  }

  if (!existsSync(resultPath)) {
    const diag = sanitizeMediaPluginDiagnostic(stderr, { exitCode, code: "PLUGIN_RUNTIME_ERROR" });
    console.error(`[media-plugin] runner missing result.json: ${diag.serverLog}`);
    throw new MediaPluginServiceError("PLUGIN_RUNTIME_ERROR", diag.publicMessage, 500);
  }

  const payload = JSON.parse(await Bun.file(resultPath).text()) as MediaPluginRunnerPayload;
  if (!payload || typeof payload !== "object" || typeof (payload as { ok?: unknown }).ok !== "boolean") {
    throw new MediaPluginServiceError("PLUGIN_RUNTIME_ERROR", "PLUGIN_RUNTIME_ERROR: malformed runner result JSON", 500);
  }
  if (!payload.ok && !payload.error) {
    const diag = sanitizeMediaPluginDiagnostic(stderr, {
      exitCode,
      code: payload.code || "PLUGIN_RUNTIME_ERROR",
    });
    console.error(`[media-plugin] runner failed without error field: ${diag.serverLog}`);
    return {
      ok: false,
      code: diag.code,
      error: diag.publicMessage,
    };
  }
  if (!payload.ok && payload.error) {
    // 结果文件错误已由 Python 侧截断；仅当含 traceback 或疑似密钥值时替换为稳定对外文案
    if (/traceback|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+/i.test(payload.error)) {
      const diag = sanitizeMediaPluginDiagnostic(payload.error, {
        exitCode,
        code: payload.code || "PLUGIN_RUNTIME_ERROR",
      });
      console.error(`[media-plugin] runner error redacted: ${diag.serverLog}`);
      return { ok: false, code: diag.code, error: diag.publicMessage };
    }
  }
  return payload;
}

export function cleanupMediaPluginRunDir(outputDir: string): void {
  try {
    rmSync(outputDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

type TerminalRunReceipt = {
  jobId: string;
  status: "done" | "error" | "cancelled";
  materialIds?: string[];
};

type StoredTerminalRunReceipt = {
  schema?: string;
  jobId?: string;
  status?: string;
  materialIds?: unknown;
};

const MAX_TERMINAL_RECEIPT_BYTES = 64 * 1024;
const COMFY_JOURNAL_STATUSES = new Set(["submitting", "submitted", "unknown_submission", "unknown_output", "completed"]);
const COMFY_OUTPUT_TYPES = new Set(["input", "output", "temp"]);

function boundedString(value: unknown, max = 1024): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

function safeComfyFilename(value: unknown): string | undefined {
  const filename = boundedString(value, 1024);
  return filename && filename !== "." && filename !== ".." && !/[\\/]/.test(filename) ? filename : undefined;
}

function safeComfySubfolder(value: unknown): string | undefined {
  const subfolder = boundedString(value, 1024);
  if (!subfolder || /^(?:[A-Za-z]:|[\\/])/.test(subfolder) || subfolder.includes("\0")) return undefined;
  const parts = subfolder.replace(/\\/g, "/").split("/");
  return parts.some((part) => part === "..") ? undefined : subfolder;
}

function sanitizedComfyJournal(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const status = boundedString(raw.status, 64);
  if (!status || !COMFY_JOURNAL_STATUSES.has(status)) return null;
  const journal: Record<string, unknown> = { status };
  const promptId = boundedString(raw.promptId, 512);
  if (promptId) journal.promptId = promptId;
  if (raw.output && typeof raw.output === "object" && !Array.isArray(raw.output)) {
    const source = raw.output as Record<string, unknown>;
    const filename = safeComfyFilename(source.filename);
    if (filename) {
      const output: Record<string, unknown> = { filename };
      const type = boundedString(source.type, 64);
      const subfolder = safeComfySubfolder(source.subfolder);
      if (type && COMFY_OUTPUT_TYPES.has(type)) output.type = type;
      if (subfolder !== undefined) output.subfolder = subfolder;
      journal.output = output;
    }
  }
  return journal;
}

function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value), "utf8");
  renameSync(tmp, path);
}

function readStoredTerminalReceipt(path: string): StoredTerminalRunReceipt | null {
  try {
    if (!existsSync(path) || statSync(path).size > MAX_TERMINAL_RECEIPT_BYTES) return null;
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value as StoredTerminalRunReceipt : null;
  } catch {
    return null;
  }
}

function isCompletedTerminalReceipt(receipt: StoredTerminalRunReceipt | null, jobId: string): boolean {
  return receipt?.schema === "framebaker.media-plugin-terminal-result-v1"
    && receipt.jobId === jobId
    && receipt.status === "done"
    && Array.isArray(receipt.materialIds)
    && receipt.materialIds.length > 0
    && receipt.materialIds.every((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id));
}

/** Replace raw runner inputs/results with bounded, credential-free terminal receipts. */
export function compactMediaPluginRunDir(outputDir: string, receipt: TerminalRunReceipt): boolean {
  let committed = false;
  let keepJournal = false;
  try {
    mkdirSync(outputDir, { recursive: true });
    const requestPath = join(outputDir, "request.json");
    const resultPath = join(outputDir, "result.json");
    // Terminal evidence is monotonic: a later cleanup/release failure must never downgrade a proven success.
    if (receipt.status !== "done" && isCompletedTerminalReceipt(readStoredTerminalReceipt(resultPath), receipt.jobId)) {
      return true;
    }
    let journal: Record<string, unknown> | null = null;
    const journalPath = join(outputDir, "comfy-journal.json");
    if (existsSync(journalPath)) {
      try {
        if (statSync(journalPath).size <= 64 * 1024) {
          journal = sanitizedComfyJournal(JSON.parse(readFileSync(journalPath, "utf8")));
        }
      } catch {
        journal = null;
      }
    }
    keepJournal = journal !== null;
    const materialIds = [...new Set(
      (receipt.materialIds ?? []).filter((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id)),
    )];
    // Commit recovery evidence before deleting artifacts. result.json is the final commit marker.
    if (journal) writeJsonAtomic(journalPath, journal);
    writeJsonAtomic(requestPath, {
      schema: "framebaker.media-plugin-terminal-request-v1",
      jobId: receipt.jobId,
    });
    let terminalResult = {
      schema: "framebaker.media-plugin-terminal-result-v1",
      jobId: receipt.jobId,
      status: receipt.status,
      materialIds,
    };
    if (Buffer.byteLength(JSON.stringify(terminalResult), "utf8") > MAX_TERMINAL_RECEIPT_BYTES) {
      terminalResult = { ...terminalResult, materialIds: [] };
    }
    writeJsonAtomic(resultPath, terminalResult);
    committed = true;
  } catch {
    // A pre-commit failure leaves the old known journal/artifacts available for recovery.
    return false;
  }
  try {
    const retained = new Set(["request.json", "result.json", ...(keepJournal ? ["comfy-journal.json"] : [])]);
    for (const name of readdirSync(outputDir)) {
      if (!retained.has(name)) rmSync(join(outputDir, name), { recursive: true, force: true });
    }
  } catch {
    // best-effort: a committed terminal receipt stays authoritative even if artifact cleanup is delayed
  }
  return committed;
}
