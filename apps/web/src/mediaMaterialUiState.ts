import { MEDIA_KINDS, type Material, type MediaKind } from "@framebaker/shared";

export type MaterialMediaFilter = "all" | MediaKind;

export interface MaterialActionAvailability {
  crop: boolean;
  matting: boolean;
  layers: boolean;
  importToProject: boolean;
  extractFrames: boolean;
  download: boolean;
  showPlayer: boolean;
  showDuration: boolean;
  imageOnlyExplanation: boolean;
}

function isMediaKind(value: unknown): value is MediaKind {
  return typeof value === "string" && (MEDIA_KINDS as readonly string[]).includes(value);
}

function inferMediaKindFromPath(path: unknown): MediaKind | null {
  if (typeof path !== "string" || !path) return null;
  if (/\.(mp4|mov|webm|avi)$/i.test(path)) return "video";
  if (/\.(mp3|wav|ogg|flac|m4a)$/i.test(path)) return "audio";
  if (/\.(png|jpe?g|gif|webp|bmp|avif)$/i.test(path)) return "image";
  if (/\.zip$/i.test(path)) return "archive";
  return null;
}

/** 在 API 边界解析媒体类型：合法 mediaKind/kind/metadata 优先，否则路径推断，默认 image。 */
export function resolveClientMediaKind(input: {
  mediaKind?: unknown;
  kind?: unknown;
  raw_path?: unknown;
  processed_path?: unknown;
  metadata?: unknown;
}): MediaKind {
  if (isMediaKind(input.mediaKind)) return input.mediaKind;
  if (isMediaKind(input.kind)) return input.kind;
  const metadata =
    input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? (input.metadata as Record<string, unknown>)
      : null;
  if (metadata && isMediaKind(metadata.mediaKind)) return metadata.mediaKind;
  return (
    inferMediaKindFromPath(input.raw_path) ??
    inferMediaKindFromPath(input.processed_path) ??
    "image"
  );
}

export function materialDurationSeconds(metadata: Record<string, unknown> | null | undefined): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = metadata.durationSeconds ?? metadata.duration;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export function formatMaterialDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * 视频海报 URL。
 * 仅返回 API 相对路径；绝不拼接 metadata.thumbnailPath 等绝对文件系统路径。
 * 无 hasThumbnail / 非视频时返回 null，卡片回退 video preload=metadata。
 */
export function materialPosterUrl(
  material: Pick<Material, "id" | "mediaKind" | "kind" | "metadata">,
  v?: number,
): string | null {
  const kind = material.mediaKind ?? material.kind;
  if (kind !== "video") return null;
  const meta = material.metadata;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  if (meta.hasThumbnail !== true) return null;
  return `/api/materials/${material.id}/thumbnail${v ? `?v=${v}` : ""}`;
}

export function materialDownloadUrl(
  id: string,
  v?: number,
  type: "raw" | "processed" = "raw",
): string {
  return `/api/materials/${id}/download?type=${type}${v ? `&v=${v}` : ""}`;
}

/** 把 API 返回的素材规范化为可信 MediaKind，避免组件重复解析。 */
export function normalizeMaterial(raw: unknown): Material {
  const row = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const metadata =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? ({ ...(row.metadata as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const mediaKind = resolveClientMediaKind({
    mediaKind: row.mediaKind,
    kind: row.kind,
    raw_path: row.raw_path,
    processed_path: row.processed_path,
    metadata,
  });
  metadata.mediaKind = mediaKind;
  const duration = materialDurationSeconds(metadata);
  if (duration != null) metadata.durationSeconds = duration;

  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? ""),
    raw_path: (row.raw_path as string | null) ?? null,
    processed_path: (row.processed_path as string | null) ?? null,
    status: (row.status === "matted" ? "matted" : "raw") as Material["status"],
    source: (typeof row.source === "string" ? row.source : "upload") as Material["source"],
    folder_id: (row.folder_id as string | null) ?? null,
    metadata,
    created_at: typeof row.created_at === "number" ? row.created_at : Number(row.created_at) || 0,
    kind: mediaKind,
    mediaKind,
  };
}

export function filterMaterialsByMediaKind(
  materials: Material[],
  filter: MaterialMediaFilter,
): Material[] {
  if (filter === "all") return materials;
  return materials.filter((m) => (m.mediaKind ?? m.kind) === filter);
}

export function materialActionAvailability(kind: MediaKind): MaterialActionAvailability {
  const isImage = kind === "image";
  const isVideo = kind === "video";
  const isAudio = kind === "audio";
  return {
    crop: isImage,
    matting: isImage,
    layers: isImage,
    importToProject: isImage,
    extractFrames: isVideo,
    download: true,
    showPlayer: isVideo || isAudio,
    showDuration: isVideo || isAudio,
    imageOnlyExplanation: !isImage,
  };
}
