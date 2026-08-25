/**
 * Canonical fbanim-v3 contract fixtures (equipment / weapon / action slices).
 * Pure builders: no storage/ writes; used by generator and parity tests.
 */
import {
  assembleLoadout,
  buildFbanimV3Entries,
  EQUIPMENT_SCHEMA_VERSION,
  multiplyMatrices,
  sampleMotionClip,
  sha256Digest,
  transformToMatrix,
  type ActionTemplate,
  type BodyProfile,
  type CharacterBinding,
  type CharacterLoadout,
  type EquipmentDefinition,
  type MotionClip,
  type Skeleton,
  type Transform,
} from "@framebaker/shared";
import { solidTexturePng } from "./fixturePng";
import {
  type FixtureExpected,
  type FixtureExpectedMatrix,
  type FixtureExpectedPixelSample,
  type FixtureExpectedPixels,
  type FixtureExpectedSlot,
  type FixtureExpectedSocket,
} from "./minimalRegionFixture";
import { exportFixtureZipEntries } from "./skeletalExport";

const IDENTITY: Transform = {
  translation: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

function cloneT(t: Transform = IDENTITY): Transform {
  return {
    translation: [...t.translation] as [number, number, number],
    rotation: [...t.rotation] as [number, number, number, number],
    scale: [...t.scale] as [number, number, number],
  };
}

function tAt(x: number, y: number, z = 0): Transform {
  return { ...cloneT(), translation: [x, y, z] };
}

export const CONTRACT_FIXTURE_IDS = [
  "eye-attachment",
  "binocular-eye-multislot",
  "cyber-arm-replacement",
  "internal-chip-none",
  "equipment-effect",
  "rifle-right-primary",
  "rifle-left-primary",
  "dual-pistol",
  "conflicting-loadout",
  "action-event-boundary",
] as const;

export type ContractFixtureId = (typeof CONTRACT_FIXTURE_IDS)[number];

export interface ContractFixtureDomain {
  fixtureId: ContractFixtureId;
  skeleton: Skeleton;
  binding: CharacterBinding;
  body: BodyProfile;
  equipment: EquipmentDefinition[];
  loadout: CharacterLoadout;
  /** When true, loadout is intentionally invalid; expected uses empty equip assembly. */
  loadoutInvalid: boolean;
  actions: Array<{
    id: string;
    name: string;
    motionClip: MotionClip;
    speed: number;
    repeat: number;
    loop: boolean;
    fallbackAction?: string;
  }>;
  actionProfiles: ActionTemplate[];
  actionSteps: Array<{ actionId: string; time: number }>;
  textures: Array<{ attachmentId: string; bytes: Uint8Array; rgba: Uint8Array; size: number; color: [number, number, number, number] }>;
  note: string;
}

function solid(size: number, color: [number, number, number, number]) {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = color[3];
  }
  return { bytes: solidTexturePng(size, color), rgba, size, color };
}

function baseSkeleton(id: string, bones: Skeleton["bones"]): Skeleton {
  return {
    schemaVersion: 1,
    kind: "skeleton",
    id,
    name: id,
    coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "pixel" },
    bones,
  };
}

function regionAttachment(
  id: string,
  name: string,
  materialId: string,
  size: number,
  rest: Transform = cloneT(),
): CharacterBinding["attachments"][number] {
  return {
    id,
    name,
    type: "region",
    materialId,
    imageSlot: "raw",
    size: [size, size],
    pivot: [0.5, 0.5],
    rest,
  };
}

function equipAttachment(
  id: string,
  name: string,
  socket: string,
  materialId: string,
  size: number,
  rest: Transform = cloneT(),
  drawOffset = 0,
) {
  return {
    id,
    name,
    socket,
    materialId,
    imageSlot: "raw" as const,
    size: [size, size] as [number, number],
    pivot: [0.5, 0.5] as [number, number],
    rest,
    drawGroup: "equipment",
    drawOffset,
  };
}

function idleClip(skeletonId: string, id = "idle", events: MotionClip["events"] = []): MotionClip {
  return {
    schemaVersion: 1,
    kind: "motion-clip",
    id,
    name: id,
    skeletonId,
    duration: 1,
    loop: true,
    tracks: [],
    events,
  };
}

function heroBones(): Skeleton["bones"] {
  return [
    { id: "root", name: "Root", parentId: null, rest: cloneT() },
    { id: "upper_r", name: "UpperR", parentId: "root", rest: tAt(4, 8, 0) },
    { id: "lower_r", name: "LowerR", parentId: "upper_r", rest: tAt(6, 0, 0) },
    { id: "hand_r", name: "HandR", parentId: "lower_r", rest: tAt(6, 0, 0) },
    { id: "upper_l", name: "UpperL", parentId: "root", rest: tAt(-4, 8, 0) },
    { id: "lower_l", name: "LowerL", parentId: "upper_l", rest: tAt(-6, 0, 0) },
    { id: "hand_l", name: "HandL", parentId: "lower_l", rest: tAt(-6, 0, 0) },
  ];
}

function equipmentBody(skeletonId: string): BodyProfile {
  return {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id: "contract-body",
    name: "Contract Body",
    skeletonId,
    mirrorAxis: "x",
    slots: [
      { id: "slot-head", semantic: "head", capacity: 1, accepts: ["helmet"] },
      { id: "slot-eye-l", semantic: "eye_left", capacity: 1, accepts: ["eye", "cyberware"] },
      { id: "slot-eye-r", semantic: "eye_right", capacity: 1, accepts: ["eye", "cyberware"] },
      { id: "slot-arm-l", semantic: "arm_left", capacity: 1, accepts: ["cyberware", "arm"] },
      { id: "slot-arm-r", semantic: "arm_right", capacity: 1, accepts: ["cyberware", "arm"] },
      { id: "slot-internal", semantic: "chest", capacity: 4, accepts: ["chip", "internal"] },
      { id: "slot-effect", semantic: "chest", capacity: 8, accepts: ["effect"] },
      { id: "slot-hand-r", semantic: "hand_right", capacity: 1, accepts: ["weapon"] },
      { id: "slot-hand-l", semantic: "hand_left", capacity: 1, accepts: ["weapon"] },
    ],
    sockets: [
      { id: "sock-head", semantic: "head", boneId: "root", rest: tAt(0, 14, 0), accepts: ["helmet"] },
      {
        id: "sock-eye-l",
        semantic: "eye_left",
        boneId: "root",
        rest: tAt(-3, 12, 0),
        accepts: ["eye"],
        mirrorSocketId: "sock-eye-r",
      },
      {
        id: "sock-eye-r",
        semantic: "eye_right",
        boneId: "root",
        rest: tAt(3, 12, 0),
        accepts: ["eye"],
        mirrorSocketId: "sock-eye-l",
      },
      { id: "sock-arm-l", semantic: "arm_left", boneId: "upper_l", rest: cloneT(), accepts: ["cyberware"] },
      { id: "sock-arm-r", semantic: "arm_right", boneId: "upper_r", rest: cloneT(), accepts: ["cyberware"] },
      { id: "sock-chest", semantic: "chest", boneId: "root", rest: tAt(0, 6, 0), accepts: ["chip", "effect"] },
      {
        id: "sock-hand-r",
        semantic: "weapon_hand_right",
        boneId: "hand_r",
        rest: tAt(2, 0, 0),
        accepts: ["weapon"],
        mirrorSocketId: "sock-hand-l",
      },
      {
        id: "sock-hand-l",
        semantic: "weapon_hand_left",
        boneId: "hand_l",
        rest: tAt(-2, 0, 0),
        accepts: ["weapon"],
        mirrorSocketId: "sock-hand-r",
      },
    ],
  };
}

function baseBinding(skeletonId: string, texSize: number, extraSlots: CharacterBinding["slots"] = []): CharacterBinding {
  const body = regionAttachment("body-region", "Body", "mat-body", texSize);
  const armL = regionAttachment("part-arm-l", "ArmL", "mat-arm-l", texSize, tAt(-4, 0, 0));
  const armR = regionAttachment("part-arm-r", "ArmR", "mat-arm-r", texSize, tAt(4, 0, 0));
  const eyeL = regionAttachment("part-eye-l", "EyeL", "mat-eye-base-l", 8, tAt(-3, 0, 0));
  const eyeR = regionAttachment("part-eye-r", "EyeR", "mat-eye-base-r", 8, tAt(3, 0, 0));
  return {
    schemaVersion: 1,
    kind: "character-binding",
    id: "contract-binding",
    name: "Contract",
    skeletonId,
    attachments: [body, armL, armR, eyeL, eyeR],
    slots: [
      { id: "body-slot", name: "Body", boneId: "root", attachmentId: "body-region", drawOrder: 0 },
      { id: "part-arm-l", name: "ArmL", boneId: "upper_l", attachmentId: "part-arm-l", drawOrder: 1 },
      { id: "part-arm-r", name: "ArmR", boneId: "upper_r", attachmentId: "part-arm-r", drawOrder: 2 },
      { id: "part-eye-l", name: "EyeL", boneId: "root", attachmentId: "part-eye-l", drawOrder: 3 },
      { id: "part-eye-r", name: "EyeR", boneId: "root", attachmentId: "part-eye-r", drawOrder: 4 },
      ...extraSlots,
    ],
  };
}

function textureMap(
  binding: CharacterBinding,
  equipment: EquipmentDefinition[],
  colors: Record<string, [number, number, number, number]>,
  defaultSize = 16,
): ContractFixtureDomain["textures"] {
  const out: ContractFixtureDomain["textures"] = [];
  const add = (attachmentId: string, size: number, color: [number, number, number, number]) => {
    const s = solid(size, color);
    out.push({ attachmentId, bytes: s.bytes, rgba: s.rgba, size: s.size, color: s.color });
  };
  for (const a of binding.attachments) {
    const size = a.size[0] ?? defaultSize;
    add(a.id, size, colors[a.id] ?? [200, 200, 200, 255]);
  }
  for (const item of equipment) {
    for (const a of item.attachments) {
      if (out.some((t) => t.attachmentId === a.id)) continue;
      const size = a.size[0] ?? defaultSize;
      add(a.id, size, colors[a.id] ?? [80, 160, 220, 255]);
    }
  }
  return out;
}

function domainShell(
  fixtureId: ContractFixtureId,
  note: string,
  opts: {
    skeleton: Skeleton;
    binding: CharacterBinding;
    body: BodyProfile;
    equipment: EquipmentDefinition[];
    loadout: CharacterLoadout;
    loadoutInvalid?: boolean;
    actions?: ContractFixtureDomain["actions"];
    actionProfiles?: ActionTemplate[];
    actionSteps?: Array<{ actionId: string; time: number }>;
    colors?: Record<string, [number, number, number, number]>;
  },
): ContractFixtureDomain {
  const actions =
    opts.actions ??
    [
      {
        id: "idle",
        name: "Idle",
        motionClip: idleClip(opts.skeleton.id),
        speed: 1,
        repeat: 1,
        loop: true,
      },
    ];
  return {
    fixtureId,
    skeleton: opts.skeleton,
    binding: opts.binding,
    body: opts.body,
    equipment: opts.equipment,
    loadout: opts.loadout,
    loadoutInvalid: opts.loadoutInvalid ?? false,
    actions,
    actionProfiles: opts.actionProfiles ?? [],
    actionSteps: opts.actionSteps ?? [{ actionId: actions[0]!.id, time: 0 }],
    textures: textureMap(opts.binding, opts.equipment, opts.colors ?? {}),
    note,
  };
}

function buildEyeAttachment(): ContractFixtureDomain {
  const skeleton = baseSkeleton("contract-sk", heroBones());
  const body = equipmentBody(skeleton.id);
  const binding = baseBinding(skeleton.id, 16);
  const mono: EquipmentDefinition = {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id: "eq-eye-mono",
    name: "Monocular Cyber Eye",
    tags: ["eye", "cyberware"],
    visualMode: "attached",
    primarySlot: "slot-eye-l",
    occupiedSlots: ["slot-eye-l"],
    conflictTags: [],
    replacesParts: [],
    hidesSlots: [],
    attachments: [equipAttachment("att-eye-mono", "Mono Lens", "sock-eye-l", "mat-eye-mono", 8)],
    effectBindings: [],
    actionOverrides: {},
  };
  return domainShell("eye-attachment", "monocular cyber-eye attached to eye_left", {
    skeleton,
    binding,
    body,
    equipment: [mono],
    loadout: { bodyProfileId: body.id, equipment: [{ equipmentId: mono.id, primarySlot: mono.primarySlot }] },
    colors: {
      "body-region": [200, 200, 200, 255],
      "att-eye-mono": [40, 200, 255, 255],
    },
  });
}

function buildBinocular(): ContractFixtureDomain {
  const skeleton = baseSkeleton("contract-sk", heroBones());
  const body = equipmentBody(skeleton.id);
  const binding = baseBinding(skeleton.id, 16);
  const binoc: EquipmentDefinition = {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id: "eq-eye-binoc",
    name: "Binocular Cyber Eyes",
    tags: ["eye", "cyberware"],
    visualMode: "attached",
    primarySlot: "slot-eye-l",
    occupiedSlots: ["slot-eye-l", "slot-eye-r"],
    conflictTags: [],
    replacesParts: ["part-eye-l", "part-eye-r"],
    hidesSlots: [],
    attachments: [
      equipAttachment("att-eye-bl", "Binoc L", "sock-eye-l", "mat-eye-bl", 8),
      equipAttachment("att-eye-br", "Binoc R", "sock-eye-r", "mat-eye-br", 8, cloneT(), 1),
    ],
    effectBindings: [],
    actionOverrides: {},
  };
  return domainShell("binocular-eye-multislot", "binocular eyes occupy both eye slots and replace base eyes", {
    skeleton,
    binding,
    body,
    equipment: [binoc],
    loadout: { bodyProfileId: body.id, equipment: [{ equipmentId: binoc.id, primarySlot: binoc.primarySlot }] },
    colors: {
      "att-eye-bl": [30, 180, 240, 255],
      "att-eye-br": [30, 180, 240, 255],
    },
  });
}

function buildCyberArm(): ContractFixtureDomain {
  const skeleton = baseSkeleton("contract-sk", heroBones());
  const body = equipmentBody(skeleton.id);
  const binding = baseBinding(skeleton.id, 16);
  const arm: EquipmentDefinition = {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id: "eq-cyber-arm",
    name: "Cyber Arm L",
    tags: ["cyberware", "arm"],
    visualMode: "replacement",
    primarySlot: "slot-arm-l",
    occupiedSlots: ["slot-arm-l"],
    conflictTags: [],
    replacesParts: ["part-arm-l"],
    hidesSlots: ["slot-arm-l"],
    attachments: [equipAttachment("att-cyber-arm", "Cyber Arm", "sock-arm-l", "mat-cyber-arm", 16)],
    effectBindings: [],
    actionOverrides: {},
  };
  return domainShell("cyber-arm-replacement", "replacement cyber-arm hides base arm part", {
    skeleton,
    binding,
    body,
    equipment: [arm],
    loadout: { bodyProfileId: body.id, equipment: [{ equipmentId: arm.id, primarySlot: arm.primarySlot }] },
    colors: { "att-cyber-arm": [120, 80, 200, 255] },
  });
}

function buildInternalChip(): ContractFixtureDomain {
  const skeleton = baseSkeleton("contract-sk", heroBones());
  const body = equipmentBody(skeleton.id);
  const binding = baseBinding(skeleton.id, 16);
  const chip: EquipmentDefinition = {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id: "eq-chip",
    name: "Internal Chip",
    tags: ["chip", "internal"],
    visualMode: "none",
    primarySlot: "slot-internal",
    occupiedSlots: ["slot-internal"],
    conflictTags: [],
    replacesParts: [],
    hidesSlots: [],
    attachments: [],
    effectBindings: [],
    actionOverrides: {},
  };
  return domainShell("internal-chip-none", "visualMode none internal chip occupies slot without attachment", {
    skeleton,
    binding,
    body,
    equipment: [chip],
    loadout: { bodyProfileId: body.id, equipment: [{ equipmentId: chip.id, primarySlot: chip.primarySlot }] },
  });
}

function buildEquipmentEffect(): ContractFixtureDomain {
  const skeleton = baseSkeleton("contract-sk", heroBones());
  const body = equipmentBody(skeleton.id);
  const binding = baseBinding(skeleton.id, 16);
  const effect: EquipmentDefinition = {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id: "eq-effect",
    name: "Cyberware Overload Effect",
    tags: ["effect"],
    visualMode: "effect",
    primarySlot: "slot-effect",
    occupiedSlots: ["slot-effect"],
    conflictTags: [],
    replacesParts: [],
    hidesSlots: [],
    attachments: [],
    effectBindings: [{ event: "weapon.fire", effectId: "fx-overload", socket: "sock-chest" }],
    actionOverrides: {},
  };
  const fireClip = idleClip(skeleton.id, "fire", [
    { time: 0, type: "weapon.fire", name: "fire" },
    { time: 0.5, type: "effect.spawn", name: "overload" },
  ]);
  return domainShell("equipment-effect", "effect-mode equipment binds weapon.fire presentation", {
    skeleton,
    binding,
    body,
    equipment: [effect],
    loadout: { bodyProfileId: body.id, equipment: [{ equipmentId: effect.id, primarySlot: effect.primarySlot }] },
    actions: [
      { id: "idle", name: "Idle", motionClip: idleClip(skeleton.id), speed: 1, repeat: 1, loop: true },
      { id: "fire", name: "Fire", motionClip: fireClip, speed: 1, repeat: 1, loop: false },
    ],
    actionSteps: [
      { actionId: "fire", time: 0 },
      { actionId: "fire", time: 0.5 },
    ],
  });
}

function weaponProfile(
  id: string,
  name: string,
  hand: "left" | "right",
  holdMode: "one_hand" | "two_hand",
  extra?: Partial<EquipmentDefinition>,
): EquipmentDefinition {
  const primary = hand === "right" ? "slot-hand-r" : "slot-hand-l";
  const secondary = hand === "right" ? "slot-hand-l" : "slot-hand-r";
  const sock = hand === "right" ? "sock-hand-r" : "sock-hand-l";
  const occupied = holdMode === "two_hand" ? [primary, secondary] : [primary];
  const gripSign = hand === "right" ? 1 : -1;
  return {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id,
    name,
    tags: ["weapon"],
    visualMode: "attached",
    primarySlot: primary,
    occupiedSlots: occupied,
    conflictTags: [],
    replacesParts: [],
    hidesSlots: [],
    attachments: [equipAttachment(`att-${id}`, name, sock, `mat-${id}`, 12, tAt(gripSign * 2, 0, 0))],
    effectBindings: [],
    actionOverrides: {},
    weapon: {
      holdMode,
      preferredPrimaryHand: hand,
      mirrorAllowed: true,
      primaryGrip: tAt(gripSign * 1, 0, 0),
      ...(holdMode === "two_hand"
        ? {
            secondaryGrip: tAt(gripSign * -6, 1, 0),
            muzzleSocket: tAt(gripSign * 14, 2, 0),
            ejectSocket: tAt(gripSign * 4, 3, 0),
            stanceProfile: "rifle_two_hand",
            recoilProfile: "rifle_recoil",
            secondaryHandConstraint: {
              id: `ik-${id}-secondary`,
              upperBoneId: hand === "right" ? "upper_l" : "upper_r",
              lowerBoneId: hand === "right" ? "lower_l" : "lower_r",
              endBoneId: hand === "right" ? "hand_l" : "hand_r",
              targetSocket: hand === "right" ? "sock-hand-l" : "sock-hand-r",
              bendDirection: "positive" as const,
              mix: 1,
              stretch: "forbid" as const,
            },
          }
        : {
            muzzleSocket: tAt(gripSign * 8, 1, 0),
            stanceProfile: "pistol_one_hand",
          }),
    },
    ...extra,
  };
}

function buildRifleRight(): ContractFixtureDomain {
  const skeleton = baseSkeleton("contract-sk", heroBones());
  const body = equipmentBody(skeleton.id);
  const binding = baseBinding(skeleton.id, 16);
  const rifle = weaponProfile("eq-rifle-r", "Rifle Right Primary", "right", "two_hand");
  return domainShell("rifle-right-primary", "two-hand rifle preferred primary right", {
    skeleton,
    binding,
    body,
    equipment: [rifle],
    loadout: { bodyProfileId: body.id, equipment: [{ equipmentId: rifle.id, primarySlot: rifle.primarySlot }] },
    colors: { "att-eq-rifle-r": [90, 90, 100, 255] },
  });
}

function buildRifleLeft(): ContractFixtureDomain {
  const skeleton = baseSkeleton("contract-sk", heroBones());
  const body = equipmentBody(skeleton.id);
  const binding = baseBinding(skeleton.id, 16);
  const rifle = weaponProfile("eq-rifle-l", "Rifle Left Primary", "left", "two_hand");
  return domainShell("rifle-left-primary", "two-hand rifle preferred primary left", {
    skeleton,
    binding,
    body,
    equipment: [rifle],
    loadout: { bodyProfileId: body.id, equipment: [{ equipmentId: rifle.id, primarySlot: rifle.primarySlot }] },
    colors: { "att-eq-rifle-l": [90, 90, 100, 255] },
  });
}

function buildDualPistol(): ContractFixtureDomain {
  const skeleton = baseSkeleton("contract-sk", heroBones());
  const body = equipmentBody(skeleton.id);
  const binding = baseBinding(skeleton.id, 16);
  const pr = weaponProfile("eq-pistol-r", "Pistol R", "right", "one_hand");
  const pl = weaponProfile("eq-pistol-l", "Pistol L", "left", "one_hand");
  return domainShell("dual-pistol", "dual one-hand pistols on both hands", {
    skeleton,
    binding,
    body,
    equipment: [pr, pl],
    loadout: {
      bodyProfileId: body.id,
      equipment: [
        { equipmentId: pr.id, primarySlot: pr.primarySlot },
        { equipmentId: pl.id, primarySlot: pl.primarySlot },
      ],
    },
    colors: {
      "att-eq-pistol-r": [160, 140, 80, 255],
      "att-eq-pistol-l": [160, 140, 80, 255],
    },
  });
}

function buildConflictingLoadout(): ContractFixtureDomain {
  const skeleton = baseSkeleton("contract-sk", heroBones());
  const body = equipmentBody(skeleton.id);
  const binding = baseBinding(skeleton.id, 16);
  const pr = weaponProfile("eq-pistol-r", "Pistol R", "right", "one_hand");
  const blade = weaponProfile("eq-conflict-blade", "Conflict Blade", "left", "one_hand", {
    tags: ["weapon", "blade"],
    conflictTags: ["weapon"],
  });
  // Intentionally invalid: conflictTags weapon vs other weapon tag.
  return domainShell("conflicting-loadout", "invalid loadout retained empty equip assembly for diagnostics", {
    skeleton,
    binding,
    body,
    equipment: [pr, blade],
    loadout: {
      bodyProfileId: body.id,
      equipment: [
        { equipmentId: pr.id, primarySlot: pr.primarySlot },
        { equipmentId: blade.id, primarySlot: blade.primarySlot },
      ],
    },
    loadoutInvalid: true,
    colors: {
      "att-eq-pistol-r": [160, 140, 80, 255],
      "att-eq-conflict-blade": [180, 60, 60, 255],
    },
  });
}

function buildActionEventBoundary(): ContractFixtureDomain {
  const skeleton = baseSkeleton("contract-sk", heroBones());
  const body = equipmentBody(skeleton.id);
  const binding = baseBinding(skeleton.id, 16);
  const fireClip: MotionClip = {
    schemaVersion: 1,
    kind: "motion-clip",
    id: "fire",
    name: "Fire",
    skeletonId: skeleton.id,
    duration: 1,
    loop: false,
    tracks: [],
    events: [
      { time: 0, type: "action.start", name: "fire" },
      { time: 0.25, type: "weapon.fire", name: "shot" },
      { time: 0.5, type: "weapon.eject", name: "casing" },
      { time: 1, type: "action.end", name: "fire" },
    ],
  };
  const templates: ActionTemplate[] = [
    {
      id: "fire",
      loop: false,
      requiredTracks: [],
      requiredEvents: ["weapon.fire"],
      allowedEvents: ["action.start", "weapon.fire", "weapon.eject", "action.end"],
      contactRules: [],
      constraintRules: [],
      fallbackAction: "idle",
      defaultInterrupt: "event-boundary",
      defaultBlendMs: 0,
    },
    {
      id: "idle",
      loop: true,
      requiredTracks: [],
      requiredEvents: [],
      allowedEvents: [],
      contactRules: [],
      constraintRules: [],
      defaultInterrupt: "immediate",
      defaultBlendMs: 0,
    },
  ];
  return domainShell("action-event-boundary", "fire action events with declared idle fallback", {
    skeleton,
    binding,
    body,
    equipment: [],
    loadout: { bodyProfileId: body.id, equipment: [] },
    actions: [
      { id: "idle", name: "Idle", motionClip: idleClip(skeleton.id), speed: 1, repeat: 1, loop: true },
      {
        id: "fire",
        name: "Fire",
        motionClip: fireClip,
        speed: 1,
        repeat: 1,
        loop: false,
        fallbackAction: "idle",
      },
    ],
    actionProfiles: templates,
    actionSteps: [
      { actionId: "fire", time: 0 },
      { actionId: "fire", time: 0.25 },
      { actionId: "fire", time: 0.5 },
      { actionId: "fire", time: 1 },
    ],
  });
}

const BUILDERS: Record<ContractFixtureId, () => ContractFixtureDomain> = {
  "eye-attachment": buildEyeAttachment,
  "binocular-eye-multislot": buildBinocular,
  "cyber-arm-replacement": buildCyberArm,
  "internal-chip-none": buildInternalChip,
  "equipment-effect": buildEquipmentEffect,
  "rifle-right-primary": buildRifleRight,
  "rifle-left-primary": buildRifleLeft,
  "dual-pistol": buildDualPistol,
  "conflicting-loadout": buildConflictingLoadout,
  "action-event-boundary": buildActionEventBoundary,
};

export function buildContractFixtureDomain(id: ContractFixtureId): ContractFixtureDomain {
  return BUILDERS[id]();
}

function socketWorld(boneWorld: number[], socketRest: Transform): { world: number[]; position: [number, number, number] } {
  const world = multiplyMatrices(boneWorld as never, transformToMatrix(socketRest));
  return {
    world: [...world],
    position: [world[12]!, world[13]!, world[14]!],
  };
}

function pixelSamples(size: number, color: [number, number, number, number]): FixtureExpectedPixelSample[] {
  const w = size;
  const h = size;
  return [
    { x: 0, y: 0, rgba: [...color] as [number, number, number, number] },
    { x: w - 1, y: 0, rgba: [...color] as [number, number, number, number] },
    { x: 0, y: h - 1, rgba: [...color] as [number, number, number, number] },
    { x: w - 1, y: h - 1, rgba: [...color] as [number, number, number, number] },
    {
      x: Math.floor(w / 2),
      y: Math.floor(h / 2),
      rgba: [...color] as [number, number, number, number],
    },
  ];
}

export interface ContractFixtureExpected extends FixtureExpected {
  effects?: Array<{ event: string; effectId: string; socket?: string }>;
  hiddenParts?: string[];
  occupiedSlots?: string[];
  loadoutValid?: boolean;
  loadoutIssues?: Array<{ path: string; message: string }>;
  fallbackActions?: Record<string, string>;
}

/** Deterministic expected.json for a contract fixture domain. */
export async function buildContractFixtureExpected(domain: ContractFixtureDomain): Promise<ContractFixtureExpected> {
  const matrices: FixtureExpectedMatrix[] = [];
  const sockets: FixtureExpectedSocket[] = [];
  const events: Array<{ time: number; type: string; name: string }> = [];
  const clipById = new Map(domain.actions.map((a) => [a.id, a.motionClip]));

  for (const step of domain.actionSteps) {
    const clip = clipById.get(step.actionId) ?? domain.actions[0]!.motionClip;
    const pose = sampleMotionClip(clip, domain.skeleton, step.time);
    for (const bone of domain.skeleton.bones) {
      const world = pose.worldMatrices[bone.id];
      if (!world) continue;
      matrices.push({ boneId: bone.id, time: step.time, world: [...world] });
    }
    for (const sock of domain.body.sockets) {
      const boneM = pose.worldMatrices[sock.boneId];
      if (!boneM) continue;
      const resolved = socketWorld(boneM, sock.rest);
      sockets.push({
        id: sock.id,
        semantic: sock.semantic,
        boneId: sock.boneId,
        time: step.time,
        position: resolved.position,
        world: resolved.world,
      });
    }
    for (const ev of clip.events) {
      if (Math.abs(ev.time - step.time) < 1e-12) {
        events.push({ time: ev.time, type: ev.type, name: ev.name });
      }
    }
  }

  const effectiveLoadout: CharacterLoadout = domain.loadoutInvalid
    ? { bodyProfileId: domain.body.id, equipment: [] }
    : domain.loadout;
  const assembled = assembleLoadout(domain.body, domain.binding, domain.equipment, effectiveLoadout);
  if (!assembled.ok) {
    throw new Error(`${domain.fixtureId} assemble failed: ${assembled.issues.map((i) => i.message).join("; ")}`);
  }

  const slots: FixtureExpectedSlot[] = domain.binding.slots
    .filter((slot) => assembled.value.visibleParts.includes(slot.id))
    .map((slot) => ({
      id: slot.id,
      attachmentId: slot.attachmentId,
      boneId: slot.boneId,
      drawOrder: slot.drawOrder,
    }))
    .sort((a, b) => a.drawOrder - b.drawOrder || a.id.localeCompare(b.id));

  // Prefer first equipment attachment texture when present; else body-region.
  const equipAtt = assembled.value.attachments[0];
  const pixelSource =
    (equipAtt && domain.textures.find((t) => t.attachmentId === equipAtt.id)) ||
    domain.textures.find((t) => t.attachmentId === domain.binding.attachments[0]!.id)!;

  const samples = pixelSamples(pixelSource.size, pixelSource.color);
  for (const sample of samples) {
    const idx = (sample.y * pixelSource.size + sample.x) * 4;
    const got = [
      pixelSource.rgba[idx]!,
      pixelSource.rgba[idx + 1]!,
      pixelSource.rgba[idx + 2]!,
      pixelSource.rgba[idx + 3]!,
    ];
    if (got.some((v, i) => v !== sample.rgba[i])) {
      throw new Error(`${domain.fixtureId} pixel sample mismatch at (${sample.x},${sample.y})`);
    }
  }
  const checksum = await sha256Digest(pixelSource.rgba);
  const pixels: FixtureExpectedPixels = {
    attachmentId: pixelSource.attachmentId,
    width: pixelSource.size,
    height: pixelSource.size,
    checksum,
    samples,
  };

  matrices.sort((a, b) => a.time - b.time || a.boneId.localeCompare(b.boneId));
  sockets.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  events.sort((a, b) => a.time - b.time || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  const fallbackActions: Record<string, string> = {};
  for (const a of domain.actions) {
    if (a.fallbackAction) fallbackActions[a.id] = a.fallbackAction;
  }
  for (const p of domain.actionProfiles) {
    if (p.fallbackAction && !fallbackActions[p.id]) fallbackActions[p.id] = p.fallbackAction;
  }

  let loadoutIssues: Array<{ path: string; message: string }> | undefined;
  if (domain.loadoutInvalid) {
    const { validateLoadout } = await import("@framebaker/shared");
    const v = validateLoadout(domain.body, domain.equipment, domain.loadout);
    loadoutIssues = v.ok ? [] : v.issues.map((i) => ({ path: i.path, message: i.message }));
  }

  return {
    matrices,
    sockets,
    slots,
    events,
    pixels,
    effects: [...assembled.value.effects].map((e) => ({
      event: e.event,
      effectId: e.effectId,
      ...(e.socket ? { socket: e.socket } : {}),
    })),
    hiddenParts: [...assembled.value.hiddenParts].sort(),
    occupiedSlots: [...assembled.value.occupiedSlots],
    loadoutValid: !domain.loadoutInvalid,
    ...(loadoutIssues ? { loadoutIssues } : {}),
    ...(Object.keys(fallbackActions).length ? { fallbackActions } : {}),
  };
}

/** In-memory fixture directory entries — never writes storage/. */
export async function buildContractFixtureEntries(id: ContractFixtureId): Promise<Array<{ name: string; data: Uint8Array }>> {
  const domain = buildContractFixtureDomain(id);
  const expected = await buildContractFixtureExpected(domain);
  const entries = await buildFbanimV3Entries({
    createdBy: { name: "FrameBaker", version: "fixture" },
    skeleton: domain.skeleton,
    characterBinding: domain.binding,
    bodyProfiles: [domain.body],
    equipment: domain.equipment,
    actions: domain.actions.map((a) => ({
      id: a.id,
      name: a.name,
      motionClip: a.motionClip,
      speed: a.speed,
      repeat: a.repeat,
      loop: a.loop,
      ...(a.fallbackAction ? { fallbackAction: a.fallbackAction } : {}),
    })),
    actionProfiles: domain.actionProfiles,
    constraints: [],
    textures: domain.textures.map((t) => ({ attachmentId: t.attachmentId, bytes: t.bytes })),
  });
  return exportFixtureZipEntries({
    fixtureId: id,
    packageEntries: entries,
    loadout: domain.loadout,
    actionSteps: domain.actionSteps,
    expected,
    metadata: {
      schemaVersion: 1,
      generatedBy: "FrameBaker",
      note: domain.note,
    },
  });
}
