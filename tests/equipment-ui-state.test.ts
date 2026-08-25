import { describe, expect, test } from "bun:test";
import type { CharacterBinding, Skeleton } from "../packages/shared/src";
import { createEquipmentFixtureBody, createEquipmentSampleFixtures } from "../apps/web/src/equipmentFixtures";
import {
  canCompleteEquipmentWizard,
  createEmptyAttachment,
  createEmptyEquipment,
  createEquipmentUiState,
  equipmentWizardBlockingIssues,
  focusZoomForSocketSemantic,
  isEquipmentDirty,
  reduceEquipmentUi,
} from "../apps/web/src/equipmentUiState";

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
  bones: [{ id: "root", name: "Root", parentId: null, rest: transform }],
};

const body = createEquipmentFixtureBody(skeleton.id);
const binding: CharacterBinding = {
  schemaVersion: 1,
  kind: "character-binding",
  id: "binding",
  name: "Binding",
  skeletonId: skeleton.id,
  slots: [{ id: "part-arm-l", name: "Arm L", boneId: "root", attachmentId: "att-arm-l", drawOrder: 0 }],
  attachments: [],
};

describe("equipment ui state", () => {
  test("wizard transitions and visual-mode required fields", () => {
    let state = createEquipmentUiState([], body, binding);
    const draft = createEmptyEquipment("eq-1", "Helmet", body, "attached");
    state = reduceEquipmentUi(state, { type: "createEquipment", equipment: draft }, body, binding);
    expect(state.pane).toBe("wizard");
    expect(state.wizardStep).toBe("identity");
    state = reduceEquipmentUi(state, { type: "setWizardStep", step: "visualMode" }, body, binding);
    expect(state.wizardStep).toBe("visualMode");

    expect(canCompleteEquipmentWizard(state.draft, body)).toBeFalse();
    expect(equipmentWizardBlockingIssues(state.draft, body, "attachments").some((issue) => issue.path === "attachments")).toBeTrue();

    state = reduceEquipmentUi(state, {
      type: "addAttachment",
      attachment: createEmptyAttachment("att-1", "Shell", "sock-head"),
    }, body, binding);
    state = reduceEquipmentUi(state, { type: "patchDraft", patch: { tags: ["helmet"] } }, body, binding);
    expect(canCompleteEquipmentWizard(state.draft, body)).toBeTrue();

    state = reduceEquipmentUi(state, { type: "setVisualMode", visualMode: "none" }, body, binding);
    expect(state.draft!.attachments).toHaveLength(0);
    expect(equipmentWizardBlockingIssues(state.draft, body).some((issue) => issue.path === "attachments")).toBeFalse();

    state = reduceEquipmentUi(state, { type: "setVisualMode", visualMode: "effect" }, body, binding);
    expect(canCompleteEquipmentWizard(state.draft, body)).toBeFalse();
    state = reduceEquipmentUi(state, {
      type: "setEffectBindings",
      bindings: [{ event: "weapon.fire", effectId: "spark", socket: "sock-chest" }],
    }, body, binding);
    state = reduceEquipmentUi(state, { type: "patchDraft", patch: { tags: ["effect"], primarySlot: "slot-effect", occupiedSlots: ["slot-effect"] } }, body, binding);
    expect(canCompleteEquipmentWizard(state.draft, body)).toBeTrue();
  });

  test("multi-slot attachment edits and mirror are one undo step", () => {
    let state = createEquipmentUiState([], body, binding);
    const draft = createEmptyEquipment("eq-eye", "Eyes", body, "attached");
    draft.primarySlot = "slot-eye";
    draft.occupiedSlots = ["slot-eye"];
    draft.tags = ["eye"];
    state = reduceEquipmentUi(state, { type: "createEquipment", equipment: draft }, body, binding);
    state = reduceEquipmentUi(state, {
      type: "addAttachment",
      attachment: createEmptyAttachment("att-l", "L", "sock-eye-l"),
    }, body, binding);
    state = reduceEquipmentUi(state, {
      type: "patchAttachment",
      attachmentId: "att-l",
      patch: { rest: { translation: [3, 1, 0] }, drawOffset: 2, materialId: "mat-eye" },
    }, body, binding);
    state = reduceEquipmentUi(state, {
      type: "mirrorAttachment",
      attachmentId: "att-l",
      pairId: "att-r",
      socketId: "sock-eye-r",
    }, body, binding);
    expect(state.draft!.attachments).toHaveLength(2);
    expect(state.draft!.attachments[1]!.rest.translation[0]).toBe(-3);
    expect(state.selectedAttachmentId).toBe("att-r");
    state = reduceEquipmentUi(state, { type: "undo" }, body, binding);
    expect(state.draft!.attachments).toHaveLength(1);
    expect(isEquipmentDirty(state)).toBeTrue();
  });

  test("loadout conflicts retain previous legal preview", () => {
    const fixtures = createEquipmentSampleFixtures();
    const helmet = fixtures.find((item) => item.id === "fx-helmet")!;
    const other = { ...helmet, id: "fx-helmet-2", name: "Other Helmet", conflictTags: ["helmet"] };
    let state = createEquipmentUiState([helmet, other], body, binding);
    state = reduceEquipmentUi(state, { type: "tryEquip", equipmentId: "fx-helmet" }, body, binding);
    expect(state.conflictIssues).toHaveLength(0);
    expect(state.previewLoadout.equipment.map((item) => item.equipmentId)).toEqual(["fx-helmet"]);
    expect(state.legalPreview?.attachments.length).toBe(1);
    const legal = state.legalPreview;

    state = reduceEquipmentUi(state, { type: "tryEquip", equipmentId: "fx-helmet-2" }, body, binding);
    expect(state.conflictIssues.length).toBeGreaterThan(0);
    expect(state.previewLoadout.equipment.map((item) => item.equipmentId)).toEqual(["fx-helmet"]);
    expect(state.legalPreview).toEqual(legal);

    state = reduceEquipmentUi(state, { type: "saveLoadout", name: "solo-helm" }, body, binding);
    state = reduceEquipmentUi(state, { type: "unequip", equipmentId: "fx-helmet" }, body, binding);
    expect(state.previewLoadout.equipment).toHaveLength(0);
    state = reduceEquipmentUi(state, { type: "loadSavedLoadout", name: "solo-helm" }, body, binding);
    expect(state.previewLoadout.equipment.map((item) => item.equipmentId)).toEqual(["fx-helmet"]);
  });

  test("save/reopen clears dirty and none mode never keeps attachments", () => {
    let state = createEquipmentUiState([], body, binding);
    const draft = createEmptyEquipment("eq-chip", "Chip", body, "none");
    draft.tags = ["chip", "internal"];
    draft.primarySlot = "slot-internal";
    draft.occupiedSlots = ["slot-internal"];
    state = reduceEquipmentUi(state, { type: "createEquipment", equipment: draft }, body, binding);
    expect(isEquipmentDirty(state)).toBeTrue();
    state = reduceEquipmentUi(state, {
      type: "addAttachment",
      attachment: createEmptyAttachment("should-block", "No", "sock-chest"),
    }, body, binding);
    expect(state.draft!.attachments).toHaveLength(0);
    state = reduceEquipmentUi(state, { type: "markSaved", equipment: state.draft! }, body, binding);
    expect(isEquipmentDirty(state)).toBeFalse();
    expect(state.library.some((item) => item.id === "eq-chip")).toBeTrue();
    state = reduceEquipmentUi(state, { type: "selectEquipment", equipmentId: "eq-chip" }, body, binding);
    expect(state.draft?.visualMode).toBe("none");
    expect(state.draft?.attachments).toHaveLength(0);
  });

  test("focus zoom maps eye/hand/body sockets", () => {
    expect(focusZoomForSocketSemantic("eye_left")).toBe("eye");
    expect(focusZoomForSocketSemantic("weapon_hand_right")).toBe("hand");
    expect(focusZoomForSocketSemantic("chest")).toBe("body");
    expect(focusZoomForSocketSemantic("custom:drone")).toBe("none");
  });
});
