export type MotionReferenceKind = "video" | "image";
export type MotionReferenceSyncMode = "stretch" | "seconds";
export type MotionReferenceOrder = "behind" | "front";

/** 按文件名/MIME 判断参考蒙皮用视频还是静图（GIF 当图，浏览器不能可靠按时间轴抽帧）。 */
export function inferMotionReferenceKind(fileName: string, mime = ""): MotionReferenceKind | null {
  const name = fileName.trim().toLowerCase();
  const type = mime.trim().toLowerCase();
  if (type.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv)$/i.test(name)) return "video";
  if (type.startsWith("image/") || /\.(gif|png|jpe?g|webp|bmp|svg)$/i.test(name)) return "image";
  return null;
}

/** 把动作剪辑时间映射到参考视频时间；stretch 把整段视频拉到动作时长，seconds 按秒对齐后截断。 */
export function mapClipTimeToMedia(
  clipTime: number,
  clipDuration: number,
  mediaDuration: number,
  mode: MotionReferenceSyncMode,
): number {
  if (!(mediaDuration > 0) || !Number.isFinite(mediaDuration)) return 0;
  const time = Number.isFinite(clipTime) ? Math.max(0, clipTime) : 0;
  if (mode === "seconds") return Math.min(mediaDuration, time);
  if (!(clipDuration > 0) || !Number.isFinite(clipDuration)) return 0;
  return Math.min(mediaDuration, Math.max(0, (time / clipDuration) * mediaDuration));
}
