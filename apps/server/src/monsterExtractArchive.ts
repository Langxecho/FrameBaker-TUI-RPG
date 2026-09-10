import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { monsterActionById } from "@framebaker/shared";
import { db, STORAGE_ROOT, uid } from "./db";
import { createStoreZip } from "./mediaPlugins/zipArchive";
import { buildMonsterExtractZipFiles } from "./monsterExtractZip";
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

/** 把本次流水线全部拆帧打成 zip，写入素材库（可下载）。 */
export function packMonsterExtractArchive(run: MonsterPipelineRun): string | null {
  const clips: Array<{ actionTitle: string; fps: number; frames: Uint8Array[] }> = [];
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
    clips.push({ actionTitle, fps, frames });
  }
  if (!clips.length) return null;
  const files = buildMonsterExtractZipFiles(run.name, clips);
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
  });
  db.query(
    "INSERT INTO materials (id, name, raw_path, status, source, folder_id, metadata, created_at) VALUES (?, ?, ?, 'raw', ?, ?, ?, ?)",
  ).run(id, `${run.name} 拆帧包`, rawPath, "extract", run.folderId, metadata, Date.now());
  broadcast("materials_changed", {});
  return id;
}
