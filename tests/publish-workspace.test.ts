import { describe, expect, test } from "bun:test";
import {
  buildFbanimV2Entries,
  buildFbanimV3Entries,
  migrateV2PackageSource,
  verifyFbanimV3Entries,
  type BodyProfile,
  type CharacterBinding,
  type EquipmentDefinition,
  type MotionClip,
  type SkeletalProjectDocument,
  type Skeleton,
} from "../packages/shared/src";
import {
  PUBLISH_STAGE_ORDER,
  collectPublishDiagnostics,
  diagnosticsByStage,
} from "../apps/web/src/publishDiagnostics";
import {
  buildMinimalRegionFixtureEntries,
  exportFbanimV3Blob,
  exportFixtureZipEntries,
} from "../apps/web/src/skeletalExport";

const transform = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

const skeleton: Skeleton = {
  schemaVersion: 1,
  kind: "skeleton",
  id: "runtime-skeleton",
  name: "Runtime Skeleton",
  coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "pixel" },
  bones: [
    { id: "root", name: "Root", parentId: null, rest: transform, tipOffset: [0, 10, 0] },
    { id: "upper", name: "Upper", parentId: "root", rest: { ...transform, translation: [0, 10, 0] }, tipOffset: [0, 20, 0] },
    { id: "lower", name: "Lower", parentId: "upper", rest: { ...transform, translation: [0, 20, 0] }, tipOffset: [0, 20, 0] },
    { id: "end", name: "End", parentId: "lower", rest: { ...transform, translation: [0, 20, 0] }, tipOffset: [0, 1, 0] },
  ],
};

const binding: CharacterBinding = {
  schemaVersion: 1,
  kind: "character-binding",
  id: "runtime-binding",
  name: "Runtime Binding",
  skeletonId: skeleton.id,
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
  slots: [
    { id: "head", semantic: "head", capacity: 1, accepts: ["helmet"] },
    { id: "hand-r", semantic: "hand_right", capacity: 1, accepts: ["weapon"] },
    { id: "hand-l", semantic: "hand_left", capacity: 1, accepts: ["weapon"] },
  ],
  sockets: [
    { id: "head-socket", semantic: "head", boneId: "root", rest: transform, accepts: ["helmet"] },
    { id: "sock-r", semantic: "weapon_hand_right", boneId: "end", rest: transform, accepts: ["weapon"], mirrorSocketId: "sock-l" },
    { id: "sock-l", semantic: "weapon_hand_left", boneId: "end", rest: transform, accepts: ["weapon"], mirrorSocketId: "sock-r" },
    { id: "sock-muzzle", semantic: "custom:muzzle", boneId: "end", rest: transform, accepts: ["effect"] },
  ],
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

function document(overrides: Partial<SkeletalProjectDocument> = {}): SkeletalProjectDocument {
  return {
    schemaVersion: 2,
    projectId: "proj-1",
    character: { binding },
    animations: [{ id: "idle", name: "idle", motionClipId: clip.id, speed: 1, repeat: 1, loop: true }],
    activeAnimationId: "idle",
    bodyProfiles: [body],
    equipment: [helmet],
    loadouts: [{ bodyProfileId: body.id, equipment: [{ equipmentId: helmet.id, primarySlot: "head" }] }],
    actionTemplates: [{
      id: "idle",
      loop: true,
      requiredTracks: [],
      requiredEvents: [],
      allowedEvents: [],
      contactRules: [],
      constraintRules: [],
      defaultInterrupt: "immediate",
      defaultBlendMs: 80,
    }],
    stanceProfiles: [],
    runtimePackageSettings: {},
    ...overrides,
  };
}

function baseInput(overrides: Partial<Parameters<typeof collectPublishDiagnostics>[0]> = {}) {
  return {
    document: document(),
    skeleton,
    clips: { [clip.id]: clip },
    textures: [
      { attachmentId: "body-region", bytes: png },
      { attachmentId: "helmet-part", bytes: png },
    ],
    ...overrides,
  };
}

describe("publish workspace diagnostics", () => {
  test("ten-stage order is stable and diagnostics follow it", async () => {
    expect([...PUBLISH_STAGE_ORDER]).toEqual([
      "schema",
      "referenceClosure",
      "loadoutConflict",
      "actionTemplate",
      "fullDurationIk",
      "socketEvent",
      "mirror",
      "runtimeCapability",
      "packageConstruction",
      "fbanimExport",
    ]);
    const report = await collectPublishDiagnostics(baseInput({
      requirementsOverride: { runtimeWarp: 1 },
      document: document({
        loadouts: [{
          bodyProfileId: body.id,
          equipment: [
            { equipmentId: helmet.id, primarySlot: "head" },
            { equipmentId: helmet.id, primarySlot: "head" },
          ],
        }],
      }),
    }));
    const stages = report.diagnostics.map((d) => d.stage);
    let last = -1;
    for (const stage of stages) {
      const idx = PUBLISH_STAGE_ORDER.indexOf(stage);
      expect(idx).toBeGreaterThanOrEqual(last);
      last = idx;
    }
    const byStage = diagnosticsByStage(report.diagnostics);
    expect(byStage.runtimeCapability.some((d) => d.code === "CAPABILITY_REJECTED")).toBeTrue();
    expect(byStage.loadoutConflict.length).toBeGreaterThan(0);
    expect(report.canExport).toBeFalse();
  });

  test("errors block export; warnings alone require confirmation", async () => {
    const ok = await collectPublishDiagnostics(baseInput());
    expect(ok.errors).toEqual([]);
    expect(ok.canExport).toBeTrue();
    expect(ok.requiresConfirm).toBeFalse();
    expect(ok.entries?.[0]?.path).toBe("manifest.json");

    const warnDoc = document({
      actionTemplates: [{
        id: "idle",
        loop: true,
        requiredTracks: [],
        requiredEvents: [],
        allowedEvents: [],
        contactRules: [],
        constraintRules: [],
        fallbackAction: "missing-fallback",
        defaultInterrupt: "immediate",
        defaultBlendMs: 80,
      }],
    });
    const warn = await collectPublishDiagnostics(baseInput({ document: warnDoc }));
    expect(warn.errors).toEqual([]);
    expect(warn.warnings.some((d) => d.code === "ACTION_FALLBACK_MISSING")).toBeTrue();
    expect(warn.canExport).toBeTrue();
    expect(warn.requiresConfirm).toBeTrue();

    const bad = await collectPublishDiagnostics(baseInput({
      textures: [{ attachmentId: "body-region", bytes: png }],
    }));
    expect(bad.errors.some((d) => d.code === "REF_MISSING_TEXTURE")).toBeTrue();
    expect(bad.canExport).toBeFalse();
    expect(bad.entries).toBeNull();
  });

  test("reference closure and capability rejection use stable codes/paths", async () => {
    const report = await collectPublishDiagnostics(baseInput({
      document: document({ animations: [{ id: "idle", name: "idle", motionClipId: "missing", speed: 1, repeat: 1, loop: true }] }),
      clips: {},
      requirementsOverride: { meshSkinning: 2 },
    }));
    const missing = report.diagnostics.find((d) => d.code === "REF_MISSING_CLIP");
    expect(missing?.path).toBe("animations.idle.motionClipId");
    expect(missing?.stage).toBe("referenceClosure");
    const cap = report.diagnostics.find((d) => d.code === "CAPABILITY_REJECTED" && d.path === "requirements.meshSkinning");
    expect(cap?.severity).toBe("error");
  });

  test("full-duration IK sampling blocks unreachable two-hand constraints", async () => {
    const rifle: EquipmentDefinition = {
      ...helmet,
      id: "rifle",
      name: "Rifle",
      tags: ["weapon"],
      primarySlot: "hand-r",
      occupiedSlots: ["hand-r", "hand-l"],
      attachments: [],
      weapon: {
        holdMode: "two_hand",
        preferredPrimaryHand: "right",
        mirrorAllowed: true,
        primaryGrip: transform,
        secondaryGrip: transform,
        stanceProfile: "rifle_two_hand",
        secondaryHandConstraint: {
          id: "ik-rifle",
          upperBoneId: "upper",
          lowerBoneId: "lower",
          endBoneId: "end",
          targetSocket: "sock-l",
          bendDirection: "positive",
          mix: 1,
          stretch: "forbid",
        },
      },
    };
    // Stretch tip so rest distance exceeds chain — tipOffsets total 40; push end far via rest translation on a clip keyframe
    const farClip: MotionClip = {
      ...clip,
      id: "far",
      tracks: [{
        targetId: "end",
        property: "translation",
        interpolation: "step",
        keyframes: [{ time: 0, value: [0, 200, 0] }],
      }],
    } as MotionClip;
    const report = await collectPublishDiagnostics(baseInput({
      document: document({
        equipment: [rifle],
        loadouts: [],
        animations: [{ id: "aim", name: "aim", motionClipId: farClip.id, speed: 1, repeat: 1, loop: false }],
      }),
      clips: { [farClip.id]: farClip },
      textures: [{ attachmentId: "body-region", bytes: png }],
    }));
    expect(report.diagnostics.some((d) => d.stage === "fullDurationIk" && d.code === "IK_UNREACHABLE")).toBeTrue();
    expect(report.canExport).toBeFalse();
  });

  test("deterministic v3 bytes and fixture zip entries without storage writes", async () => {
    const a = await collectPublishDiagnostics(baseInput());
    const b = await collectPublishDiagnostics(baseInput());
    expect(a.entries!.map((e) => [e.path, [...e.bytes]])).toEqual(b.entries!.map((e) => [e.path, [...e.bytes]]));
    const blob = await exportFbanimV3Blob(a.entries!);
    expect(blob.type).toContain("zip");
    expect(blob.size).toBeGreaterThan(32);

    const fixture = await exportFixtureZipEntries({
      fixtureId: "minimal-region",
      packageEntries: a.entries!,
      loadout: { bodyProfileId: body.id, equipment: [{ equipmentId: helmet.id, primarySlot: "head" }] },
      actionSteps: [{ actionId: "idle", time: 0 }, { actionId: "idle", time: 0.5 }],
      expected: { matrices: [], events: [], slots: [] },
      metadata: { schemaVersion: 1, generatedBy: "publish-workspace-test" },
    });
    expect(fixture.map((e) => e.name).sort()).toEqual([
      "action-steps.json",
      "expected.json",
      "loadout.json",
      "metadata.json",
      "package.fbanim",
    ]);
    expect(fixture.every((e) => !e.name.includes("storage"))).toBeTrue();

    const minimal = await buildMinimalRegionFixtureEntries({
      skeleton,
      binding,
      body,
      clip,
      textureBytes: png,
    });
    expect(minimal.map((e) => e.name).sort()).toEqual([
      "action-steps.json",
      "expected.json",
      "loadout.json",
      "metadata.json",
      "package.fbanim",
    ]);
    const { readZip } = await import("../apps/web/src/zip");
    const packageEntries = await readZip(new Blob([minimal.find((e) => e.name === "package.fbanim")!.data]));
    const verified = await verifyFbanimV3Entries(packageEntries.map((e) => ({ path: e.name, bytes: e.data })));
    expect(verified.ok).toBeTrue();
  });

  test("canonical minimal-region fixture exists under tests/fixtures/fbanim-v3", async () => {
    const root = new URL("./fixtures/fbanim-v3/minimal-region/", import.meta.url);
    const names = ["package.fbanim", "loadout.json", "action-steps.json", "expected.json", "metadata.json"];
    for (const name of names) {
      const file = Bun.file(new URL(name, root));
      expect(await file.exists()).toBeTrue();
      expect(file.size).toBeGreaterThan(0);
    }
    const meta = await Bun.file(new URL("metadata.json", root)).json() as { fixtureId?: string };
    expect(meta.fixtureId).toBe("minimal-region");
  });

  test("v2 import migrates to v3 export without dynamics", async () => {
    const v2 = await buildFbanimV2Entries({
      createdBy: { name: "FrameBaker", version: "test" },
      skeleton,
      characterBinding: binding,
      actions: [{ id: "idle", name: "Idle", motionClip: clip, speed: 1, repeat: 1, loop: true }],
      textures: [{ attachmentId: "body-region", bytes: png }],
    });
    const migrated = migrateV2PackageSource({
      createdBy: { name: "FrameBaker", version: "test" },
      skeleton,
      characterBinding: binding,
      actions: [{ id: "idle", name: "Idle", motionClip: clip, speed: 1, repeat: 1, loop: true }],
      textures: [{ attachmentId: "body-region", bytes: png }],
    });
    const v3 = await buildFbanimV3Entries(migrated);
    const verified = await verifyFbanimV3Entries(v3);
    expect(verified.ok).toBeTrue();
    if (verified.ok) {
      expect(verified.value.manifest.version).toBe(3);
      expect(verified.value.bodyProfiles).toEqual([]);
      expect(verified.value.equipment).toEqual([]);
    }
    expect(v2[0]?.path).toBe("manifest.json");
  });
});
