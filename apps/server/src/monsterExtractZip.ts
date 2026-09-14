/** 怪物流水线拆帧压缩包路径：动画名/动作ID/{fps}fps/0001.png */

export function sanitizeZipSegment(name: string): string {
  const cleaned = name.replace(/[/\\?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 48) || "monster";
}

export function monsterExtractZipEntryPath(opts: {
  monsterName: string;
  actionId: string;
  fps: number;
  frameIndex: number;
  /** 仅 sidecar 展示用，不进入路径 */
  actionTitle?: string;
}): string {
  const root = sanitizeZipSegment(opts.monsterName);
  const action = sanitizeZipSegment(opts.actionId);
  const fps = Math.max(1, Math.round(opts.fps));
  const n = Math.max(1, Math.floor(opts.frameIndex));
  return `${root}/${action}/${fps}fps/${String(n).padStart(4, "0")}.png`;
}

export type MonsterExtractClipInput = {
  actionId: string;
  actionTitle: string;
  fps: number;
  frames: Uint8Array[];
};

export type MonsterExtractSidecar = {
  liafPipeline: "R0-draft";
  notARuntimeContract: true;
  schemaHint: "draft-sidecar-not-frozen";
  monsterName: string;
  facing: "left";
  actions: Array<{
    id: string;
    title: string;
    fps: number;
    files: string[];
  }>;
};

export function buildMonsterExtractZipFiles(
  monsterName: string,
  clips: MonsterExtractClipInput[],
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const clip of clips) {
    clip.frames.forEach((bytes, i) => {
      const path = monsterExtractZipEntryPath({
        monsterName,
        actionId: clip.actionId,
        actionTitle: clip.actionTitle,
        fps: clip.fps,
        frameIndex: i + 1,
      });
      files[path] = bytes;
    });
  }
  return files;
}

export function buildMonsterExtractSidecar(monsterName: string, clips: MonsterExtractClipInput[]): MonsterExtractSidecar {
  return {
    liafPipeline: "R0-draft",
    notARuntimeContract: true,
    schemaHint: "draft-sidecar-not-frozen",
    monsterName: sanitizeZipSegment(monsterName),
    facing: "left",
    actions: clips.map((clip) => ({
      id: clip.actionId,
      title: clip.actionTitle,
      fps: Math.max(1, Math.round(clip.fps)),
      files: clip.frames.map((_, i) =>
        monsterExtractZipEntryPath({
          monsterName,
          actionId: clip.actionId,
          fps: clip.fps,
          frameIndex: i + 1,
        }),
      ),
    })),
  };
}
