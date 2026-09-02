import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MediaPluginDetail, MediaPluginKind } from "@framebaker/shared";
import { readManifestFile, toMediaPluginDetail, validateParamDefaults } from "./manifest";
import { assertExistingPluginDir } from "./paths";
import { MediaPluginServiceError } from "./types";

function atomicWriteJson(path: string, data: unknown) {
  const tmp = join(dirname(path), `.tmp_plugin_${Date.now()}_${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  try {
    renameSync(tmp, path);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
    throw error;
  }
}

function loadRawManifest(pluginDir: string): Record<string, unknown> {
  const path = join(pluginDir, "plugin.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    throw new MediaPluginServiceError(
      "PLUGIN_PACKAGE_INVALID",
      `plugin.json is not valid JSON: ${(error as Error).message}`,
    );
  }
}

export function updateMediaPluginSecrets(
  kind: MediaPluginKind,
  pluginId: string,
  values: Record<string, string>,
): MediaPluginDetail {
  const dir = assertExistingPluginDir(kind, pluginId);
  const manifest = readManifestFile(dir);
  if (manifest.kind !== kind) {
    throw new MediaPluginServiceError("PLUGIN_NOT_FOUND", `插件不存在: ${kind}/${pluginId}`, 404);
  }

  for (const key of Object.keys(values)) {
    if (!(key in manifest.secrets)) {
      throw new MediaPluginServiceError("PLUGIN_SECRET_INVALID", `未知密钥: ${key}`);
    }
  }

  const raw = loadRawManifest(dir);
  const secrets =
    raw.secrets && typeof raw.secrets === "object" && !Array.isArray(raw.secrets)
      ? (raw.secrets as Record<string, Record<string, unknown>>)
      : {};
  raw.secrets = secrets;

  for (const [key, value] of Object.entries(values)) {
    const meta = secrets[key];
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      throw new MediaPluginServiceError("PLUGIN_SECRET_INVALID", `密钥定义无效: ${key}`);
    }
    meta.value = String(value);
  }

  atomicWriteJson(join(dir, "plugin.json"), raw);
  return toMediaPluginDetail(readManifestFile(dir));
}

export function updateMediaPluginParams(
  kind: MediaPluginKind,
  pluginId: string,
  defaults: Record<string, unknown>,
): MediaPluginDetail {
  const dir = assertExistingPluginDir(kind, pluginId);
  const manifest = readManifestFile(dir);
  if (manifest.kind !== kind) {
    throw new MediaPluginServiceError("PLUGIN_NOT_FOUND", `插件不存在: ${kind}/${pluginId}`, 404);
  }

  validateParamDefaults(manifest.params_schema, defaults);

  const raw = loadRawManifest(dir);
  const schema =
    raw.params_schema && typeof raw.params_schema === "object" && !Array.isArray(raw.params_schema)
      ? (raw.params_schema as Record<string, Record<string, unknown>>)
      : {};
  raw.params_schema = schema;

  for (const [key, value] of Object.entries(defaults)) {
    const spec = schema[key];
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      throw new MediaPluginServiceError("PLUGIN_PARAMETER_INVALID", `参数定义无效: ${key}`);
    }
    spec.default = value;
  }

  atomicWriteJson(join(dir, "plugin.json"), raw);
  return toMediaPluginDetail(readManifestFile(dir));
}
