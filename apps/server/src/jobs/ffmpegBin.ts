import { existsSync } from "node:fs";
import { join } from "node:path";

export function ffmpegInstallHint(): string {
  if (process.platform === "win32") return "winget install ffmpeg（装完后重启 bun dev；或 https://ffmpeg.org/download.html）";
  if (process.platform === "darwin") return "brew install ffmpeg";
  return "用系统包管理器安装 ffmpeg（如 apt install ffmpeg）";
}

function winGetFfmpeg(): string | null {
  if (process.platform !== "win32") return null;
  const local = process.env.LOCALAPPDATA?.trim();
  if (!local) return null;
  const links = join(local, "Microsoft", "WinGet", "Links", "ffmpeg.exe");
  return existsSync(links) ? links : null;
}

/** 解析 ffmpeg 可执行文件；WinGet 安装后 Cursor 进程可能还看不到 PATH。 */
export function resolveFfmpegBin(): string | null {
  return Bun.which("ffmpeg") || winGetFfmpeg();
}

export function requireFfmpegBin(): string {
  const bin = resolveFfmpegBin();
  if (!bin) {
    throw new Error(`未找到 ffmpeg。怪物静图去背/贴画和 GIF/MP4 拆帧都需要它。请安装后重启开发服务：${ffmpegInstallHint()}`);
  }
  return bin;
}
