import { describe, expect, test } from "bun:test";
import { registerAicTestDatabase } from "./aic-test-storage";

const { db, uid } = await import("../apps/server/src/db");
registerAicTestDatabase(db);
const { applyAicOperations, getAicDiagnostics, getAicSummary, sampleAicPose } = await import("../apps/server/src/aicCharacter");

const skeleton = (id: string) => ({
  schemaVersion: 1,
  kind: "skeleton" as const,
  id,
  name: "AIC test humanoid",
  coordinateSystem: { handedness: "right" as const, upAxis: "y" as const, forwardAxis: "+z" as const, unit: "pixel" as const },
  bones: [{ id: "root", name: "Root", parentId: null, rest: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }],
});

describe("AIC character operations", () => {
  test("supports staged skeleton/clip creation and idempotent retry", async () => {
    const projectId = uid();
    db.query("INSERT INTO projects (id, name, kind, folder_id, created_at) VALUES (?, ?, 'skeletal', NULL, ?)").run(projectId, "AIC test", Date.now());
    const skeletonId = `aic-skeleton-${uid()}`;
    const clipId = `aic-clip-${uid()}`;
    const operations = [
      { type: "create-skeleton", asset: skeleton(skeletonId) },
      { type: "create-motion-clip", asset: { schemaVersion: 1, kind: "motion-clip", id: clipId, name: "Idle", skeletonId, duration: 1, loop: true, events: [], tracks: [] } },
    ] as const;
    const first = await applyAicOperations(projectId, 0, "aic-op-1", [...operations]);
    expect(first).toMatchObject({ projectId, revision: 1 });
    const retry = await applyAicOperations(projectId, 0, "aic-op-1", [...operations]);
    expect(retry).toEqual(first);
    await applyAicOperations(projectId, 1, "aic-op-binding", [{
      type: "upsert-binding",
      binding: {
        schemaVersion: 1,
        kind: "character-binding",
        id: `aic-binding-${uid()}`,
        name: "AIC test binding",
        skeletonId,
        slots: [],
        attachments: [],
      },
    }]);
    const summary = getAicSummary(projectId, { actionId: "missing" }) as { revision: number; coordinateSystem: { unit: string } };
    expect(summary.revision).toBe(2);
    expect(summary.coordinateSystem.unit).toBe("pixel");
    db.query("DELETE FROM animation_assets WHERE id IN (?, ?)").run(skeletonId, clipId);
    db.query("DELETE FROM skeletal_projects WHERE project_id = ?").run(projectId);
    db.query("DELETE FROM projects WHERE id = ?").run(projectId);
  });

  test("rejects stale revision and preserves the prior revision", async () => {
    const projectId = uid();
    db.query("INSERT INTO projects (id, name, kind, folder_id, created_at) VALUES (?, ?, 'skeletal', NULL, ?)").run(projectId, "AIC test", Date.now());
    const skeletonId = `aic-skeleton-${uid()}`;
    await applyAicOperations(projectId, 0, "aic-op-2", [{ type: "create-skeleton", asset: skeleton(skeletonId) }]);
    await expect(applyAicOperations(projectId, 0, "aic-op-3", [{ type: "create-skeleton", asset: skeleton(`aic-other-${uid()}`) }])).rejects.toThrow("revision");
    expect(getAicDiagnostics(projectId).revision).toBe(1);
    db.query("DELETE FROM animation_assets WHERE id = ?").run(skeletonId);
    db.query("DELETE FROM skeletal_projects WHERE project_id = ?").run(projectId);
    db.query("DELETE FROM projects WHERE id = ?").run(projectId);
  });

  test("samples rest channels and motion FK with bounded selections", async () => {
    const projectId = uid();
    db.query("INSERT INTO projects (id, name, kind, folder_id, created_at) VALUES (?, ?, 'skeletal', NULL, ?)").run(projectId, "AIC pose sample", Date.now());
    const skeletonId = `aic-pose-skeleton-${uid()}`;
    const clipId = `aic-pose-clip-${uid()}`;
    const skeletonAsset = {
      schemaVersion: 1,
      kind: "skeleton" as const,
      id: skeletonId,
      name: "Pose sample",
      coordinateSystem: { handedness: "right" as const, upAxis: "y" as const, forwardAxis: "+z" as const, unit: "pixel" as const },
      bones: [
        { id: "root", name: "Root", parentId: null, rest: { translation: [0, 1, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
        { id: "arm", name: "Arm", parentId: "root", rest: { translation: [0, 2, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
        { id: "hand", name: "Hand", parentId: "arm", rest: { translation: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } },
      ],
    };
    await applyAicOperations(projectId, 0, "pose-create", [
      { type: "create-skeleton", asset: skeletonAsset },
      { type: "create-motion-clip", asset: { schemaVersion: 1, kind: "motion-clip", id: clipId, name: "Pose", skeletonId, duration: 1, loop: true, events: [], tracks: [{ targetId: "arm", property: "translation", interpolation: "linear", keyframes: [{ time: 0, value: [0, 2, 0] }, { time: 1, value: [4, 2, 0] }] }] } },
      { type: "upsert-binding", binding: { schemaVersion: 1, kind: "character-binding", id: `aic-pose-binding-${uid()}`, name: "Pose binding", skeletonId, slots: [], attachments: [] } },
      { type: "upsert-action", action: { id: "pose", name: "Pose", motionClipId: clipId, speed: 0.25, repeat: 2, loop: false } },
    ]);
    const pose = sampleAicPose(projectId, { actionId: "pose", timeSeconds: 2, boneIds: ["arm"] }) as any;
    expect(pose.coordinateSystem.unit).toBe("pixel");
    expect(pose.timeSeconds).toBe(0.5);
    expect(pose.scaledActionTimeSeconds).toBe(0.5);
    expect(pose.clipTimeSeconds).toBe(0.5);
    expect(pose.action).toMatchObject({ resolvedBy: "id", speed: 0.25, repeat: 2, loop: false });
    expect(pose.clip).toMatchObject({ id: clipId, loop: true });
    expect(pose.bones).toHaveLength(1);
    expect(pose.bones[0].local.translation).toEqual([2, 2, 0]);
    expect(pose.bones[0].worldMatrix[12]).toBe(2);
    const ended = sampleAicPose(projectId, { actionId: "pose", timeSeconds: 8, boneIds: ["arm"] }) as any;
    expect(ended.playback.ended).toBe(true);
    expect(ended.clipTimeSeconds).toBe(1);
    expect(ended.bones[0].local.translation).toEqual([4, 2, 0]);
    const page = getAicSummary(projectId, { boneOffset: 1, boneLimit: 1 }) as any;
    expect(page.skeleton).toMatchObject({ boneCount: 3, boneOffset: 1, boneLimit: 1, bonesTruncated: true });
    expect(page.skeleton.bones.map((bone: { id: string }) => bone.id)).toEqual(["arm"]);
    expect(page.actions[0]).toMatchObject({ speed: 0.25, repeat: 2, loop: false, clipLoop: true });
    await applyAicOperations(projectId, 1, "pose-ambiguous-action", [{ type: "upsert-action", action: { id: "pose-alt", name: "Pose", motionClipId: clipId, speed: 1, repeat: 1, loop: false } }]);
    await expect(Promise.resolve().then(() => sampleAicPose(projectId, { actionId: "Pose", timeSeconds: 0, boneIds: ["arm"] }))).rejects.toThrow("动作名称不唯一");
    await expect(Promise.resolve().then(() => sampleAicPose(projectId, { actionId: "missing", timeSeconds: 0, boneIds: ["arm"] }))).rejects.toThrow("动作不存在");
    await expect(Promise.resolve().then(() => sampleAicPose(projectId, { actionId: "pose", timeSeconds: 0, boneIds: ["unknown"] }))).rejects.toThrow("骨骼不存在");
    await expect(Promise.resolve().then(() => sampleAicPose(projectId, { actionId: "pose", timeSeconds: -0.01, boneIds: ["arm"] }))).rejects.toThrow("非负有限数值");
    db.query("DELETE FROM animation_assets WHERE id IN (?, ?)").run(skeletonId, clipId);
    db.query("DELETE FROM aic_operations WHERE project_id = ?").run(projectId);
    db.query("DELETE FROM skeletal_projects WHERE project_id = ?").run(projectId);
    db.query("DELETE FROM projects WHERE id = ?").run(projectId);
  });
});
