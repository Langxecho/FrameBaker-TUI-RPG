import { mediaPluginStorageRoot } from "./paths";
import { listInstalledMediaPlugins } from "./registry";
import { resolveMediaPythonExecutable } from "./pythonEnv";

export type MediaPluginRuntimeInfo = {
  pythonAvailable: boolean;
  pythonPath: string | null;
  installedCount: number;
  installRoot: string;
  hint: string | null;
};

export type SanitizedMediaPluginDiagnostic = {
  code: string;
  publicMessage: string;
  serverLog: string;
};

const SECRETISH = /(api[_-]?key|token|password|authorization|secret|sk-[A-Za-z0-9_-]{8,})/gi;

function redactSecrets(text: string): string {
  return text.replace(SECRETISH, "[redacted]");
}

/** 截断并脱敏服务端诊断；对外只返回稳定短错误码/文案，不泄露 traceback/stderr。 */
export function sanitizeMediaPluginDiagnostic(
  raw: string,
  options?: { exitCode?: number; code?: string; maxServerLog?: number },
): SanitizedMediaPluginDiagnostic {
  const code = options?.code || "PLUGIN_RUNTIME_ERROR";
  const redacted = redactSecrets(String(raw ?? ""));
  const maxServerLog = options?.maxServerLog ?? 800;
  const serverLog = redacted.replace(/\s+/g, " ").trim().slice(0, maxServerLog);
  const exitHint =
    typeof options?.exitCode === "number" && Number.isFinite(options.exitCode)
      ? ` (exit=${options.exitCode})`
      : "";
  return {
    code,
    publicMessage: `${code}: media plugin runner failed${exitHint}`,
    serverLog,
  };
}

/** 配置/体检用：Python 与已安装插件数量（不含密钥）。 */
export function getMediaPluginRuntimeInfo(): MediaPluginRuntimeInfo {
  const installRoot = mediaPluginStorageRoot();
  const installedCount = listInstalledMediaPlugins().length;
  try {
    const pythonPath = resolveMediaPythonExecutable();
    return {
      pythonAvailable: true,
      pythonPath,
      installedCount,
      installRoot,
      hint: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      pythonAvailable: false,
      pythonPath: null,
      installedCount,
      installRoot,
      hint: message.includes("setup_media")
        ? message
        : "PYTHON_RUNTIME_UNAVAILABLE: .venv-media is missing; run scripts/setup_media.ps1 or scripts/setup_media.sh",
    };
  }
}
