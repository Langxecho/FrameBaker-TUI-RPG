import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
