import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { db, STORAGE_ROOT } from "./db";
import { requireFfmpegBin } from "./jobs/ffmpegBin";
import { isPathInside } from "./mediaPlugins/paths";

/** 网关上传常拒 256 透明 PNG；转成 1024 RGB JPEG 再交给 I2VA 插件。 */
export function prepareMonsterI2vJpeg(stillMaterialId: string): string {
  const row = db.query("SELECT raw_path FROM materials WHERE id = ?").get(stillMaterialId) as { raw_path: string | null } | null;
  const src = row?.raw_path;
  if (!src || !existsSync(src)) throw new Error("待机静图文件缺失，无法准备图生视频参考图");
  const dir = join(STORAGE_ROOT, "monster-i2v");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `${stillMaterialId}.jpg`);
  if (existsSync(out) && statSync(out).size > 0) return assertStorageJpeg(out);
  const ffmpeg = requireFfmpegBin();
  const result = Bun.spawnSync(
    [
      ffmpeg,
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=0x111111:s=1024x1024:d=1",
      "-i",
      src,
      "-filter_complex",
      "[1:v]format=rgba,scale=1024:1024:force_original_aspect_ratio=decrease:flags=neighbor[fg];[0:v][fg]overlay=(W-w)/2:(H-h)/2,format=yuvj420p",
      "-frames:v",
      "1",
      "-q:v",
      "2",
      out,
    ],
    { stderr: "pipe" },
  );
  if (result.exitCode !== 0 || !existsSync(out) || statSync(out).size <= 0) {
    const err = result.stderr ? new TextDecoder().decode(result.stderr) : "";
    throw new Error(`待机静图转 JPEG 失败: ${err.trim().slice(-800) || `退出码 ${result.exitCode}`}`);
  }
  return assertStorageJpeg(out);
}

function assertStorageJpeg(path: string): string {
  const resolved = resolve(path);
  if (!isPathInside(resolved, STORAGE_ROOT)) throw new Error("图生视频参考图未落在 STORAGE_ROOT 内");
  return resolved;
}
