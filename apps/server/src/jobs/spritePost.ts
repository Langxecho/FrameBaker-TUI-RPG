import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { requireFfmpegBin } from "./ffmpegBin";
import { JobCancelledError } from "./run";
import { processSpritePixels, readPngSize, type SpriteFit } from "./spriteKey";

async function runCaptured(argv: string[], signal?: AbortSignal): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  if (signal?.aborted) throw new JobCancelledError();
  let proc;
  try {
    proc = Bun.spawn(argv, { stdout: "pipe" as const, stderr: "pipe" as const });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法启动 ${argv[0]}：${detail}`);
  }
  const onAbort = () => {
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).text(),
    ]);
    if (signal?.aborted) throw new JobCancelledError();
    return { code, stdout: Buffer.from(stdout), stderr };
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

function pngSizeFromFile(path: string): { width: number; height: number } {
  const size = readPngSize(readFileSync(path));
  if (!size) throw new Error("无法从 PNG 头读取尺寸（产物可能不是 PNG）");
  return size;
}

export async function applySpritePostprocessToPng(
  path: string,
  options: { bgKey?: "flood" | "none"; spriteFit?: SpriteFit },
  signal?: AbortSignal,
): Promise<void> {
  if (!options.bgKey && !options.spriteFit) return;
  const ffmpeg = requireFfmpegBin();
  const { width, height } = pngSizeFromFile(path);
  const decoded = await runCaptured(
    [ffmpeg, "-y", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
    signal,
  );
  if (decoded.code !== 0) throw new Error(`解码 PNG 失败: ${decoded.stderr.trim().slice(-500)}`);
  const expected = width * height * 4;
  if (decoded.stdout.length < expected) throw new Error("PNG 像素数据不完整");
  const processed = processSpritePixels(new Uint8ClampedArray(decoded.stdout.subarray(0, expected)), width, height, options);
  const tmpDir = join(dirname(path), `sprite_${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const rawPath = join(tmpDir, "frame.rgba");
  const outPath = join(tmpDir, "out.png");
  writeFileSync(rawPath, processed.data);
  try {
    const encoded = await runCaptured(
      [
        ffmpeg,
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgba",
        "-s",
        `${processed.width}x${processed.height}`,
        "-i",
        rawPath,
        "-frames:v",
        "1",
        outPath,
      ],
      signal,
    );
    if (encoded.code !== 0) throw new Error(`写出透明 PNG 失败: ${encoded.stderr.trim().slice(-500)}`);
    await Bun.write(path, Bun.file(outPath));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
