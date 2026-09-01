import { describe, expect, test } from "bun:test";
import type { BodyProfile, CharacterBinding, Skeleton } from "../packages/shared/src";
import {
  canCompleteWeaponWizard,
  createEmptyWeapon,
  createWeaponUiState,
  diagnoseWeaponTwoHandIk,
  isWeaponDirty,
  reduceWeaponUi,
  resolveWeaponHandSlots,
  assembledForWeaponPane,
  weaponWizardBlockingIssues,
} from "../apps/web/src/weaponUiState";
import { createWeaponFixtureBody, createWeaponSampleFixtures } from "../apps/web/src/weaponFixtures";

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
    { id: "upper_r", name: "Upper R", parentId: "root", rest: { ...transform, translation: [8, 10, 0] } },
    { id: "lower_r", name: "Lower R", parentId: "upper_r", rest: { ...transform, translation: [10, 0, 0] } },
    { id: "hand_r", name: "Hand R", parentId: "lower_r", rest: { ...transform, translation: [10, 0, 0] } },
    { id: "upper_l", name: "Upper L", parentId: "root", rest: { ...transform, translation: [0, 10, 0] } },
    { id: "lower_l", name: "Lower L", parentId: "upper_l", rest: { ...transform, translation: [10, 0, 0] } },
    { id: "hand_l", name: "Hand L", parentId: "lower_l", rest: { ...transform, translation: [10, 0, 0] } },
  ],
};

const body: BodyProfile = createWeaponFixtureBody(skeleton.id);
const binding: CharacterBinding = {
  schemaVersion: 1,
  kind: "character-binding",
  id: "binding",
  name: "Binding",
  skeletonId: skeleton.id,
  slots: [],
  attachments: [],
};

describe("weapon ui state", () => {
  test("creates rifle two-hand weapon with grips, muzzle, and secondary IK", () => {
    let state = createWeaponUiState([], body, binding, skeleton);
    const rifle = createEmptyWeapon("wpn-rifle", "Rifle", body, {
      holdMode: "two_hand",
      preferredPrimaryHand: "right",
    });
    state = reduceWeaponUi(state, { type: "createWeapon", equipment: rifle }, body, binding, skeleton);
    expect(state.pane).toBe("editor");
    expect(state.draft?.weapon?.holdMode).toBe("two_hand");
    expect(state.draft?.occupiedSlots).toHaveLength(2);

    state = reduceWeaponUi(state, {
      type: "patchWeapon",
      patch: {
        primaryGrip: { ...transform, translation: [2, 0, 0] },
        secondaryGrip: { ...transform, translation: [-6, 1, 0] },
        muzzleSocket: { ...transform, translation: [14, 2, 0] },
        ejectSocket: { ...transform, translation: [4, 3, 0] },
        stanceProfile: "rifle_two_hand",
        mirrorAllowed: true,
      },
    }, body, binding, skeleton);
    state = reduceWeaponUi(state, {
      type: "setSecondaryHandConstraint",
      constraint: {
        id: "ik-secondary",
        upperBoneId: "upper_l",
        lowerBoneId: "lower_l",
        endBoneId: "hand_l",
        targetSocket: "sock-hand-l",
        bendDirection: "positive",
        mix: 1,
        stretch: "forbid",
      },
    }, body, binding, skeleton);
    state = reduceWeaponUi(state, {
      type: "patchAttachment",
      attachmentId: state.draft!.attachments[0]!.id,
      patch: { materialId: "mat-rifle" },
    }, body, binding, skeleton);

    expect(canCompleteWeaponWizard(state.draft, body, skeleton)).toBeTrue();
    expect(state.draft!.weapon!.secondaryHandConstraint?.targetSocket).toBe("sock-hand-l");
    expect(isWeaponDirty(state)).toBeTrue();
  });

  test("empty weapon cannot complete until its attachment has a real material", () => {
    const weapon = createEmptyWeapon("wpn-new", "新武器", body);
    expect(weapon.attachments[0]?.materialId).toBe("mat-placeholder");
    expect(canCompleteWeaponWizard(weapon, body, skeleton)).toBeFalse();
    expect(weaponWizardBlockingIssues(weapon, body, skeleton).some((issue) => issue.path.includes("materialId"))).toBeTrue();
  });

  test("patchAttachment assigns a material so the wizard can complete", () => {
    let state = createWeaponUiState([], body, binding, skeleton);
    const weapon = createEmptyWeapon("wpn-gun", "手枪", body);
    state = reduceWeaponUi(state, { type: "createWeapon", equipment: weapon }, body, binding, skeleton);
    const attachmentId = state.draft!.attachments[0]!.id;
    expect(state.selectedAttachmentId).toBe(attachmentId);
    state = reduceWeaponUi(state, {
      type: "patchAttachment",
      attachmentId,
      patch: { materialId: "mat-pistol" },
    }, body, binding, skeleton);
    expect(state.draft!.attachments[0]!.materialId).toBe("mat-pistol");
    state = reduceWeaponUi(state, {
      type: "patchAttachment",
      attachmentId,
      patch: { drawOffset: -1 },
    }, body, binding, skeleton);
    expect(state.draft!.attachments[0]!.drawOffset).toBe(-1);
    expect(canCompleteWeaponWizard(state.draft, body, skeleton)).toBeTrue();
  });

  test("left and right preferred primary hands resolve opposite occupied slots", () => {
    const right = createEmptyWeapon("wpn-r", "Right Pistol", body, {
      holdMode: "one_hand",
      preferredPrimaryHand: "right",
    });
    const left = createEmptyWeapon("wpn-l", "Left Pistol", body, {
      holdMode: "one_hand",
      preferredPrimaryHand: "left",
    });
    expect(resolveWeaponHandSlots(body, "one_hand", "right")).toEqual({
      primarySlot: "slot-hand-r",
      occupiedSlots: ["slot-hand-r"],
    });
    expect(resolveWeaponHandSlots(body, "one_hand", "left")).toEqual({
      primarySlot: "slot-hand-l",
      occupiedSlots: ["slot-hand-l"],
    });
    expect(right.primarySlot).toBe("slot-hand-r");
    expect(left.primarySlot).toBe("slot-hand-l");
    expect(resolveWeaponHandSlots(body, "two_hand", "right").occupiedSlots).toEqual([
      "slot-hand-r",
      "slot-hand-l",
    ]);
  });

  test("dual wield preview equips two independent one-hand weapons", () => {
    const fixtures = createWeaponSampleFixtures();
    const pistolR = fixtures.find((item) => item.id === "fx-pistol-r")!;
    const pistolL = fixtures.find((item) => item.id === "fx-pistol-l")!;
    let state = createWeaponUiState([pistolR, pistolL], body, binding, skeleton);
    state = reduceWeaponUi(state, { type: "setPane", pane: "preview" }, body, binding, skeleton);
    state = reduceWeaponUi(state, { type: "tryEquip", equipmentId: "fx-pistol-r" }, body, binding, skeleton);
    state = reduceWeaponUi(state, { type: "tryEquip", equipmentId: "fx-pistol-l" }, body, binding, skeleton);
    expect(state.conflictIssues).toHaveLength(0);
    expect(state.previewLoadout.equipment.map((item) => item.equipmentId).sort()).toEqual([
      "fx-pistol-l",
      "fx-pistol-r",
    ]);
    expect([...(state.legalPreview?.occupiedSlots ?? [])].sort()).toEqual(["slot-hand-l", "slot-hand-r"]);
  });

  test("compatibility preview does not keep the draft weapon after clear", () => {
    const pistol = createEmptyWeapon("wpn-preview", "Pistol", body, { holdMode: "one_hand", preferredPrimaryHand: "right" });
    pistol.attachments[0] = { ...pistol.attachments[0]!, materialId: "mat-pistol" };
    let state = createWeaponUiState([pistol], body, binding, skeleton);
    state = reduceWeaponUi(state, { type: "tryEquip", equipmentId: "wpn-preview" }, body, binding, skeleton);
    expect(state.legalPreview?.attachments.length).toBeGreaterThan(0);
    state = reduceWeaponUi(state, { type: "clearPreview" }, body, binding, skeleton);
    expect(state.previewLoadout.equipment).toEqual([]);
    expect(state.legalPreview?.attachments ?? []).toEqual([]);
    const preview = assembledForWeaponPane("preview", state.legalPreview, state.draft, body.id);
    const editor = assembledForWeaponPane("editor", state.legalPreview, state.draft, body.id);
    expect(preview.attachments).toEqual([]);
    expect(editor.attachments.map((item) => item.id)).toEqual(state.draft!.attachments.map((item) => item.id));
  });

  test("conflict fixture retains previous legal dual-wield preview", () => {
    const fixtures = createWeaponSampleFixtures();
    const pistolR = fixtures.find((item) => item.id === "fx-pistol-r")!;
    const rifle = fixtures.find((item) => item.id === "fx-rifle")!;
    const conflict = fixtures.find((item) => item.id === "fx-weapon-conflict")!;
    let state = createWeaponUiState([pistolR, rifle, conflict], body, binding, skeleton);
    state = reduceWeaponUi(state, { type: "tryEquip", equipmentId: "fx-pistol-r" }, body, binding, skeleton);
    expect(state.conflictIssues).toHaveLength(0);
    const legal = state.legalPreview;
    state = reduceWeaponUi(state, { type: "tryEquip", equipmentId: "fx-weapon-conflict" }, body, binding, skeleton);
    expect(state.conflictIssues.length).toBeGreaterThan(0);
    expect(state.previewLoadout.equipment.map((item) => item.equipmentId)).toEqual(["fx-pistol-r"]);
    expect(state.legalPreview).toEqual(legal);
  });

  test("save/reopen clears dirty and either mode keeps single-slot occupation", () => {
    let state = createWeaponUiState([], body, binding, skeleton);
    const either = createEmptyWeapon("wpn-either", "Either Blade", body, {
      holdMode: "either",
      preferredPrimaryHand: "right",
    });
    state = reduceWeaponUi(state, { type: "createWeapon", equipment: either }, body, binding, skeleton);
    state = reduceWeaponUi(state, {
      type: "patchWeapon",
      patch: { stanceProfile: "pistol_one_hand", mirrorAllowed: true },
    }, body, binding, skeleton);
    expect(state.draft!.occupiedSlots).toEqual(["slot-hand-r"]);
    const attachmentId = state.draft!.attachments[0]!.id;
    state = reduceWeaponUi(state, {
      type: "patchAttachment",
      attachmentId,
      patch: { materialId: "mat-blade" },
    }, body, binding, skeleton);
    expect(weaponWizardBlockingIssues(state.draft, body, skeleton).length).toBe(0);
    expect(isWeaponDirty(state)).toBeTrue();
    state = reduceWeaponUi(state, { type: "markSaved", equipment: state.draft! }, body, binding, skeleton);
    expect(isWeaponDirty(state)).toBeFalse();
    state = reduceWeaponUi(state, { type: "selectWeapon", equipmentId: "wpn-either" }, body, binding, skeleton);
    expect(state.draft?.weapon?.holdMode).toBe("either");
    expect(state.library.some((item) => item.id === "wpn-either")).toBeTrue();
  });

  test("hold-mode change and undo are one command each", () => {
    let state = createWeaponUiState([], body, binding, skeleton);
    const weapon = createEmptyWeapon("wpn-mode", "Mode Weapon", body, {
      holdMode: "one_hand",
      preferredPrimaryHand: "right",
    });
    state = reduceWeaponUi(state, { type: "createWeapon", equipment: weapon }, body, binding, skeleton);
    state = reduceWeaponUi(state, {
      type: "setHoldMode",
      holdMode: "two_hand",
    }, body, binding, skeleton);
    expect(state.draft!.weapon!.holdMode).toBe("two_hand");
    expect(state.draft!.occupiedSlots).toHaveLength(2);
    expect(state.draft!.weapon!.secondaryGrip).toBeDefined();
    state = reduceWeaponUi(state, { type: "undo" }, body, binding, skeleton);
    expect(state.draft!.weapon!.holdMode).toBe("one_hand");
    expect(state.draft!.occupiedSlots).toEqual(["slot-hand-r"]);
  });

  test("weapon diagnostics reuse pure two-bone IK for unreachable secondary grip", () => {
    const ikSkeleton: Skeleton = {
      ...skeleton,
      bones: [
        { id: "root", name: "Root", parentId: null, rest: transform },
        { id: "upper_r", name: "Upper R", parentId: "root", rest: { ...transform, translation: [8, 10, 0] } },
        { id: "lower_r", name: "Lower R", parentId: "upper_r", rest: { ...transform, translation: [10, 0, 0] } },
        { id: "hand_r", name: "Hand R", parentId: "lower_r", rest: { ...transform, translation: [10, 0, 0] } },
        { id: "upper_l", name: "Upper L", parentId: "root", rest: { ...transform, translation: [0, 10, 0] } },
        { id: "lower_l", name: "Lower L", parentId: "upper_l", rest: { ...transform, translation: [10, 0, 0] } },
        { id: "hand_l", name: "Hand L", parentId: "lower_l", rest: { ...transform, translation: [10, 0, 0] } },
      ],
    };
    const rifle = createEmptyWeapon("wpn-ik", "IK Rifle", body, {
      holdMode: "two_hand",
      preferredPrimaryHand: "right",
    });
    rifle.weapon!.primaryGrip = transform;
    rifle.weapon!.secondaryGrip = { ...transform, translation: [200, 0, 0] };
    rifle.weapon!.secondaryHandConstraint = {
      id: "ik-secondary",
      upperBoneId: "upper_l",
      lowerBoneId: "lower_l",
      endBoneId: "hand_l",
      targetSocket: "sock-hand-l",
      bendDirection: "positive",
      mix: 1,
      stretch: "forbid",
    };
    const issues = diagnoseWeaponTwoHandIk(rifle, body, ikSkeleton);
    expect(issues.some((issue) => issue.message.includes("unreachable") || issue.path.includes("secondaryHandConstraint"))).toBeTrue();
  });
});
