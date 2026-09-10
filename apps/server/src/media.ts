import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { STORAGE_ROOT } from "./db";
import { runCmd } from "./jobs/run";
import { isPathInside } from "./mediaPlugins/paths";

const THUMBNAIL_ROOT = join(STORAGE_ROOT, "thumbnails");
const THUMBNAIL_MIN = 64;
const THUMBNAIL_MAX = 1024;
const THUMBNAIL_CONCURRENCY = 4;

let thumbnailRunning = 0;
const thumbnailQueue: Array<() => void> = [];
const thumbnailInflight = new Map<string, Promise<string | null>>();

/** 图片列表只允许有限尺寸，避免把缩略图接口当成原图代理。 */
export function parseThumbnailSize(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const size = Number(value);
  if (!Number.isInteger(size) || size < THUMBNAIL_MIN || size > THUMBNAIL_MAX) return null;
  return size;
}

function runThumbnailTask<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      thumbnailRunning += 1;
      void task()
        .then(resolve, reject)
        .finally(() => {
          thumbnailRunning -= 1;
          const next = thumbnailQueue.shift();
          if (next) next();
        });
    };
    if (thumbnailRunning < THUMBNAIL_CONCURRENCY) run();
    else thumbnailQueue.push(run);
  });
}

function thumbnailKey(sourcePath: string, size: number): { key: string; output: string } | null {
  try {
    const stat = statSync(sourcePath);
    const sourceKey = createHash("sha1").update(sourcePath).digest("hex").slice(0, 20);
    const version = `${Math.floor(stat.mtimeMs)}-${stat.size}`;
    const versionKey = createHash("sha1").update(version).digest("hex").slice(0, 16);
    const key = `${sourceKey}-${size}-${versionKey}`;
    return { key, output: join(THUMBNAIL_ROOT, `${key}.png`) };
  } catch {
    return null;
  }
}

/**
 * 生成并缓存 UI 缩略图。优先使用 ImageMagick，随后回退 ffmpeg；两者都没有时返回 null，由调用方回退原图，
 * 不影响导入、编辑和导出等核心流程；同时限制并发，避免素材页首开时拉起几十个进程。
 */
export function getThumbnailPath(sourcePath: string, size: number): Promise<string | null> {
  const keyed = thumbnailKey(sourcePath, size);
  if (!keyed) return Promise.resolve(null);
  const cached = thumbnailInflight.get(keyed.key);
  if (cached) return cached;

  const promise = runThumbnailTask(async () => {
    if (existsSync(keyed.output)) return keyed.output;
    // Windows 自带的 convert.exe 不是 ImageMagick，不能作为后备命令。
    const imageMagick = Bun.which("magick") ?? (process.platform === "win32" ? null : Bun.which("convert"));
    const ffmpeg = imageMagick ? null : Bun.which("ffmpeg");
    if (!imageMagick && !ffmpeg) return null;
    mkdirSync(THUMBNAIL_ROOT, { recursive: true });
    const temporary = `${keyed.output}.${crypto.randomUUID()}.tmp.png`;
    try {
      if (imageMagick) {
        await runCmd(
          [imageMagick, sourcePath, "-thumbnail", `${size}x${size}>`, "-strip", "-define", "png:compression-level=9", temporary],
          undefined
        );
      } else {
        await runCmd([
          ffmpeg!, "-y", "-i", sourcePath,
          "-vf", `scale=w='min(${size},iw)':h='min(${size},ih)':force_original_aspect_ratio=decrease`,
          "-frames:v", "1", temporary,
        ]);
      }
      renameSync(temporary, keyed.output);
      return existsSync(keyed.output) ? keyed.output : null;
    } catch {
      return null;
    } finally {
      rmSync(temporary, { force: true });
    }
  });
  thumbnailInflight.set(keyed.key, promise);
  void promise.then(
    () => thumbnailInflight.delete(keyed.key),
    () => thumbnailInflight.delete(keyed.key)
  );
  return promise;
}

function entityTag(path: string): { etag: string; lastModified: string } {
  const stat = statSync(path);
  return {
    etag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
    lastModified: new Date(stat.mtimeMs).toUTCString(),
  };
}

export function mediaContentTypeForPath(path: string): string {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mov":
      return "video/quicktime";
    case ".avi":
      return "video/x-msvideo";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".flac":
      return "audio/flac";
    case ".ogg":
      return "audio/ogg";
    case ".m4a":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

export function assertStorageMediaPath(path: string): string {
  const resolved = resolve(path);
  if (!isPathInside(resolved, STORAGE_ROOT)) {
    throw new Error("媒体路径未落在 STORAGE_ROOT 内");
  }
  return resolved;
}

function parseByteRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match) return null;
  const startText = match[1] ?? "";
  const endText = match[2] ?? "";
  if (!startText && !endText) return null;
  let start = startText ? Number(startText) : 0;
  let end = endText ? Number(endText) : size - 1;
  if (!startText && endText) {
    const suffix = Number(endText);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return null;
  end = Math.min(end, size - 1);
  return { start, end };
}

/** RFC 5987：中文文件名必须带 filename*，否则 Chrome 下载栏会失败并提示「联系你的组织」。 */
export function contentDispositionAttachment(downloadName: string): string {
  const cleaned = downloadName.replace(/[\r\n"]/g, "_").trim() || "download";
  const ext = cleaned.includes(".") ? cleaned.slice(cleaned.lastIndexOf(".")) : "";
  const ascii = /^[\x20-\x7E]+$/.test(cleaned) ? cleaned : `download${ext}`;
  const encoded = encodeURIComponent(cleaned).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/** 为媒体响应提供条件请求、版本化缓存；支持基础 Range。 */
export function serveMediaFile(
  path: string,
  request: Request,
  contentType: string,
  options?: { downloadName?: string },
): Response {
  const { etag, lastModified } = entityTag(path);
  const versioned = new URL(request.url).searchParams.has("v");
  const cacheControl = versioned ? "public, max-age=31536000, immutable" : "public, max-age=0, must-revalidate";
  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
    ETag: etag,
    "Last-Modified": lastModified,
    "Accept-Ranges": "bytes",
  });
  if (options?.downloadName) {
    headers.set("Content-Disposition", contentDispositionAttachment(options.downloadName));
  }
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  const size = statSync(path).size;
  const range = parseByteRange(request.headers.get("range"), size);
  if (range) {
    const { start, end } = range;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(Bun.file(path).slice(start, end + 1), { status: 206, headers });
  }

  return new Response(Bun.file(path), { headers });
}

export function isImagePath(path: string): boolean {
  return /\.(?:png|jpe?g|webp|gif)$/i.test(basename(path));
}

export function isVideoPath(path: string): boolean {
  return /\.(?:mp4|webm|mov|avi)$/i.test(basename(path));
}

export function isAudioPath(path: string): boolean {
  return /\.(?:mp3|wav|flac|ogg|m4a|aac)$/i.test(basename(path));
}
