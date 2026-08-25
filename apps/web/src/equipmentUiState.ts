import {
  EQUIPMENT_SCHEMA_VERSION,
  assembleLoadout,
  quaternionFromZRotation,
  validateEquipmentDefinition,
  validateLoadout,
  zRotationFromQuaternion,
  type AssembledLoadout,
  type BodyProfile,
  type CharacterBinding,
  type CharacterLoadout,
  type EquipmentAttachment,
  type EquipmentDefinition,
  type EquipmentEffectBinding,
  type EquipmentVisualMode,
  type Transform,
  type ValidationIssue,
} from "@framebaker/shared";

export type EquipmentWizardStep =
  | "identity"
  | "visualMode"
  | "slots"
  | "attachments"
  | "replacement"
  | "actions"
  | "compatibility";

export type EquipmentWorkspacePane = "library" | "wizard" | "loadout";

export type FocusZoomTarget = "none" | "eye" | "hand" | "body";

export const EQUIPMENT_WIZARD_STEPS: readonly EquipmentWizardStep[] = [
  "identity",
  "visualMode",
  "slots",
  "attachments",
  "replacement",
  "actions",
  "compatibility",
] as const;

export type EquipmentUiAction =
  | { type: "setPane"; pane: EquipmentWorkspacePane }
  | { type: "setWizardStep"; step: EquipmentWizardStep }
  | { type: "selectEquipment"; equipmentId: string | null }
  | { type: "selectAttachment"; attachmentId: string | null }
  | { type: "selectBodyProfile"; bodyProfileId: string }
  | { type: "replaceLibrary"; equipment: EquipmentDefinition[]; selectedId?: string | null }
  | { type: "createEquipment"; equipment: EquipmentDefinition }
  | { type: "deleteEquipment"; equipmentId: string }
  | { type: "patchDraft"; patch: Partial<EquipmentDefinition> }
  | { type: "setVisualMode"; visualMode: EquipmentVisualMode }
  | { type: "setPrimarySlot"; slotId: string }
  | { type: "setOccupiedSlots"; slotIds: string[] }
  | { type: "addAttachment"; attachment: EquipmentAttachment }
  | { type: "deleteAttachment"; attachmentId: string }
  | { type: "patchAttachment"; attachmentId: string; patch: Omit<Partial<EquipmentAttachment>, "rest" | "size" | "pivot"> & { size?: EquipmentAttachment["size"]; pivot?: EquipmentAttachment["pivot"]; rest?: Partial<Transform> } }
  | { type: "mirrorAttachment"; attachmentId: string; pairId: string; socketId: string }
  | { type: "setEffectBindings"; bindings: EquipmentEffectBinding[] }
  | { type: "setActionOverrides"; overrides: Record<string, string> }
  | { type: "setFocusZoom"; focus: FocusZoomTarget }
  | { type: "setPreviewTime"; time: number }
  | { type: "setFacing"; facing: "left" | "right" }
  | { type: "setShowHiddenBase"; show: boolean }
  | { type: "setIsolateSelected"; isolate: boolean }
  | { type: "tryEquip"; equipmentId: string }
  | { type: "unequip"; equipmentId: string }
  | { type: "saveLoadout"; name: string }
  | { type: "loadSavedLoadout"; name: string }
  | { type: "deleteSavedLoadout"; name: string }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "markSaved"; equipment: EquipmentDefinition }
  | { type: "replaceDraft"; equipment: EquipmentDefinition };

export interface SavedTestLoadout {
  name: string;
  loadout: CharacterLoadout;
}

export interface EquipmentUiState {
  pane: EquipmentWorkspacePane;
  wizardStep: EquipmentWizardStep;
  library: EquipmentDefinition[];
  saved: EquipmentDefinition | null;
  draft: EquipmentDefinition | null;
  selectedEquipmentId: string | null;
  selectedAttachmentId: string | null;
  selectedBodyProfileId: string;
  previewLoadout: CharacterLoadout;
  legalPreview: AssembledLoadout | null;
  conflictIssues: ValidationIssue[];
  savedLoadouts: SavedTestLoadout[];
  focusZoom: FocusZoomTarget;
  previewTime: number;
  facing: "left" | "right";
  showHiddenBase: boolean;
  isolateSelected: boolean;
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

function pushHistory(state: EquipmentUiState, nextDraft: EquipmentDefinition): EquipmentUiState {
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

function mirrorRestX(rest: Transform): Transform {
  return {
    translation: [-rest.translation[0], rest.translation[1], rest.translation[2]],
    rotation: [...rest.rotation] as Transform["rotation"],
    scale: [...rest.scale] as Transform["scale"],
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

function definitionsForPreview(state: EquipmentUiState): EquipmentDefinition[] {
  if (!state.draft) return state.library.map(cloneEquipment);
  return upsertLibrary(state.library, state.draft);
}

function recomputePreview(
  state: EquipmentUiState,
  body: BodyProfile | null,
  binding: CharacterBinding | null,
  nextLoadout: CharacterLoadout,
): Pick<EquipmentUiState, "previewLoadout" | "legalPreview" | "conflictIssues"> {
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

export function createEmptyEquipment(
  id: string,
  name: string,
  body: BodyProfile,
  visualMode: EquipmentVisualMode = "attached",
): EquipmentDefinition {
  const primarySlot = body.slots[0]?.id ?? "slot";
  return {
    schemaVersion: EQUIPMENT_SCHEMA_VERSION,
    id,
    name,
    tags: [],
    visualMode,
    primarySlot,
    occupiedSlots: body.slots.some((slot) => slot.id === primarySlot) ? [primarySlot] : [],
    conflictTags: [],
    replacesParts: [],
    hidesSlots: [],
    attachments: [],
    effectBindings: [],
    actionOverrides: {},
  };
}

export function createEmptyAttachment(
  id: string,
  name: string,
  socket: string,
  materialId = "mat-placeholder",
): EquipmentAttachment {
  return {
    id,
    name,
    socket,
    materialId,
    imageSlot: "raw",
    size: [16, 16],
    pivot: [0.5, 0.5],
    rest: identityTransform(),
    drawGroup: "equipment",
    drawOffset: 0,
  };
}

export function createEquipmentUiState(
  library: EquipmentDefinition[],
  body: BodyProfile | null,
  binding: CharacterBinding | null = null,
  savedLoadouts: SavedTestLoadout[] = [],
): EquipmentUiState {
  const selected = library[0] ?? null;
  const bodyId = body?.id ?? "";
  const base: EquipmentUiState = {
    pane: "library",
    wizardStep: "identity",
    library: library.map(cloneEquipment),
    saved: selected ? cloneEquipment(selected) : null,
    draft: selected ? cloneEquipment(selected) : null,
    selectedEquipmentId: selected?.id ?? null,
    selectedAttachmentId: selected?.attachments[0]?.id ?? null,
    selectedBodyProfileId: bodyId,
    previewLoadout: emptyLoadout(bodyId),
    legalPreview: null,
    conflictIssues: [],
    savedLoadouts: savedLoadouts.map((item) => ({ name: item.name, loadout: cloneLoadout(item.loadout) })),
    focusZoom: "none",
    previewTime: 0,
    facing: "right",
    showHiddenBase: false,
    isolateSelected: false,
    past: [],
    future: [],
  };
  if (!body || !binding) return base;
  const preview = recomputePreview(base, body, binding, base.previewLoadout);
  return { ...base, ...preview };
}

export function isEquipmentDirty(state: EquipmentUiState): boolean {
  return !equipmentEqual(state.draft, state.saved);
}

export function equipmentWizardBlockingIssues(
  draft: EquipmentDefinition | null,
  body: BodyProfile | null,
  step?: EquipmentWizardStep,
): ValidationIssue[] {
  if (!draft) return [{ path: "draft", message: "尚未选择装备" }];
  if (!body) return [{ path: "bodyProfileId", message: "缺少 BodyProfile" }];
  const issues: ValidationIssue[] = [];
  if (!draft.name.trim()) issues.push({ path: "name", message: "名称不能为空" });
  if (step === "identity" || !step) {
    if (!draft.tags.length && draft.visualMode !== "none") {
      // tags optional at identity, but recommended; no hard block
    }
  }
  if (step === "slots" || !step) {
    if (!draft.occupiedSlots.includes(draft.primarySlot)) {
      issues.push({ path: "primarySlot", message: "主插槽必须被占用" });
    }
  }
  if (step === "attachments" || step === "visualMode" || !step) {
    if ((draft.visualMode === "attached" || draft.visualMode === "replacement") && draft.attachments.length === 0) {
      issues.push({ path: "attachments", message: `${draft.visualMode} 模式需要至少一个附件` });
    }
    if ((draft.visualMode === "none" || draft.visualMode === "effect") && draft.attachments.length > 0) {
      issues.push({ path: "attachments", message: `${draft.visualMode} 模式不能有持久附件` });
    }
  }
  if (step === "replacement" || !step) {
    if (draft.visualMode === "replacement" && draft.replacesParts.length === 0) {
      issues.push({ path: "replacesParts", message: "replacement 模式需要声明替换部件" });
    }
  }
  if (step === "actions" || !step) {
    if (draft.visualMode === "effect" && !(draft.effectBindings?.length)) {
      issues.push({ path: "effectBindings", message: "effect 模式需要至少一个效果绑定" });
    }
  }
  const validated = validateEquipmentDefinition(draft, body);
  if (!step) return [...issues, ...validated.issues];
  const stepPaths: Record<EquipmentWizardStep, string[]> = {
    identity: ["identity", "name", "tags", "schemaVersion"],
    visualMode: ["visualMode", "attachments"],
    slots: ["primarySlot", "occupiedSlots", "conflictTags"],
    attachments: ["attachments"],
    replacement: ["replacesParts", "hidesSlots"],
    actions: ["effectBindings", "actionOverrides", "actionProfile", "weapon"],
    compatibility: [],
  };
  const allowed = new Set(stepPaths[step]);
  const filtered = validated.issues.filter((issue) => {
    if (!allowed.size) return true;
    return [...allowed].some((prefix) => issue.path === prefix || issue.path.startsWith(`${prefix}.`) || issue.path.startsWith(`${prefix}[`));
  });
  return [...issues, ...filtered];
}

export function canCompleteEquipmentWizard(draft: EquipmentDefinition | null, body: BodyProfile | null): boolean {
  return equipmentWizardBlockingIssues(draft, body).length === 0;
}

export function focusZoomForSocketSemantic(semantic: string): FocusZoomTarget {
  if (semantic.includes("eye")) return "eye";
  if (semantic.includes("hand") || semantic.includes("weapon_hand")) return "hand";
  if (semantic === "head" || semantic === "chest" || semantic === "back" || semantic === "neck" || semantic === "face") {
    return "body";
  }
  return "none";
}

export function attachmentRotationDegrees(rest: Transform): number {
  return (zRotationFromQuaternion(rest.rotation) * 180) / Math.PI;
}

export function setAttachmentRotationDegrees(rest: Transform, degrees: number): Transform {
  return {
    ...rest,
    rotation: quaternionFromZRotation((degrees * Math.PI) / 180),
  };
}

export function reduceEquipmentUi(
  state: EquipmentUiState,
  action: EquipmentUiAction,
  body: BodyProfile | null,
  binding: CharacterBinding | null = null,
): EquipmentUiState {
  switch (action.type) {
    case "setPane":
      return { ...state, pane: action.pane };
    case "setWizardStep":
      return { ...state, pane: "wizard", wizardStep: action.step };
    case "selectEquipment": {
      const selected = action.equipmentId
        ? state.library.find((item) => item.id === action.equipmentId) ?? null
        : null;
      return {
        ...state,
        selectedEquipmentId: selected?.id ?? null,
        saved: selected ? cloneEquipment(selected) : null,
        draft: selected ? cloneEquipment(selected) : null,
        selectedAttachmentId: selected?.attachments[0]?.id ?? null,
        past: [],
        future: [],
        pane: selected ? "wizard" : state.pane,
        wizardStep: "identity",
      };
    }
    case "selectAttachment":
      return { ...state, selectedAttachmentId: action.attachmentId };
    case "selectBodyProfile": {
      const nextLoadout = { ...cloneLoadout(state.previewLoadout), bodyProfileId: action.bodyProfileId };
      const preview = recomputePreview({ ...state, selectedBodyProfileId: action.bodyProfileId }, body, binding, nextLoadout);
      return { ...state, selectedBodyProfileId: action.bodyProfileId, ...preview };
    }
    case "replaceLibrary": {
      const selected = action.selectedId !== undefined
        ? (action.selectedId ? action.equipment.find((item) => item.id === action.selectedId) ?? null : null)
        : (action.equipment.find((item) => item.id === state.selectedEquipmentId) ?? action.equipment[0] ?? null);
      return {
        ...state,
        library: action.equipment.map(cloneEquipment),
        selectedEquipmentId: selected?.id ?? null,
        saved: selected ? cloneEquipment(selected) : null,
        draft: selected ? cloneEquipment(selected) : null,
        selectedAttachmentId: selected?.attachments[0]?.id ?? null,
        past: [],
        future: [],
      };
    }
    case "createEquipment": {
      const nextLibrary = upsertLibrary(state.library, action.equipment);
      return {
        ...state,
        library: nextLibrary,
        selectedEquipmentId: action.equipment.id,
        saved: null,
        draft: cloneEquipment(action.equipment),
        selectedAttachmentId: action.equipment.attachments[0]?.id ?? null,
        pane: "wizard",
        wizardStep: "identity",
        past: [],
        future: [],
      };
    }
    case "deleteEquipment": {
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
        selectedAttachmentId: selected?.attachments[0]?.id ?? null,
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
    case "setVisualMode": {
      if (!state.draft) return state;
      const next = cloneEquipment(state.draft);
      next.visualMode = action.visualMode;
      if (action.visualMode === "none" || action.visualMode === "effect") {
        next.attachments = [];
      }
      if (action.visualMode !== "replacement") {
        next.replacesParts = [];
      }
      if (action.visualMode !== "effect") {
        next.effectBindings = [];
      } else if (!next.effectBindings) {
        next.effectBindings = [];
      }
      return {
        ...pushHistory(state, next),
        selectedAttachmentId: next.attachments[0]?.id ?? null,
      };
    }
    case "setPrimarySlot": {
      if (!state.draft) return state;
      const occupied = new Set(state.draft.occupiedSlots);
      occupied.add(action.slotId);
      const next = {
        ...cloneEquipment(state.draft),
        primarySlot: action.slotId,
        occupiedSlots: [...occupied],
      };
      return pushHistory(state, next);
    }
    case "setOccupiedSlots": {
      if (!state.draft) return state;
      const slots = [...new Set(action.slotIds)];
      if (!slots.includes(state.draft.primarySlot) && state.draft.primarySlot) {
        slots.unshift(state.draft.primarySlot);
      }
      return pushHistory(state, { ...cloneEquipment(state.draft), occupiedSlots: slots });
    }
    case "addAttachment": {
      if (!state.draft) return state;
      if (state.draft.visualMode === "none" || state.draft.visualMode === "effect") return state;
      if (state.draft.attachments.some((item) => item.id === action.attachment.id)) return state;
      const next = {
        ...cloneEquipment(state.draft),
        attachments: [...state.draft.attachments, structuredClone(action.attachment)],
      };
      return { ...pushHistory(state, next), selectedAttachmentId: action.attachment.id };
    }
    case "deleteAttachment": {
      if (!state.draft) return state;
      const nextAttachments = state.draft.attachments.filter((item) => item.id !== action.attachmentId);
      const next = { ...cloneEquipment(state.draft), attachments: nextAttachments };
      return {
        ...pushHistory(state, next),
        selectedAttachmentId: state.selectedAttachmentId === action.attachmentId
          ? (nextAttachments[0]?.id ?? null)
          : state.selectedAttachmentId,
      };
    }
    case "patchAttachment": {
      if (!state.draft) return state;
      if (!state.draft.attachments.some((item) => item.id === action.attachmentId)) return state;
      const next = {
        ...cloneEquipment(state.draft),
        attachments: state.draft.attachments.map((item) => {
          if (item.id !== action.attachmentId) return item;
          const { rest, ...restPatch } = action.patch;
          return {
            ...item,
            ...restPatch,
            size: action.patch.size ? [...action.patch.size] as EquipmentAttachment["size"] : item.size,
            pivot: action.patch.pivot ? [...action.patch.pivot] as EquipmentAttachment["pivot"] : item.pivot,
            rest: patchRest(item.rest, rest),
          };
        }),
      };
      return pushHistory(state, next);
    }
    case "mirrorAttachment": {
      if (!state.draft) return state;
      const source = state.draft.attachments.find((item) => item.id === action.attachmentId);
      if (!source || state.draft.attachments.some((item) => item.id === action.pairId)) return state;
      const pair: EquipmentAttachment = {
        ...structuredClone(source),
        id: action.pairId,
        name: `${source.name}-mirror`,
        socket: action.socketId,
        rest: mirrorRestX(source.rest),
      };
      const next = {
        ...cloneEquipment(state.draft),
        attachments: [...state.draft.attachments, pair],
      };
      return { ...pushHistory(state, next), selectedAttachmentId: pair.id };
    }
    case "setEffectBindings": {
      if (!state.draft) return state;
      return pushHistory(state, { ...cloneEquipment(state.draft), effectBindings: structuredClone(action.bindings) });
    }
    case "setActionOverrides": {
      if (!state.draft) return state;
      return pushHistory(state, { ...cloneEquipment(state.draft), actionOverrides: { ...action.overrides } });
    }
    case "setFocusZoom":
      return { ...state, focusZoom: action.focus };
    case "setPreviewTime":
      return { ...state, previewTime: Math.max(0, action.time) };
    case "setFacing":
      return { ...state, facing: action.facing };
    case "setShowHiddenBase":
      return { ...state, showHiddenBase: action.show };
    case "setIsolateSelected":
      return { ...state, isolateSelected: action.isolate };
    case "tryEquip": {
      const definition = definitionsForPreview(state).find((item) => item.id === action.equipmentId);
      if (!definition) {
        return {
          ...state,
          conflictIssues: [{ path: "equipmentId", message: "装备不存在" }],
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
    case "saveLoadout": {
      const name = action.name.trim();
      if (!name) return state;
      const entry = { name, loadout: cloneLoadout(state.previewLoadout) };
      const savedLoadouts = state.savedLoadouts.some((item) => item.name === name)
        ? state.savedLoadouts.map((item) => item.name === name ? entry : item)
        : [...state.savedLoadouts, entry];
      return { ...state, savedLoadouts };
    }
    case "loadSavedLoadout": {
      const found = state.savedLoadouts.find((item) => item.name === action.name);
      if (!found) return state;
      return { ...state, ...recomputePreview(state, body, binding, cloneLoadout(found.loadout)) };
    }
    case "deleteSavedLoadout":
      return {
        ...state,
        savedLoadouts: state.savedLoadouts.filter((item) => item.name !== action.name),
      };
    case "undo": {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return {
        ...state,
        draft: cloneEquipment(previous),
        past: state.past.slice(0, -1),
        future: state.draft ? [...state.future, cloneEquipment(state.draft)] : state.future,
        selectedAttachmentId: previous.attachments.some((item) => item.id === state.selectedAttachmentId)
          ? state.selectedAttachmentId
          : (previous.attachments[0]?.id ?? null),
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
        selectedAttachmentId: next.attachments.some((item) => item.id === state.selectedAttachmentId)
          ? state.selectedAttachmentId
          : (next.attachments[0]?.id ?? null),
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
        selectedAttachmentId: action.equipment.attachments.some((item) => item.id === state.selectedAttachmentId)
          ? state.selectedAttachmentId
          : (action.equipment.attachments[0]?.id ?? null),
        past: [],
        future: [],
      };
    default:
      return state;
  }
}
