import { describe, expect, test } from "bun:test";
import type { BodyProfile, CharacterLoadout, EquipmentDefinition, MotionClip } from "../packages/shared/src";
import {
  ACTION_TEMPLATE_KINDS,
  STANDARD_ACTION_EVENTS,
  canEditOwnedLayer,
  createActionFromTemplate,
  createActionUiState,
  evaluateCompatibilityMatrix,
  insertSemanticEvent,
  isActionDirty,
  reduceActionUi,
  validateActionEvents,
} from "../apps/web/src/actionUiState";

const transform = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};

function emptyClip(id: string, loop = false): MotionClip {
  return {
    schemaVersion: 1,
    kind: "motion-clip",
    id,
    name: id,
    skeletonId: "hero",
    duration: 1,
    loop,
    tracks: [{
      targetId: "root",
      property: "translation",
      keys: [{ time: 0, value: [0, 0, 0], interpolation: "step" }],
    }],
    events: [],
    provenance: { source: "manual" },
  };
}

const body: BodyProfile = {
  schemaVersion: 1,
  id: "body-a",
  name: "Body A",
  skeletonId: "hero",
  mirrorAxis: "x",
  slots: [
    { id: "slot-hand-r", semantic: "hand_right", capacity: 1, accepts: ["weapon"] },
    { id: "slot-hand-l", semantic: "hand_left", capacity: 1, accepts: ["weapon", "cyber"] },
  ],
  sockets: [
    { id: "sock-hand-r", semantic: "weapon_hand_right", boneId: "root", rest: transform, accepts: ["weapon"] },
    { id: "sock-muzzle", semantic: "muzzle", boneId: "root", rest: transform, accepts: ["effect"] },
  ],
};

const rifle: EquipmentDefinition = {
  schemaVersion: 1,
  id: "rifle",
  name: "Rifle",
  tags: ["weapon"],
  visualMode: "attached",
  primarySlot: "slot-hand-r",
  occupiedSlots: ["slot-hand-r", "slot-hand-l"],
  conflictTags: [],
  replacesParts: [],
  hidesSlots: [],
  attachments: [],
  actionOverrides: { reload: "clip-reload-bullpup" },
  weapon: {
    holdMode: "two_hand",
    preferredPrimaryHand: "right",
    mirrorAllowed: true,
    primaryGrip: transform,
    secondaryGrip: transform,
    muzzleSocket: transform,
    stanceProfile: "rifle_two_hand",
  },
};

describe("action ui state", () => {
  test("templates cover idle/move/aim/fire/reload/hit/death/custom", () => {
    expect([...ACTION_TEMPLATE_KINDS]).toEqual([
      "idle", "move", "aim", "fire", "reload", "hit", "death", "custom",
    ]);
    const reload = createActionFromTemplate("reload", "act-reload");
    expect(reload.template.loop).toBeFalse();
    expect(reload.template.requiredEvents).toContain("weapon.reload.detach");
    expect(reload.template.requiredEvents).toContain("weapon.reload.complete");
    expect(reload.template.fallbackAction).toBe("idle");
    expect(reload.recommendedKeyPoses).toEqual(["start", "anticipation", "action", "recovery"]);
  });

  test("owned layer editing is restricted", () => {
    let state = createActionUiState({
      templates: [createActionFromTemplate("aim", "aim").template],
      clips: { "clip-aim": emptyClip("clip-aim") },
      baseActions: { aim: "clip-aim" },
    });
    state = reduceActionUi(state, { type: "selectAction", actionId: "aim" });
    state = reduceActionUi(state, { type: "setLayerSource", source: "base" });
    expect(canEditOwnedLayer(state)).toBeFalse();
    state = reduceActionUi(state, { type: "setOwnedLayer", layer: "base" });
    expect(canEditOwnedLayer(state)).toBeTrue();
    state = reduceActionUi(state, {
      type: "patchOwnedClip",
      clip: emptyClip("clip-aim-edited"),
    });
    expect(state.baseActions.aim).toBe("clip-aim-edited");
    expect(isActionDirty(state)).toBeTrue();
  });

  test("semantic event insertion validates sockets and reload order", () => {
    let state = createActionUiState({
      templates: [createActionFromTemplate("reload", "reload").template],
      clips: { "clip-reload": emptyClip("clip-reload") },
      baseActions: { reload: "clip-reload" },
      bodyProfiles: [body],
      equipment: [rifle],
    });
    state = reduceActionUi(state, { type: "selectAction", actionId: "reload" });
    state = reduceActionUi(state, { type: "setOwnedLayer", layer: "base" });
    state = reduceActionUi(state, { type: "setPreviewTime", time: 0.2 });
    state = reduceActionUi(state, {
      type: "addSemanticEvent",
      eventType: "weapon.reload.attach",
      name: "attach",
      socketId: "sock-hand-r",
    });
    expect(state.eventIssues.some((issue) => issue.path.includes("reload"))).toBeTrue();
    state = reduceActionUi(state, {
      type: "addSemanticEvent",
      eventType: "weapon.fire",
      name: "fire",
      socketId: "sock-muzzle",
      time: 0.1,
    });
    expect(state.muzzlePlaceholder).toEqual({ time: 0.1, socketId: "sock-muzzle" });
    expect(STANDARD_ACTION_EVENTS).toContain("weapon.fire");
  });

  test("compatibility matrix loads exact failed combination and time", () => {
    const loadout: CharacterLoadout = {
      bodyProfileId: "body-a",
      equipment: [{ equipmentId: "rifle", primarySlot: "slot-hand-r" }],
    };
    const clips = {
      "clip-reload": emptyClip("clip-reload"),
      "clip-reload-bad": {
        ...emptyClip("clip-reload-bad"),
        events: [
          { time: 0.6, type: "weapon.reload.complete", name: "c" },
          { time: 0.2, type: "weapon.reload.detach", name: "d" },
        ],
      } satisfies MotionClip,
    };
    const matrix = evaluateCompatibilityMatrix({
      actionId: "reload",
      bodyProfiles: [body],
      equipment: [rifle],
      weapons: [rifle],
      handedness: ["right", "left"],
      cyberlimbs: [],
      loadouts: [{ name: "rifle-right", loadout }],
      clips,
      baseActions: { reload: "clip-reload" },
      equipmentOverridesById: { rifle: { reload: "clip-reload-bad" } },
    });
    expect(matrix.cells.length).toBeGreaterThan(0);
    const failed = matrix.cells.find((cell) => !cell.ok)!;
    expect(failed.failureTime).toBe(0.6);
    let state = createActionUiState({
      templates: [createActionFromTemplate("reload", "reload").template],
      clips,
      baseActions: { reload: "clip-reload" },
      bodyProfiles: [body],
      equipment: [rifle],
      loadouts: [{ name: "rifle-right", loadout }],
    });
    state = reduceActionUi(state, { type: "loadCompatibilityFailure", cell: failed });
    expect(state.selectedActionId).toBe("reload");
    expect(state.previewTime).toBe(0.6);
    expect(state.selectedLoadoutName).toBe(failed.loadoutName);
    expect(state.selectedBodyProfileId).toBe(failed.bodyProfileId);
  });

  test("insertSemanticEvent helper rejects unknown event types", () => {
    const clip = emptyClip("c1");
    const result = insertSemanticEvent(clip, {
      type: "not.a.real.event",
      name: "x",
      time: 0.1,
    }, createActionFromTemplate("custom", "custom").template);
    expect(result.ok).toBeFalse();
    const custom = createActionFromTemplate("custom", "custom").template;
    const ok = insertSemanticEvent(clip, {
      type: "effect.trigger",
      name: "spark",
      time: 0.1,
      payload: { socket: "sock-muzzle" },
    }, custom);
    expect(ok.ok).toBeTrue();
    expect(validateActionEvents(ok.clip!.events, custom).ok).toBeTrue();
  });
});
