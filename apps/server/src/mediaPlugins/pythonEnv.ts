import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeMediaPluginDiagnostic } from "./diagnostics";
import { terminateSpawnedProcessTree } from "./processKill";

// 与 db.ts 同源，但不导入 db，避免测试/调用时触发 sqlite 副作用
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

export const MEDIA_PLUGIN_RUNNER_SCRIPT = join(
  import.meta.dir,
  "..",
  "python",
  "media_plugin_runner.py",
);

/** Task 2 bridge default; Task 4 runner.ts may override/extend with AbortSignal. */
export const MEDIA_PLUGIN_RUNNER_DEFAULT_TIMEOUT_MS = 600_000;

export type MediaPluginRunnerRequest = {
  kind: "image_api" | "video_api" | "audio_api";
  pluginId: string;
  pluginRoot: string;
  prompt: string;
  imageUrls: string[];
  audioUrls: string[];
  durationSeconds: number | null;
  params: Record<string, unknown>;
  outputDir: string;
  mode?: string;
  timeoutSeconds?: number;
  /** Wall-clock bound for the Bun↔Python bridge. Defaults to MEDIA_PLUGIN_RUNNER_DEFAULT_TIMEOUT_MS. */
  bridgeTimeoutMs?: number;
};

export type MediaPluginRunnerSuccess = {
  ok: true;
  result: Record<string, any>;
};

export type MediaPluginRunnerFailure = {
  ok: false;
  code: string;
  error: string;
};

export type MediaPluginRunnerPayload = MediaPluginRunnerSuccess | MediaPluginRunnerFailure;

function venvPythonCandidates(): string[] {
  return [
    join(REPO_ROOT, ".venv-media", "Scripts", "python.exe"),
    join(REPO_ROOT, ".venv-media", "bin", "python"),
    join(REPO_ROOT, ".venv-media", "bin", "python3"),
  ];
}

/** 解析媒体插件 Python 解释器；不可用时抛出 PYTHON_RUNTIME_UNAVAILABLE。 */
export function resolveMediaPythonExecutable(): string {
  const override = process.env.FRAMEBAKER_MEDIA_PYTHON?.trim();
  if (override) {
    if (!existsSync(override)) {
      throw new Error("PYTHON_RUNTIME_UNAVAILABLE: configured media Python executable was not found");
    }
    return override;
  }
  for (const candidate of venvPythonCandidates()) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "PYTHON_RUNTIME_UNAVAILABLE: .venv-media is missing; run scripts/setup_media.ps1 or scripts/setup_media.sh",
  );
}

export async function invokeMediaPluginRunner(
  request: MediaPluginRunnerRequest,
): Promise<MediaPluginRunnerPayload> {
  const python = resolveMediaPythonExecutable();
  mkdirSync(request.outputDir, { recursive: true });
  const requestPath = join(request.outputDir, "request.json");
  const resultPath = join(request.outputDir, "result.json");
  writeFileSync(requestPath, JSON.stringify(request), "utf8");

  const bridgeTimeoutMs =
    typeof request.bridgeTimeoutMs === "number" && Number.isFinite(request.bridgeTimeoutMs) && request.bridgeTimeoutMs > 0
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
  const stderrPromise = new Response(proc.stderr).text();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    terminateSpawnedProcessTree(proc);
  }, bridgeTimeoutMs);
  let exitCode: number;
  try {
    exitCode = await proc.exited;
  } finally {
    clearTimeout(timer);
  }
  const stderr = await stderrPromise;

  if (timedOut) {
    throw new Error(
      `PLUGIN_RUNTIME_TIMEOUT: media plugin runner exceeded ${bridgeTimeoutMs}ms`,
    );
  }

  if (!existsSync(resultPath)) {
    const diag = sanitizeMediaPluginDiagnostic(stderr, { exitCode, code: "PLUGIN_RUNTIME_ERROR" });
    console.error(`[media-plugin] invoke missing result.json: ${diag.serverLog}`);
    throw new Error(diag.publicMessage);
  }
  const payload = JSON.parse(await Bun.file(resultPath).text()) as MediaPluginRunnerPayload;
  if (!payload || typeof payload !== "object" || typeof (payload as any).ok !== "boolean") {
    throw new Error("PLUGIN_RUNTIME_ERROR: malformed runner result JSON");
  }
  if (!payload.ok && !payload.error) {
    const diag = sanitizeMediaPluginDiagnostic(stderr, {
      exitCode,
      code: payload.code || "PLUGIN_RUNTIME_ERROR",
    });
    console.error(`[media-plugin] invoke failed without error field: ${diag.serverLog}`);
    return {
      ok: false,
      code: diag.code,
      error: diag.publicMessage,
    };
  }
  if (!payload.ok && payload.error && /traceback|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+/i.test(payload.error)) {
    const diag = sanitizeMediaPluginDiagnostic(payload.error, {
      exitCode,
      code: payload.code || "PLUGIN_RUNTIME_ERROR",
    });
    console.error(`[media-plugin] invoke error redacted: ${diag.serverLog}`);
    return { ok: false, code: diag.code, error: diag.publicMessage };
  }
  return payload;
}
