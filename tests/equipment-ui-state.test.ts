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
  slotIdForSocket,
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

  test("attachment rest patches refresh the assembled preview", () => {
    const fixtures = createEquipmentSampleFixtures();
    const helmet = fixtures.find((item) => item.id === "fx-helmet")!;
    let state = createEquipmentUiState([helmet], body, binding);
    state = reduceEquipmentUi(state, { type: "tryEquip", equipmentId: "fx-helmet" }, body, binding);
    expect(state.legalPreview?.attachments[0]?.rest.translation[0]).toBe(0);

    state = reduceEquipmentUi(state, {
      type: "patchAttachment",
      attachmentId: helmet.attachments[0]!.id,
      patch: { rest: { translation: [70, 0, 0] } },
    }, body, binding);
    expect(state.draft!.attachments[0]!.rest.translation[0]).toBe(70);
    expect(state.legalPreview?.attachments[0]?.rest.translation[0]).toBe(70);
  });

  test("canvas drag skipHistory then commitCanvasEdit is one undo step", () => {
    const fixtures = createEquipmentSampleFixtures();
    const helmet = fixtures.find((item) => item.id === "fx-helmet")!;
    let state = createEquipmentUiState([helmet], body, binding);
    const before = structuredClone(state.draft!);
    state = reduceEquipmentUi(state, {
      type: "patchAttachment",
      attachmentId: helmet.attachments[0]!.id,
      skipHistory: true,
      patch: { rest: { translation: [12, 4, 0] } },
    }, body, binding);
    expect(state.past).toHaveLength(0);
    state = reduceEquipmentUi(state, { type: "commitCanvasEdit", before }, body, binding);
    expect(state.past).toHaveLength(1);
    state = reduceEquipmentUi(state, { type: "undo" }, body, binding);
    expect(state.draft!.attachments[0]!.rest.translation[0]).toBe(0);
  });

  test("changing primary slot releases the previous occupancy", () => {
    let state = createEquipmentUiState([], body, binding);
    const draft = createEmptyEquipment("eq-pack", "Pack", body, "attached");
    expect(draft.primarySlot).toBe("slot-head");
    expect(draft.occupiedSlots).toEqual(["slot-head"]);
    state = reduceEquipmentUi(state, { type: "createEquipment", equipment: draft }, body, binding);
    state = reduceEquipmentUi(state, { type: "setPrimarySlot", slotId: "slot-back" }, body, binding);
    expect(state.draft!.primarySlot).toBe("slot-back");
    expect(state.draft!.occupiedSlots).toEqual(["slot-back"]);
  });

  test("attachment socket retargets a single occupied slot away from head", () => {
    let state = createEquipmentUiState([], body, binding);
    const draft = createEmptyEquipment("eq-pack", "Pack", body, "attached");
    state = reduceEquipmentUi(state, { type: "createEquipment", equipment: draft }, body, binding);
    state = reduceEquipmentUi(state, {
      type: "addAttachment",
      attachment: createEmptyAttachment("att-pack", "Pack", "sock-back"),
    }, body, binding);
    expect(state.draft!.primarySlot).toBe("slot-back");
    expect(state.draft!.occupiedSlots).toEqual(["slot-back"]);

    state = reduceEquipmentUi(state, {
      type: "patchAttachment",
      attachmentId: "att-pack",
      patch: { socket: "sock-arm-l" },
    }, body, binding);
    expect(state.draft!.primarySlot).toBe("slot-arm-l");
    expect(state.draft!.occupiedSlots).toEqual(["slot-arm-l"]);
  });

  test("selecting mis-slotted gear retargets to the attachment socket", () => {
    const pack = createEmptyEquipment("eq-pack", "Pack", body, "attached");
    pack.attachments = [createEmptyAttachment("att-pack", "Pack", "sock-back")];
    expect(pack.primarySlot).toBe("slot-head");
    let state = createEquipmentUiState([pack], body, binding);
    state = reduceEquipmentUi(state, { type: "selectEquipment", equipmentId: "eq-pack" }, body, binding);
    expect(state.draft!.primarySlot).toBe("slot-back");
    expect(state.draft!.occupiedSlots).toEqual(["slot-back"]);
    expect(isEquipmentDirty(state)).toBeTrue();
  });

  test("helmet and backpack can be worn together after slot retarget", () => {
    const helmet = createEmptyEquipment("eq-helm", "Helm", body, "attached");
    helmet.tags = ["helmet"];
    helmet.attachments = [createEmptyAttachment("att-helm", "Helm", "sock-head")];
    const pack = createEmptyEquipment("eq-pack", "Pack", body, "attached");
    pack.tags = ["device"];
    pack.attachments = [createEmptyAttachment("att-pack", "Pack", "sock-back")];
    let state = createEquipmentUiState([helmet, pack], body, binding);
    state = reduceEquipmentUi(state, { type: "selectEquipment", equipmentId: "eq-pack" }, body, binding);
    expect(state.draft!.primarySlot).toBe("slot-back");
    state = reduceEquipmentUi(state, { type: "tryEquip", equipmentId: "eq-helm" }, body, binding);
    expect(state.conflictIssues).toHaveLength(0);
    state = reduceEquipmentUi(state, { type: "tryEquip", equipmentId: "eq-pack" }, body, binding);
    expect(state.conflictIssues).toHaveLength(0);
    expect(state.previewLoadout.equipment.map((item) => item.equipmentId).sort()).toEqual(["eq-helm", "eq-pack"]);
  });

  test("slotIdForSocket maps head/back/eye sockets", () => {
    expect(slotIdForSocket(body, "sock-head")).toBe("slot-head");
    expect(slotIdForSocket(body, "sock-back")).toBe("slot-back");
    expect(slotIdForSocket(body, "sock-eye-l")).toBe("slot-eye");
  });

  test("selectEquipment keepPane stays on the current pane", () => {
    const helmet = createEmptyEquipment("eq-helm", "Helm", body, "attached");
    helmet.tags = ["helmet"];
    helmet.attachments = [createEmptyAttachment("att-helm", "Helm", "sock-head")];
    const pack = createEmptyEquipment("eq-pack", "Pack", body, "attached");
    pack.tags = ["device"];
    pack.attachments = [createEmptyAttachment("att-pack", "Pack", "sock-back")];
    let state = createEquipmentUiState([helmet, pack], body, binding);
    state = reduceEquipmentUi(state, { type: "setPane", pane: "loadout" }, body, binding);
    state = reduceEquipmentUi(state, { type: "selectEquipment", equipmentId: "eq-pack", keepPane: true }, body, binding);
    expect(state.pane).toBe("loadout");
    expect(state.selectedEquipmentId).toBe("eq-pack");
    expect(state.selectedAttachmentId).toBe("att-pack");
    expect(state.wizardStep).toBe("identity");
  });

  test("new attachments default to a clickable size", () => {
    expect(createEmptyAttachment("att-1", "Shell", "sock-head").size).toEqual([48, 48]);
  });
});
