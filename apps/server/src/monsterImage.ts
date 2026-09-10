import { existsSync } from "node:fs";
import { join } from "node:path";
import type { GenProvider } from "@framebaker/shared";
import {
  MONSTER_IMAGE_API_SIZE,
  MONSTER_IMAGE_DEFAULT_BASE_URL,
  MONSTER_IMAGE_DEFAULT_MODEL,
  MONSTER_IMAGE_PLUGIN_ID,
  MONSTER_IMAGE_PROVIDER_ID,
  normalizeMonsterImageBaseUrl,
} from "@framebaker/shared";
import { db } from "./db";
import { readManifestFile } from "./mediaPlugins/manifest";
import { mediaPluginDir } from "./mediaPlugins/paths";
import type { RuntimeGenProvider } from "./provider";

export interface MonsterImageSettings {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

function readSettingJson<T>(key: string): T | null {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

function pluginFallback(): { apiBaseUrl: string; apiKey: string; model: string } | null {
  try {
    const dir = mediaPluginDir("image_api", MONSTER_IMAGE_PLUGIN_ID);
    if (!existsSync(join(dir, "plugin.json"))) return null;
    const manifest = readManifestFile(dir);
    const secrets = manifest.secrets ?? {};
    const apiKey = String(secrets.api_key?.value ?? "").trim();
    const rawBase = String(secrets.base_url?.value ?? "").trim();
    const model = String(manifest.params_schema.model?.default ?? "").trim() || MONSTER_IMAGE_DEFAULT_MODEL;
    if (!apiKey && !rawBase) return null;
    return {
      apiBaseUrl: normalizeMonsterImageBaseUrl(rawBase || MONSTER_IMAGE_DEFAULT_BASE_URL) || MONSTER_IMAGE_DEFAULT_BASE_URL,
      apiKey,
      model,
    };
  } catch {
    return null;
  }
}

export function mergeMonsterImageSetting(raw: unknown): MonsterImageSettings {
  const prev = readSettingJson<Partial<MonsterImageSettings>>("monsterImage") ?? {};
  const incoming = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const apiKeyIncoming = String(incoming.apiKey ?? "").trim();
  return {
    apiBaseUrl:
      normalizeMonsterImageBaseUrl(String(incoming.apiBaseUrl ?? prev.apiBaseUrl ?? "")) || MONSTER_IMAGE_DEFAULT_BASE_URL,
    apiKey: apiKeyIncoming || String(prev.apiKey ?? "").trim(),
    model: String(incoming.model ?? prev.model ?? "").trim() || MONSTER_IMAGE_DEFAULT_MODEL,
  };
}

export function getMonsterImageSettings(): MonsterImageSettings & { usingPluginFallback: boolean } {
  const saved = readSettingJson<Partial<MonsterImageSettings>>("monsterImage") ?? {};
  const plugin = pluginFallback();
  const apiBaseUrl =
    normalizeMonsterImageBaseUrl(saved.apiBaseUrl) || plugin?.apiBaseUrl || MONSTER_IMAGE_DEFAULT_BASE_URL;
  const model = String(saved.model ?? "").trim() || plugin?.model || MONSTER_IMAGE_DEFAULT_MODEL;
  const savedKey = String(saved.apiKey ?? "").trim();
  const apiKey = savedKey || plugin?.apiKey || "";
  return {
    apiBaseUrl,
    apiKey,
    model,
    usingPluginFallback: !savedKey && Boolean(plugin?.apiKey),
  };
}

export function getMonsterImageProvider(): RuntimeGenProvider {
  const settings = getMonsterImageSettings();
  const emptyCli = {
    cliBin: "",
    cliPromptArg: "",
    cliOutputArg: "",
    cliModelArg: "",
    cliReferenceArg: "",
    cliExtraArgs: "",
  };
  return {
    id: MONSTER_IMAGE_PROVIDER_ID,
    name: "怪物生图",
    type: "api",
    ...emptyCli,
    apiBaseUrl: settings.apiBaseUrl,
    apiKey: settings.apiKey,
    imageModels: settings.model ? [settings.model] : [],
    videoModels: [],
    textModels: [],
    imageSize: MONSTER_IMAGE_API_SIZE,
    videoSize: "",
    apiModels: settings.model ? [settings.model] : [],
    apiSize: MONSTER_IMAGE_API_SIZE,
  };
}

export function monsterImageConfigured(provider: GenProvider = getMonsterImageProvider()): boolean {
  return Boolean(provider.apiBaseUrl.trim() && provider.apiKey.trim());
}

export function monsterImageJobFields(): { providerId: string; model: string; size: string } {
  const provider = getMonsterImageProvider();
  if (!monsterImageConfigured(provider)) {
    throw new Error("请在怪物页顶部填写生图 Base URL 和 API Key，或先在设置里配好 Euzhi GPT Image 2 插件密钥");
  }
  return {
    providerId: MONSTER_IMAGE_PROVIDER_ID,
    model: provider.imageModels[0] || MONSTER_IMAGE_DEFAULT_MODEL,
    size: provider.imageSize || MONSTER_IMAGE_API_SIZE,
  };
}

export function getMonsterImagePublic() {
  const settings = getMonsterImageSettings();
  return {
    apiBaseUrl: settings.apiBaseUrl,
    model: settings.model,
    configured: Boolean(settings.apiBaseUrl && settings.apiKey),
    hasKey: Boolean(settings.apiKey),
    usingPluginFallback: settings.usingPluginFallback,
  };
}
