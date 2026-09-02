import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MEDIA_PLUGIN_KINDS, type MediaPluginDetail, type MediaPluginKind, type MediaPluginSummary } from "@framebaker/shared";
import { readManifestFile, toMediaPluginDetail, toMediaPluginSummary } from "./manifest";
import { assertSafeMediaPluginId, ensureMediaPluginRoots, mediaPluginDir, mediaPluginKindRoot } from "./paths";
import { MediaPluginServiceError } from "./types";

function scanKind(kind: MediaPluginKind): MediaPluginSummary[] {
  const root = mediaPluginKindRoot(kind);
  if (!existsSync(root)) return [];
  const summaries: MediaPluginSummary[] = [];
  for (const name of readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory()) continue;
    try {
      assertSafeMediaPluginId(name.name);
      const manifest = readManifestFile(join(root, name.name));
      if (manifest.kind !== kind) continue;
      const summary = toMediaPluginSummary(manifest);
      const providerOk = existsSync(join(root, name.name, "provider.py"));
      summaries.push({ ...summary, runnable: providerOk && summary.configured });
    } catch {
      // 跳过损坏目录
    }
  }
  summaries.sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en"));
  return summaries;
}

export function listInstalledMediaPlugins(kind?: MediaPluginKind): MediaPluginSummary[] {
  ensureMediaPluginRoots();
  if (kind) return scanKind(kind);
  return MEDIA_PLUGIN_KINDS.flatMap((k) => scanKind(k));
}

export function getMediaPlugin(kind: MediaPluginKind, pluginId: string): MediaPluginDetail | null {
  ensureMediaPluginRoots();
  try {
    assertSafeMediaPluginId(pluginId);
  } catch {
    return null;
  }
  const dir = mediaPluginDir(kind, pluginId);
  if (!existsSync(dir)) return null;
  try {
    const manifest = readManifestFile(dir);
    if (manifest.kind !== kind) return null;
    const providerOk = existsSync(join(dir, "provider.py"));
    const detail = toMediaPluginDetail(manifest);
    return { ...detail, runnable: providerOk && detail.configured };
  } catch (error) {
    if (error instanceof MediaPluginServiceError && error.code === "PLUGIN_NOT_FOUND") return null;
    throw error;
  }
}
