import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MaterialRow } from "@framebaker/shared";
import { importMaterialToProject, sortMaterialsByFrameNumber } from "../apps/server/src/api/materials";
import { db, STORAGE_ROOT, uid } from "../apps/server/src/db";

function material(name: string, createdAt: number): MaterialRow {
  return {
    id: name,
    name,
    raw_path: null,
    processed_path: null,
    status: "raw",
    source: "extract",
    folder_id: null,
    metadata: "{}",
    created_at: createdAt,
  };
}

const createdProjectIds: string[] = [];
const createdMaterialIds: string[] = [];

afterAll(() => {
  for (const id of createdMaterialIds) {
    try {
      db.query("DELETE FROM materials WHERE id = ?").run(id);
    } catch {
      /* ignore */
    }
    rmSync(join(STORAGE_ROOT, "materials", id), { recursive: true, force: true });
  }
  for (const id of createdProjectIds) {
    try {
      db.query("DELETE FROM frames WHERE project_id = ?").run(id);
      db.query("DELETE FROM projects WHERE id = ?").run(id);
    } catch {
      /* ignore */
    }
    rmSync(join(STORAGE_ROOT, "projects", id), { recursive: true, force: true });
  }
});

function createProject(): string {
  const id = uid();
  db.query("INSERT INTO projects (id, name, kind, folder_id, created_at) VALUES (?, ?, 'frame', NULL, ?)").run(
    id,
    "import-media-kind",
    Date.now(),
  );
  createdProjectIds.push(id);
  return id;
}

function insertMaterial(opts: { name: string; fileName: string; bytes: Buffer; mediaKind: "image" | "video" | "audio" }): MaterialRow {
  const id = uid();
  const dir = join(STORAGE_ROOT, "materials", id);
  mkdirSync(dir, { recursive: true });
  const rawPath = join(dir, opts.fileName);
  writeFileSync(rawPath, opts.bytes);
  db.query(
    "INSERT INTO materials (id, name, raw_path, status, source, folder_id, metadata, created_at) VALUES (?, ?, ?, 'raw', 'upload', NULL, ?, ?)",
  ).run(id, opts.name, rawPath, JSON.stringify({ mediaKind: opts.mediaKind }), Date.now());
  createdMaterialIds.push(id);
  return db.query("SELECT * FROM materials WHERE id = ?").get(id) as MaterialRow;
}

describe("素材导入顺序", () => {
  test("忽略选择顺序并按帧编号自然升序排列", () => {
    const selected = [material("run #120", 1), material("run #10", 2), material("run #2", 3), material("run #1", 4)];
    expect(sortMaterialsByFrameNumber(selected).map((item) => item.name)).toEqual([
      "run #1",
      "run #2",
      "run #10",
      "run #120",
    ]);
  });
});

describe("prepareMaterialFrame / 导入项目媒体类型", () => {
  test("视频仍给出抽帧说明；音频等非图片一律拒绝", () => {
    const projectId = createProject();
    const video = insertMaterial({
      name: "clip",
      fileName: "raw.mp4",
      bytes: Buffer.from("fake-mp4"),
      mediaKind: "video",
    });
    const audio = insertMaterial({
      name: "sfx",
      fileName: "raw.mp3",
      bytes: Buffer.from("fake-mp3"),
      mediaKind: "audio",
    });
    // 伪装成图片扩展名，但 serialized mediaKind=audio，仍应拒绝
    const audioDisguisedAsPng = insertMaterial({
      name: "sneaky-audio",
      fileName: "raw.png",
      bytes: Buffer.from("not-really-png"),
      mediaKind: "audio",
    });

    expect(() => importMaterialToProject(video, projectId)).toThrow(/是视频素材，请先抽帧再导入项目/);
    expect(() => importMaterialToProject(audio, projectId)).toThrow(/音频|非图片|不能.*导入/);
    expect(() => importMaterialToProject(audioDisguisedAsPng, projectId)).toThrow(/音频|非图片|不能.*导入/);
  });
});