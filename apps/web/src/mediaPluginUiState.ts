import type {
  Folder,
  MediaKind,
  MediaPluginKind,
  MediaPluginParamSchema,
  MediaPluginGenerationRequest,
  Material,
} from "@framebaker/shared";
import { MEDIA_PLUGIN_ARCHIVE_EXTENSIONS } from "@framebaker/shared";

export type MediaGenerateTab = "image" | "video" | "audio";

export const MEDIA_GENERATE_TABS: MediaGenerateTab[] = ["image", "video", "audio"];

export function pluginKindForTab(tab: MediaGenerateTab): MediaPluginKind {
  if (tab === "image") return "image_api";
  if (tab === "video") return "video_api";
  return "audio_api";
}

export function mediaKindForPluginKind(kind: MediaPluginKind): MediaKind {
  if (kind === "image_api") return "image";
  if (kind === "video_api") return "video";
  return "audio";
}

export function tabForPluginKind(kind: MediaPluginKind): MediaGenerateTab {
  return mediaKindForPluginKind(kind);
}

export function allowedPluginArchiveExtensions(): string[] {
  return Object.values(MEDIA_PLUGIN_ARCHIVE_EXTENSIONS);
}

export function isAllowedPluginArchiveFilename(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  return allowedPluginArchiveExtensions().some((ext) => lower.endsWith(ext));
}

/** 插件导入 file input 的 accept：仅扩展名，避免 application/zip 放宽筛选。 */
export function pluginArchiveFileAccept(): string {
  return allowedPluginArchiveExtensions().join(",");
}

/** 从 job.progress 解析媒体插件归档后的 materialIds（完成态写入）。 */
export function parseMaterialIdsFromJobProgress(progress: string | null | undefined): string[] {
  const text = progress ?? "";
  const jsonMatch = /materialIds=(\[[^\]]*\])/i.exec(text);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]!) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((id): id is string => typeof id === "string" && id.trim() !== "");
      }
    } catch {
      /* fall through */
    }
  }
  const single = /materialId[=:]\s*([A-Za-z0-9_-]+)/i.exec(text);
  return single?.[1] ? [single[1]] : [];
}

export function createParamDefaults(schema: Record<string, MediaPluginParamSchema>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema ?? {})) {
    if (field && "default" in field && field.default !== undefined) {
      out[key] = structuredClone(field.default);
      continue;
    }
    const type = String(field?.type ?? "string");
    if (type === "boolean") out[key] = false;
    else if (type === "integer" || type === "number") out[key] = 0;
    else if (type === "json") out[key] = {};
    else if (type === "enum" && Array.isArray(field?.enum) && field.enum.length) out[key] = field.enum[0];
    else out[key] = "";
  }
  return out;
}

export type MediaPluginParamErrors = Record<string, string>;

export function validateMediaPluginParams(
  schema: Record<string, MediaPluginParamSchema>,
  values: Record<string, unknown>,
): MediaPluginParamErrors {
  const errors: MediaPluginParamErrors = {};
  for (const [key, field] of Object.entries(schema ?? {})) {
    const required = Boolean(field?.required);
    const raw = values[key];
    const type = String(field?.type ?? "string");
    const empty =
      raw === undefined ||
      raw === null ||
      (typeof raw === "string" && raw.trim() === "") ||
      (type === "json" && typeof raw === "string" && raw.trim() === "");
    if (required && empty) {
      errors[key] = "required";
      continue;
    }
    if (empty) continue;
    if (type === "integer") {
      if (typeof raw !== "number" || !Number.isInteger(raw)) errors[key] = "integer";
    } else if (type === "number") {
      if (typeof raw !== "number" || !Number.isFinite(raw)) errors[key] = "number";
    } else if (type === "boolean") {
      if (typeof raw !== "boolean") errors[key] = "boolean";
    } else if (type === "enum") {
      const options = Array.isArray(field.enum) ? field.enum : [];
      if (!options.some((opt) => Object.is(opt, raw) || String(opt) === String(raw))) errors[key] = "enum";
    } else if (type === "json") {
      if (typeof raw === "string") {
        try {
          JSON.parse(raw);
        } catch {
          errors[key] = "json";
        }
      } else if (typeof raw !== "object" || raw === null) {
        errors[key] = "json";
      }
    }
  }
  return errors;
}

export function coerceParamValuesForSubmit(
  schema: Record<string, MediaPluginParamSchema>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema ?? {})) {
    const type = String(field?.type ?? "string");
    const raw = values[key];
    if (raw === undefined) continue;
    if (type === "json" && typeof raw === "string") {
      out[key] = raw.trim() === "" ? {} : JSON.parse(raw);
      continue;
    }
    if ((type === "integer" || type === "number") && typeof raw === "string" && raw.trim() !== "") {
      const n = type === "integer" ? Number.parseInt(raw, 10) : Number(raw);
      out[key] = n;
      continue;
    }
    out[key] = raw;
  }
  return out;
}

function constraintInt(constraints: Record<string, unknown>, key: string, fallback: number): number {
  const v = constraints[key];
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  return fallback;
}

export function maxReferenceCountForPlugin(
  kind: MediaPluginKind,
  constraints: Record<string, unknown> = {},
): number {
  if (kind === "image_api") return constraintInt(constraints, "max_reference_images", 8);
  if (kind === "video_api") return constraintInt(constraints, "max_reference_images", 1);
  return Math.max(
    constraintInt(constraints, "max_reference_images", 1),
    constraintInt(constraints, "max_reference_audios", 1),
  );
}

export function acceptedReferenceMediaKinds(
  kind: MediaPluginKind,
  constraints: Record<string, unknown> = {},
): MediaKind[] {
  if (kind === "image_api" || kind === "video_api") return ["image"];
  const kinds: MediaKind[] = [];
  const maxImages = constraintInt(constraints, "max_reference_images", 1);
  const maxAudios = constraintInt(constraints, "max_reference_audios", 1);
  if (maxImages > 0) kinds.push("image");
  if (maxAudios > 0) kinds.push("audio");
  return kinds.length ? kinds : ["image", "audio"];
}

export function filterMaterialsForPlugin(
  materials: Material[],
  kind: MediaPluginKind,
  constraints: Record<string, unknown> = {},
): Material[] {
  const accepted = new Set(acceptedReferenceMediaKinds(kind, constraints));
  return materials.filter((m) => accepted.has((m.mediaKind ?? m.kind) as MediaKind));
}

export function canUseProjectTarget(kind: MediaPluginKind): boolean {
  return kind === "image_api";
}

export function buildMediaGenerationRequest(input: {
  kind: MediaPluginKind;
  pluginId: string;
  prompt: string;
  references?: string[];
  params?: Record<string, unknown>;
  count?: number;
  durationSeconds?: number;
  folderId?: string | null;
  projectId?: string | null;
  name?: string;
}): MediaPluginGenerationRequest {
  const projectId = canUseProjectTarget(input.kind) ? input.projectId ?? null : null;
  return {
    kind: input.kind,
    pluginId: input.pluginId,
    prompt: input.prompt,
    references: input.references?.length ? input.references : undefined,
    params: input.params && Object.keys(input.params).length ? input.params : undefined,
    count: input.count,
    durationSeconds: input.durationSeconds,
    folderId: input.folderId ?? null,
    projectId,
    name: input.name,
  };
}

export function validateGenerationForm(input: {
  pluginId: string;
  prompt: string;
  schema: Record<string, MediaPluginParamSchema>;
  params: Record<string, unknown>;
  kind: MediaPluginKind;
  projectId?: string | null;
}): { ok: true } | { ok: false; field: string; code: string } {
  if (!input.pluginId.trim()) return { ok: false, field: "pluginId", code: "required" };
  if (!input.prompt.trim()) return { ok: false, field: "prompt", code: "required" };
  if (input.projectId && !canUseProjectTarget(input.kind)) {
    return { ok: false, field: "projectId", code: "image_only" };
  }
  const paramErrors = validateMediaPluginParams(input.schema, input.params);
  const first = Object.entries(paramErrors)[0];
  if (first) return { ok: false, field: first[0], code: first[1] };
  return { ok: true };
}

export function isHttpConflictStatus(status: number): boolean {
  return status === 409;
}

/** Build ImportModal/FolderTree-style nested folder labels (`父 / 子`). */
export function folderPathLabel(folders: Folder[], folderId: string): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const folder = byId.get(folderId);
  if (!folder) return "";
  const names = [folder.name];
  const seen = new Set([folder.id]);
  let parentId = folder.parent_id;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parent_id;
  }
  return names.join(" / ");
}
