import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { monsterActionById } from "@framebaker/shared";
import { db, STORAGE_ROOT, uid } from "./db";
import { readPngSize } from "./jobs/spriteKey";
import { createStoreZip } from "./mediaPlugins/zipArchive";
import {
  buildMonsterExtractSidecar,
  buildMonsterExtractZipFiles,
  type MonsterExtractClipInput,
} from "./monsterExtractZip";
import type { MonsterPipelineRun } from "./monsterPipelineTypes";
import { broadcast } from "./ws";

function assetPath(id: string): string | null {
  const material = db
    .query("SELECT raw_path, processed_path FROM materials WHERE id = ?")
    .get(id) as { raw_path: string | null; processed_path: string | null } | null;
  if (material) {
    const processed = material.processed_path && existsSync(material.processed_path) ? material.processed_path : null;
    const raw = material.raw_path && existsSync(material.raw_path) ? material.raw_path : null;
    return processed ?? raw;
  }
  const frame = db
    .query("SELECT raw_path, processed_path FROM frames WHERE id = ?")
    .get(id) as { raw_path: string | null; processed_path: string | null } | null;
  if (!frame) return null;
  const processed = frame.processed_path && existsSync(frame.processed_path) ? frame.processed_path : null;
  const raw = frame.raw_path && existsSync(frame.raw_path) ? frame.raw_path : null;
  return processed ?? raw;
}

function toolVersion(): string {
  try {
        const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8")) as { version?: string };
    return pkg.version?.slice(0, 64) || "0.4.0";
  } catch {
    return "0.4.0";
  }
}

/** 同一动作多 fps 时只保留最高采样，避免 sidecar 动作 ID 重复。 */
function pickClipsByAction(clips: MonsterExtractClipInput[]): MonsterExtractClipInput[] {
  const best = new Map<string, MonsterExtractClipInput>();
  for (const clip of clips) {
    const prev = best.get(clip.actionId);
    if (!prev || clip.fps > prev.fps) best.set(clip.actionId, clip);
  }
  return [...best.values()];
}

/** 把本次流水线全部拆帧打成 R1-A zip（sidecar.json + frames/），写入素材库。不是 .monster。 */
export function packMonsterExtractArchive(run: MonsterPipelineRun): string | null {
  const collected: MonsterExtractClipInput[] = [];
  const keys = Object.keys(run.extractFrameIds ?? {}).sort();
  for (const key of keys) {
    const colon = key.lastIndexOf(":");
    if (colon <= 0) continue;
    const actionId = key.slice(0, colon);
    const fps = Number(key.slice(colon + 1));
    if (!Number.isFinite(fps)) continue;
    const ids = run.extractFrameIds[key] ?? [];
    const frames: Uint8Array[] = [];
    for (const id of ids) {
      const path = assetPath(id);
      if (!path) continue;
      frames.push(new Uint8Array(readFileSync(path)));
    }
    if (!frames.length) continue;
    const actionTitle = run.actions.find((a) => a.id === actionId)?.title ?? monsterActionById(actionId)?.title ?? actionId;
    collected.push({ actionId, actionTitle, fps, frames });
  }
  const clips = pickClipsByAction(collected);
  if (!clips.length) return null;

  let canvas = { width: run.spriteFit.width, height: run.spriteFit.height };
  const firstSize = readPngSize(clips[0]!.frames[0]!);
  if (firstSize) canvas = firstSize;
  for (const clip of clips) {
    for (const frame of clip.frames) {
      const size = readPngSize(frame);
      if (!size || size.width !== canvas.width || size.height !== canvas.height) return null;
    }
  }

  const files = buildMonsterExtractZipFiles(clips);
  const sidecar = buildMonsterExtractSidecar({
    displayName: run.name,
    projectId: run.pipelineId,
    exportId: uid(),
    toolVersion: toolVersion(),
    exportedAt: new Date().toISOString(),
    canvas,
    clips,
  });
  files["sidecar.json"] = new TextEncoder().encode(`${JSON.stringify(sidecar, null, 2)}\n`);
  const bytes = createStoreZip(files);
  const id = uid();
  const dir = join(STORAGE_ROOT, "materials", id);
  mkdirSync(dir, { recursive: true });
  const rawPath = join(dir, "raw.zip");
  writeFileSync(rawPath, bytes);
  const metadata = JSON.stringify({
    mediaKind: "archive",
    pipelineId: run.pipelineId,
    monsterName: run.name,
    format: "framebaker.monster-sprite-extract",
    schemaVersion: 1,
    notAMonsterPackage: true,
  });
  db.query(
    "INSERT INTO materials (id, name, raw_path, status, source, folder_id, metadata, created_at) VALUES (?, ?, ?, 'raw', ?, ?, ?, ?)",
  ).run(id, `${run.name} 拆帧包`, rawPath, "extract", run.folderId, metadata, Date.now());
  broadcast("materials_changed", {});
  return id;
}
