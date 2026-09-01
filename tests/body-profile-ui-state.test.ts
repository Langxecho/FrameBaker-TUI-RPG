import { describe, expect, test } from "bun:test";
import type { BodyProfile, Skeleton } from "../packages/shared/src";
import {
  createBodyProfileUiState,
  createEmptyBodyProfile,
  isBodyProfileDirty,
  reduceBodyProfileUi,
  seedStandardBodyProfile,
} from "../apps/web/src/bodyProfileUiState";

const transform = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};

const skeleton: Skeleton = {
  schemaVersion: 1,
  kind: "skeleton",
  id: "hero",
  name: "Hero",
  coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "pixel" },
  bones: [
    { id: "root", name: "Root", parentId: null, rest: transform },
    { id: "hand_l", name: "Hand L", parentId: "root", rest: transform },
    { id: "hand_r", name: "Hand R", parentId: "root", rest: transform },
  ],
};

function blank(): BodyProfile {
  return createEmptyBodyProfile("body", "Body", skeleton.id);
}

describe("body profile ui state", () => {
  test("selects a bone without marking dirty", () => {
    let state = createBodyProfileUiState(blank(), skeleton);
    state = reduceBodyProfileUi(state, { type: "selectBone", boneId: "hand_l" });
    expect(state.selectedBoneId).toBe("hand_l");
    expect(isBodyProfileDirty(state)).toBeFalse();
    expect(state.past).toHaveLength(0);
  });

  test("adds a socket on the selected bone and marks dirty", () => {
    let state = createBodyProfileUiState(blank(), skeleton);
    state = reduceBodyProfileUi(state, { type: "selectBone", boneId: "hand_l" });
    state = reduceBodyProfileUi(state, { type: "addSocket", socketId: "socket-l", semantic: "weapon_hand_left" });
    expect(state.draft.sockets).toHaveLength(1);
    expect(state.draft.sockets[0]).toMatchObject({ id: "socket-l", boneId: "hand_l", semantic: "weapon_hand_left" });
    expect(state.selectedSocketId).toBe("socket-l");
    expect(isBodyProfileDirty(state)).toBeTrue();
  });

  test("mirrors a socket pair as one undoable command", () => {
    let state = createBodyProfileUiState(blank(), skeleton);
    state = reduceBodyProfileUi(state, { type: "selectBone", boneId: "hand_l" });
    state = reduceBodyProfileUi(state, { type: "addSocket", socketId: "socket-l", semantic: "weapon_hand_left" });
    state = reduceBodyProfileUi(state, {
      type: "patchSocket",
      socketId: "socket-l",
      patch: { rest: { translation: [12, 4, 0] }, accepts: ["weapon"] },
    });
    state = reduceBodyProfileUi(state, { type: "mirrorSocket", socketId: "socket-l", pairId: "socket-r" });
    expect(state.draft.sockets).toHaveLength(2);
    const left = state.draft.sockets.find((socket) => socket.id === "socket-l")!;
    const right = state.draft.sockets.find((socket) => socket.id === "socket-r")!;
    expect(left.mirrorSocketId).toBe("socket-r");
    expect(right.mirrorSocketId).toBe("socket-l");
    expect(right.semantic).toBe("weapon_hand_right");
    expect(right.rest.translation[0]).toBe(-12);
    expect(right.accepts).toEqual(["weapon"]);
    const beforeUndoCount = state.draft.sockets.length;
    state = reduceBodyProfileUi(state, { type: "undo" });
    expect(state.draft.sockets).toHaveLength(1);
    expect(state.draft.sockets[0]!.id).toBe("socket-l");
    expect(state.draft.sockets[0]!.mirrorSocketId).toBeUndefined();
    state = reduceBodyProfileUi(state, { type: "redo" });
    expect(state.draft.sockets).toHaveLength(beforeUndoCount);
  });

  test("deletes a socket and clears broken mirror links", () => {
    let state = createBodyProfileUiState(blank(), skeleton);
    state = reduceBodyProfileUi(state, { type: "addSocket", socketId: "socket-l", boneId: "hand_l", semantic: "weapon_hand_left" });
    state = reduceBodyProfileUi(state, { type: "mirrorSocket", socketId: "socket-l", pairId: "socket-r" });
    state = reduceBodyProfileUi(state, { type: "deleteSocket", socketId: "socket-r" });
    expect(state.draft.sockets.map((socket) => socket.id)).toEqual(["socket-l"]);
    expect(state.draft.sockets[0]!.mirrorSocketId).toBeUndefined();
    expect(state.selectedSocketId).toBe("socket-l");
  });

  test("tracks dirty transitions across save and one-command undo boundaries", () => {
    let state = createBodyProfileUiState(blank(), skeleton);
    expect(isBodyProfileDirty(state)).toBeFalse();
    state = reduceBodyProfileUi(state, { type: "addSlot", slotId: "head", semantic: "head" });
    state = reduceBodyProfileUi(state, { type: "patchSlot", slotId: "head", patch: { capacity: 2, accepts: ["helmet"] } });
    expect(isBodyProfileDirty(state)).toBeTrue();
    expect(state.past).toHaveLength(2);
    state = reduceBodyProfileUi(state, { type: "undo" });
    expect(state.draft.slots[0]!.capacity).toBe(1);
    state = reduceBodyProfileUi(state, { type: "undo" });
    expect(isBodyProfileDirty(state)).toBeFalse();
    state = reduceBodyProfileUi(state, { type: "redo" });
    state = reduceBodyProfileUi(state, { type: "markSaved", profile: state.draft });
    expect(isBodyProfileDirty(state)).toBeFalse();
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
  });

  test("seeds standard hand slots and weapon sockets from skeleton bones", () => {
    const profile = seedStandardBodyProfile("body", "Body", skeleton);
    expect(profile.slots.map((slot) => slot.semantic).sort()).toEqual(expect.arrayContaining(["hand_left", "hand_right", "head"]));
    const left = profile.sockets.find((socket) => socket.semantic === "weapon_hand_left");
    const right = profile.sockets.find((socket) => socket.semantic === "weapon_hand_right");
    expect(left?.boneId).toBe("hand_l");
    expect(right?.boneId).toBe("hand_r");
    expect(left?.mirrorSocketId).toBe(right?.id);
    expect(right?.mirrorSocketId).toBe(left?.id);
    expect(left?.accepts).toContain("weapon");
    expect(profile.slots.find((slot) => slot.semantic === "hand_right")?.accepts).toContain("weapon");
  });
});
