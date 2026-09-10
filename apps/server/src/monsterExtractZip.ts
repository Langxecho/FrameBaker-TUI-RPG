/** 怪物流水线拆帧压缩包路径：动画名/动作名/{fps}fps/0001.png */

export function sanitizeZipSegment(name: string): string {
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 48) || "monster";
}

export function monsterExtractZipEntryPath(opts: {
  monsterName: string;
  actionTitle: string;
  fps: number;
  frameIndex: number;
}): string {
  const root = sanitizeZipSegment(opts.monsterName);
  const action = sanitizeZipSegment(opts.actionTitle);
  const fps = Math.max(1, Math.round(opts.fps));
  const n = Math.max(1, Math.floor(opts.frameIndex));
  return `${root}/${action}/${fps}fps/${String(n).padStart(4, "0")}.png`;
}

export function buildMonsterExtractZipFiles(
  monsterName: string,
  clips: Array<{ actionTitle: string; fps: number; frames: Uint8Array[] }>,
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const clip of clips) {
    clip.frames.forEach((bytes, i) => {
      const path = monsterExtractZipEntryPath({
        monsterName,
        actionTitle: clip.actionTitle,
        fps: clip.fps,
        frameIndex: i + 1,
      });
      files[path] = bytes;
    });
  }
  return files;
}
