import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createStoreZip } from "../apps/server/src/mediaPlugins/zipArchive";
import { assembleMonsterSpriteExtractFromZip, attachMonsterExtractSidecarFiles, parseMonsterSpriteImportSpec } from "../apps/server/src/monsterSpriteImport";

const SOURCE_CONTENT_SHA256 = "1a9dcdb14337a4da3f7fce5dc7281bf65644a01ca0efb3e0f56f799a223e1ac0";
const FIXED_EXPORTED_AT = "2026-09-17T00:00:00.000Z";
const FIXED_EXPORT_ID = "a1-drone-fb02-r1-a";
const sourceRoot = process.env.A1_DRONE_SOURCE_ROOT ?? "F:/CodeProject/tui-rpg-terminal-engine/liaf-preview/fixtures/packages/A1Drone.monster";
const specPath = join(import.meta.dir, "../mission/fixtures/fb-02/a1-drone-r1-import-spec.json");

export type A1DroneFixture = { bytes: Uint8Array; files: Record<string, Uint8Array>; sha256: string };

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function sourcePngZip(root = sourceRoot): Uint8Array {
  const contentPath = join(root, "content.json");
  if (!existsSync(contentPath)) throw new Error(`A1 Drone source is missing: ${contentPath}`);
  if (sha256(readFileSync(contentPath)) !== SOURCE_CONTENT_SHA256) throw new Error("A1 Drone source content.json SHA-256 does not match FB-02");
  const files: Record<string, Uint8Array> = {};
  for (const folder of ["idle", "attack", "electric_loop", "hit_received", "death"]) {
    for (let frame = 0; frame < 107; frame++) {
      const path = join(root, "assets", folder, `${frame}.png`);
      if (!existsSync(path)) throw new Error(`A1 Drone source frame is missing: ${path}`);
      files[`${folder}/${frame}.png`] = new Uint8Array(readFileSync(path));
    }
  }
  return createStoreZip(files);
}

export async function buildA1DroneFb02Fixture(root = sourceRoot): Promise<A1DroneFixture> {
  const parsed = parseMonsterSpriteImportSpec(readFileSync(specPath, "utf8"));
  if (!parsed.ok) throw new Error(parsed.error);
  const assembled = await assembleMonsterSpriteExtractFromZip(sourcePngZip(root), parsed.spec);
  if (!assembled.ok) throw new Error(assembled.error);
  const files = attachMonsterExtractSidecarFiles(assembled, { exportId: FIXED_EXPORT_ID, toolVersion: "0.4.0", exportedAt: FIXED_EXPORTED_AT });
  const bytes = createStoreZip(files);
  return { bytes, files, sha256: sha256(bytes) };
}

if (import.meta.main) {
  const outputIndex = process.argv.findIndex((value) => value === "-Output" || value === "--output");
  const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
  if (!output) throw new Error("Usage: bun scripts/generate_a1_drone_fb02_fixture.ts -Output <archive.zip>");
  const fixture = await buildA1DroneFb02Fixture();
  const destination = resolve(output);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, fixture.bytes);
  console.log(`A1 Drone FB-02 R1-A fixture: ${destination}`);
  console.log(`sha256=${fixture.sha256}`);
}
