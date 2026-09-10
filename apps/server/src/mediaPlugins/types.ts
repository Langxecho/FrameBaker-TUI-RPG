import type {
  MediaPluginDetail,
  MediaPluginEntry,
  MediaPluginKind,
  MediaPluginParamSchema,
  MediaPluginSecretSummary,
  MediaPluginSummary,
} from "@framebaker/shared";

export type {
  MediaPluginDetail,
  MediaPluginEntry,
  MediaPluginKind,
  MediaPluginParamSchema,
  MediaPluginSecretSummary,
  MediaPluginSummary,
};

/** 队列内存负载：媒体插件生成任务 */
export type MediaPluginJobPayload = {
  kind: MediaPluginKind;
  pluginId: string;
  prompt: string;
  references: string[];
  /** 覆盖参考图文件（必须在 STORAGE_ROOT 内）。怪物流水线用 RGB JPEG，避免透明小 PNG 导致网关 502。 */
  referencePathOverrides?: string[];
  params: Record<string, unknown>;
  durationSeconds: number | null;
  folderId: string | null;
  projectId: string | null;
  name: string;
  batchCount: number;
  batchIndex: number;
  bridgeTimeoutMs?: number;
};

export type MediaPluginErrorCode =
  | "PLUGIN_PACKAGE_INVALID"
  | "PLUGIN_NOT_FOUND"
  | "PLUGIN_REPLACE_REQUIRED"
  | "PLUGIN_PARAMETER_INVALID"
  | "PLUGIN_SECRET_INVALID"
  | "PLUGIN_PATH_INVALID"
  | "PLUGIN_INSTALL_FAILED"
  | "PLUGIN_DOWNLOAD_REJECTED"
  | "PLUGIN_OUTPUT_INVALID"
  | "PLUGIN_RUNTIME_ERROR"
  | "PLUGIN_RUNTIME_TIMEOUT";

export class MediaPluginServiceError extends Error {
  readonly code: MediaPluginErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: MediaPluginErrorCode, message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.name = "MediaPluginServiceError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/** 磁盘上的完整 manifest（含密钥明文，仅服务端内部使用）。 */
export type MediaPluginManifest = {
  plugin_id: string;
  name: string;
  version: string;
  kind: MediaPluginKind;
  capabilities: string[];
  entry: MediaPluginEntry;
  secrets: Record<string, Record<string, unknown>>;
  params_schema: Record<string, MediaPluginParamSchema>;
  constraints: Record<string, unknown>;
};

export type MediaPluginValidationReport = {
  ok: boolean;
  errors: string[];
  manifest?: MediaPluginManifest;
};
