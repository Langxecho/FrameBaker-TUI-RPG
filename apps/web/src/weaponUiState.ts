import {
  EQUIPMENT_SCHEMA_VERSION,
  assembleLoadout,
  validateEquipmentDefinition,
  validateLoadout,
  type AssembledLoadout,
  type BodyProfile,
  type CharacterBinding,
  type CharacterLoadout,
  type EquipmentDefinition,
  type Skeleton,
  type Transform,
  type TwoBoneIkConstraint,
  type ValidationIssue,
  type WeaponProfile,
} from "@framebaker/shared";

export type WeaponHoldMode = WeaponProfile["holdMode"];
export type WeaponPrimaryHand = WeaponProfile["preferredPrimaryHand"];
export type WeaponWorkspacePane = "library" | "editor" | "preview";
export type WeaponGripTarget = "primaryGrip" | "secondaryGrip" | "muzzleSocket" | "ejectSocket";

export type WeaponUiAction =
  | { type: "setPane"; pane: WeaponWorkspacePane }
  | { type: "selectWeapon"; equipmentId: string | null }
  | { type: "replaceLibrary"; equipment: EquipmentDefinition[]; selectedId?: string | null }
  | { type: "createWeapon"; equipment: EquipmentDefinition }
  | { type: "deleteWeapon"; equipmentId: string }
  | { type: "patchDraft"; patch: Partial<EquipmentDefinition> }
  | { type: "setHoldMode"; holdMode: WeaponHoldMode }
  | { type: "setPreferredPrimaryHand"; hand: WeaponPrimaryHand }
  | { type: "patchWeapon"; patch: Partial<WeaponProfile> }
  | { type: "patchGrip"; target: WeaponGripTarget; rest: Partial<Transform> }
  | { type: "setSecondaryHandConstraint"; constraint: TwoBoneIkConstraint | null }
  | { type: "patchSecondaryHandConstraint"; patch: Partial<TwoBoneIkConstraint> }
  | { type: "selectGripTarget"; target: WeaponGripTarget }
  | { type: "selectBodyProfile"; bodyProfileId: string }
  | { type: "setPreviewTime"; time: number }
  | { type: "setFacing"; facing: "left" | "right" }
  | { type: "tryEquip"; equipmentId: string }
  | { type: "unequip"; equipmentId: string }
  | { type: "clearPreview" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "markSaved"; equipment: EquipmentDefinition }
  | { type: "replaceDraft"; equipment: EquipmentDefinition };

export interface WeaponUiState {
  pane: WeaponWorkspacePane;
  library: EquipmentDefinition[];
  saved: EquipmentDefinition | null;
  draft: EquipmentDefinition | null;
  selectedEquipmentId: string | null;
  selectedGripTarget: WeaponGripTarget;
  selectedBodyProfileId: string;
  previewLoadout: CharacterLoadout;
  legalPreview: AssembledLoadout | null;
  conflictIssues: ValidationIssue[];
  previewTime: number;
  facing: "left" | "right";
  past: EquipmentDefinition[];
  future: EquipmentDefinition[];
}

const identityTransform = (): Transform => ({
  translation: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

function cloneEquipment(value: EquipmentDefinition): EquipmentDefinition {
  return structuredClone(value);
}

function cloneLoadout(value: CharacterLoadout): CharacterLoadout {
  return structuredClone(value);
}

function equipmentEqual(a: EquipmentDefinition | null, b: EquipmentDefinition | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function pushHistory(state: WeaponUiState, nextDraft: EquipmentDefinition): WeaponUiState {
  if (!state.draft || equipmentEqual(state.draft, nextDraft)) return { ...state, draft: nextDraft };
  return {
    ...state,
    draft: nextDraft,
    past: [...state.past, cloneEquipment(state.draft)],
    future: [],
  };
}

function patchRest(rest: Transform, patch?: Partial<Transform>): Transform {
  if (!patch) return rest;
  return {
    translation: patch.translation ? [...patch.translation] as Transform["translation"] : [...rest.translation] as Transform["translation"],
    rotation: patch.rotation ? [...patch.rotation] as Transform["rotation"] : [...rest.rotation] as Transform["rotation"],
    scale: patch.scale ? [...patch.scale] as Transform["scale"] : [...rest.scale] as Transform["scale"],
  };
}

function emptyLoadout(bodyProfileId: string): CharacterLoadout {
  return { bodyProfileId, equipment: [] };
}

function upsertLibrary(library: EquipmentDefinition[], item: EquipmentDefinition): EquipmentDefinition[] {
  const exists = library.some((entry) => entry.id === item.id);
  return exists
    ? library.map((entry) => entry.id === item.id ? cloneEquipment(item) : entry)
    : [...library, cloneEquipment(item)];
}

function definitionsForPreview(state: WeaponUiState): EquipmentDefinition[] {
  if (!state.draft) return state.library.map(cloneEquipment);
  return upsertLibrary(state.library, state.draft);
}

function isWeaponEquipment(item: EquipmentDefinition): boolean {
  return item.weapon !== undefined || item.tags.includes("weapon");
}

function recomputePreview(
  state: WeaponUiState,
  body: BodyProfile | null,
  binding: CharacterBinding | null,
  nextLoadout: CharacterLoadout,
): Pick<WeaponUiState, "previewLoadout" | "legalPreview" | "conflictIssues"> {
  if (!body || body.id !== nextLoadout.bodyProfileId) {
    return {
      previewLoadout: nextLoadout,
      legalPreview: state.legalPreview,
      conflictIssues: [{ path: "bodyProfileId", message: "BodyProfile 不匹配" }],
    };
  }
  const definitions = definitionsForPreview(state);
  const validated = validateLoadout(body, definitions, nextLoadout);
  if (!validated.ok || !binding) {
    return {
      previewLoadout: state.previewLoadout,
      legalPreview: state.legalPreview,
      conflictIssues: validated.issues,
    };
  }
  const assembled = assembleLoadout(body, binding, definitions, nextLoadout);
  if (!assembled.ok) {
    return {
      previewLoadout: state.previewLoadout,
      legalPreview: state.legalPreview,
      conflictIssues: assembled.issues,
    };
  }
  return {
    previewLoadout: cloneLoadout(nextLoadout),
    legalPreview: assembled.value,
    conflictIssues: [],
  };
}

function handSlotId(body: BodyProfile, hand: WeaponPrimaryHand): string | null {
  const semantic = hand === "left" ? "hand_left" : "hand_right";
  const weaponSemantic = hand === "left" ? "weapon_hand_left" : "weapon_hand_right";
  return body.slots.find((slot) => slot.semantic === semantic || slot.semantic === weaponSemantic)?.id
    ?? body.slots.find((slot) => slot.accepts.includes("weapon") && slot.id.toLowerCase().includes(hand === "left" ? "l" : "r"))?.id
    ?? null;
}

export function resolveWeaponHandSlots(
  body: BodyProfile,
  holdMode: WeaponHoldMode,
  preferredPrimaryHand: WeaponPrimaryHand,
): { primarySlot: string; occupiedSlots: string[] } {
  const primary = handSlotId(body, preferredPrimaryHand);
  const opposite = handSlotId(body, preferredPrimaryHand === "left" ? "right" : "left");
  const fallback = body.slots.find((slot) => slot.accepts.includes("weapon"))?.id ?? body.slots[0]?.id ?? "slot";
  const primarySlot = primary ?? fallback;
  if (holdMode === "two_hand") {
    const secondary = opposite && opposite !== primarySlot ? opposite : body.slots.find((slot) => slot.id !== primarySlot && slot.accepts.includes("weapon"))?.id;
    return {
      primarySlot,
      occupiedSlots: secondary ? [primarySlot, secondary] : [primarySlot],
    };
  }
  return { primarySlot, occupiedSlots: [primarySlot] };
}

function ensureWeaponProfile(
  equipment: EquipmentDefinition,
  holdMode: WeaponHoldMode = "one_hand",
  preferredPrimaryHand: WeaponPrimaryHand = "right",
): WeaponProfile {
  if (equipment.weapon) return structuredClone(equipment.weapon);
  return {
    holdMode,
    preferredPrimaryHand,
    mirrorAllowed: true,
    primaryGrip: identityTransform(),
    secondaryGrip: holdMode === "two_hand" ? identityTransform() : undefined,
    muzzleSocket: undefined,
    ejectSocket: undefined,
    stanceProfile: holdMode === "two_hand" ? "rifle_two_hand" : "pistol_one_hand",
    recoilProfile: undefined,
    secondaryHandConstraint: undefined,
  };
}

export function createEmptyWeapon(
  id: string,
  name: string,
  body: BodyProfile,
  options: {
    holdMode?: WeaponHoldMode;
    preferredPrimaryHand?: WeaponPrimaryHand;
  } = {},
): EquipmentDefinition {
  const holdMode = options.holdMode ?? "one_hand";
  const preferredPrimaryHand = options.preferredPrimaryHand ?? "right";
  const slots = resolveWeaponHandSlots(body, holdMode, preferredPrimaryHand);
  const weapon = ensureWeaponProfile(
    {
      schemaVersion: EQUIPMENT_SCHEMA_VERSION,
      id,
      name,
      tags: ["weapon"],
      visualMode: "attached",
      primarySlot: slots.primarySlot,
      occupiedSlots: slots.occupiedSlots,
      conflictTags: [],
      replacesParts: [],
      hidesSlots: [],
      attachments: [],
    },
    holdMode,
    preferredPrimaryHand,
  );
  return {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id,
    name,
    tags: ["weapon"],
    visualMode: "attached",
    primarySlot: slots.primarySlot,
    occupiedSlots: slots.occupiedSlots,
    conflictTags: [],
    replacesParts: [],
    hidesSlots: [],
    attachments: [],
    effectBindings: [],
    actionOverrides: {},
    weapon,
  };
}

export function createDefaultSecondaryHandConstraint(
  skeleton: Skeleton,
  body: BodyProfile,
  preferredPrimaryHand: WeaponPrimaryHand,
): TwoBoneIkConstraint {
  const secondaryHand = preferredPrimaryHand === "left" ? "right" : "left";
  const boneHint = secondaryHand === "left" ? ["upper_l", "lower_l", "hand_l", "arm_l", "forearm_l"] : ["upper_r", "lower_r", "hand_r", "arm_r", "forearm_r"];
  const bones = skeleton.bones.map((bone) => bone.id);
  const pick = (hints: string[], fallbackIndex: number) =>
    hints.find((id) => bones.includes(id)) ?? bones[Math.min(fallbackIndex, bones.length - 1)] ?? "root";
  const targetSemantic = secondaryHand === "left" ? "weapon_hand_left" : "weapon_hand_right";
  const handSemantic = secondaryHand === "left" ? "hand_left" : "hand_right";
  const targetSocket = body.sockets.find((socket) => socket.semantic === targetSemantic || socket.semantic === handSemantic)?.id
    ?? body.sockets[0]?.id
    ?? "socket";
  return {
    id: "ik-secondary",
    upperBoneId: pick(boneHint.slice(0, 1).concat(["upper_arm", "shoulder"]), 1),
    lowerBoneId: pick(boneHint.slice(1, 2).concat(["forearm", "lower_arm"]), 2),
    endBoneId: pick(boneHint.slice(2, 3).concat(["hand", "wrist"]), 3),
    targetSocket,
    bendDirection: "positive",
    mix: 1,
    stretch: "forbid",
  };
}

export function createWeaponUiState(
  library: EquipmentDefinition[],
  body: BodyProfile | null,
  binding: CharacterBinding | null = null,
  _skeleton: Skeleton | null = null,
): WeaponUiState {
  const weapons = library.filter(isWeaponEquipment).map(cloneEquipment);
  const selected = weapons[0] ?? null;
  const bodyId = body?.id ?? "";
  const base: WeaponUiState = {
    pane: "library",
    library: weapons,
    saved: selected ? cloneEquipment(selected) : null,
    draft: selected ? cloneEquipment(selected) : null,
    selectedEquipmentId: selected?.id ?? null,
    selectedGripTarget: "primaryGrip",
    selectedBodyProfileId: bodyId,
    previewLoadout: emptyLoadout(bodyId),
    legalPreview: null,
    conflictIssues: [],
    previewTime: 0,
    facing: "right",
    past: [],
    future: [],
  };
  if (!body || !binding) return base;
  return { ...base, ...recomputePreview(base, body, binding, base.previewLoadout) };
}

export function isWeaponDirty(state: WeaponUiState): boolean {
  return !equipmentEqual(state.draft, state.saved);
}

export function weaponWizardBlockingIssues(
  draft: EquipmentDefinition | null,
  body: BodyProfile | null,
  skeleton: Skeleton | null = null,
): ValidationIssue[] {
  if (!draft) return [{ path: "draft", message: "尚未选择武器" }];
  if (!body) return [{ path: "bodyProfileId", message: "缺少 BodyProfile" }];
  const issues: ValidationIssue[] = [];
  if (!draft.name.trim()) issues.push({ path: "name", message: "名称不能为空" });
  if (!draft.weapon) {
    issues.push({ path: "weapon", message: "必须声明 WeaponProfile" });
    return issues;
  }
  const weapon = draft.weapon;
  if (!weapon.stanceProfile?.trim() || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(weapon.stanceProfile)) {
    issues.push({ path: "weapon.stanceProfile", message: "姿态配置无效" });
  }
  if (weapon.holdMode === "two_hand") {
    if (!weapon.secondaryGrip) issues.push({ path: "weapon.secondaryGrip", message: "two_hand 必须声明 secondaryGrip" });
    if (draft.occupiedSlots.length !== 2) issues.push({ path: "occupiedSlots", message: "two_hand 必须占用两个插槽" });
  }
  if (weapon.holdMode !== "two_hand" && draft.occupiedSlots.length !== 1) {
    issues.push({ path: "occupiedSlots", message: "单手/either 只能占用一个插槽" });
  }
  if (weapon.secondaryHandConstraint && skeleton) {
    const c = weapon.secondaryHandConstraint;
    const boneIds = new Set(skeleton.bones.map((bone) => bone.id));
    if (!boneIds.has(c.upperBoneId) || !boneIds.has(c.lowerBoneId) || !boneIds.has(c.endBoneId)) {
      issues.push({ path: "weapon.secondaryHandConstraint", message: "IK 骨骼不存在" });
    }
  }
  const validated = validateEquipmentDefinition(draft, body);
  return [...issues, ...validated.issues];
}

export function canCompleteWeaponWizard(
  draft: EquipmentDefinition | null,
  body: BodyProfile | null,
  skeleton: Skeleton | null = null,
): boolean {
  return weaponWizardBlockingIssues(draft, body, skeleton).length === 0;
}

function applyHoldMode(
  draft: EquipmentDefinition,
  body: BodyProfile,
  holdMode: WeaponHoldMode,
): EquipmentDefinition {
  const preferred = draft.weapon?.preferredPrimaryHand ?? "right";
  const slots = resolveWeaponHandSlots(body, holdMode, preferred);
  const weapon = ensureWeaponProfile(draft, holdMode, preferred);
  weapon.holdMode = holdMode;
  if (holdMode === "two_hand") {
    weapon.secondaryGrip = weapon.secondaryGrip ?? identityTransform();
    if (!weapon.stanceProfile || weapon.stanceProfile === "pistol_one_hand") {
      weapon.stanceProfile = "rifle_two_hand";
    }
  } else if (holdMode === "one_hand" || holdMode === "either") {
    if (!weapon.stanceProfile || weapon.stanceProfile === "rifle_two_hand") {
      weapon.stanceProfile = holdMode === "either" ? "pistol_one_hand" : "pistol_one_hand";
    }
  }
  return {
    ...cloneEquipment(draft),
    primarySlot: slots.primarySlot,
    occupiedSlots: slots.occupiedSlots,
    weapon,
  };
}

function applyPreferredHand(
  draft: EquipmentDefinition,
  body: BodyProfile,
  hand: WeaponPrimaryHand,
): EquipmentDefinition {
  const holdMode = draft.weapon?.holdMode ?? "one_hand";
  const slots = resolveWeaponHandSlots(body, holdMode, hand);
  const weapon = ensureWeaponProfile(draft, holdMode, hand);
  weapon.preferredPrimaryHand = hand;
  return {
    ...cloneEquipment(draft),
    primarySlot: slots.primarySlot,
    occupiedSlots: slots.occupiedSlots,
    weapon,
  };
}

export function reduceWeaponUi(
  state: WeaponUiState,
  action: WeaponUiAction,
  body: BodyProfile | null,
  binding: CharacterBinding | null = null,
  skeleton: Skeleton | null = null,
): WeaponUiState {
  switch (action.type) {
    case "setPane":
      return { ...state, pane: action.pane };
    case "selectWeapon": {
      const selected = action.equipmentId
        ? state.library.find((item) => item.id === action.equipmentId) ?? null
        : null;
      return {
        ...state,
        selectedEquipmentId: selected?.id ?? null,
        saved: selected ? cloneEquipment(selected) : null,
        draft: selected ? cloneEquipment(selected) : null,
        selectedGripTarget: "primaryGrip",
        past: [],
        future: [],
        pane: selected ? "editor" : state.pane,
      };
    }
    case "replaceLibrary": {
      const weapons = action.equipment.filter(isWeaponEquipment).map(cloneEquipment);
      const selected = action.selectedId !== undefined
        ? (action.selectedId ? weapons.find((item) => item.id === action.selectedId) ?? null : null)
        : (weapons.find((item) => item.id === state.selectedEquipmentId) ?? weapons[0] ?? null);
      return {
        ...state,
        library: weapons,
        selectedEquipmentId: selected?.id ?? null,
        saved: selected ? cloneEquipment(selected) : null,
        draft: selected ? cloneEquipment(selected) : null,
        selectedGripTarget: "primaryGrip",
        past: [],
        future: [],
      };
    }
    case "createWeapon": {
      const nextLibrary = upsertLibrary(state.library, action.equipment);
      return {
        ...state,
        library: nextLibrary,
        selectedEquipmentId: action.equipment.id,
        saved: null,
        draft: cloneEquipment(action.equipment),
        selectedGripTarget: "primaryGrip",
        pane: "editor",
        past: [],
        future: [],
      };
    }
    case "deleteWeapon": {
      const nextLibrary = state.library.filter((item) => item.id !== action.equipmentId);
      const selected = nextLibrary[0] ?? null;
      const nextLoadout = {
        ...cloneLoadout(state.previewLoadout),
        equipment: state.previewLoadout.equipment.filter((item) => item.equipmentId !== action.equipmentId),
      };
      const base = {
        ...state,
        library: nextLibrary,
        selectedEquipmentId: selected?.id ?? null,
        saved: selected ? cloneEquipment(selected) : null,
        draft: selected ? cloneEquipment(selected) : null,
        past: [],
        future: [],
      };
      return { ...base, ...recomputePreview(base, body, binding, nextLoadout) };
    }
    case "patchDraft": {
      if (!state.draft) return state;
      const next = { ...cloneEquipment(state.draft), ...action.patch, id: state.draft.id };
      return pushHistory(state, next);
    }
    case "setHoldMode": {
      if (!state.draft || !body) return state;
      return pushHistory(state, applyHoldMode(state.draft, body, action.holdMode));
    }
    case "setPreferredPrimaryHand": {
      if (!state.draft || !body) return state;
      return pushHistory(state, applyPreferredHand(state.draft, body, action.hand));
    }
    case "patchWeapon": {
      if (!state.draft) return state;
      const weapon = ensureWeaponProfile(state.draft);
      const nextWeapon: WeaponProfile = {
        ...weapon,
        ...action.patch,
        primaryGrip: action.patch.primaryGrip ? patchRest(weapon.primaryGrip, action.patch.primaryGrip) : weapon.primaryGrip,
        secondaryGrip: action.patch.secondaryGrip !== undefined
          ? (action.patch.secondaryGrip ? patchRest(weapon.secondaryGrip ?? identityTransform(), action.patch.secondaryGrip) : undefined)
          : weapon.secondaryGrip,
        muzzleSocket: action.patch.muzzleSocket !== undefined
          ? (action.patch.muzzleSocket ? patchRest(weapon.muzzleSocket ?? identityTransform(), action.patch.muzzleSocket) : undefined)
          : weapon.muzzleSocket,
        ejectSocket: action.patch.ejectSocket !== undefined
          ? (action.patch.ejectSocket ? patchRest(weapon.ejectSocket ?? identityTransform(), action.patch.ejectSocket) : undefined)
          : weapon.ejectSocket,
        secondaryHandConstraint: action.patch.secondaryHandConstraint !== undefined
          ? action.patch.secondaryHandConstraint
          : weapon.secondaryHandConstraint,
      };
      return pushHistory(state, { ...cloneEquipment(state.draft), weapon: nextWeapon });
    }
    case "patchGrip": {
      if (!state.draft?.weapon) return state;
      const weapon = ensureWeaponProfile(state.draft);
      const current = action.target === "primaryGrip"
        ? weapon.primaryGrip
        : action.target === "secondaryGrip"
          ? (weapon.secondaryGrip ?? identityTransform())
          : action.target === "muzzleSocket"
            ? (weapon.muzzleSocket ?? identityTransform())
            : (weapon.ejectSocket ?? identityTransform());
      const nextRest = patchRest(current, action.rest);
      const nextWeapon: WeaponProfile = { ...weapon };
      if (action.target === "primaryGrip") nextWeapon.primaryGrip = nextRest;
      if (action.target === "secondaryGrip") nextWeapon.secondaryGrip = nextRest;
      if (action.target === "muzzleSocket") nextWeapon.muzzleSocket = nextRest;
      if (action.target === "ejectSocket") nextWeapon.ejectSocket = nextRest;
      return {
        ...pushHistory(state, { ...cloneEquipment(state.draft), weapon: nextWeapon }),
        selectedGripTarget: action.target,
      };
    }
    case "setSecondaryHandConstraint": {
      if (!state.draft) return state;
      const weapon = ensureWeaponProfile(state.draft);
      weapon.secondaryHandConstraint = action.constraint ? structuredClone(action.constraint) : undefined;
      return pushHistory(state, { ...cloneEquipment(state.draft), weapon });
    }
    case "patchSecondaryHandConstraint": {
      if (!state.draft?.weapon) return state;
      const weapon = ensureWeaponProfile(state.draft);
      const base = weapon.secondaryHandConstraint ?? (skeleton && body
        ? createDefaultSecondaryHandConstraint(skeleton, body, weapon.preferredPrimaryHand)
        : null);
      if (!base) return state;
      weapon.secondaryHandConstraint = { ...base, ...action.patch };
      return pushHistory(state, { ...cloneEquipment(state.draft), weapon });
    }
    case "selectGripTarget":
      return { ...state, selectedGripTarget: action.target };
    case "selectBodyProfile": {
      const nextLoadout = { ...cloneLoadout(state.previewLoadout), bodyProfileId: action.bodyProfileId };
      const preview = recomputePreview({ ...state, selectedBodyProfileId: action.bodyProfileId }, body, binding, nextLoadout);
      return { ...state, selectedBodyProfileId: action.bodyProfileId, ...preview };
    }
    case "setPreviewTime":
      return { ...state, previewTime: Math.max(0, action.time) };
    case "setFacing":
      return { ...state, facing: action.facing };
    case "tryEquip": {
      const definition = definitionsForPreview(state).find((item) => item.id === action.equipmentId);
      if (!definition) {
        return {
          ...state,
          conflictIssues: [{ path: "equipmentId", message: "武器不存在" }],
        };
      }
      if (state.previewLoadout.equipment.some((item) => item.equipmentId === action.equipmentId)) {
        return state;
      }
      const nextLoadout: CharacterLoadout = {
        bodyProfileId: state.selectedBodyProfileId || state.previewLoadout.bodyProfileId,
        equipment: [
          ...state.previewLoadout.equipment,
          { equipmentId: definition.id, primarySlot: definition.primarySlot },
        ],
      };
      return { ...state, ...recomputePreview(state, body, binding, nextLoadout) };
    }
    case "unequip": {
      const nextLoadout: CharacterLoadout = {
        ...cloneLoadout(state.previewLoadout),
        equipment: state.previewLoadout.equipment.filter((item) => item.equipmentId !== action.equipmentId),
      };
      return { ...state, ...recomputePreview(state, body, binding, nextLoadout) };
    }
    case "clearPreview": {
      const nextLoadout = emptyLoadout(state.selectedBodyProfileId || state.previewLoadout.bodyProfileId);
      return { ...state, ...recomputePreview(state, body, binding, nextLoadout) };
    }
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...state,
        draft: cloneEquipment(previous),
        past: state.past.slice(0, -1),
        future: state.draft ? [...state.future, cloneEquipment(state.draft)] : state.future,
      };
    }
    case "redo": {
      const next = state.future.at(-1);
      if (!next) return state;
      return {
        ...state,
        draft: cloneEquipment(next),
        past: state.draft ? [...state.past, cloneEquipment(state.draft)] : state.past,
        future: state.future.slice(0, -1),
      };
    }
    case "markSaved": {
      const saved = cloneEquipment(action.equipment);
      return {
        ...state,
        saved,
        draft: cloneEquipment(saved),
        library: upsertLibrary(state.library, saved),
        selectedEquipmentId: saved.id,
        past: [],
        future: [],
      };
    }
    case "replaceDraft":
      return {
        ...state,
        draft: cloneEquipment(action.equipment),
        past: [],
        future: [],
      };
    default:
      return state;
  }
}
