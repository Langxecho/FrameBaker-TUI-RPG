import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MEDIA_PLUGIN_ARCHIVE_EXTENSIONS,
  MEDIA_PLUGIN_KINDS,
  parseMediaPluginKind,
  type MediaPluginDetail,
  type MediaPluginEntry,
  type MediaPluginKind,
  type MediaPluginParamSchema,
  type MediaPluginSecretSummary,
  type MediaPluginSummary,
} from "@framebaker/shared";
import { assertSafeMediaPluginId } from "./paths";
import type { MediaPluginManifest, MediaPluginValidationReport } from "./types";
import { MediaPluginServiceError } from "./types";

const PARAM_TYPES = new Set(["string", "integer", "number", "boolean", "enum", "json", ""]);

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function normalizeCapabilities(raw: unknown): string[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", "capabilities must be an array");
  }
  return [...new Set(raw.map((v) => String(v).trim()).filter(Boolean))].sort();
}

function normalizeEntry(raw: unknown): MediaPluginEntry {
  const entry = asObject(raw ?? {}, "entry");
  const type = String(entry.type ?? "").trim();
  const moduleName = String(entry.module ?? "").trim();
  const fn = String(entry.function ?? "").trim();
  if (type !== "python") throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", 'entry.type must be "python"');
  if (moduleName !== "provider") throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", 'entry.module must be "provider"');
  if (!fn) throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", "entry.function is required");
  return { type, module: moduleName, function: fn };
}

function normalizeSecrets(raw: unknown): Record<string, Record<string, unknown>> {
  const secrets = asObject(raw ?? {}, "secrets");
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, meta] of Object.entries(secrets)) {
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", `secrets.${key} must be an object`);
    }
    out[key] = { ...(meta as Record<string, unknown>) };
  }
  return out;
}

function normalizeParamsSchema(raw: unknown): Record<string, MediaPluginParamSchema> {
  const schema = asObject(raw ?? {}, "params_schema");
  const out: Record<string, MediaPluginParamSchema> = {};
  for (const [key, spec] of Object.entries(schema)) {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", `params_schema.${key} must be an object`);
    }
    const obj = spec as Record<string, unknown>;
    const type = String(obj.type ?? "").trim();
    if (!PARAM_TYPES.has(type)) {
      throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", `params_schema.${key} has invalid type: ${type}`);
    }
    if ("enum" in obj && !Array.isArray(obj.enum)) {
      throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", `params_schema.${key}.enum must be an array`);
    }
    out[key] = { ...(obj as MediaPluginParamSchema), type: type || "string" };
  }
  return out;
}

function normalizeConstraints(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  return asObject(raw, "constraints");
}

export function archiveExtensionForFilename(filename: string): `.iap` | `.vap` | `.aap` {
  const lower = filename.trim().toLowerCase();
  if (lower.endsWith(".iap")) return ".iap";
  if (lower.endsWith(".vap")) return ".vap";
  if (lower.endsWith(".aap")) return ".aap";
  throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", "仅支持上传 .iap / .vap / .aap 插件包");
}

export function kindFromArchiveExtension(ext: `.iap` | `.vap` | `.aap`): MediaPluginKind {
  for (const kind of MEDIA_PLUGIN_KINDS) {
    if (MEDIA_PLUGIN_ARCHIVE_EXTENSIONS[kind] === ext) return kind;
  }
  throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", `未知插件扩展名: ${ext}`);
}

function parseManifestKind(value: unknown): MediaPluginKind {
  try {
    return parseMediaPluginKind(value);
  } catch (error) {
    throw new MediaPluginServiceError(
      "PLUGIN_PACKAGE_INVALID",
      error instanceof Error ? error.message : `Invalid media plugin kind: ${String(value)}`,
    );
  }
}

export function parseMediaPluginManifest(raw: unknown, expectedKind?: MediaPluginKind): MediaPluginManifest {
  const obj = asObject(raw, "plugin.json");
  const pluginId = assertSafeMediaPluginId(String(obj.plugin_id ?? "").trim());
  const kind = parseManifestKind(String(obj.kind ?? "").trim());
  if (expectedKind && kind !== expectedKind) {
    throw new MediaPluginServiceError(
      "PLUGIN_PACKAGE_INVALID",
      `plugin.json kind 必须为 "${expectedKind}"（当前为 "${kind}"）`,
    );
  }
  const name = String(obj.name ?? pluginId).trim() || pluginId;
  const version = String(obj.version ?? "1.0.0").trim() || "1.0.0";
  return {
    plugin_id: pluginId,
    name,
    version,
    kind,
    capabilities: normalizeCapabilities(obj.capabilities),
    entry: normalizeEntry(obj.entry),
    secrets: normalizeSecrets(obj.secrets),
    params_schema: normalizeParamsSchema(obj.params_schema),
    constraints: normalizeConstraints(obj.constraints),
  };
}

export function secretSummaries(secrets: Record<string, Record<string, unknown>>): MediaPluginSecretSummary[] {
  return Object.entries(secrets).map(([id, meta]) => ({
    id,
    label: String(meta.label ?? id),
    required: Boolean(meta.required),
    configured: Boolean(String(meta.value ?? "").trim()),
  }));
}

export function isManifestConfigured(secrets: Record<string, Record<string, unknown>>): boolean {
  return Object.values(secrets).every((meta) => {
    if (!meta?.required) return true;
    return Boolean(String(meta.value ?? "").trim());
  });
}

export function redactManifestSecrets(manifest: MediaPluginManifest): MediaPluginManifest {
  const secrets: Record<string, Record<string, unknown>> = {};
  for (const [id, meta] of Object.entries(manifest.secrets)) {
    const { value: _value, ...rest } = meta;
    secrets[id] = { ...rest, configured: Boolean(String(meta.value ?? "").trim()) };
  }
  return { ...manifest, secrets };
}

/** 导出用：从 plugin.json 字节中剥离 secrets.*.value，避免密钥随归档离开本机。 */
export function sanitizePluginJsonBytesForExport(bytes: Uint8Array): { bytes: Uint8Array; stripped: boolean } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new MediaPluginServiceError(
      "PLUGIN_PACKAGE_INVALID",
      `导出前无法解析 plugin.json: ${(error as Error).message}`,
    );
  }
  const obj = asObject(parsed, "plugin.json");
  let stripped = false;
  if (obj.secrets && typeof obj.secrets === "object" && !Array.isArray(obj.secrets)) {
    const secrets = obj.secrets as Record<string, Record<string, unknown>>;
    const next: Record<string, Record<string, unknown>> = {};
    for (const [id, meta] of Object.entries(secrets)) {
      if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
        next[id] = meta as Record<string, unknown>;
        continue;
      }
      if ("value" in meta) {
        const { value: _value, ...rest } = meta;
        next[id] = { ...rest, value: "" };
        if (String(_value ?? "").trim()) stripped = true;
      } else {
        next[id] = { ...meta };
      }
    }
    obj.secrets = next;
  }
  return { bytes: new TextEncoder().encode(`${JSON.stringify(obj, null, 2)}\n`), stripped };
}

export function toMediaPluginSummary(manifest: MediaPluginManifest, opts?: { runnable?: boolean }): MediaPluginSummary {
  const configured = isManifestConfigured(manifest.secrets);
  return {
    id: manifest.plugin_id,
    name: manifest.name,
    version: manifest.version,
    kind: manifest.kind,
    capabilities: [...manifest.capabilities],
    configured,
    runnable: opts?.runnable ?? configured,
  };
}

export function toMediaPluginDetail(manifest: MediaPluginManifest, opts?: { runnable?: boolean }): MediaPluginDetail {
  return {
    ...toMediaPluginSummary(manifest, opts),
    paramsSchema: structuredClone(manifest.params_schema),
    constraints: structuredClone(manifest.constraints),
    secrets: secretSummaries(manifest.secrets),
    entry: { ...manifest.entry },
  };
}

export function readManifestFile(pluginDir: string): MediaPluginManifest {
  const path = join(pluginDir, "plugin.json");
  if (!existsSync(path)) {
    throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", "plugin.json is missing");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new MediaPluginServiceError(
      "PLUGIN_PACKAGE_INVALID",
      `plugin.json is not valid JSON: ${(error as Error).message}`,
    );
  }
  return parseMediaPluginManifest(raw);
}

export function validateInstalledPluginDir(pluginDir: string, expectedKind?: MediaPluginKind): MediaPluginValidationReport {
  const errors: string[] = [];
  const pluginJson = join(pluginDir, "plugin.json");
  const provider = join(pluginDir, "provider.py");
  if (!existsSync(pluginJson)) errors.push("plugin.json is missing");
  if (!existsSync(provider)) errors.push("provider.py is missing");
  if (errors.length) return { ok: false, errors };

  try {
    const manifest = parseMediaPluginManifest(JSON.parse(readFileSync(pluginJson, "utf8")), expectedKind);
    return { ok: true, errors: [], manifest };
  } catch (error) {
    if (error instanceof MediaPluginServiceError) {
      return { ok: false, errors: [error.message] };
    }
    return { ok: false, errors: [(error as Error).message] };
  }
}

export function validateParamDefaults(
  schema: Record<string, MediaPluginParamSchema>,
  defaults: Record<string, unknown>,
): void {
  for (const key of Object.keys(defaults)) {
    if (!(key in schema)) {
      throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `未知参数: ${key}`);
    }
  }
  for (const [key, value] of Object.entries(defaults)) {
    const spec = schema[key];
    const type = String(spec.type ?? "string");
    if (value === null || value === undefined) continue;
    if (Array.isArray(spec.enum) && spec.enum.length > 0 && !spec.enum.includes(value as never)) {
      throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `参数 ${key} 不在枚举范围内`);
    }
    switch (type) {
      case "string":
        if (typeof value !== "string") throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `参数 ${key} 须为 string`);
        break;
      case "integer":
        if (typeof value !== "number" || !Number.isInteger(value)) {
          throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `参数 ${key} 须为 integer`);
        }
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `参数 ${key} 须为 number`);
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `参数 ${key} 须为 boolean`);
        break;
      case "json":
        break;
      case "enum":
        break;
      default:
        break;
    }
  }
}
