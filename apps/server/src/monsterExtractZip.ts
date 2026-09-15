/** R1-A 怪物逐帧素材：ZIP 根目录 sidecar.json + frames/{actionId}/0001.png。不是 .monster。 */

import { createHash } from "node:crypto";
import { MONSTER_IDLE_ACTION_ID } from "@framebaker/shared";

export type MonsterSpriteLoopMode = "once" | "loop" | "hold";

export function toContractId(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96);
  if (/^[a-z0-9][a-z0-9_.-]*$/.test(cleaned)) return cleaned;
  return `id-${cleaned.replace(/^[^a-z0-9]+/, "").slice(0, 93) || "export"}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 把 count 帧均分到约 1000/fps 毫秒，余数摊到前几帧（24fps 三帧为 42/42/41）。 */
export function frameDurationsMs(frameCount: number, fps: number): number[] {
  const count = Math.max(1, Math.floor(frameCount));
  const hz = Math.max(1, Math.min(60, Math.round(fps)));
  const totalMs = Math.max(count, Math.round((count * 1000) / hz));
  const base = Math.floor(totalMs / count);
  const rem = totalMs - base * count;
  return Array.from({ length: count }, (_, i) => Math.max(1, base + (i < rem ? 1 : 0)));
}

export function monsterExtractZipEntryPath(opts: {
  actionId: string;
  frameIndex: number;
  monsterName?: string;
  actionTitle?: string;
  fps?: number;
}): string {
  const action = toContractId(opts.actionId);
  const n = Math.max(1, Math.floor(opts.frameIndex));
  return `frames/${action}/${String(n).padStart(4, "0")}.png`;
}

export function loopModeForActionId(actionId: string): MonsterSpriteLoopMode {
  if (actionId === MONSTER_IDLE_ACTION_ID || actionId.endsWith("-idle")) return "loop";
  if (actionId.includes("death")) return "hold";
  return "once";
}

export type MonsterExtractClipInput = {
  actionId: string;
  actionTitle: string;
  fps: number;
  frames: Uint8Array[];
};

export type MonsterSpriteExtractSidecar = {
  format: "framebaker.monster-sprite-extract";
  schemaVersion: 1;
  source: {
    projectId: string;
    exportId: string;
    toolName: "FrameBaker";
    toolVersion: string;
    exportedAt: string;
  };
  displayName: string;
  canvas: { width: number; height: number };
  coordinateSystem: {
    space: "pixel_2d";
    xAxis: "right";
    yAxis: "down";
    origin: "top_left";
    mirrorAxis: "x";
  };
  objectOriginPx: { x: number; y: number };
  defaultFacing: "left" | "right";
  actions: Array<{
    actionId: string;
    displayName: string;
    loopMode: MonsterSpriteLoopMode;
    sampleRateHz: number;
    frames: Array<{
      relativePath: string;
      startTimeMs: number;
      durationMs: number;
      sha256: string;
      anchors: Array<{ id: string; x: number; y: number; directionDegrees?: number }>;
    }>;
    markers: Array<{ id: string; atMs: number; presentationOnly: true }>;
  }>;
};

export function buildMonsterExtractZipFiles(clips: MonsterExtractClipInput[]): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  for (const clip of clips) {
    clip.frames.forEach((bytes, i) => {
      files[monsterExtractZipEntryPath({ actionId: clip.actionId, frameIndex: i + 1 })] = bytes;
    });
  }
  return files;
}

export function buildMonsterExtractSidecar(opts: {
  displayName: string;
  projectId: string;
  exportId: string;
  toolVersion: string;
  exportedAt: string;
  canvas: { width: number; height: number };
  clips: MonsterExtractClipInput[];
}): MonsterSpriteExtractSidecar {
  const width = Math.max(1, Math.min(2048, Math.round(opts.canvas.width)));
  const height = Math.max(1, Math.min(2048, Math.round(opts.canvas.height)));
  const displayName = opts.displayName.trim().slice(0, 120) || "monster";
  return {
    format: "framebaker.monster-sprite-extract",
    schemaVersion: 1,
    source: {
      projectId: toContractId(opts.projectId),
      exportId: toContractId(opts.exportId),
      toolName: "FrameBaker",
      toolVersion: opts.toolVersion.slice(0, 64) || "0.4.0",
      exportedAt: opts.exportedAt,
    },
    displayName,
    canvas: { width, height },
    coordinateSystem: {
      space: "pixel_2d",
      xAxis: "right",
      yAxis: "down",
      origin: "top_left",
      mirrorAxis: "x",
    },
    objectOriginPx: { x: Math.floor(width / 2), y: height },
    defaultFacing: "left",
    actions: opts.clips.map((clip) => {
      const actionId = toContractId(clip.actionId);
      const durations = frameDurationsMs(clip.frames.length, clip.fps);
      let startTimeMs = 0;
      const frames = clip.frames.map((bytes, i) => {
        const durationMs = durations[i]!;
        const relativePath = monsterExtractZipEntryPath({ actionId, frameIndex: i + 1 });
        const frame = {
          relativePath,
          startTimeMs,
          durationMs,
          sha256: sha256Hex(bytes),
          anchors: [] as Array<{ id: string; x: number; y: number }>,
        };
        startTimeMs += durationMs;
        return frame;
      });
      return {
        actionId,
        displayName: clip.actionTitle.trim().slice(0, 120) || actionId,
        loopMode: loopModeForActionId(clip.actionId),
        sampleRateHz: Math.max(1, Math.min(60, Math.round(clip.fps))),
        frames,
        markers: [] as Array<{ id: string; atMs: number; presentationOnly: true }>,
      };
    }),
  };
}
