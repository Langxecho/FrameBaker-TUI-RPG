import { describe, expect, test } from "bun:test";
import { registerAicTestDatabase } from "./aic-test-storage";

const { db, uid } = await import("../apps/server/src/db");
registerAicTestDatabase(db);
const { applyAicOperations } = await import("../apps/server/src/aicCharacter");

const skeleton = (id: string) => ({
  schemaVersion: 1 as const,
  kind: "skeleton" as const,
  id,
  name: "Atomic AIC test skeleton",
  coordinateSystem: { handedness: "right" as const, upAxis: "y" as const, forwardAxis: "+z" as const, unit: "pixel" as const },
  bones: [{ id: "root", name: "Root", parentId: null, rest: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }],
});

function snapshot(projectId: string, clipId: string, key: string) {
  return {
    project: db.query("SELECT document, revision FROM skeletal_projects WHERE project_id = ?").get(projectId),
    clip: db.query("SELECT id, data FROM animation_assets WHERE id = ?").get(clipId),
    operation: db.query("SELECT project_id, idempotency_key, input_hash, result FROM aic_operations WHERE project_id = ? AND idempotency_key = ?").get(projectId, key),
  };
}

describe("AIC operation transaction atomicity", () => {
  test("rolls back valid earlier keyframes for bad references, values, and mesh capability", async () => {
    const projectId = uid();
    const skeletonId = `atomic-skeleton-${uid()}`;
    const clipId = `atomic-clip-${uid()}`;
    db.query("INSERT INTO projects (id, name, kind, folder_id, created_at) VALUES (?, ?, 'skeletal', NULL, ?)").run(projectId, "AIC atomicity test", Date.now());
    await applyAicOperations(projectId, 0, "atomic-create", [
      { type: "create-skeleton", asset: skeleton(skeletonId) },
      { type: "create-motion-clip", asset: { schemaVersion: 1, kind: "motion-clip", id: clipId, name: "Atomic clip", skeletonId, duration: 1, loop: false, events: [], tracks: [] } },
      { type: "upsert-binding", binding: { schemaVersion: 1, kind: "character-binding", id: `atomic-binding-${uid()}`, name: "Atomic binding", skeletonId, slots: [], attachments: [] } },
    ]);

    const valid = { type: "upsert-keyframe" as const, clipId, targetId: "root", property: "translation" as const, time: 0.25, value: [2, 3, 0] };
    const invalidBatches: Array<{ key: string; operation: any; message: RegExp }> = [
      { key: "atomic-bad-reference", operation: { ...valid, targetId: "missing-bone" }, message: /动作|MotionClip|无效|骨骼|target/i },
      { key: "atomic-bad-time", operation: { ...valid, time: -0.01 }, message: /关键帧时间|time|范围/i },
      { key: "atomic-bad-mesh", operation: { type: "set-runtime-capabilities", requiredCapabilities: { meshSkinning: 1 } }, message: /操作后项目未通过结构校验/i },
    ];

    for (const item of invalidBatches) {
      const before = snapshot(projectId, clipId, item.key);
      await expect(applyAicOperations(projectId, 1, item.key, [valid, item.operation])).rejects.toThrow(item.message);
      expect(snapshot(projectId, clipId, item.key)).toEqual(before);
    }

    const retryKey = "atomic-bad-reference";
    const corrected = { ...valid, targetId: "root", time: 0.5, value: [4, 5, 0] };
    const result = await applyAicOperations(projectId, 1, retryKey, [valid, corrected]);
    expect(result).toMatchObject({ projectId, revision: 2 });
    const stored = db.query("SELECT data FROM animation_assets WHERE id = ?").get(clipId) as { data: string };
    expect(JSON.parse(stored.data).tracks[0].keyframes).toHaveLength(2);
    expect(db.query("SELECT idempotency_key FROM aic_operations WHERE project_id = ? AND idempotency_key = ?").get(projectId, retryKey)).toBeTruthy();
    expect(await applyAicOperations(projectId, 1, retryKey, [valid, corrected])).toEqual(result);

    db.query("DELETE FROM aic_operations WHERE project_id = ?").run(projectId);
    db.query("DELETE FROM animation_assets WHERE id IN (?, ?)").run(skeletonId, clipId);
    db.query("DELETE FROM skeletal_projects WHERE project_id = ?").run(projectId);
    db.query("DELETE FROM projects WHERE id = ?").run(projectId);
  });
});
