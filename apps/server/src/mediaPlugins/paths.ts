import { existsSync, mkdirSync } from "node:fs";
import { isAbsolute, join, resolve, sep } from "node:path";
import { MEDIA_PLUGIN_KINDS, parseMediaPluginKind, type MediaPluginKind } from "@framebaker/shared";
import { STORAGE_ROOT } from "../db";
import { MediaPluginServiceError } from "./types";

const SAFE_PLUGIN_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** 与 Python runner / Task 2 共用：FRAMEBAKER_MEDIA_PLUGIN_ROOT 优先，否则 STORAGE_ROOT/media-plugins。 */
export function mediaPluginStorageRoot(): string {
  const override = process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT?.trim();
  if (override) return resolve(override);
  return resolve(STORAGE_ROOT, "media-plugins");
}

export function mediaPluginRunsRoot(): string {
  return resolve(STORAGE_ROOT, "media-plugin-runs");
}

export function mediaPluginKindRoot(kind: MediaPluginKind): string {
  parseMediaPluginKind(kind);
  return join(mediaPluginStorageRoot(), kind);
}

export function assertSafeMediaPluginId(pluginId: string): string {
  const id = String(pluginId ?? "").trim();
  if (!id || !SAFE_PLUGIN_ID.test(id)) {
    throw new MediaPluginServiceError(
      "PLUGIN_PATH_INVALID",
      `非法 plugin_id: ${pluginId || "(empty)"}（仅允许字母数字及 ._-，且不能以点开头）`,
    );
  }
  if (id.includes("..") || id.includes("/") || id.includes("\\")) {
    throw new MediaPluginServiceError("PLUGIN_PATH_INVALID", `非法 plugin_id: ${pluginId}`);
  }
  return id;
}

export function mediaPluginDir(kind: MediaPluginKind, pluginId: string): string {
  const id = assertSafeMediaPluginId(pluginId);
  const root = resolve(mediaPluginKindRoot(kind));
  const dest = resolve(root, id);
  if (!isPathInside(dest, root) || dest === root) {
    throw new MediaPluginServiceError("PLUGIN_PATH_INVALID", "plugin_id would install outside install root");
  }
  return dest;
}

export function ensureMediaPluginRoots(): void {
  mkdirSync(mediaPluginStorageRoot(), { recursive: true });
  for (const kind of MEDIA_PLUGIN_KINDS) {
    mkdirSync(mediaPluginKindRoot(kind), { recursive: true });
  }
  mkdirSync(mediaPluginRunsRoot(), { recursive: true });
}

export function isPathInside(candidate: string, root: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate === resolvedRoot) return true;
  const prefix = resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep;
  return resolvedCandidate.startsWith(prefix);
}

/** 在 root 下解析相对条目；拒绝绝对路径与 Zip Slip。 */
export function resolveContainedPath(root: string, entryName: string): string {
  const name = String(entryName ?? "").replace(/\\/g, "/");
  if (!name || name.endsWith("/")) {
    throw new MediaPluginServiceError("PLUGIN_PATH_INVALID", `非法归档条目: ${entryName}`);
  }
  if (isAbsolute(name) || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.startsWith("//")) {
    throw new MediaPluginServiceError("PLUGIN_PATH_INVALID", `Zip Slip / 绝对路径条目被拒绝: ${entryName}`);
  }
  const parts = name.split("/").filter((p) => p.length > 0);
  if (parts.some((p) => p === ".." || p === ".")) {
    throw new MediaPluginServiceError("PLUGIN_PATH_INVALID", `Zip Slip 路径穿越被拒绝: ${entryName}`);
  }
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, ...parts);
  if (!isPathInside(target, resolvedRoot) || target === resolvedRoot) {
    throw new MediaPluginServiceError("PLUGIN_PATH_INVALID", `路径未包含在目标目录内: ${entryName}`);
  }
  return target;
}

export function assertExistingPluginDir(kind: MediaPluginKind, pluginId: string): string {
  const dir = mediaPluginDir(kind, pluginId);
  if (!existsSync(dir)) {
    throw new MediaPluginServiceError("PLUGIN_NOT_FOUND", `插件不存在: ${kind}/${pluginId}`, 404);
  }
  return dir;
}
