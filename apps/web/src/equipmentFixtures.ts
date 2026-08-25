import {
  EQUIPMENT_SCHEMA_VERSION,
  type BodyProfile,
  type EquipmentDefinition,
} from "@framebaker/shared";
import { createEmptyAttachment } from "./equipmentUiState";

const transform = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};

/** Deterministic sample BodyProfile used only by equipment UI fixture tests. */
export function createEquipmentFixtureBody(skeletonId = "hero"): BodyProfile {
  return {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id: "fixture-body",
    name: "Fixture Body",
    skeletonId,
    mirrorAxis: "x",
    slots: [
      { id: "slot-head", semantic: "head", capacity: 1, accepts: ["helmet"] },
      { id: "slot-eye", semantic: "face", capacity: 2, accepts: ["eye", "cyberware"] },
      { id: "slot-arm-l", semantic: "arm_left", capacity: 1, accepts: ["cyberware", "arm"] },
      { id: "slot-arm-r", semantic: "arm_right", capacity: 1, accepts: ["cyberware", "arm"] },
      { id: "slot-back", semantic: "back", capacity: 1, accepts: ["device", "backpack"] },
      { id: "slot-internal", semantic: "chest", capacity: 4, accepts: ["chip", "internal"] },
      { id: "slot-effect", semantic: "chest", capacity: 8, accepts: ["effect"] },
    ],
    sockets: [
      { id: "sock-head", semantic: "head", boneId: "root", rest: transform, accepts: ["helmet"] },
      { id: "sock-eye-l", semantic: "eye_left", boneId: "root", rest: { ...transform, translation: [-4, 12, 0] }, accepts: ["eye"], mirrorSocketId: "sock-eye-r" },
      { id: "sock-eye-r", semantic: "eye_right", boneId: "root", rest: { ...transform, translation: [4, 12, 0] }, accepts: ["eye"], mirrorSocketId: "sock-eye-l" },
      { id: "sock-arm-l", semantic: "arm_left", boneId: "root", rest: transform, accepts: ["cyberware"] },
      { id: "sock-arm-r", semantic: "arm_right", boneId: "root", rest: transform, accepts: ["cyberware"] },
      { id: "sock-back", semantic: "back", boneId: "root", rest: transform, accepts: ["device"] },
      { id: "sock-chest", semantic: "chest", boneId: "root", rest: transform, accepts: ["chip", "effect"] },
    ],
  };
}

function base(id: string, name: string, tags: string[], visualMode: EquipmentDefinition["visualMode"], primarySlot: string, occupiedSlots: string[]): EquipmentDefinition {
  return {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id,
    name,
    tags,
    visualMode,
    primarySlot,
    occupiedSlots,
    conflictTags: [],
    replacesParts: [],
    hidesSlots: [],
    attachments: [],
    effectBindings: [],
    actionOverrides: {},
  };
}

/**
 * Fixed sample equipment assets for deterministic tests and creator smoke paths.
 * Not production game content.
 */
export function createEquipmentSampleFixtures(): EquipmentDefinition[] {
  const helmet = base("fx-helmet", "Sample Helmet", ["helmet"], "attached", "slot-head", ["slot-head"]);
  helmet.attachments = [createEmptyAttachment("att-helmet", "Helmet Shell", "sock-head", "mat-helmet")];

  const monoEye = base("fx-eye-mono", "Sample Monocular Eye", ["eye", "cyberware"], "attached", "slot-eye", ["slot-eye"]);
  monoEye.attachments = [createEmptyAttachment("att-eye-l", "Mono Lens", "sock-eye-l", "mat-eye")];

  const binocEye = base("fx-eye-binoc", "Sample Binocular Eyes", ["eye", "cyberware"], "attached", "slot-eye", ["slot-eye"]);
  binocEye.attachments = [
    createEmptyAttachment("att-eye-bl", "Binoc L", "sock-eye-l", "mat-eye"),
    createEmptyAttachment("att-eye-br", "Binoc R", "sock-eye-r", "mat-eye"),
  ];

  const cyberArm = base("fx-cyber-arm", "Sample Cyber Arm", ["cyberware", "arm"], "replacement", "slot-arm-l", ["slot-arm-l"]);
  cyberArm.replacesParts = ["part-arm-l"];
  cyberArm.hidesSlots = ["slot-arm-l"];
  cyberArm.attachments = [createEmptyAttachment("att-cyber-arm", "Cyber Arm", "sock-arm-l", "mat-arm")];

  const backDevice = base("fx-back-device", "Sample Back Device", ["device"], "attached", "slot-back", ["slot-back"]);
  backDevice.attachments = [createEmptyAttachment("att-back", "Back Pack", "sock-back", "mat-back")];

  const internalChip = base("fx-chip", "Sample Internal Chip", ["chip", "internal"], "none", "slot-internal", ["slot-internal"]);

  const eventEffect = base("fx-effect", "Sample Event Effect", ["effect"], "effect", "slot-effect", ["slot-effect"]);
  eventEffect.effectBindings = [{ event: "weapon.fire", effectId: "muzzle-flash", socket: "sock-chest" }];

  return [helmet, monoEye, binocEye, cyberArm, backDevice, internalChip, eventEffect];
}
