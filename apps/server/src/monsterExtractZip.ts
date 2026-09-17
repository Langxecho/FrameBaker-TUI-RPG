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
  /** 导入入口必填；流水线打包未传时回退 loopModeForActionId。 */
  loopMode?: MonsterSpriteLoopMode;
  /** 未提供逐帧覆盖时复制到本动作的每一帧。 */
  anchors?: MonsterSpritePresentationAnchor[];
  /** 索引与输入帧顺序一致，未提供的帧沿用 anchors。 */
  frameAnchors?: Array<MonsterSpritePresentationAnchor[] | undefined>;
  /** 仅供表现编排器采样，绝不参与命中或伤害结算。 */
  markers?: MonsterSpritePresentationMarker[];
};

export type MonsterSpritePresentationAnchor = {
  id: string;
  x: number;
  y: number;
  directionDegrees?: number;
};

export type MonsterSpritePresentationMarker = {
  id: string;
  atMs: number;
  presentationOnly: true;
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
      anchors: MonsterSpritePresentationAnchor[];
    }>;
    markers: MonsterSpritePresentationMarker[];
  }>;
};

const CONTRACT_ID = /^[a-z0-9][a-z0-9_.-]{0,95}$/;
const PRESENTATION_MARKER_ID = /^(?!combat\.hitbox(?:\.|$))[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

function checkedAnchors(
  anchors: MonsterSpritePresentationAnchor[] | undefined,
  canvas: { width: number; height: number },
  label: string,
): MonsterSpritePresentationAnchor[] {
  const list = anchors ?? [];
  if (list.length > 32) throw new RangeError(`${label} 的挂点不能超过 32 个`);
  const ids = new Set<string>();
  return list.map((anchor) => {
    if (!CONTRACT_ID.test(anchor.id) || ids.has(anchor.id)) throw new RangeError(`${label} 的挂点 ID 无效或重复`);
    ids.add(anchor.id);
    if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y) || anchor.x < 0 || anchor.y < 0 || anchor.x > canvas.width || anchor.y > canvas.height) {
      throw new RangeError(`${label} 的挂点坐标超出画布`);
    }
    if (anchor.directionDegrees !== undefined && (!Number.isFinite(anchor.directionDegrees) || anchor.directionDegrees < -360 || anchor.directionDegrees > 360)) {
      throw new RangeError(`${label} 的挂点方向必须在 -360 到 360 度之间`);
    }
    return anchor.directionDegrees === undefined
      ? { id: anchor.id, x: anchor.x, y: anchor.y }
      : { id: anchor.id, x: anchor.x, y: anchor.y, directionDegrees: anchor.directionDegrees };
  });
}

function checkedMarkers(markers: MonsterSpritePresentationMarker[] | undefined, durationMs: number, label: string): MonsterSpritePresentationMarker[] {
  const list = markers ?? [];
  if (list.length > 128) throw new RangeError(`${label} 的标记不能超过 128 个`);
  return list.map((marker) => {
    if (!PRESENTATION_MARKER_ID.test(marker.id) || marker.presentationOnly !== true) {
      throw new RangeError(`${label} 的标记必须是合法的 presentationOnly 表现标记`);
    }
    if (!Number.isInteger(marker.atMs) || marker.atMs < 0 || marker.atMs >= durationMs) {
      throw new RangeError(`${label} 的标记时刻必须位于动作时长内`);
    }
    return { id: marker.id, atMs: marker.atMs, presentationOnly: true };
  });
}

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
  objectOriginPx?: { x: number; y: number };
  defaultFacing?: "left" | "right";
}): MonsterSpriteExtractSidecar {
  const width = Math.round(opts.canvas.width);
  const height = Math.round(opts.canvas.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width > 2048 || height > 2048) {
    throw new RangeError("怪物拆帧画布必须在 1 到 2048 像素之间");
  }
  const displayName = opts.displayName.trim().slice(0, 120) || "monster";
  const originX = opts.objectOriginPx ? Math.round(opts.objectOriginPx.x) : Math.floor(width / 2);
  const originY = opts.objectOriginPx ? Math.round(opts.objectOriginPx.y) : height;
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
    objectOriginPx: { x: originX, y: originY },
    defaultFacing: opts.defaultFacing === "right" ? "right" : "left",
    actions: opts.clips.map((clip) => {
      const actionId = toContractId(clip.actionId);
      const durations = frameDurationsMs(clip.frames.length, clip.fps);
      let startTimeMs = 0;
      const actionLabel = `动作 ${actionId}`;
      if (clip.frameAnchors && clip.frameAnchors.length > clip.frames.length) {
        throw new RangeError(`${actionLabel} 的逐帧挂点数量超过帧数`);
      }
      const frames = clip.frames.map((bytes, i) => {
        const durationMs = durations[i]!;
        const relativePath = monsterExtractZipEntryPath({ actionId, frameIndex: i + 1 });
        const anchors = checkedAnchors(clip.frameAnchors?.[i] ?? clip.anchors, { width, height }, `${actionLabel} 第 ${i + 1} 帧`);
        const frame = {
          relativePath,
          startTimeMs,
          durationMs,
          sha256: sha256Hex(bytes),
          anchors,
        };
        startTimeMs += durationMs;
        return frame;
      });
      return {
        actionId,
        displayName: clip.actionTitle.trim().slice(0, 120) || actionId,
        loopMode: clip.loopMode ?? loopModeForActionId(clip.actionId),
        sampleRateHz: Math.max(1, Math.min(60, Math.round(clip.fps))),
        frames,
        markers: checkedMarkers(clip.markers, startTimeMs, actionLabel),
      };
    }),
  };
}
