import { describe, expect, test } from "bun:test";
import type { BodyProfile, CharacterLoadout, EquipmentDefinition, MotionClip } from "../packages/shared/src";
import {
  ACTION_TEMPLATE_KINDS,
  STANDARD_ACTION_EVENTS,
  canEditOwnedLayer,
  createActionFromTemplate,
  createActionUiState,
  editableMotionClipId,
  evaluateCompatibilityMatrix,
  inspectLayerClip,
  insertSemanticEvent,
  defaultSemanticEventName,
  resolveSemanticEventName,
  semanticEventDisplayLabel,
  seekTimeFromStrip,
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
      ownedLayer: "equipment",
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

  test("editableMotionClipId 在剪辑尚未载入时仍返回基础层 clip id", () => {
    const state = createActionUiState({
      templates: [createActionFromTemplate("idle", "idle").template],
      clips: {},
      baseActions: { idle: "clip-idle" },
    });
    expect(editableMotionClipId(state)).toBe("clip-idle");
    expect(inspectLayerClip(state)?.id).toBe("clip-idle");
  });

  test("createActionUiState 会为缺失的 clip-move 补空剪辑", () => {
    const state = createActionUiState({
      templates: [createActionFromTemplate("move", "move").template],
      clips: {},
      baseActions: { move: "clip-move" },
      skeletonId: "hero",
    });
    expect(state.clips["clip-move"]?.id).toBe("clip-move");
    expect(state.clips["clip-move"]?.loop).toBeTrue();
  });

  test("hydrateClips 会补上缺失剪辑且不覆盖未保存的本地修改", () => {
    let state = createActionUiState({
      templates: [createActionFromTemplate("idle", "idle").template],
      clips: { "clip-idle": emptyClip("clip-idle") },
      baseActions: { idle: "clip-idle" },
    });
    state = reduceActionUi(state, { type: "setOwnedLayer", layer: "base" });
    state = reduceActionUi(state, {
      type: "addSemanticEvent",
      eventType: "effect.trigger",
      name: "spark",
    });
    const dirtyEvents = state.clips["clip-idle"]!.events.length;
    const incoming = {
      ...emptyClip("clip-idle"),
      tracks: [{
        targetId: "root",
        property: "rotation" as const,
        keys: [{ time: 0, value: [0, 0, 0, 1], interpolation: "linear" as const }],
      }],
    };
    state = reduceActionUi(state, {
      type: "hydrateClips",
      clips: { "clip-idle": incoming, "clip-move": emptyClip("clip-move", true) },
    });
    expect(state.clips["clip-idle"]!.events.length).toBe(dirtyEvents);
    expect(state.clips["clip-idle"]!.tracks).toEqual(incoming.tracks);
    expect(state.clips["clip-move"]?.id).toBe("clip-move");
  });

  test("脚步事件不会沿用默认名称 fire", () => {
    expect(defaultSemanticEventName("movement.footstep.left")).toBe("left");
    expect(resolveSemanticEventName("movement.footstep.left", "fire")).toBe("left");
    expect(resolveSemanticEventName("weapon.fire", "fire")).toBe("fire");
    expect(semanticEventDisplayLabel("movement.footstep.left")).toBe("footstep.left");
    const clip = emptyClip("clip-move", true);
    const inserted = insertSemanticEvent(clip, {
      time: 0.2,
      type: "movement.footstep.left",
      name: "fire",
    }, createActionFromTemplate("move", "move").template);
    expect(inserted.clip?.events[0]?.name).toBe("left");
    expect(inserted.clip?.events[0]?.type).toBe("movement.footstep.left");
  });

  test("seekTimeFromStrip 把指针位置换成秒并夹紧", () => {
    expect(seekTimeFromStrip(10, 10, 100, 2)).toBe(0);
    expect(seekTimeFromStrip(60, 10, 100, 2)).toBe(1);
    expect(seekTimeFromStrip(110, 10, 100, 2)).toBe(2);
    expect(seekTimeFromStrip(0, 10, 100, 2)).toBe(0);
    expect(seekTimeFromStrip(50, 10, 0, 2)).toBe(0);
  });
});
