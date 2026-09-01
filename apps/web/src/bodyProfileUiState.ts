import {
  EQUIPMENT_SCHEMA_VERSION,
  type BodyProfile,
  type BodySlotDefinition,
  type BodySocketDefinition,
  type Skeleton,
  type Transform,
  type ValidationIssue,
  validateBodyProfile,
} from "@framebaker/shared";

export const BODY_PROFILE_STANDARD_SEMANTICS = [
  "head", "face", "eye_left", "eye_right", "ear_left", "ear_right", "neck", "chest", "back",
  "arm_left", "arm_right", "forearm_left", "forearm_right", "hand_left", "hand_right",
  "leg_left", "leg_right", "foot_left", "foot_right", "weapon_hand_left", "weapon_hand_right",
] as const;

export type BodyProfileMode = "skeleton" | "parts" | "semantics";

export type BodyProfileUiAction =
  | { type: "selectBone"; boneId: string }
  | { type: "selectSocket"; socketId: string | null }
  | { type: "selectSlot"; slotId: string | null }
  | { type: "setMode"; mode: BodyProfileMode }
  | { type: "setName"; name: string }
  | { type: "mapBoneSemantic"; boneId: string; semantic: string }
  | { type: "addSocket"; socketId: string; boneId?: string; semantic?: string }
  | { type: "deleteSocket"; socketId: string }
  | { type: "mirrorSocket"; socketId: string; pairId: string }
  | { type: "patchSocket"; socketId: string; patch: Partial<Pick<BodySocketDefinition, "semantic" | "boneId" | "accepts">> & { rest?: Partial<Transform> } }
  | { type: "addSlot"; slotId: string; semantic?: string }
  | { type: "deleteSlot"; slotId: string }
  | { type: "patchSlot"; slotId: string; patch: Partial<Pick<BodySlotDefinition, "semantic" | "capacity" | "accepts">> }
  | { type: "setPreviewTime"; time: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "markSaved"; profile: BodyProfile }
  | { type: "replaceProfile"; profile: BodyProfile }
  | { type: "seedStandard"; skeleton: Skeleton };

export interface BodyProfileUiState {
  saved: BodyProfile;
  draft: BodyProfile;
  mode: BodyProfileMode;
  selectedBoneId: string;
  selectedSocketId: string | null;
  selectedSlotId: string | null;
  previewTime: number;
  past: BodyProfile[];
  future: BodyProfile[];
}

const identityTransform = (): Transform => ({
  translation: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

function cloneProfile(profile: BodyProfile): BodyProfile {
  return structuredClone(profile);
}

function profilesEqual(a: BodyProfile, b: BodyProfile): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function pushHistory(state: BodyProfileUiState, nextDraft: BodyProfile): BodyProfileUiState {
  if (profilesEqual(state.draft, nextDraft)) return state;
  return {
    ...state,
    draft: nextDraft,
    past: [...state.past, cloneProfile(state.draft)],
    future: [],
  };
}

function patchSocketRest(rest: Transform, patch?: Partial<Transform>): Transform {
  if (!patch) return rest;
  return {
    translation: patch.translation ? [...patch.translation] as Transform["translation"] : [...rest.translation] as Transform["translation"],
    rotation: patch.rotation ? [...patch.rotation] as Transform["rotation"] : [...rest.rotation] as Transform["rotation"],
    scale: patch.scale ? [...patch.scale] as Transform["scale"] : [...rest.scale] as Transform["scale"],
  };
}

function mirrorSemantic(semantic: string): string {
  if (semantic.includes("_left")) return semantic.replace("_left", "_right");
  if (semantic.includes("_right")) return semantic.replace("_right", "_left");
  if (semantic.endsWith("-left")) return semantic.replace(/-left$/, "-right");
  if (semantic.endsWith("-right")) return semantic.replace(/-right$/, "-left");
  return semantic;
}

function mirrorRestX(rest: Transform): Transform {
  return {
    translation: [-rest.translation[0], rest.translation[1], rest.translation[2]],
    rotation: [...rest.rotation] as Transform["rotation"],
    scale: [...rest.scale] as Transform["scale"],
  };
}

export function createEmptyBodyProfile(id: string, name: string, skeletonId: string): BodyProfile {
  return {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id,
    name,
    skeletonId,
    mirrorAxis: "x",
    slots: [],
    sockets: [],
  };
}

function resolveBoneId(skeleton: Skeleton, names: readonly string[]): string {
  const semanticMap = skeleton.semanticProfile?.bones ?? {};
  for (const name of names) {
    const mapped = semanticMap[name];
    if (typeof mapped === "string" && skeleton.bones.some((bone) => bone.id === mapped)) return mapped;
  }
  for (const name of names) {
    const bySemantic = skeleton.bones.find((bone) => bone.semantic === name);
    if (bySemantic) return bySemantic.id;
  }
  for (const name of names) {
    const exact = skeleton.bones.find((bone) => bone.id === name);
    if (exact) return exact.id;
  }
  const lowered = names.map((name) => name.toLowerCase().replace(/[_-]/g, ""));
  for (const bone of skeleton.bones) {
    const id = bone.id.toLowerCase().replace(/[_-]/g, "");
    if (lowered.some((name) => id === name || id.endsWith(name))) return bone.id;
  }
  return skeleton.bones[0]?.id ?? "root";
}

/** 按当前骨架生成头/胸/手等标准插槽与武器插座，便于装备穿戴与双手持武。 */
export function seedStandardBodyProfile(id: string, name: string, skeleton: Skeleton): BodyProfile {
  const head = resolveBoneId(skeleton, ["head"]);
  const chest = resolveBoneId(skeleton, ["chest", "torso"]);
  const handL = resolveBoneId(skeleton, ["leftWrist", "hand_left", "hand_l"]);
  const handR = resolveBoneId(skeleton, ["rightWrist", "hand_right", "hand_r"]);
  const armL = resolveBoneId(skeleton, ["leftShoulder", "arm_left", "upper_l"]);
  const armR = resolveBoneId(skeleton, ["rightShoulder", "arm_right", "upper_r"]);
  const restAt = (x = 0, y = 0): Transform => ({ translation: [x, y, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  return {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id,
    name,
    skeletonId: skeleton.id,
    mirrorAxis: "x",
    slots: [
      { id: "slot-head", semantic: "head", capacity: 1, accepts: ["helmet"] },
      { id: "slot-face", semantic: "face", capacity: 2, accepts: ["eye", "cyberware"] },
      { id: "slot-hand-l", semantic: "hand_left", capacity: 1, accepts: ["weapon"] },
      { id: "slot-hand-r", semantic: "hand_right", capacity: 1, accepts: ["weapon"] },
      { id: "slot-chest", semantic: "chest", capacity: 4, accepts: ["chip", "internal"] },
      { id: "slot-back", semantic: "back", capacity: 1, accepts: ["device", "backpack"] },
      { id: "slot-arm-l", semantic: "arm_left", capacity: 1, accepts: ["cyberware", "arm"] },
      { id: "slot-arm-r", semantic: "arm_right", capacity: 1, accepts: ["cyberware", "arm"] },
    ],
    sockets: [
      { id: "sock-head", semantic: "head", boneId: head, rest: restAt(), accepts: ["helmet"] },
      { id: "sock-eye-l", semantic: "eye_left", boneId: head, rest: restAt(-4, 12), accepts: ["eye"], mirrorSocketId: "sock-eye-r" },
      { id: "sock-eye-r", semantic: "eye_right", boneId: head, rest: restAt(4, 12), accepts: ["eye"], mirrorSocketId: "sock-eye-l" },
      { id: "sock-hand-l", semantic: "weapon_hand_left", boneId: handL, rest: restAt(), accepts: ["weapon"], mirrorSocketId: "sock-hand-r" },
      { id: "sock-hand-r", semantic: "weapon_hand_right", boneId: handR, rest: restAt(), accepts: ["weapon"], mirrorSocketId: "sock-hand-l" },
      { id: "sock-chest", semantic: "chest", boneId: chest, rest: restAt(), accepts: ["chip", "effect"] },
      { id: "sock-back", semantic: "back", boneId: chest, rest: restAt(), accepts: ["device"] },
      { id: "sock-arm-l", semantic: "arm_left", boneId: armL, rest: restAt(), accepts: ["cyberware"], mirrorSocketId: "sock-arm-r" },
      { id: "sock-arm-r", semantic: "arm_right", boneId: armR, rest: restAt(), accepts: ["cyberware"], mirrorSocketId: "sock-arm-l" },
    ],
  };
}

export function createBodyProfileUiState(profile: BodyProfile, skeleton: Skeleton): BodyProfileUiState {
  return {
    saved: cloneProfile(profile),
    draft: cloneProfile(profile),
    mode: "semantics",
    selectedBoneId: skeleton.bones[0]?.id ?? "",
    selectedSocketId: profile.sockets[0]?.id ?? null,
    selectedSlotId: profile.slots[0]?.id ?? null,
    previewTime: 0,
    past: [],
    future: [],
  };
}

export function isBodyProfileDirty(state: BodyProfileUiState): boolean {
  return !profilesEqual(state.draft, state.saved);
}

export function bodyProfileDiagnostics(state: BodyProfileUiState, skeleton: Skeleton): ValidationIssue[] {
  const result = validateBodyProfile(state.draft, skeleton);
  const issues = [...result.issues];
  const boneIds = new Set(skeleton.bones.map((bone) => bone.id));
  for (const socket of state.draft.sockets) {
    if (!boneIds.has(socket.boneId)) issues.push({ path: `sockets.${socket.id}.boneId`, message: "骨骼不存在" });
    if (socket.mirrorSocketId) {
      const pair = state.draft.sockets.find((item) => item.id === socket.mirrorSocketId);
      if (!pair) issues.push({ path: `sockets.${socket.id}.mirrorSocketId`, message: "镜像插座不存在" });
      else if (pair.mirrorSocketId && pair.mirrorSocketId !== socket.id) {
        issues.push({ path: `sockets.${socket.id}.mirrorSocketId`, message: "镜像配对不对称" });
      }
    }
  }
  for (const slot of state.draft.slots) {
    if (!Number.isInteger(slot.capacity) || slot.capacity < 1 || slot.capacity > 32) {
      issues.push({ path: `slots.${slot.id}.capacity`, message: "容量必须是 1..32 的整数" });
    }
  }
  return issues;
}

export function normalizeSocketSemantic(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "custom:unnamed";
  if ((BODY_PROFILE_STANDARD_SEMANTICS as readonly string[]).includes(trimmed)) return trimmed;
  if (trimmed.startsWith("custom:")) return trimmed;
  return `custom:${trimmed}`;
}

export function reduceBodyProfileUi(state: BodyProfileUiState, action: BodyProfileUiAction): BodyProfileUiState {
  switch (action.type) {
    case "selectBone":
      return { ...state, selectedBoneId: action.boneId };
    case "selectSocket":
      return { ...state, selectedSocketId: action.socketId };
    case "selectSlot":
      return { ...state, selectedSlotId: action.slotId };
    case "setMode":
      return { ...state, mode: action.mode };
    case "setPreviewTime":
      return { ...state, previewTime: Math.max(0, action.time) };
    case "setName": {
      const next = { ...cloneProfile(state.draft), name: action.name };
      return pushHistory(state, next);
    }
    case "mapBoneSemantic": {
      // semantic bone mapping is stored on sockets/slots via guided UI; keep selected bone and optional auto-socket semantic
      const selected = state.draft.sockets.find((socket) => socket.id === state.selectedSocketId);
      if (!selected || selected.boneId !== action.boneId) {
        return { ...state, selectedBoneId: action.boneId };
      }
      const semantic = normalizeSocketSemantic(action.semantic);
      const next = {
        ...cloneProfile(state.draft),
        sockets: state.draft.sockets.map((socket) => socket.id === selected.id ? { ...socket, semantic } : socket),
      };
      return { ...pushHistory(state, next), selectedBoneId: action.boneId };
    }
    case "addSocket": {
      const boneId = action.boneId ?? state.selectedBoneId;
      if (!boneId) return state;
      const socket: BodySocketDefinition = {
        id: action.socketId,
        semantic: normalizeSocketSemantic(action.semantic ?? "custom:socket"),
        boneId,
        rest: identityTransform(),
        accepts: [],
      };
      const next = { ...cloneProfile(state.draft), sockets: [...state.draft.sockets, socket] };
      return { ...pushHistory(state, next), selectedSocketId: socket.id, selectedBoneId: boneId };
    }
    case "deleteSocket": {
      if (!state.draft.sockets.some((socket) => socket.id === action.socketId)) return state;
      const nextSockets = state.draft.sockets
        .filter((socket) => socket.id !== action.socketId)
        .map((socket) => socket.mirrorSocketId === action.socketId ? { ...socket, mirrorSocketId: undefined } : socket);
      const next = { ...cloneProfile(state.draft), sockets: nextSockets };
      const selectedSocketId = state.selectedSocketId === action.socketId
        ? (nextSockets[0]?.id ?? null)
        : state.selectedSocketId;
      return { ...pushHistory(state, next), selectedSocketId };
    }
    case "mirrorSocket": {
      const source = state.draft.sockets.find((socket) => socket.id === action.socketId);
      if (!source || state.draft.sockets.some((socket) => socket.id === action.pairId)) return state;
      const pair: BodySocketDefinition = {
        id: action.pairId,
        semantic: mirrorSemantic(source.semantic),
        boneId: source.boneId,
        rest: mirrorRestX(source.rest),
        accepts: [...source.accepts],
        mirrorSocketId: source.id,
      };
      const next = {
        ...cloneProfile(state.draft),
        sockets: [
          ...state.draft.sockets.map((socket) => socket.id === source.id ? { ...socket, mirrorSocketId: pair.id } : socket),
          pair,
        ],
      };
      return { ...pushHistory(state, next), selectedSocketId: pair.id };
    }
    case "patchSocket": {
      if (!state.draft.sockets.some((socket) => socket.id === action.socketId)) return state;
      const next = {
        ...cloneProfile(state.draft),
        sockets: state.draft.sockets.map((socket) => {
          if (socket.id !== action.socketId) return socket;
          return {
            ...socket,
            semantic: action.patch.semantic !== undefined ? normalizeSocketSemantic(action.patch.semantic) : socket.semantic,
            boneId: action.patch.boneId ?? socket.boneId,
            accepts: action.patch.accepts ? [...action.patch.accepts] : socket.accepts,
            rest: patchSocketRest(socket.rest, action.patch.rest),
          };
        }),
      };
      return pushHistory(state, next);
    }
    case "addSlot": {
      const slot: BodySlotDefinition = {
        id: action.slotId,
        semantic: action.semantic?.trim() || action.slotId,
        capacity: 1,
        accepts: [],
      };
      const next = { ...cloneProfile(state.draft), slots: [...state.draft.slots, slot] };
      return { ...pushHistory(state, next), selectedSlotId: slot.id };
    }
    case "deleteSlot": {
      if (!state.draft.slots.some((slot) => slot.id === action.slotId)) return state;
      const nextSlots = state.draft.slots.filter((slot) => slot.id !== action.slotId);
      const next = { ...cloneProfile(state.draft), slots: nextSlots };
      const selectedSlotId = state.selectedSlotId === action.slotId ? (nextSlots[0]?.id ?? null) : state.selectedSlotId;
      return { ...pushHistory(state, next), selectedSlotId };
    }
    case "patchSlot": {
      if (!state.draft.slots.some((slot) => slot.id === action.slotId)) return state;
      const next = {
        ...cloneProfile(state.draft),
        slots: state.draft.slots.map((slot) => {
          if (slot.id !== action.slotId) return slot;
          return {
            ...slot,
            semantic: action.patch.semantic ?? slot.semantic,
            capacity: action.patch.capacity ?? slot.capacity,
            accepts: action.patch.accepts ? [...action.patch.accepts] : slot.accepts,
          };
        }),
      };
      return pushHistory(state, next);
    }
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...state,
        draft: cloneProfile(previous),
        past: state.past.slice(0, -1),
        future: [...state.future, cloneProfile(state.draft)],
        selectedSocketId: previous.sockets.some((socket) => socket.id === state.selectedSocketId)
          ? state.selectedSocketId
          : (previous.sockets[0]?.id ?? null),
        selectedSlotId: previous.slots.some((slot) => slot.id === state.selectedSlotId)
          ? state.selectedSlotId
          : (previous.slots[0]?.id ?? null),
      };
    }
    case "redo": {
      const next = state.future.at(-1);
      if (!next) return state;
      return {
        ...state,
        draft: cloneProfile(next),
        past: [...state.past, cloneProfile(state.draft)],
        future: state.future.slice(0, -1),
        selectedSocketId: next.sockets.some((socket) => socket.id === state.selectedSocketId)
          ? state.selectedSocketId
          : (next.sockets[0]?.id ?? null),
        selectedSlotId: next.slots.some((slot) => slot.id === state.selectedSlotId)
          ? state.selectedSlotId
          : (next.slots[0]?.id ?? null),
      };
    }
    case "markSaved":
      return {
        ...state,
        saved: cloneProfile(action.profile),
        draft: cloneProfile(action.profile),
        past: [],
        future: [],
      };
    case "seedStandard": {
      const next = seedStandardBodyProfile(state.draft.id, state.draft.name, action.skeleton);
      return {
        ...pushHistory(state, next),
        selectedSlotId: next.slots[0]?.id ?? null,
        selectedSocketId: next.sockets.find((socket) => socket.semantic === "weapon_hand_right")?.id ?? next.sockets[0]?.id ?? null,
      };
    }
    case "replaceProfile":
      return {
        ...state,
        draft: cloneProfile(action.profile),
        selectedSocketId: action.profile.sockets.some((socket) => socket.id === state.selectedSocketId)
          ? state.selectedSocketId
          : (action.profile.sockets[0]?.id ?? null),
        selectedSlotId: action.profile.slots.some((slot) => slot.id === state.selectedSlotId)
          ? state.selectedSlotId
          : (action.profile.slots[0]?.id ?? null),
        past: [],
        future: [],
      };
    default:
      return state;
  }
}
