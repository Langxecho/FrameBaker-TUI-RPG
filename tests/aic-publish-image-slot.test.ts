import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readZip } from "../apps/web/src/zip";
import { registerAicTestDatabase } from "./aic-test-storage";

const { applyAicOperations, publishAicV3 } = await import("../apps/server/src/aicCharacter");
const { db, STORAGE_ROOT, uid } = await import("../apps/server/src/db");
registerAicTestDatabase(db);

const projectId = uid();
const materialId = uid();
const skeletonId = `aic-slot-skeleton-${uid()}`;
const bindingId = `aic-slot-binding-${uid()}`;
const isolatedRoot = join(STORAGE_ROOT, `aic-publish-image-slot-${uid()}`);
const rawPath = join(isolatedRoot, "raw.png");
const processedPath = join(isolatedRoot, "processed.png");
const artifacts: string[] = [];
const tinyPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const processedPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==", "base64");

const skeleton = {
  schemaVersion: 1,
  kind: "skeleton" as const,
  id: skeletonId,
  name: "Image-slot test skeleton",
  coordinateSystem: { handedness: "right" as const, upAxis: "y" as const, forwardAxis: "+z" as const, unit: "pixel" as const },
  bones: [{ id: "root", name: "Root", parentId: null, rest: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }],
};

function binding(imageSlot: "raw" | "processed") {
  return {
    schemaVersion: 1,
    kind: "character-binding" as const,
    id: bindingId,
    name: "Image-slot test binding",
    skeletonId,
    slots: [{ id: "slot", name: "Body", boneId: "root", attachmentId: "body", drawOrder: 0 }],
    attachments: [{ id: "body", name: "Body", type: "region" as const, materialId, imageSlot, size: [1, 1] as [number, number], pivot: [0.5, 0.5] as [number, number], rest: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }],
  };
}

async function publishedTexture(artifact: any): Promise<Buffer> {
  const bytes = readFileSync(join(STORAGE_ROOT, "aic-published", `${artifact.digest.slice("sha256:".length)}.fbanim`));
  const entries = await readZip(new Blob([bytes]));
  const manifest = JSON.parse(new TextDecoder().decode(entries.find((entry) => entry.name === "manifest.json")!.data));
  const texturePath = manifest.entry.textures[0].path;
  return Buffer.from(entries.find((entry) => entry.name === texturePath)!.data);
}

beforeAll(async () => {
  mkdirSync(isolatedRoot, { recursive: true });
  writeFileSync(rawPath, tinyPng);
  writeFileSync(processedPath, processedPng);
  db.query("INSERT INTO projects (id, name, kind, folder_id, created_at) VALUES (?, ?, 'skeletal', NULL, ?)").run(projectId, "AIC image slot test", Date.now());
  db.query("INSERT INTO materials (id, name, raw_path, processed_path, status, source, folder_id, metadata, created_at) VALUES (?, ?, ?, ?, 'matted', 'upload', NULL, '{}', ?)").run(materialId, "AIC image slot material", rawPath, processedPath, Date.now());
  await applyAicOperations(projectId, 0, "image-slot-create", [{ type: "create-skeleton", asset: skeleton }, { type: "upsert-binding", binding: binding("raw") }]);
});

afterAll(() => {
  for (const artifact of artifacts) rmSync(join(STORAGE_ROOT, "aic-published", artifact), { force: true });
  db.query("DELETE FROM animation_assets WHERE id = ?").run(skeletonId);
  db.query("DELETE FROM aic_operations WHERE project_id = ?").run(projectId);
  db.query("DELETE FROM skeletal_projects WHERE project_id = ?").run(projectId);
  db.query("DELETE FROM projects WHERE id = ?").run(projectId);
  db.query("DELETE FROM materials WHERE id = ?").run(materialId);
});

describe("AIC publish image-slot contract", () => {
  test("publishes the explicit slot and fails closed when that slot is missing", async () => {
    const rawArtifact = await publishAicV3(projectId) as any;
    artifacts.push(`${rawArtifact.digest.slice("sha256:".length)}.fbanim`);
    expect(await publishedTexture(rawArtifact)).toEqual(tinyPng);

    await applyAicOperations(projectId, 1, "image-slot-processed", [{ type: "upsert-binding", binding: binding("processed") }]);
    const processedArtifact = await publishAicV3(projectId) as any;
    artifacts.push(`${processedArtifact.digest.slice("sha256:".length)}.fbanim`);
    expect(await publishedTexture(processedArtifact)).toEqual(processedPng);

    rmSync(processedPath, { force: true });
    let error: any;
    try { await publishAicV3(projectId); } catch (caught) { error = caught; }
    expect(error?.code).toBe("PUBLISH_FAILED");
    expect(error?.message).toContain("（processed）");
  });
});
