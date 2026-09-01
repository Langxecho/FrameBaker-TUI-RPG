import { describe, expect, test } from "bun:test";
import {
  assembleLoadout,
  quaternionFromZRotation,
  type BodyProfile,
  type CharacterBinding,
  type EquipmentDefinition,
  type Skeleton,
} from "../packages/shared/src";
import { createEmptyAttachment } from "../apps/web/src/equipmentUiState";
import { createEquipmentFixtureBody } from "../apps/web/src/equipmentFixtures";
import { createWeaponFixtureBody, createWeaponSampleFixtures } from "../apps/web/src/weaponFixtures";
import { attachmentRestFromComposed, bindingWithAssembledLoadout, composeSocketRest, overlayDraftEquipment } from "../apps/web/src/loadoutPreview";
import { createEmptyWeapon } from "../apps/web/src/weaponUiState";

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
    { id: "hand_r", name: "Hand R", parentId: "root", rest: transform },
    { id: "hand_l", name: "Hand L", parentId: "root", rest: transform },
  ],
};

const equipmentBody = createEquipmentFixtureBody(skeleton.id);
const weaponBody: BodyProfile = createWeaponFixtureBody(skeleton.id);

const binding: CharacterBinding = {
  schemaVersion: 1,
  kind: "character-binding",
  id: "binding",
  name: "Binding",
  skeletonId: skeleton.id,
  slots: [
    { id: "part-arm-l", name: "Arm L", boneId: "root", attachmentId: "att-arm-l", drawOrder: 0 },
    { id: "part-head", name: "Head", boneId: "root", attachmentId: "att-head", drawOrder: 1 },
  ],
  attachments: [
    {
      id: "att-arm-l",
      name: "Arm L",
      type: "region",
      materialId: "mat-arm",
      imageSlot: "raw",
      size: [8, 16],
      pivot: [0.5, 0.5],
      rest: transform,
    },
    {
      id: "att-head",
      name: "Head",
      type: "region",
      materialId: "mat-head",
      imageSlot: "raw",
      size: [12, 12],
      pivot: [0.5, 0.5],
      rest: transform,
    },
  ],
};

function helmet(): EquipmentDefinition {
  return {
    schemaVersion: 1,
    id: "eq-helmet",
    name: "Helmet",
    tags: ["helmet"],
    visualMode: "attached",
    primarySlot: "slot-head",
    occupiedSlots: ["slot-head"],
    conflictTags: [],
    replacesParts: [],
    hidesSlots: [],
    attachments: [{
      ...createEmptyAttachment("att-helmet", "Helmet Shell", "sock-head", "mat-helmet"),
      rest: { translation: [0, 4, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    }],
  };
}

function cyberArm(): EquipmentDefinition {
  return {
    schemaVersion: 1,
    id: "eq-cyber-arm",
    name: "Cyber Arm",
    tags: ["cyberware", "arm"],
    visualMode: "replacement",
    primarySlot: "slot-arm-l",
    occupiedSlots: ["slot-arm-l"],
    conflictTags: [],
    replacesParts: ["part-arm-l"],
    hidesSlots: ["slot-arm-l"],
    attachments: [createEmptyAttachment("att-cyber", "Cyber Shell", "sock-arm-l", "mat-cyber")],
  };
}

describe("bindingWithAssembledLoadout", () => {
  test("wears attached equipment on the socket bone with composed rest", () => {
    const item = helmet();
    const assembled = assembleLoadout(equipmentBody, binding, [item], {
      bodyProfileId: equipmentBody.id,
      equipment: [{ equipmentId: item.id, primarySlot: item.primarySlot }],
    });
    expect(assembled.ok).toBeTrue();
    const preview = bindingWithAssembledLoadout(binding, equipmentBody, assembled.value!);
    const slot = preview.slots.find((entry) => entry.attachmentId === "att-helmet");
    expect(slot?.boneId).toBe("root");
    const attachment = preview.attachments.find((entry) => entry.id === "att-helmet");
    expect(attachment?.type).toBe("region");
    expect(attachment?.rest.translation[1]).toBe(4);
    expect(preview.slots.some((entry) => entry.id === "part-head")).toBeTrue();
  });

  test("drawOffset -1 tucks equipment under the limb on the socket bone", () => {
    const handed: CharacterBinding = {
      ...binding,
      slots: [
        { id: "part-torso", name: "Torso", boneId: "root", attachmentId: "att-arm-l", drawOrder: 0 },
        { id: "part-hand-r", name: "Hand R", boneId: "hand_r", attachmentId: "att-head", drawOrder: 1 },
      ],
    };
    const glove: EquipmentDefinition = {
      schemaVersion: 1,
      id: "eq-glove",
      name: "Glove",
      tags: ["weapon"],
      visualMode: "attached",
      primarySlot: "slot-hand-r",
      occupiedSlots: ["slot-hand-r"],
      conflictTags: [],
      replacesParts: [],
      hidesSlots: [],
      attachments: [{
        ...createEmptyAttachment("att-glove", "Glove", "sock-hand-r", "mat-glove"),
        drawOffset: -1,
      }],
    };
    const body = createWeaponFixtureBody(skeleton.id);
    const assembled = assembleLoadout(body, handed, [glove], {
      bodyProfileId: body.id,
      equipment: [{ equipmentId: glove.id, primarySlot: glove.primarySlot }],
    });
    expect(assembled.ok).toBeTrue();
    const preview = bindingWithAssembledLoadout(handed, body, assembled.value!);
    const ids = [...preview.slots].sort((a, b) => a.drawOrder - b.drawOrder).map((entry) => entry.attachmentId);
    expect(ids).toEqual(["att-arm-l", "att-glove", "att-head"]);
  });

  test("hides replaced base parts unless showHiddenBase is on", () => {
    const item = cyberArm();
    const assembled = assembleLoadout(equipmentBody, binding, [item], {
      bodyProfileId: equipmentBody.id,
      equipment: [{ equipmentId: item.id, primarySlot: item.primarySlot }],
    });
    expect(assembled.ok).toBeTrue();
    const hidden = bindingWithAssembledLoadout(binding, equipmentBody, assembled.value!);
    expect(hidden.slots.some((entry) => entry.id === "part-arm-l")).toBeFalse();
    expect(hidden.attachments.some((entry) => entry.id === "att-arm-l")).toBeFalse();
    expect(hidden.attachments.some((entry) => entry.id === "att-cyber")).toBeTrue();

    const shown = bindingWithAssembledLoadout(binding, equipmentBody, assembled.value!, { showHiddenBase: true });
    expect(shown.slots.some((entry) => entry.id === "part-arm-l")).toBeTrue();
  });

  test("isolateSelected keeps only the chosen equipment attachments", () => {
    const item = helmet();
    const assembled = assembleLoadout(equipmentBody, binding, [item], {
      bodyProfileId: equipmentBody.id,
      equipment: [{ equipmentId: item.id, primarySlot: item.primarySlot }],
    });
    const preview = bindingWithAssembledLoadout(binding, equipmentBody, assembled.value!, {
      isolateAttachmentIds: ["att-helmet"],
    });
    expect(preview.slots.map((entry) => entry.attachmentId)).toEqual(["att-helmet"]);
    expect(preview.attachments.map((entry) => entry.id)).toEqual(["att-helmet"]);
  });

  test("dual-wield pistols appear on both hand bones", () => {
    const fixtures = createWeaponSampleFixtures(skeleton.id);
    const assembled = assembleLoadout(weaponBody, binding, fixtures, {
      bodyProfileId: weaponBody.id,
      equipment: [
        { equipmentId: "fx-pistol-r", primarySlot: "slot-hand-r" },
        { equipmentId: "fx-pistol-l", primarySlot: "slot-hand-l" },
      ],
    });
    expect(assembled.ok).toBeTrue();
    const preview = bindingWithAssembledLoadout(binding, weaponBody, assembled.value!);
    const right = preview.slots.find((entry) => entry.boneId === "hand_r");
    const left = preview.slots.find((entry) => entry.boneId === "hand_l");
    expect(right).toBeDefined();
    expect(left).toBeDefined();
    expect(right?.attachmentId).not.toBe(left?.attachmentId);
    expect(preview.attachments.filter((entry) => entry.id.startsWith("att-pistol") || entry.name.toLowerCase().includes("pistol")).length).toBeGreaterThanOrEqual(2);
  });

  test("two-hand rifle occupies both slots and keeps a single visual on the primary hand", () => {
    const fixtures = createWeaponSampleFixtures(skeleton.id);
    const rifle = fixtures.find((item) => item.id === "fx-rifle")!;
    expect(rifle.occupiedSlots.sort()).toEqual(["slot-hand-l", "slot-hand-r"]);
    const assembled = assembleLoadout(weaponBody, binding, fixtures, {
      bodyProfileId: weaponBody.id,
      equipment: [{ equipmentId: "fx-rifle", primarySlot: "slot-hand-r" }],
    });
    expect(assembled.ok).toBeTrue();
    expect([...(assembled.value!.occupiedSlots)].sort()).toEqual(["slot-hand-l", "slot-hand-r"]);
    const preview = bindingWithAssembledLoadout(binding, weaponBody, assembled.value!);
    const rifleSlots = preview.slots.filter((entry) => preview.attachments.some((att) => att.id === entry.attachmentId && att.name.toLowerCase().includes("rifle")));
    expect(rifleSlots.length).toBe(1);
    expect(rifleSlots[0]?.boneId).toBe("hand_r");
  });
});

describe("createEmptyWeapon visuals", () => {
  test("new one-hand weapons get a default attachment on the preferred hand socket", () => {
    const right = createEmptyWeapon("wpn-r", "Right Pistol", weaponBody, {
      holdMode: "one_hand",
      preferredPrimaryHand: "right",
    });
    expect(right.attachments).toHaveLength(1);
    expect(right.attachments[0]?.socket).toBe("sock-hand-r");
    const left = createEmptyWeapon("wpn-l", "Left Pistol", weaponBody, {
      holdMode: "one_hand",
      preferredPrimaryHand: "left",
    });
    expect(left.attachments[0]?.socket).toBe("sock-hand-l");
  });
});

describe("equipment attachment rest roundtrip", () => {
  test("composed preview rest converts back to attachment-local rest", () => {
    const socketRest = {
      translation: [6, 2, 0] as [number, number, number],
      rotation: quaternionFromZRotation(0.3),
      scale: [1, 1, 1] as [number, number, number],
    };
    const local = {
      translation: [12, -4, 0] as [number, number, number],
      rotation: quaternionFromZRotation(-0.15),
      scale: [1.75, 1.75, 1] as [number, number, number],
    };
    const composed = composeSocketRest(socketRest, local);
    const roundtrip = attachmentRestFromComposed(socketRest, composed);
    expect(roundtrip.translation[0]).toBeCloseTo(local.translation[0], 5);
    expect(roundtrip.translation[1]).toBeCloseTo(local.translation[1], 5);
    expect(roundtrip.scale[0]).toBeCloseTo(local.scale[0], 5);
    expect(roundtrip.scale[1]).toBeCloseTo(local.scale[1], 5);
  });
});

describe("overlayDraftEquipment", () => {
  test("shows the wizard draft without try-on", () => {
    const item = helmet();
    const overlay = overlayDraftEquipment(null, item, equipmentBody.id);
    expect(overlay.attachments.map((entry) => entry.id)).toEqual(["att-helmet"]);
    const preview = bindingWithAssembledLoadout(binding, equipmentBody, overlay);
    expect(preview.attachments.some((entry) => entry.id === "att-helmet")).toBeTrue();
    expect(preview.slots.some((entry) => entry.attachmentId === "att-helmet")).toBeTrue();
  });

  test("replaces assembled copies with the live draft", () => {
    const item = helmet();
    const assembled = assembleLoadout(equipmentBody, binding, [item], {
      bodyProfileId: equipmentBody.id,
      equipment: [{ equipmentId: item.id, primarySlot: item.primarySlot }],
    });
    expect(assembled.ok).toBeTrue();
    const edited = helmet();
    edited.attachments[0]!.rest = { translation: [0, 12, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
    const overlay = overlayDraftEquipment(assembled.value!, edited, equipmentBody.id);
    expect(overlay.attachments).toHaveLength(1);
    expect(overlay.attachments[0]?.rest.translation[1]).toBe(12);
  });
});
