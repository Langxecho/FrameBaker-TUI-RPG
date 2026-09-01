import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { skeletalProjectsApi } from "../apps/server/src/api/skeletalProjects";
import { db } from "../apps/server/src/db";

const projectId = `test-skeletal-v2-${crypto.randomUUID()}`;
const skeletonId = `test-skeleton-${crypto.randomUUID()}`;
const request = (body: unknown) => skeletalProjectsApi.handle(new Request(`http://localhost/api/projects/${projectId}/skeletal-document`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
}));

describe("骨骼项目文档 v2 校验", () => {
  beforeAll(() => {
    db.query("INSERT INTO projects (id, name, kind, created_at) VALUES (?, ?, 'skeletal', ?)").run(projectId, "v2 test", Date.now());
    db.query("INSERT INTO animation_assets (id, kind, name, skeleton_id, data, created_at, updated_at) VALUES (?, 'skeleton', ?, NULL, ?, ?, ?)").run(skeletonId, "test skeleton", JSON.stringify({ schemaVersion: 1, kind: "skeleton", id: skeletonId, name: "Test", coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "pixel" }, bones: [{ id: "root", name: "Root", parentId: null, rest: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }] }), Date.now(), Date.now());
  });
  afterAll(() => {
    db.query("DELETE FROM skeletal_projects WHERE project_id = ?").run(projectId);
    db.query("DELETE FROM animation_assets WHERE id = ?").run(skeletonId);
    db.query("DELETE FROM projects WHERE id = ?").run(projectId);
  });

  test("rejects equipment references that are not in the document body profile", async () => {
    const response = await request({ schemaVersion: 2, projectId, character: null, animations: [], activeAnimationId: null, bodyProfiles: [], equipment: [{ schemaVersion: 1, id: "sword", name: "Sword", tags: [], visualMode: "none", primarySlot: "hand", occupiedSlots: ["hand"], conflictTags: [], replacesParts: [], hidesSlots: [], attachments: [] }], loadouts: [], actionTemplates: [], stanceProfiles: [], runtimePackageSettings: {} });
    expect(response.status).toBe(400);
  });

  test("registers a stub stance profile when a weapon references one that does not exist yet", async () => {
    const body = { schemaVersion: 1, id: "body-stance", name: "Body", skeletonId, mirrorAxis: "x", slots: [{ id: "hand", semantic: "hand_left", capacity: 1, accepts: ["weapon"] }], sockets: [{ id: "hand-socket", semantic: "weapon_hand_left", boneId: "root", rest: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, accepts: ["weapon"] }] };
    const response = await request({
      schemaVersion: 2,
      projectId,
      character: null,
      animations: [],
      activeAnimationId: null,
      bodyProfiles: [body],
      equipment: [{
        schemaVersion: 1,
        id: "pistol",
        name: "Pistol",
        tags: ["weapon"],
        visualMode: "none",
        primarySlot: "hand",
        occupiedSlots: ["hand"],
        conflictTags: [],
        replacesParts: [],
        hidesSlots: [],
        attachments: [],
        weapon: {
          holdMode: "one_hand",
          preferredPrimaryHand: "right",
          mirrorAllowed: true,
          primaryGrip: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          stanceProfile: "pistol_one_hand",
        },
      }],
      loadouts: [],
      actionTemplates: [],
      stanceProfiles: [],
      runtimePackageSettings: {},
    });
    expect(response.status).toBe(200);
    const payload = await response.json() as { document: { stanceProfiles: Array<{ id: string }> } };
    expect(payload.document.stanceProfiles.map((item) => item.id)).toContain("pistol_one_hand");
  });

  test("keeps missing material validation behavior for equipment attachments", async () => {
    const body = { schemaVersion: 1, id: "body", name: "Body", skeletonId, mirrorAxis: "x", slots: [{ id: "hand", semantic: "hand_left", capacity: 1, accepts: ["weapon"] }], sockets: [{ id: "hand-socket", semantic: "weapon_hand_left", boneId: "root", rest: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, accepts: ["weapon"] }] };
    const response = await request({ schemaVersion: 2, projectId, character: null, animations: [], activeAnimationId: null, bodyProfiles: [body], equipment: [{ schemaVersion: 1, id: "sword", name: "Sword", tags: ["weapon"], visualMode: "attached", primarySlot: "hand", occupiedSlots: ["hand"], conflictTags: [], replacesParts: [], hidesSlots: [], attachments: [{ id: "blade", name: "Blade", socket: "hand-socket", materialId: "missing", imageSlot: "raw", size: [1, 1], pivot: [0.5, 0.5], rest: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }, drawGroup: "equipment", drawOffset: 0 }] }], loadouts: [], actionTemplates: [], stanceProfiles: [], runtimePackageSettings: {} });
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("素材");
  });
});
