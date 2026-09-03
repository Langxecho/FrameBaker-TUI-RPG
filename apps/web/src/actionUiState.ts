import {
  STANDARD_ACTION_EVENTS,
  compileActionSet,
  validateReloadEventOrder,
  type ActionInterrupt,
  type ActionLayerSource,
  type ActionTemplate,
  type BodyProfile,
  type CharacterLoadout,
  type CompiledAction,
  type EquipmentDefinition,
  type MotionClip,
  type MotionEvent,
  type ValidationIssue,
} from "@framebaker/shared";

export { STANDARD_ACTION_EVENTS };
export type { ActionLayerSource };

export function stubMotionClip(input: {
  id: string;
  name: string;
  skeletonId: string;
  loop?: boolean;
}): MotionClip {
  return {
    schemaVersion: 1,
    kind: "motion-clip",
    id: input.id,
    name: input.name,
    skeletonId: input.skeletonId,
    duration: 1,
    loop: Boolean(input.loop),
    tracks: [],
    events: [],
    provenance: { source: "manual" },
  };
}

export function fillMissingActionClips(snapshot: ActionUiSnapshot, skeletonId: string): ActionUiSnapshot {
  const clips = { ...snapshot.clips };
  const maps = [snapshot.baseActions, snapshot.stanceActions, snapshot.equipmentOverrides, snapshot.equipmentCorrections];
  for (const map of maps) {
    for (const [actionId, clipId] of Object.entries(map)) {
      if (!clipId || clips[clipId]) continue;
      const template = snapshot.templates.find((item) => item.id === actionId);
      clips[clipId] = stubMotionClip({
        id: clipId,
        name: actionId,
        skeletonId,
        loop: template?.loop,
      });
    }
  }
  return { ...snapshot, clips };
}

/** 类型 `movement.footstep.left` → 默认名称 `left`。 */
export function defaultSemanticEventName(type: string): string {
  const last = type.trim().split(".").filter(Boolean).pop();
  return last || "event";
}

/** 表单曾默认名称 fire；类型已改成脚步时不要把 fire 当作风脚名称。 */
export function resolveSemanticEventName(type: string, name: string): string {
  const trimmed = name.trim();
  const derived = defaultSemanticEventName(type);
  if (!trimmed) return derived;
  if (trimmed === "fire" && type !== "weapon.fire") return derived;
  return trimmed;
}

/** 时间轴标签用类型后两段，避免只显示错误的短名称。 */
export function semanticEventDisplayLabel(type: string): string {
  const parts = type.trim().split(".").filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return parts[0] || type;
}

/** 把时间轴条上的指针位置换成秒；宽度无效时返回 0。 */
export function seekTimeFromStrip(clientX: number, left: number, width: number, duration: number): number {
  if (!(width > 0) || !(duration > 0)) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  return ratio * duration;
}

export const ACTION_TEMPLATE_KINDS = [
  "idle",
  "move",
  "aim",
  "fire",
  "reload",
  "hit",
  "death",
  "custom",
] as const;

export type ActionTemplateKind = (typeof ACTION_TEMPLATE_KINDS)[number];

export type ActionWorkspacePane = "tree" | "events" | "matrix";

export type OwnedActionLayer = "base" | "stance" | "equipment" | "correction";

export interface ActionTemplateSeed {
  template: ActionTemplate;
  recommendedKeyPoses: readonly ["start", "anticipation", "action", "recovery"];
  kind: ActionTemplateKind;
}

export interface CompatibilityCell {
  id: string;
  ok: boolean;
  actionId: string;
  bodyProfileId: string;
  weaponId: string | null;
  handedness: "left" | "right" | null;
  cyberlimbId: string | null;
  loadoutName: string | null;
  failureTime: number | null;
  reason: string | null;
}

export interface CompatibilityMatrix {
  actionId: string;
  cells: CompatibilityCell[];
}

export interface ActionUiSnapshot {
  templates: ActionTemplate[];
  clips: Record<string, MotionClip>;
  baseActions: Record<string, string>;
  stanceActions: Record<string, string>;
  equipmentOverrides: Record<string, string>;
  equipmentCorrections: Record<string, string>;
}

export interface ActionUiState extends ActionUiSnapshot {
  saved: ActionUiSnapshot;
  selectedActionId: string | null;
  layerSource: ActionLayerSource;
  ownedLayer: OwnedActionLayer;
  pane: ActionWorkspacePane;
  previewTime: number;
  selectedBodyProfileId: string | null;
  selectedLoadoutName: string | null;
  selectedHandedness: "left" | "right";
  eventIssues: ValidationIssue[];
  muzzlePlaceholder: { time: number; socketId: string } | null;
  bodyProfiles: BodyProfile[];
  equipment: EquipmentDefinition[];
  loadouts: Array<{ name: string; loadout: CharacterLoadout }>;
  past: ActionUiSnapshot[];
  future: ActionUiSnapshot[];
}

export type ActionUiAction =
  | { type: "selectAction"; actionId: string | null }
  | { type: "setLayerSource"; source: ActionLayerSource }
  | { type: "setOwnedLayer"; layer: OwnedActionLayer }
  | { type: "setPane"; pane: ActionWorkspacePane }
  | { type: "setPreviewTime"; time: number }
  | { type: "createFromTemplate"; kind: ActionTemplateKind; actionId: string; clipId?: string }
  | { type: "patchTemplate"; actionId: string; patch: Partial<ActionTemplate> }
  | { type: "deleteAction"; actionId: string }
  | { type: "upsertClip"; clip: MotionClip }
  | { type: "patchOwnedClip"; clip: MotionClip }
  | { type: "bindLayerClip"; actionId: string; layer: OwnedActionLayer; clipId: string }
  | { type: "addSemanticEvent"; eventType: string; name: string; socketId?: string; time?: number }
  | { type: "deleteEvent"; index: number }
  | { type: "loadCompatibilityFailure"; cell: CompatibilityCell }
  | { type: "selectBodyProfile"; bodyProfileId: string }
  | { type: "selectLoadout"; name: string | null }
  | { type: "setHandedness"; handedness: "left" | "right" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "markSaved" }
  | { type: "hydrateClips"; clips: Record<string, MotionClip> }
  | { type: "replaceAll"; snapshot: ActionUiSnapshot };

const KEY_POSES = ["start", "anticipation", "action", "recovery"] as const;

function cloneSnapshot(value: ActionUiSnapshot): ActionUiSnapshot {
  return {
    templates: structuredClone(value.templates),
    clips: structuredClone(value.clips),
    baseActions: { ...value.baseActions },
    stanceActions: { ...value.stanceActions },
    equipmentOverrides: { ...value.equipmentOverrides },
    equipmentCorrections: { ...value.equipmentCorrections },
  };
}

function snapshotsEqual(a: ActionUiSnapshot, b: ActionUiSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function asSnapshot(state: ActionUiState): ActionUiSnapshot {
  return {
    templates: state.templates,
    clips: state.clips,
    baseActions: state.baseActions,
    stanceActions: state.stanceActions,
    equipmentOverrides: state.equipmentOverrides,
    equipmentCorrections: state.equipmentCorrections,
  };
}

function pushHistory(state: ActionUiState, next: ActionUiSnapshot): ActionUiState {
  if (snapshotsEqual(asSnapshot(state), next)) return { ...state, ...next };
  return {
    ...state,
    ...next,
    past: [...state.past, cloneSnapshot(asSnapshot(state))],
    future: [],
  };
}

function defaultInterrupt(kind: ActionTemplateKind): ActionInterrupt {
  if (kind === "hit" || kind === "death") return "non-interruptible";
  if (kind === "fire" || kind === "reload") return "event-boundary";
  return "immediate";
}

function requiredEventsFor(kind: ActionTemplateKind): string[] {
  switch (kind) {
    case "fire":
      return ["weapon.fire"];
    case "reload":
      return ["weapon.reload.detach", "weapon.reload.attach", "weapon.reload.complete"];
    case "hit":
      return ["combat.hitbox.start"];
    case "move":
      return ["movement.footstep.left", "movement.footstep.right"];
    default:
      return [];
  }
}

function allowedEventsFor(kind: ActionTemplateKind): string[] {
  if (kind === "custom") return [...STANDARD_ACTION_EVENTS];
  const base = new Set<string>(requiredEventsFor(kind));
  if (kind === "fire") {
    base.add("weapon.eject");
    base.add("effect.trigger");
  }
  if (kind === "reload") {
    base.add("effect.trigger");
    base.add("equipment.activate");
  }
  if (kind === "aim" || kind === "idle") {
    base.add("effect.trigger");
  }
  if (kind === "death" || kind === "hit") {
    base.add("combat.hitbox.end");
    base.add("combat.invulnerable.start");
    base.add("combat.invulnerable.end");
  }
  if (kind === "move") {
    base.add("movement.footstep.left");
    base.add("movement.footstep.right");
  }
  return [...base];
}

export function createActionFromTemplate(kind: ActionTemplateKind, actionId: string): ActionTemplateSeed {
  const loop = kind === "idle" || kind === "move" || kind === "aim";
  const template: ActionTemplate = {
    id: actionId,
    loop,
    requiredTracks: kind === "custom" ? [] : ["root"],
    requiredEvents: requiredEventsFor(kind),
    allowedEvents: allowedEventsFor(kind),
    contactRules: [],
    constraintRules: kind === "aim" || kind === "fire" || kind === "reload" ? ["two-bone-ik"] : [],
    fallbackAction: kind === "idle" ? undefined : "idle",
    defaultInterrupt: defaultInterrupt(kind),
    defaultBlendMs: kind === "hit" || kind === "death" ? 0 : 80,
  };
  return { template, recommendedKeyPoses: KEY_POSES, kind };
}

export function createActionUiState(input: {
  templates?: ActionTemplate[];
  clips?: Record<string, MotionClip>;
  baseActions?: Record<string, string>;
  stanceActions?: Record<string, string>;
  equipmentOverrides?: Record<string, string>;
  equipmentCorrections?: Record<string, string>;
  bodyProfiles?: BodyProfile[];
  equipment?: EquipmentDefinition[];
  loadouts?: Array<{ name: string; loadout: CharacterLoadout }>;
  ownedLayer?: OwnedActionLayer;
  skeletonId?: string;
}): ActionUiState {
  const snapshot = fillMissingActionClips({
    templates: structuredClone(input.templates ?? []),
    clips: structuredClone(input.clips ?? {}),
    baseActions: { ...(input.baseActions ?? {}) },
    stanceActions: { ...(input.stanceActions ?? {}) },
    equipmentOverrides: { ...(input.equipmentOverrides ?? {}) },
    equipmentCorrections: { ...(input.equipmentCorrections ?? {}) },
  }, input.skeletonId ?? input.bodyProfiles?.[0]?.skeletonId ?? "skeleton");
  const firstAction = snapshot.templates[0]?.id
    ?? Object.keys(snapshot.baseActions)[0]
    ?? null;
  return {
    ...snapshot,
    saved: cloneSnapshot(snapshot),
    selectedActionId: firstAction,
    layerSource: input.ownedLayer ?? "base",
    // 默认编辑基础层，避免重开页面后「插入事件 / 编辑轨道」灰掉或按钮消失
    ownedLayer: input.ownedLayer ?? "base",
    pane: "tree",
    previewTime: 0,
    selectedBodyProfileId: input.bodyProfiles?.[0]?.id ?? null,
    selectedLoadoutName: input.loadouts?.[0]?.name ?? null,
    selectedHandedness: "right",
    eventIssues: [],
    muzzlePlaceholder: null,
    bodyProfiles: input.bodyProfiles ?? [],
    equipment: input.equipment ?? [],
    loadouts: input.loadouts ?? [],
    past: [],
    future: [],
  };
}

export function isActionDirty(state: ActionUiState): boolean {
  return !snapshotsEqual(asSnapshot(state), state.saved);
}

export function canEditOwnedLayer(state: ActionUiState): boolean {
  return state.layerSource === state.ownedLayer;
}

function layerMapKey(layer: OwnedActionLayer): keyof Pick<ActionUiSnapshot, "baseActions" | "stanceActions" | "equipmentOverrides" | "equipmentCorrections"> {
  switch (layer) {
    case "base": return "baseActions";
    case "stance": return "stanceActions";
    case "equipment": return "equipmentOverrides";
    case "correction": return "equipmentCorrections";
  }
}

export function compileSelectedAction(state: ActionUiState): CompiledAction | null {
  if (!state.selectedActionId) return null;
  const result = compileActionSet({
    actionIds: [state.selectedActionId],
    clips: state.clips,
    baseActions: state.baseActions,
    stanceActions: state.stanceActions,
    equipmentOverrides: state.equipmentOverrides,
    equipmentCorrections: state.equipmentCorrections,
    templates: state.templates,
    ownedLayer: state.ownedLayer,
  });
  return result.actions[0] ?? null;
}

export function inspectLayerClip(state: ActionUiState): MotionClip | null {
  const compiled = compileSelectedAction(state);
  if (!compiled) return null;
  if (state.layerSource === "composed") return compiled.clip;
  return compiled.layers.find((layer) => layer.source === state.layerSource)?.clip ?? null;
}

export function ownedLayerClipId(state: ActionUiState): string | undefined {
  if (!state.selectedActionId) return undefined;
  return state[layerMapKey(state.ownedLayer)][state.selectedActionId];
}

/** 弹窗编辑用的真实资产 ID；合成层的 runtime:* 剪辑不能拿去打开编辑器。 */
export function editableMotionClipId(state: ActionUiState): string | undefined {
  const inspected = inspectLayerClip(state);
  if (inspected && !inspected.id.startsWith("runtime:")) return inspected.id;
  return ownedLayerClipId(state);
}

export function validateActionEvents(
  events: readonly MotionEvent[],
  template?: ActionTemplate,
): { ok: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const allowed = new Set<string>([
    ...STANDARD_ACTION_EVENTS,
    ...(template?.allowedEvents ?? []),
  ]);
  for (const event of events) {
    if (!allowed.has(event.type)) {
      issues.push({ path: "events", message: `未知或未允许的事件 ${event.type}` });
    }
  }
  if (template) {
    for (const required of template.requiredEvents) {
      if (!events.some((event) => event.type === required)) {
        issues.push({ path: "events", message: `缺少必需事件 ${required}` });
      }
    }
  }
  const reload = validateReloadEventOrder(events);
  issues.push(...reload.issues);
  return { ok: issues.length === 0, issues };
}

export function insertSemanticEvent(
  clip: MotionClip,
  event: MotionEvent,
  template?: ActionTemplate,
): { ok: boolean; clip?: MotionClip; issues: ValidationIssue[] } {
  const type = event.type.trim();
  const name = resolveSemanticEventName(type, event.name);
  if (!type || !name) {
    return { ok: false, issues: [{ path: "events", message: "事件类型和名称不能为空" }] };
  }
  const allowed = new Set<string>([...STANDARD_ACTION_EVENTS, ...(template?.allowedEvents ?? [])]);
  if (!allowed.has(type)) {
    return { ok: false, issues: [{ path: "events", message: `未知事件类型 ${type}` }] };
  }
  if (type === "weapon.fire") {
    const socket = event.payload && typeof event.payload.socket === "string" ? event.payload.socket : undefined;
    if (!socket) {
      return { ok: false, issues: [{ path: "events.weapon.fire", message: "weapon.fire 需要 muzzle 插座" }] };
    }
  }
  const nextEvents = [...clip.events, { ...event, type, name }]
    .sort((a, b) => a.time - b.time);
  const validation = validateActionEvents(nextEvents, template);
  // reload order may be incomplete while authoring — still apply clip but surface issues
  const nextClip: MotionClip = { ...clip, events: nextEvents } as MotionClip;
  return { ok: validation.ok || nextEvents.length > 0, clip: nextClip, issues: validation.issues };
}

function recomputeEventIssues(state: ActionUiState): ValidationIssue[] {
  if (!state.selectedActionId) return [];
  const template = state.templates.find((item) => item.id === state.selectedActionId);
  const clip = inspectLayerClip({ ...state, layerSource: state.ownedLayer }) ?? inspectLayerClip(state);
  if (!clip) return [];
  return validateActionEvents(clip.events, template).issues;
}

export function evaluateCompatibilityMatrix(input: {
  actionId: string;
  bodyProfiles: BodyProfile[];
  equipment: EquipmentDefinition[];
  weapons: EquipmentDefinition[];
  handedness: Array<"left" | "right">;
  cyberlimbs: EquipmentDefinition[];
  loadouts: Array<{ name: string; loadout: CharacterLoadout }>;
  clips: Record<string, MotionClip>;
  baseActions: Record<string, string>;
  stanceActions?: Record<string, string>;
  equipmentOverridesById?: Record<string, Record<string, string>>;
}): CompatibilityMatrix {
  const cells: CompatibilityCell[] = [];
  const bodies = input.bodyProfiles.length ? input.bodyProfiles : [{ id: "_", name: "_", schemaVersion: 1, skeletonId: "", mirrorAxis: "x" as const, slots: [], sockets: [] }];
  const weapons = input.weapons.length ? input.weapons : [null];
  const hands = input.handedness.length ? input.handedness : [null];
  const cybers = input.cyberlimbs.length ? input.cyberlimbs : [null];
  const loadouts = input.loadouts.length ? input.loadouts : [{ name: null as string | null, loadout: null as CharacterLoadout | null }];

  for (const body of bodies) {
    for (const weapon of weapons) {
      for (const hand of hands) {
        for (const cyber of cybers) {
          for (const entry of loadouts) {
            const overrides = {
              ...(input.stanceActions ?? {}),
            };
            const equipmentOverrides: Record<string, string> = {};
            if (weapon && input.equipmentOverridesById?.[weapon.id]) {
              Object.assign(equipmentOverrides, input.equipmentOverridesById[weapon.id]);
            }
            if (entry.loadout) {
              for (const equipped of entry.loadout.equipment) {
                const def = input.equipment.find((item) => item.id === equipped.equipmentId);
                if (def?.actionOverrides) Object.assign(equipmentOverrides, def.actionOverrides);
                if (input.equipmentOverridesById?.[equipped.equipmentId]) {
                  Object.assign(equipmentOverrides, input.equipmentOverridesById[equipped.equipmentId]);
                }
              }
            }
            const compiled = compileActionSet({
              actionIds: [input.actionId],
              clips: input.clips,
              baseActions: input.baseActions,
              stanceActions: input.stanceActions,
              equipmentOverrides,
            });
            const action = compiled.actions[0];
            let ok = compiled.ok && !!action;
            let failureTime: number | null = null;
            let reason: string | null = null;
            if (action) {
              const reload = validateReloadEventOrder(action.clip.events);
              if (!reload.ok) {
                ok = false;
                reason = reload.issues[0]?.message ?? "reload order";
                const complete = action.clip.events.find((event) => event.type === "weapon.reload.complete");
                const attach = action.clip.events.find((event) => event.type === "weapon.reload.attach");
                failureTime = complete?.time ?? attach?.time ?? action.clip.events[0]?.time ?? 0;
              } else if (action.diagnostics.length) {
                const hard = action.diagnostics.find((item) =>
                  item.message.includes("缺失") || item.message.includes("不在允许") || item.message.includes("缺少必需"),
                );
                if (hard) {
                  ok = false;
                  reason = hard.message;
                  failureTime = 0;
                }
              }
              if (weapon?.weapon?.holdMode === "two_hand" && hand === "left" && weapon.weapon.preferredPrimaryHand === "right" && !weapon.weapon.mirrorAllowed) {
                ok = false;
                reason = "handedness not allowed";
                failureTime = 0;
              }
            } else {
              ok = false;
              reason = "compile failed";
              failureTime = 0;
            }
            cells.push({
              id: [body.id, weapon?.id ?? "-", hand ?? "-", cyber?.id ?? "-", entry.name ?? "-"].join("|"),
              ok,
              actionId: input.actionId,
              bodyProfileId: body.id,
              weaponId: weapon?.id ?? null,
              handedness: hand,
              cyberlimbId: cyber?.id ?? null,
              loadoutName: entry.name,
              failureTime: ok ? null : failureTime,
              reason: ok ? null : reason,
            });
          }
        }
      }
    }
  }
  return { actionId: input.actionId, cells };
}

export function reduceActionUi(state: ActionUiState, action: ActionUiAction): ActionUiState {
  switch (action.type) {
    case "selectAction":
      return { ...state, selectedActionId: action.actionId, eventIssues: [], muzzlePlaceholder: null };
    case "setLayerSource":
      return { ...state, layerSource: action.source };
    case "setOwnedLayer":
      return { ...state, ownedLayer: action.layer, layerSource: action.layer };
    case "setPane":
      return { ...state, pane: action.pane };
    case "setPreviewTime":
      return { ...state, previewTime: Math.max(0, action.time) };
    case "selectBodyProfile":
      return { ...state, selectedBodyProfileId: action.bodyProfileId };
    case "selectLoadout":
      return { ...state, selectedLoadoutName: action.name };
    case "setHandedness":
      return { ...state, selectedHandedness: action.handedness };
    case "createFromTemplate": {
      const seed = createActionFromTemplate(action.kind, action.actionId);
      const clipId = action.clipId ?? `clip-${action.actionId}`;
      const clip: MotionClip = state.clips[clipId] ?? stubMotionClip({
        id: clipId,
        name: action.actionId,
        skeletonId: state.bodyProfiles[0]?.skeletonId ?? "skeleton",
        loop: seed.template.loop,
      });
      const next = pushHistory(state, {
        ...asSnapshot(state),
        templates: [...state.templates.filter((item) => item.id !== action.actionId), seed.template],
        clips: { ...state.clips, [clipId]: clip },
        baseActions: { ...state.baseActions, [action.actionId]: clipId },
      });
      return { ...next, selectedActionId: action.actionId, layerSource: "base", ownedLayer: "base" };
    }
    case "patchTemplate": {
      const templates = state.templates.map((item) => item.id === action.actionId ? { ...item, ...action.patch, id: item.id } : item);
      return pushHistory(state, { ...asSnapshot(state), templates });
    }
    case "deleteAction": {
      const { [action.actionId]: _b, ...baseActions } = state.baseActions;
      const { [action.actionId]: _s, ...stanceActions } = state.stanceActions;
      const { [action.actionId]: _e, ...equipmentOverrides } = state.equipmentOverrides;
      const { [action.actionId]: _c, ...equipmentCorrections } = state.equipmentCorrections;
      const next = pushHistory(state, {
        ...asSnapshot(state),
        templates: state.templates.filter((item) => item.id !== action.actionId),
        baseActions,
        stanceActions,
        equipmentOverrides,
        equipmentCorrections,
      });
      return {
        ...next,
        selectedActionId: next.selectedActionId === action.actionId ? (next.templates[0]?.id ?? null) : next.selectedActionId,
      };
    }
    case "upsertClip":
      return pushHistory(state, {
        ...asSnapshot(state),
        clips: { ...state.clips, [action.clip.id]: structuredClone(action.clip) },
      });
    case "patchOwnedClip": {
      if (!state.selectedActionId) return state;
      if (state.layerSource !== state.ownedLayer) return state;
      const key = layerMapKey(state.ownedLayer);
      return pushHistory(state, {
        ...asSnapshot(state),
        clips: { ...state.clips, [action.clip.id]: structuredClone(action.clip) },
        [key]: { ...state[key], [state.selectedActionId]: action.clip.id },
      });
    }
    case "bindLayerClip": {
      const key = layerMapKey(action.layer);
      return pushHistory(state, {
        ...asSnapshot(state),
        [key]: { ...state[key], [action.actionId]: action.clipId },
      });
    }
    case "addSemanticEvent": {
      if (!state.selectedActionId || state.layerSource !== state.ownedLayer) return state;
      const key = layerMapKey(state.ownedLayer);
      const clipId = state[key][state.selectedActionId];
      const clip = clipId ? state.clips[clipId] : null;
      if (!clip) return state;
      const time = action.time ?? state.previewTime;
      const template = state.templates.find((item) => item.id === state.selectedActionId);
      const payload = action.socketId ? { socket: action.socketId } : undefined;
      const inserted = insertSemanticEvent(clip, {
        time,
        type: action.eventType,
        name: action.name,
        payload,
      }, template);
      if (!inserted.clip) {
        return { ...state, eventIssues: inserted.issues };
      }
      let muzzlePlaceholder = state.muzzlePlaceholder;
      if (action.eventType === "weapon.fire" && action.socketId) {
        muzzlePlaceholder = { time, socketId: action.socketId };
      }
      const next = pushHistory(state, {
        ...asSnapshot(state),
        clips: { ...state.clips, [inserted.clip.id]: inserted.clip },
      });
      return {
        ...next,
        eventIssues: inserted.issues,
        muzzlePlaceholder,
        previewTime: time,
      };
    }
    case "deleteEvent": {
      if (!state.selectedActionId || state.layerSource !== state.ownedLayer) return state;
      const key = layerMapKey(state.ownedLayer);
      const clipId = state[key][state.selectedActionId];
      const clip = clipId ? state.clips[clipId] : null;
      if (!clip) return state;
      const events = clip.events.filter((_, index) => index !== action.index);
      const nextClip = { ...clip, events } as MotionClip;
      const next = pushHistory(state, {
        ...asSnapshot(state),
        clips: { ...state.clips, [nextClip.id]: nextClip },
      });
      return { ...next, eventIssues: recomputeEventIssues(next) };
    }
    case "loadCompatibilityFailure":
      return {
        ...state,
        selectedActionId: action.cell.actionId,
        previewTime: action.cell.failureTime ?? 0,
        selectedLoadoutName: action.cell.loadoutName,
        selectedBodyProfileId: action.cell.bodyProfileId,
        selectedHandedness: action.cell.handedness ?? state.selectedHandedness,
        pane: "events",
        layerSource: "composed",
      };
    case "undo": {
      if (!state.past.length) return state;
      const previous = state.past[state.past.length - 1]!;
      return {
        ...state,
        ...cloneSnapshot(previous),
        past: state.past.slice(0, -1),
        future: [cloneSnapshot(asSnapshot(state)), ...state.future],
        eventIssues: [],
      };
    }
    case "redo": {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return {
        ...state,
        ...cloneSnapshot(next!),
        past: [...state.past, cloneSnapshot(asSnapshot(state))],
        future: rest,
        eventIssues: [],
      };
    }
    case "markSaved":
      return { ...state, saved: cloneSnapshot(asSnapshot(state)), past: [], future: [] };
    case "hydrateClips": {
      const clips = { ...state.clips };
      const savedClips = { ...state.saved.clips };
      for (const [id, clip] of Object.entries(action.clips)) {
        const local = state.clips[id];
        const savedClip = state.saved.clips[id];
        const locallyDirty = Boolean(
          local && savedClip && JSON.stringify(local) !== JSON.stringify(savedClip),
        );
        if (locallyDirty && local) {
          clips[id] = { ...clip, events: local.events };
          continue;
        }
        clips[id] = clip;
        savedClips[id] = clip;
      }
      const next = {
        ...state,
        clips,
        saved: { ...state.saved, clips: savedClips },
      };
      return { ...next, eventIssues: recomputeEventIssues(next) };
    }
    case "replaceAll":
      return {
        ...state,
        ...cloneSnapshot(action.snapshot),
        saved: cloneSnapshot(action.snapshot),
        past: [],
        future: [],
        eventIssues: [],
      };
    default:
      return state;
  }
}
