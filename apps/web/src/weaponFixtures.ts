import {
  EQUIPMENT_SCHEMA_VERSION,
  type BodyProfile,
  type EquipmentDefinition,
  type Transform,
} from "@framebaker/shared";
import { createEmptyWeapon } from "./weaponUiState";

const transform: Transform = {
  translation: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

/** Deterministic BodyProfile with hand slots/sockets for weapon UI fixtures. */
export function createWeaponFixtureBody(skeletonId = "hero"): BodyProfile {
  return {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id: "weapon-fixture-body",
    name: "Weapon Fixture Body",
    skeletonId,
    mirrorAxis: "x",
    slots: [
      { id: "slot-hand-r", semantic: "hand_right", capacity: 1, accepts: ["weapon"] },
      { id: "slot-hand-l", semantic: "hand_left", capacity: 1, accepts: ["weapon"] },
    ],
    sockets: [
      {
        id: "sock-hand-r",
        semantic: "weapon_hand_right",
        boneId: "hand_r",
        rest: { ...transform, translation: [6, 0, 0] },
        accepts: ["weapon"],
        mirrorSocketId: "sock-hand-l",
      },
      {
        id: "sock-hand-l",
        semantic: "weapon_hand_left",
        boneId: "hand_l",
        rest: { ...transform, translation: [-6, 0, 0] },
        accepts: ["weapon"],
        mirrorSocketId: "sock-hand-r",
      },
      {
        id: "sock-muzzle",
        semantic: "custom:muzzle",
        boneId: "hand_r",
        rest: { ...transform, translation: [14, 2, 0] },
        accepts: ["effect"],
      },
    ],
  };
}

/**
 * Fixed sample weapons for deterministic tests and creator smoke paths.
 * Not production game content.
 */
export function createWeaponSampleFixtures(skeletonId = "hero"): EquipmentDefinition[] {
  const body = createWeaponFixtureBody(skeletonId);

  const rifle = createEmptyWeapon("fx-rifle", "Sample Rifle", body, {
    holdMode: "two_hand",
    preferredPrimaryHand: "right",
  });
  rifle.weapon = {
    holdMode: "two_hand",
    preferredPrimaryHand: "right",
    mirrorAllowed: true,
    primaryGrip: { ...transform, translation: [2, 0, 0] },
    secondaryGrip: { ...transform, translation: [-6, 1, 0] },
    muzzleSocket: { ...transform, translation: [14, 2, 0] },
    ejectSocket: { ...transform, translation: [4, 3, 0] },
    stanceProfile: "rifle_two_hand",
    recoilProfile: "rifle_recoil",
    secondaryHandConstraint: {
      id: "ik-rifle-secondary",
      upperBoneId: "upper_l",
      lowerBoneId: "lower_l",
      endBoneId: "hand_l",
      targetSocket: "sock-hand-l",
      bendDirection: "positive",
      mix: 1,
      stretch: "forbid",
    },
  };

  const pistolR = createEmptyWeapon("fx-pistol-r", "Sample Pistol R", body, {
    holdMode: "one_hand",
    preferredPrimaryHand: "right",
  });
  pistolR.weapon = {
    holdMode: "one_hand",
    preferredPrimaryHand: "right",
    mirrorAllowed: true,
    primaryGrip: { ...transform, translation: [1, 0, 0] },
    muzzleSocket: { ...transform, translation: [8, 1, 0] },
    stanceProfile: "pistol_one_hand",
  };

  const pistolL = createEmptyWeapon("fx-pistol-l", "Sample Pistol L", body, {
    holdMode: "one_hand",
    preferredPrimaryHand: "left",
  });
  pistolL.weapon = {
    holdMode: "one_hand",
    preferredPrimaryHand: "left",
    mirrorAllowed: true,
    primaryGrip: { ...transform, translation: [-1, 0, 0] },
    muzzleSocket: { ...transform, translation: [-8, 1, 0] },
    stanceProfile: "pistol_one_hand",
  };

  const conflict = createEmptyWeapon("fx-weapon-conflict", "Sample Conflict Blade", body, {
    holdMode: "one_hand",
    preferredPrimaryHand: "left",
  });
  conflict.tags = ["weapon", "blade"];
  conflict.conflictTags = ["weapon"];
  conflict.weapon = {
    holdMode: "one_hand",
    preferredPrimaryHand: "left",
    mirrorAllowed: false,
    primaryGrip: transform,
    stanceProfile: "pistol_one_hand",
  };

  return [rifle, pistolR, pistolL, conflict];
}
