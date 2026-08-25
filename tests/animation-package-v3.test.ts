import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import manifestSchema from "../packages/shared/schemas/fbanim/v3/manifest.schema.json";
import {
  buildFbanimV2Entries,
  buildFbanimV3Entries,
  canonicalizeJson,
  FBANIM_V3_VERSION,
  migrateV2PackageSource,
  sha256Digest,
  verifyFbanimV2Entries,
  verifyFbanimV3Entries,
  type BodyProfile,
  type CharacterBinding,
  type EquipmentDefinition,
  type FbanimV3PackageSource,
  type MotionClip,
  type Skeleton,
} from "../packages/shared/src";

const transform = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};
const skeleton: Skeleton = {
  schemaVersion: 1,
  kind: "skeleton",
  id: "runtime-skeleton",
  name: "Runtime Skeleton",
  coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "pixel" },
  bones: [{ id: "root", name: "Root", parentId: null, rest: transform }],
};
const binding: CharacterBinding = {
  schemaVersion: 1,
  kind: "character-binding",
  id: "runtime-binding",
  name: "Runtime Binding",
  skeletonId: skeleton.id,
  boneRotationOffsets: { root: 0.1 },
  attachments: [{
    id: "body-region",
    name: "Body",
    type: "region",
    materialId: "local-material",
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
const helmet: EquipmentDefinition = {
  schemaVersion: 1,
  id: "helmet",
  name: "Helmet",
  tags: ["helmet"],
  visualMode: "attached",
  primarySlot: "head",
  occupiedSlots: ["head"],
  conflictTags: [],
  replacesParts: [],
  hidesSlots: [],
  attachments: [{
    id: "helmet-part",
    name: "Helmet Part",
    socket: "head-socket",
    materialId: "helmet-mat",
    imageSlot: "raw",
    size: [8, 8],
    pivot: [0.5, 0.5],
    rest: transform,
    drawGroup: "equipment",
    drawOffset: 1,
  }],
};
const clip: MotionClip = {
  schemaVersion: 1,
  kind: "motion-clip",
  id: "runtime-idle",
  name: "Idle",
  skeletonId: skeleton.id,
  duration: 1,
  loop: true,
  tracks: [],
  events: [],
};
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

const source = (overrides: Partial<FbanimV3PackageSource> = {}): FbanimV3PackageSource => ({
  createdBy: { name: "FrameBaker", version: "test" },
  skeleton,
  characterBinding: binding,
  bodyProfiles: [body],
  equipment: [helmet],
  actions: [{ id: "idle", name: "Idle", motionClip: clip, speed: 1, repeat: 1, loop: true }],
  actionProfiles: [],
  constraints: [],
  textures: [
    { attachmentId: "body-region", bytes: png },
    { attachmentId: "helmet-part", bytes: png },
  ],
  ...overrides,
});

describe("fbanim v3 运行时包", () => {
  test("版本常量与构建验证闭包", async () => {
    expect(FBANIM_V3_VERSION).toBe(3);
    const entries = await buildFbanimV3Entries(source());
    expect(entries[0]?.path).toBe("manifest.json");
    expect(entries.some((entry) => entry.path.startsWith("body-profiles/"))).toBeTrue();
    expect(entries.some((entry) => entry.path.startsWith("equipment/"))).toBeTrue();
    expect(entries.some((entry) => entry.path.startsWith("motions/"))).toBeTrue();
    expect(entries.some((entry) => entry.path.startsWith("textures/"))).toBeTrue();
    const verified = await verifyFbanimV3Entries(entries);
    expect(verified.ok).toBeTrue();
    if (verified.ok) {
      expect(verified.value.actions[0]?.name).toBe("Idle");
      expect(verified.value.bodyProfiles[0]?.id).toBe("body");
      expect(verified.value.equipment[0]?.id).toBe("helmet");
      expect(verified.value.manifest.requirements.regionRendering).toBe(1);
      expect(verified.value.manifest.requirements.equipmentAssembly).toBe(1);
      expect(verified.value.manifest.requirements.runtimeWarp).toBeUndefined();
      expect(verified.value.manifest.requirements.meshSkinning).toBeUndefined();
    }
    const validateSchema = new Ajv2020({ strict: true, validateSchema: false }).compile(manifestSchema);
    expect(validateSchema(JSON.parse(new TextDecoder().decode(entries[0]!.bytes)))).toBeTrue();
  });

  test("相同输入生成完全确定的条目与摘要", async () => {
    const a = await buildFbanimV3Entries(source());
    const b = await buildFbanimV3Entries(source({
      equipment: [helmet],
      bodyProfiles: [body],
      textures: [
        { attachmentId: "helmet-part", bytes: png },
        { attachmentId: "body-region", bytes: png },
      ],
      actions: [{ id: "idle", name: "Idle", motionClip: clip, speed: 1, repeat: 1, loop: true }],
    }));
    expect(a.map((entry) => [entry.path, [...entry.bytes]])).toEqual(b.map((entry) => [entry.path, [...entry.bytes]]));
  });

  test("capability floors 仅列出所需最低版本，省略未使用能力", async () => {
    const minimal = await buildFbanimV3Entries(source({
      bodyProfiles: [],
      equipment: [],
      textures: [{ attachmentId: "body-region", bytes: png }],
      requirements: undefined,
    }));
    const manifest = JSON.parse(new TextDecoder().decode(minimal[0]!.bytes));
    expect(manifest.requirements).toEqual({ regionRendering: 1 });
    expect(manifest.requirements.motionEvents).toBeUndefined();
    expect(manifest.requirements.twoBoneIk).toBeUndefined();
    expect(manifest.requirements.equipmentAssembly).toBeUndefined();

    const withEvents = await buildFbanimV3Entries(source({
      bodyProfiles: [],
      equipment: [],
      textures: [{ attachmentId: "body-region", bytes: png }],
      actions: [{
        id: "idle",
        name: "Idle",
        motionClip: { ...clip, events: [{ time: 0.5, type: "footstep", name: "footstep", payload: {} }] },
        speed: 1,
        repeat: 1,
        loop: true,
      }],
    }));
    const eventManifest = JSON.parse(new TextDecoder().decode(withEvents[0]!.bytes));
    expect(eventManifest.requirements.motionEvents).toBe(1);
  });

  test("拒绝 runtimeWarp/meshSkinning 需求与含 warp 的源", async () => {
    await expect(buildFbanimV3Entries(source({
      requirements: { regionRendering: 1, runtimeWarp: 1 },
      bodyProfiles: [],
      equipment: [],
      textures: [{ attachmentId: "body-region", bytes: png }],
    }))).rejects.toThrow();
    await expect(buildFbanimV3Entries(source({
      requirements: { regionRendering: 1, meshSkinning: 1 },
      bodyProfiles: [],
      equipment: [],
      textures: [{ attachmentId: "body-region", bytes: png }],
    }))).rejects.toThrow();

    const warpedBinding: CharacterBinding = {
      ...binding,
      attachments: [{
        ...binding.attachments[0]!,
        warp: { grid: [3, 3], points: new Array<number>(18).fill(0) },
      }],
    };
    await expect(buildFbanimV3Entries(source({
      characterBinding: warpedBinding,
      bodyProfiles: [],
      equipment: [],
      textures: [{ attachmentId: "body-region", bytes: png }],
    }))).rejects.toThrow();
  });

  test("拒绝篡改摘要、路径穿越、多余/缺失条目、非法 PNG 与无效引用", async () => {
    const entries = await buildFbanimV3Entries(source());
    const altered = entries.map((entry) => ({ path: entry.path, bytes: entry.bytes.slice() }));
    altered[1]!.bytes[0] ^= 1;
    expect((await verifyFbanimV3Entries(altered)).ok).toBeFalse();
    expect((await verifyFbanimV3Entries([...entries, { path: "../escape.png", bytes: png }])).ok).toBeFalse();
    expect((await verifyFbanimV3Entries([...entries, { path: "textures/deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef.png", bytes: png }])).ok).toBeFalse();
    expect((await verifyFbanimV3Entries(entries.filter((entry) => !entry.path.startsWith("textures/")))).ok).toBeFalse();
    await expect(buildFbanimV3Entries(source({ textures: [{ attachmentId: "body-region", bytes: png }] }))).rejects.toThrow();
    await expect(buildFbanimV3Entries(source({
      textures: [
        { attachmentId: "body-region", bytes: png },
        { attachmentId: "helmet-part", bytes: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]) },
      ],
    }))).rejects.toThrow();
    await expect(buildFbanimV3Entries(source({
      equipment: [{ ...helmet, id: "bad", attachments: [{ ...helmet.attachments[0]!, socket: "missing" }] }],
      textures: [
        { attachmentId: "body-region", bytes: png },
        { attachmentId: "helmet-part", bytes: png },
      ],
    }))).rejects.toThrow();
    expect((await verifyFbanimV3Entries(entries, { maxTotalBytes: 32 })).ok).toBeFalse();
  });

  test("拒绝改名的内容寻址路径和非规范资产 JSON", async () => {
    const entries = await buildFbanimV3Entries(source());
    const manifest = JSON.parse(new TextDecoder().decode(entries[0]!.bytes));
    const skeletonEntry = entries.find((entry) => entry.path === manifest.entry.skeleton.path)!;
    const renamed = `skeletons/${"0".repeat(64)}.json`;
    manifest.entry.skeleton.path = renamed;
    const renamedEntries = entries.map((entry) =>
      entry === skeletonEntry
        ? { ...entry, path: renamed }
        : entry.path === "manifest.json"
          ? { ...entry, bytes: canonicalizeJson(manifest) }
          : entry
    );
    expect((await verifyFbanimV3Entries(renamedEntries)).ok).toBeFalse();

    const pretty = new TextEncoder().encode(JSON.stringify(skeleton, null, 2));
    const digest = await sha256Digest(pretty);
    const path = `skeletons/${digest.slice(7)}.json`;
    manifest.entry.skeleton = { ...manifest.entry.skeleton, path, digest, byteLength: pretty.length };
    const prettyEntries = entries
      .filter((entry) => entry !== skeletonEntry)
      .map((entry) => entry.path === "manifest.json" ? { ...entry, bytes: canonicalizeJson(manifest) } : entry)
      .concat({ path, bytes: pretty });
    expect((await verifyFbanimV3Entries(prettyEntries)).ok).toBeFalse();
  });

  test("v2 包仍可读写；无动态特性时可迁移为 v3 最小表示", async () => {
    const v2Source = {
      createdBy: { name: "FrameBaker", version: "test" },
      skeleton,
      characterBinding: binding,
      actions: [{ id: "idle", name: "Idle", motionClip: clip, speed: 1, repeat: 1, loop: true }],
      textures: [{ attachmentId: "body-region", bytes: png }],
    };
    const v2Entries = await buildFbanimV2Entries(v2Source);
    const v2Verified = await verifyFbanimV2Entries(v2Entries);
    expect(v2Verified.ok).toBeTrue();

    const migrated = migrateV2PackageSource(v2Source);
    expect(migrated.bodyProfiles).toEqual([]);
    expect(migrated.equipment).toEqual([]);
    const v3Entries = await buildFbanimV3Entries(migrated);
    const v3Verified = await verifyFbanimV3Entries(v3Entries);
    expect(v3Verified.ok).toBeTrue();
    if (v3Verified.ok) {
      expect(v3Verified.value.manifest.version).toBe(3);
      expect(v3Verified.value.actions[0]?.motionClip).toEqual(clip);
      expect(v3Verified.value.manifest.requirements).toEqual({ regionRendering: 1 });
    }

    const warped = {
      ...v2Source,
      characterBinding: {
        ...binding,
        attachments: [{ ...binding.attachments[0]!, warp: { grid: [2, 2], points: new Array<number>(8).fill(0) } }],
      },
    };
    expect(() => migrateV2PackageSource(warped)).toThrow();
  });
});
