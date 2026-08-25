/**
 * Generate canonical minimal-region fixture under tests/fixtures/fbanim-v3.
 * Writes only into tests/fixtures — never storage/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BodyProfile, CharacterBinding, MotionClip, Skeleton } from "../packages/shared/src";
import { buildMinimalRegionFixtureEntries } from "../apps/web/src/skeletalExport";

const transform = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

const skeleton: Skeleton = {
  schemaVersion: 1,
  kind: "skeleton",
  id: "minimal-skeleton",
  name: "Minimal",
  coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "pixel" },
  bones: [{ id: "root", name: "Root", parentId: null, rest: transform }],
};

const binding: CharacterBinding = {
  schemaVersion: 1,
  kind: "character-binding",
  id: "minimal-binding",
  name: "Minimal",
  skeletonId: skeleton.id,
  attachments: [{
    id: "body-region",
    name: "Body",
    type: "region",
    materialId: "mat-body",
    imageSlot: "raw",
    size: [16, 16],
    pivot: [0.5, 0.5],
    rest: transform,
  }],
  slots: [{ id: "body-slot", name: "Body", boneId: "root", attachmentId: "body-region", drawOrder: 0 }],
};

const body: BodyProfile = {
  schemaVersion: 1,
  id: "body",
  name: "Body",
  skeletonId: skeleton.id,
  mirrorAxis: "x",
  slots: [{ id: "head", semantic: "head", capacity: 1, accepts: ["helmet"] }],
  sockets: [{ id: "head-socket", semantic: "head", boneId: "root", rest: transform, accepts: ["helmet"] }],
};

const clip: MotionClip = {
  schemaVersion: 1,
  kind: "motion-clip",
  id: "idle",
  name: "Idle",
  skeletonId: skeleton.id,
  duration: 1,
  loop: true,
  tracks: [],
  events: [],
};

const outDir = join(import.meta.dir, "..", "tests", "fixtures", "fbanim-v3", "minimal-region");
mkdirSync(outDir, { recursive: true });

const entries = await buildMinimalRegionFixtureEntries({
  skeleton,
  binding,
  body,
  clip,
  textureBytes: png,
});

for (const entry of entries) {
  writeFileSync(join(outDir, entry.name), entry.data);
  console.log("wrote", entry.name, entry.data.length);
}
console.log("OK", outDir);
