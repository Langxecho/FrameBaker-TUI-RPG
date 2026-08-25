import type { MotionClip, MotionEvent, MotionTrack, ValidationIssue } from "./animation";
import type { ActionTemplate } from "./equipment";

/** 创作期动作层来源；运行时只消费最终 composed 剪辑。 */
export type ActionLayerSource =
  | "base"
  | "stance"
  | "equipment"
  | "correction"
  | "pre-constraint"
  | "post-constraint"
  | "composed";

export const STANDARD_ACTION_EVENTS = [
  "weapon.fire",
  "weapon.eject",
  "weapon.reload.detach",
  "weapon.reload.attach",
  "weapon.reload.complete",
  "weapon.melee.active",
  "weapon.melee.inactive",
  "equipment.activate",
  "equipment.deactivate",
  "equipment.swap",
  "effect.trigger",
  "combat.hitbox.start",
  "combat.hitbox.end",
  "combat.invulnerable.start",
  "combat.invulnerable.end",
  "movement.footstep.left",
  "movement.footstep.right",
] as const;

export type StandardActionEvent = (typeof STANDARD_ACTION_EVENTS)[number];

export interface ActionCompositionRequest {
  actionIds: string[];
  clips: Record<string, MotionClip>;
  baseActions: Record<string, string>;
  stanceActions?: Record<string, string>;
  equipmentOverrides?: Record<string, string>;
  equipmentCorrections?: Record<string, string>;
  templates?: ActionTemplate[];
  /** 当前作者拥有的可编辑层；其他层只读。 */
  ownedLayer?: Exclude<ActionLayerSource, "composed" | "pre-constraint" | "post-constraint">;
}

export interface ActionLayerSnapshot {
  source: ActionLayerSource;
  clipId: string | null;
  clip: MotionClip | null;
  readOnly: boolean;
}

export interface CompiledAction {
  actionId: string;
  clip: MotionClip;
  layers: ActionLayerSnapshot[];
  diagnostics: ValidationIssue[];
  usedFallback?: string;
  editableLayer: ActionLayerSource | null;
}

export interface ActionCompositionResult {
  ok: boolean;
  actions: CompiledAction[];
  diagnostics: ValidationIssue[];
}

const issue = (path: string, message: string): ValidationIssue => ({ path, message });

function cloneClip(clip: MotionClip): MotionClip {
  return structuredClone(clip);
}

function trackKey(track: MotionTrack): string {
  return `${track.targetId}\0${track.property}`;
}

/** 后层同 targetId+property 整轨覆盖前层；新轨追加。不改动 MotionClip 采样语义。 */
export function mergeMotionTracks(base: MotionClip, overlay: MotionClip): MotionClip {
  const map = new Map<string, MotionClip["tracks"][number]>();
  for (const track of base.tracks) map.set(trackKey(track as MotionTrack), structuredClone(track));
  for (const track of overlay.tracks) map.set(trackKey(track as MotionTrack), structuredClone(track));
  const duration = Math.max(base.duration, overlay.duration);
  const loop = base.loop || overlay.loop;
  const events = mergeMotionEvents(base.events, overlay.events, duration, loop).events;
  // 保持 schemaVersion 与 base 一致；v1/v2 轨道不在此转换
  if (base.schemaVersion === 2) {
    return {
      ...cloneClip(base),
      schemaVersion: 2,
      id: `${base.id}+${overlay.id}`,
      name: base.name,
      duration,
      loop,
      tracks: [...map.values()] as Extract<MotionClip, { schemaVersion: 2 }>["tracks"],
      events,
    };
  }
  return {
    ...cloneClip(base),
    schemaVersion: 1,
    id: `${base.id}+${overlay.id}`,
    name: base.name,
    duration,
    loop,
    tracks: [...map.values()] as Extract<MotionClip, { schemaVersion: 1 }>["tracks"],
    events,
  };
}

/** 按时间升序合并；同一时刻保留 base 再 overlay 的稳定顺序。循环剪辑丢弃 time>=duration 的边界事件。 */
export function mergeMotionEvents(
  base: readonly MotionEvent[],
  overlay: readonly MotionEvent[],
  duration: number,
  loop: boolean,
): { events: MotionEvent[]; droppedBoundary: MotionEvent[] } {
  const tagged = [
    ...base.map((event, index) => ({ event, index, lane: 0 as const })),
    ...overlay.map((event, index) => ({ event, index, lane: 1 as const })),
  ].sort((a, b) => a.event.time - b.event.time || a.lane - b.lane || a.index - b.index);
  const events: MotionEvent[] = [];
  const droppedBoundary: MotionEvent[] = [];
  for (const item of tagged) {
    const event = { ...item.event, payload: item.event.payload ? { ...item.event.payload } : undefined };
    if (loop && event.time >= duration) {
      droppedBoundary.push(event);
      continue;
    }
    if (event.time < 0 || event.time > duration) {
      droppedBoundary.push(event);
      continue;
    }
    events.push(event);
  }
  return { events, droppedBoundary };
}

export function validateReloadEventOrder(events: readonly MotionEvent[]): { ok: boolean; issues: ValidationIssue[] } {
  const detach = events.filter((event) => event.type === "weapon.reload.detach");
  const attach = events.filter((event) => event.type === "weapon.reload.attach");
  const complete = events.filter((event) => event.type === "weapon.reload.complete");
  const issues: ValidationIssue[] = [];
  if (!detach.length && !attach.length && !complete.length) return { ok: true, issues };
  const maxDetach = detach.length ? Math.max(...detach.map((event) => event.time)) : -Infinity;
  const minAttach = attach.length ? Math.min(...attach.map((event) => event.time)) : Infinity;
  const minComplete = complete.length ? Math.min(...complete.map((event) => event.time)) : Infinity;
  if (attach.length && detach.length && minAttach < maxDetach) {
    issues.push(issue("events.reload", "reload.attach 必须不早于 reload.detach"));
  }
  if (complete.length && attach.length && minComplete < minAttach) {
    issues.push(issue("events.reload", "reload.complete 必须不早于 reload.attach"));
  }
  if (complete.length && detach.length && minComplete < maxDetach) {
    issues.push(issue("events.reload", "reload.complete 必须不早于 reload.detach"));
  }
  if (attach.length && !detach.length) {
    issues.push(issue("events.reload", "存在 reload.attach 时需要 reload.detach"));
  }
  if (complete.length && (!detach.length || !attach.length)) {
    issues.push(issue("events.reload", "存在 reload.complete 时需要 detach 与 attach"));
  }
  return { ok: issues.length === 0, issues };
}

function resolveClipId(
  actionId: string,
  maps: Array<Record<string, string> | undefined>,
): string | undefined {
  for (const map of maps) {
    const id = map?.[actionId];
    if (id) return id;
  }
  return undefined;
}

function layerSnapshot(
  source: ActionLayerSource,
  clipId: string | null,
  clips: Record<string, MotionClip>,
  ownedLayer: ActionCompositionRequest["ownedLayer"],
): ActionLayerSnapshot {
  const clip = clipId ? clips[clipId] ?? null : null;
  const editableSources: ActionLayerSource[] = ["base", "stance", "equipment", "correction"];
  const readOnly = source === "composed"
    || source === "pre-constraint"
    || source === "post-constraint"
    || !ownedLayer
    || source !== ownedLayer
    || !editableSources.includes(source);
  return {
    source,
    clipId,
    clip: clip ? cloneClip(clip) : null,
    readOnly,
  };
}

function compileOne(
  actionId: string,
  request: ActionCompositionRequest,
  visiting: Set<string>,
): CompiledAction {
  const diagnostics: ValidationIssue[] = [];
  const template = request.templates?.find((item) => item.id === actionId);
  const baseId = request.baseActions[actionId];
  const stanceId = request.stanceActions?.[actionId];
  const equipmentId = request.equipmentOverrides?.[actionId];
  const correctionId = request.equipmentCorrections?.[actionId];

  let usedFallback: string | undefined;
  let effectiveBaseId = baseId;
  if (!effectiveBaseId && !stanceId && !equipmentId) {
    const fallback = template?.fallbackAction;
    if (fallback && fallback !== actionId && !visiting.has(fallback)) {
      visiting.add(actionId);
      const fallbackCompiled = compileOne(fallback, request, visiting);
      visiting.delete(actionId);
      usedFallback = fallback;
      diagnostics.push(issue(`actions.${actionId}`, `动作缺失，已回退到 fallback ${fallback}`));
      diagnostics.push(...fallbackCompiled.diagnostics.map((item) => ({
        path: item.path,
        message: item.message,
      })));
      return {
        actionId,
        clip: {
          ...cloneClip(fallbackCompiled.clip),
          id: `runtime:${actionId}`,
          name: actionId,
        },
        layers: fallbackCompiled.layers.map((layer) => ({
          ...layer,
          source: layer.source === "composed" ? "composed" : layer.source,
        })),
        diagnostics,
        usedFallback,
        editableLayer: request.ownedLayer ?? null,
      };
    }
    diagnostics.push(issue(`actions.${actionId}`, "动作缺失且无可用 fallback"));
    const empty: MotionClip = {
      schemaVersion: 1,
      kind: "motion-clip",
      id: `runtime:${actionId}:missing`,
      name: actionId,
      skeletonId: "",
      duration: 0,
      loop: false,
      tracks: [],
      events: [],
      provenance: { source: "manual" },
    };
    return {
      actionId,
      clip: empty,
      layers: [],
      diagnostics,
      editableLayer: request.ownedLayer ?? null,
    };
  }

  const layers: ActionLayerSnapshot[] = [
    layerSnapshot("base", effectiveBaseId ?? null, request.clips, request.ownedLayer),
    layerSnapshot("stance", stanceId ?? null, request.clips, request.ownedLayer),
    layerSnapshot("equipment", equipmentId ?? null, request.clips, request.ownedLayer),
    layerSnapshot("correction", correctionId ?? null, request.clips, request.ownedLayer),
  ];

  const take = (clipId: string | undefined): MotionClip | null => {
    if (!clipId) return null;
    const next = request.clips[clipId];
    if (!next) {
      diagnostics.push(issue(`actions.${actionId}.clips.${clipId}`, "剪辑不存在"));
      return null;
    }
    return next;
  };

  const baseClip = take(effectiveBaseId);
  const stanceClip = take(stanceId);
  const equipmentClip = take(equipmentId);
  const correctionClip = take(correctionId);

  // tracks: base ⟕ stance → 若有 equipment override 则整轨替换 → correction 轨合并
  // events: 各层按时间稳定合并（override 不丢弃前层事件）
  let composed: MotionClip | null = null;
  if (baseClip) composed = cloneClip(baseClip);
  if (stanceClip) composed = composed ? mergeMotionTracks(composed, stanceClip) : cloneClip(stanceClip);
  if (equipmentClip) {
    if (composed) {
      const replaced = cloneClip(equipmentClip);
      const duration = Math.max(composed.duration, replaced.duration);
      const loop = composed.loop || replaced.loop;
      const mergedEvents = mergeMotionEvents(composed.events, replaced.events, duration, loop);
      composed = {
        ...replaced,
        id: `${composed.id}+${replaced.id}`,
        name: composed.name,
        duration,
        loop,
        events: mergedEvents.events,
      };
      if (mergedEvents.droppedBoundary.length) {
        diagnostics.push(issue(`actions.${actionId}.events`, "循环边界处的一次性事件已丢弃，避免重复触发"));
      }
    } else {
      composed = cloneClip(equipmentClip);
    }
  }
  if (correctionClip) composed = composed ? mergeMotionTracks(composed, correctionClip) : cloneClip(correctionClip);

  if (!composed) {
    diagnostics.push(issue(`actions.${actionId}`, "无法解析任何层剪辑"));
    const empty: MotionClip = {
      schemaVersion: 1,
      kind: "motion-clip",
      id: `runtime:${actionId}:empty`,
      name: actionId,
      skeletonId: "",
      duration: 0,
      loop: false,
      tracks: [],
      events: [],
      provenance: { source: "manual" },
    };
    return { actionId, clip: empty, layers, diagnostics, editableLayer: request.ownedLayer ?? null };
  }

  // 单层循环也可能带边界事件，再清理一次
  const cleaned = mergeMotionEvents([], composed.events, composed.duration, composed.loop);
  if (cleaned.droppedBoundary.length) {
    diagnostics.push(issue(`actions.${actionId}.events`, "循环边界处的一次性事件已丢弃，避免重复触发"));
  }
  composed = {
    ...composed,
    id: `runtime:${actionId}`,
    name: actionId,
    events: cleaned.events,
  };

  const reload = validateReloadEventOrder(composed.events);
  diagnostics.push(...reload.issues);

  if (template) {
    for (const required of template.requiredEvents) {
      if (!composed.events.some((event) => event.type === required)) {
        diagnostics.push(issue(`actions.${actionId}.events`, `缺少必需事件 ${required}`));
      }
    }
    if (template.allowedEvents.length) {
      for (const event of composed.events) {
        if (!template.allowedEvents.includes(event.type) && !STANDARD_ACTION_EVENTS.includes(event.type as StandardActionEvent)) {
          // allowed 为空表示不限制；非空时允许标准事件与声明列表
        }
        if (template.allowedEvents.length && !template.allowedEvents.includes(event.type)) {
          diagnostics.push(issue(`actions.${actionId}.events`, `事件 ${event.type} 不在允许列表`));
        }
      }
    }
  }

  layers.push({
    source: "composed",
    clipId: composed.id,
    clip: cloneClip(composed),
    readOnly: true,
  });

  return {
    actionId,
    clip: composed,
    layers,
    diagnostics,
    usedFallback,
    editableLayer: request.ownedLayer ?? null,
  };
}

/** 将 base/stance/equipment override/correction 编译为运行时剪辑；不执行 IK/约束。 */
export function compileActionSet(request: ActionCompositionRequest): ActionCompositionResult {
  const actions: CompiledAction[] = [];
  const diagnostics: ValidationIssue[] = [];
  for (const actionId of request.actionIds) {
    const compiled = compileOne(actionId, request, new Set());
    actions.push(compiled);
    diagnostics.push(...compiled.diagnostics);
  }
  const ok = actions.every((action) => !action.diagnostics.some((item) =>
    item.message.includes("缺失且无可用") || item.path.endsWith(":missing") || item.message.includes("无法解析"),
  )) && actions.every((action) => action.clip.duration > 0 || action.usedFallback !== undefined || action.clip.tracks.length > 0);
  // 更直接：任一动作完全失败则 ok=false
  const hardFail = actions.some((action) =>
    action.diagnostics.some((item) => item.message.includes("缺失且无可用") || item.message.includes("无法解析")),
  );
  return {
    ok: !hardFail && actions.length === request.actionIds.length,
    actions,
    diagnostics,
  };
}

export function resolveActionClipId(
  actionId: string,
  baseActions: Record<string, string>,
  stanceActions?: Record<string, string>,
  equipmentOverrides?: Record<string, string>,
): string | undefined {
  return resolveClipId(actionId, [equipmentOverrides, stanceActions, baseActions]);
}
