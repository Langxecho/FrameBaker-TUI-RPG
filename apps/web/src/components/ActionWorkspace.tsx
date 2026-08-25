import { useMemo, useReducer, useState } from "react";
import type {
  ActionTemplate,
  BodyProfile,
  CharacterBinding,
  CharacterLoadout,
  EquipmentDefinition,
  MotionClip,
  Skeleton,
} from "@framebaker/shared";
import { Plus, Redo2, Save, Trash2, Undo2 } from "lucide-react";
import {
  ACTION_TEMPLATE_KINDS,
  STANDARD_ACTION_EVENTS,
  canEditOwnedLayer,
  compileSelectedAction,
  createActionFromTemplate,
  createActionUiState,
  evaluateCompatibilityMatrix,
  inspectLayerClip,
  isActionDirty,
  reduceActionUi,
  type ActionTemplateKind,
  type ActionUiState,
  type OwnedActionLayer,
} from "../actionUiState";
import { useT } from "../i18n";
import { askConfirm, notify } from "../notice";
import { CharacterPreview } from "./AnimationAssetsWorkspace";
import PxSelect from "./PxSelect";

const LAYER_SOURCES = ["base", "stance", "equipment", "correction", "pre-constraint", "post-constraint", "composed"] as const;

export interface ActionWorkspaceProps {
  templates?: ActionTemplate[];
  clips?: Record<string, MotionClip>;
  baseActions?: Record<string, string>;
  stanceActions?: Record<string, string>;
  equipmentOverrides?: Record<string, string>;
  bodyProfiles?: BodyProfile[];
  equipment?: EquipmentDefinition[];
  loadouts?: Array<{ name: string; loadout: CharacterLoadout }>;
  skeleton: Skeleton;
  binding?: CharacterBinding;
  busy?: boolean;
  onSaveActions: (payload: {
    templates: ActionTemplate[];
    clips: Record<string, MotionClip>;
    baseActions: Record<string, string>;
    stanceActions: Record<string, string>;
    equipmentOverrides: Record<string, string>;
  }) => Promise<void> | void;
  onEditMotionClip?: (clipId: string) => void;
}

function eventGroup(type: string): string {
  if (type.startsWith("weapon.")) return "weapon";
  if (type.startsWith("equipment.")) return "equipment";
  if (type.startsWith("effect.")) return "effect";
  if (type.startsWith("combat.")) return "combat";
  if (type.startsWith("movement.")) return "movement";
  return "other";
}

export default function ActionWorkspace({
  templates = [],
  clips = {},
  baseActions = {},
  stanceActions = {},
  equipmentOverrides = {},
  bodyProfiles = [],
  equipment = [],
  loadouts = [],
  skeleton,
  binding,
  busy = false,
  onSaveActions,
  onEditMotionClip,
}: ActionWorkspaceProps) {
  const t = useT();
  const [state, dispatch] = useReducer(
    (current: ActionUiState, action: Parameters<typeof reduceActionUi>[1]) => reduceActionUi(current, action),
    undefined,
    () => createActionUiState({
      templates,
      clips,
      baseActions,
      stanceActions,
      equipmentOverrides,
      bodyProfiles,
      equipment,
      loadouts,
    }),
  );
  const [newKind, setNewKind] = useState<ActionTemplateKind>("idle");
  const [eventType, setEventType] = useState<string>("weapon.fire");
  const [eventName, setEventName] = useState("fire");
  const [socketId, setSocketId] = useState("");

  const dirty = isActionDirty(state);
  const editable = canEditOwnedLayer(state);
  const compiled = useMemo(() => compileSelectedAction(state), [state]);
  const layerClip = useMemo(() => inspectLayerClip(state), [state]);
  const selectedTemplate = state.templates.find((item) => item.id === state.selectedActionId) ?? null;
  const body = bodyProfiles.find((item) => item.id === state.selectedBodyProfileId) ?? bodyProfiles[0] ?? null;
  const sockets = body?.sockets ?? [];
  const weapons = equipment.filter((item) => item.weapon);
  const cyberlimbs = equipment.filter((item) => item.tags.includes("cyber") || item.tags.includes("cyberlimb"));

  const matrix = useMemo(() => {
    if (!state.selectedActionId) return null;
    return evaluateCompatibilityMatrix({
      actionId: state.selectedActionId,
      bodyProfiles,
      equipment,
      weapons,
      handedness: ["right", "left"],
      cyberlimbs,
      loadouts,
      clips: state.clips,
      baseActions: state.baseActions,
      stanceActions: state.stanceActions,
      equipmentOverridesById: Object.fromEntries(
        equipment.map((item) => [item.id, item.actionOverrides ?? {}]),
      ),
    });
  }, [state.selectedActionId, state.clips, state.baseActions, state.stanceActions, bodyProfiles, equipment, weapons, cyberlimbs, loadouts]);

  const previewClip = layerClip ?? compiled?.clip;

  const save = async () => {
    if (busy) return;
    try {
      await onSaveActions({
        templates: state.templates,
        clips: state.clips,
        baseActions: state.baseActions,
        stanceActions: state.stanceActions,
        equipmentOverrides: state.equipmentOverrides,
      });
      dispatch({ type: "markSaved" });
      notify(t("skeletal.actions.saved"), "info");
    } catch (e) {
      notify(t("skeletal.actions.saveFailed", { msg: (e as Error).message }));
    }
  };

  const createAction = () => {
    const id = newKind === "custom" ? `custom-${crypto.randomUUID().slice(0, 8)}` : newKind;
    if (state.templates.some((item) => item.id === id) || state.baseActions[id]) {
      notify(t("skeletal.actions.duplicateId"));
      return;
    }
    dispatch({ type: "createFromTemplate", kind: newKind, actionId: id });
  };

  return (
    <div className="skeletal-action-workspace">
      <aside className="pixel-panel skeletal-action-tree">
        <header>
          <div>
            <h2>{t("skeletal.actions.title")}</h2>
            <p>{t("skeletal.actions.hint")}</p>
          </div>
          <div className="skeletal-action-toolbar">
            <button type="button" className="px-btn" disabled={!state.past.length || busy} onClick={() => dispatch({ type: "undo" })} title={t("skeletal.actions.undo")}><Undo2 size={14} /></button>
            <button type="button" className="px-btn" disabled={!state.future.length || busy} onClick={() => dispatch({ type: "redo" })} title={t("skeletal.actions.redo")}><Redo2 size={14} /></button>
            <button type="button" className="px-btn accent" disabled={!dirty || busy} onClick={() => void save()}><Save size={14} /> {t("common.save")}</button>
          </div>
        </header>
        <p className={dirty ? "skeletal-dirty" : "skeletal-clean"}>{dirty ? t("skeletal.actions.unsaved") : t("skeletal.actions.clean")}</p>
        <div className="skeletal-add-action">
          <PxSelect
            value={newKind}
            options={ACTION_TEMPLATE_KINDS.map((kind) => ({ value: kind, label: t(`skeletal.actions.template.${kind}`) }))}
            onChange={(value) => setNewKind(value as ActionTemplateKind)}
          />
          <button type="button" className="px-btn accent" disabled={busy} onClick={createAction}><Plus size={14} /> {t("skeletal.actions.create")}</button>
        </div>
        <div className="skeletal-action-items" role="tree" aria-label={t("skeletal.actions.tree")}>
          {state.templates.map((item) => (
            <button
              type="button"
              key={item.id}
              className={state.selectedActionId === item.id ? "active" : ""}
              onClick={() => dispatch({ type: "selectAction", actionId: item.id })}
            >
              <strong>{item.id}</strong>
              <span>{item.loop ? t("skeletal.actions.looping") : t("skeletal.actions.oneshot")} · {item.defaultInterrupt}</span>
            </button>
          ))}
          {!state.templates.length && <p className="animation-empty">{t("skeletal.actions.empty")}</p>}
        </div>
      </aside>

      <section className="pixel-panel skeletal-action-inspector">
        <div className="skeletal-binding-tool-tabs" role="tablist">
          <button type="button" className={`px-btn ${state.pane === "tree" ? "accent" : ""}`} onClick={() => dispatch({ type: "setPane", pane: "tree" })}>{t("skeletal.actions.pane.layers")}</button>
          <button type="button" className={`px-btn ${state.pane === "events" ? "accent" : ""}`} onClick={() => dispatch({ type: "setPane", pane: "events" })}>{t("skeletal.actions.pane.events")}</button>
          <button type="button" className={`px-btn ${state.pane === "matrix" ? "accent" : ""}`} onClick={() => dispatch({ type: "setPane", pane: "matrix" })}>{t("skeletal.actions.pane.matrix")}</button>
        </div>

        {selectedTemplate && state.pane === "tree" && <>
          <div className="skeletal-action-settings">
            <label className="px-check"><input type="checkbox" checked={selectedTemplate.loop} disabled={busy} onChange={(e) => dispatch({ type: "patchTemplate", actionId: selectedTemplate.id, patch: { loop: e.target.checked } })} />{t("skeletal.actions.loop")}</label>
            <label>{t("skeletal.actions.interrupt")}
              <PxSelect
                value={selectedTemplate.defaultInterrupt}
                options={[
                  { value: "immediate", label: t("skeletal.actions.interrupt.immediate") },
                  { value: "event-boundary", label: t("skeletal.actions.interrupt.eventBoundary") },
                  { value: "non-interruptible", label: t("skeletal.actions.interrupt.nonInterruptible") },
                ]}
                onChange={(value) => dispatch({ type: "patchTemplate", actionId: selectedTemplate.id, patch: { defaultInterrupt: value as ActionTemplate["defaultInterrupt"] } })}
              />
            </label>
            <label>{t("skeletal.actions.fallback")}
              <input className="px-input" value={selectedTemplate.fallbackAction ?? ""} disabled={busy} onChange={(e) => dispatch({ type: "patchTemplate", actionId: selectedTemplate.id, patch: { fallbackAction: e.target.value.trim() || undefined } })} />
            </label>
            <label>{t("skeletal.actions.blendMs")}
              <input className="px-input" type="number" min={0} max={60000} value={selectedTemplate.defaultBlendMs} disabled={busy} onChange={(e) => dispatch({ type: "patchTemplate", actionId: selectedTemplate.id, patch: { defaultBlendMs: Math.max(0, Number(e.target.value) || 0) } })} />
            </label>
            <p>{t("skeletal.actions.requiredEvents")}: {selectedTemplate.requiredEvents.join(", ") || t("skeletal.actions.none")}</p>
            <p>{t("skeletal.actions.keyPoses")}: {createActionFromTemplate(
              (ACTION_TEMPLATE_KINDS as readonly string[]).includes(selectedTemplate.id) ? selectedTemplate.id as ActionTemplateKind : "custom",
              selectedTemplate.id,
            ).recommendedKeyPoses.join(" → ")}</p>
          </div>

          <div className="skeletal-action-layers">
            <h3>{t("skeletal.actions.layerSource")}</h3>
            <div className="skeletal-action-layer-list">
              {LAYER_SOURCES.map((source) => (
                <button
                  type="button"
                  key={source}
                  className={`px-btn ${state.layerSource === source ? "accent" : ""}`}
                  onClick={() => dispatch({ type: "setLayerSource", source })}
                >
                  {t(`skeletal.actions.layer.${source}`)}
                </button>
              ))}
            </div>
            <label>{t("skeletal.actions.ownedLayer")}
              <PxSelect
                value={state.ownedLayer}
                options={(["base", "stance", "equipment", "correction"] as OwnedActionLayer[]).map((layer) => ({
                  value: layer,
                  label: t(`skeletal.actions.layer.${layer}`),
                }))}
                onChange={(value) => dispatch({ type: "setOwnedLayer", layer: value as OwnedActionLayer })}
              />
            </label>
            <p>{editable ? t("skeletal.actions.layerEditable") : t("skeletal.actions.layerReadOnly")}</p>
            {compiled && <ul className="skeletal-action-diagnostics">
              {compiled.layers.filter((layer) => layer.source !== "composed").map((layer) => (
                <li key={layer.source}>{t(`skeletal.actions.layer.${layer.source}`)}: {layer.clipId ?? t("skeletal.actions.none")} {layer.readOnly ? `(${t("skeletal.actions.readOnly")})` : ""}</li>
              ))}
            </ul>}
            {onEditMotionClip && layerClip && (
              <button type="button" className="px-btn" disabled={!editable || busy} onClick={() => onEditMotionClip(layerClip.id)}>
                {t("skeletal.actions.editTracks")}
              </button>
            )}
            <button
              type="button"
              className="px-btn danger"
              disabled={busy || !state.selectedActionId}
              onClick={async () => {
                if (!state.selectedActionId) return;
                if (!(await askConfirm(t("skeletal.actions.deleteConfirm")))) return;
                dispatch({ type: "deleteAction", actionId: state.selectedActionId });
              }}
            ><Trash2 size={14} /> {t("skeletal.actions.delete")}</button>
          </div>
        </>}

        {selectedTemplate && state.pane === "events" && <>
          <div className="skeletal-action-settings">
            <label>{t("skeletal.actions.eventType")}
              <PxSelect
                value={eventType}
                options={[...STANDARD_ACTION_EVENTS].map((value) => ({
                  value,
                  label: `${t(`skeletal.actions.eventGroup.${eventGroup(value)}`)} · ${value}`,
                }))}
                onChange={setEventType}
              />
            </label>
            <label>{t("skeletal.actions.eventName")}<input className="px-input" value={eventName} onChange={(e) => setEventName(e.target.value)} /></label>
            <label>{t("skeletal.actions.socket")}
              <PxSelect
                value={socketId}
                options={[{ value: "", label: t("skeletal.actions.noSocket") }, ...sockets.map((socket) => ({ value: socket.id, label: `${socket.id} (${socket.semantic})` }))]}
                onChange={setSocketId}
                placeholder={t("skeletal.actions.chooseSocket")}
              />
            </label>
            <label>{t("skeletal.actions.previewTime")}
              <input className="px-input" type="number" min={0} step={0.01} value={state.previewTime} onChange={(e) => dispatch({ type: "setPreviewTime", time: Number(e.target.value) || 0 })} />
            </label>
            <button
              type="button"
              className="px-btn accent"
              disabled={!editable || busy || !eventName.trim()}
              onClick={() => dispatch({
                type: "addSemanticEvent",
                eventType,
                name: eventName.trim(),
                socketId: socketId || undefined,
              })}
            >{t("skeletal.actions.addEvent")}</button>
          </div>
          {state.muzzlePlaceholder && <p className="skeletal-action-muzzle">{t("skeletal.actions.muzzlePlaceholder", { socket: state.muzzlePlaceholder.socketId, time: state.muzzlePlaceholder.time.toFixed(2) })}</p>}
          <div className="skeletal-event-strip">
            <strong>{t("skeletal.actions.eventTimeline")}</strong>
            {(layerClip?.events ?? []).map((event, index) => (
              <button
                type="button"
                key={`${event.time}-${index}`}
                style={{ left: `${(layerClip?.duration ? event.time / layerClip.duration : 0) * 100}%` }}
                title={`${event.type} · ${event.name}`}
                onClick={() => dispatch({ type: "setPreviewTime", time: event.time })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (editable) dispatch({ type: "deleteEvent", index });
                }}
              ><span>{event.name}</span></button>
            ))}
            <i style={{ left: `${(layerClip?.duration ? state.previewTime / layerClip.duration : 0) * 100}%` }} />
          </div>
          <ul className="skeletal-action-diagnostics">
            {state.eventIssues.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.path}: {issue.message}</li>)}
            {!state.eventIssues.length && <li>{t("skeletal.actions.diagnosticsOk")}</li>}
          </ul>
          <p className="skeletal-action-note">{t("skeletal.actions.presentationOnly")}</p>
        </>}

        {state.pane === "matrix" && matrix && (
          <div className="skeletal-action-matrix">
            <h3>{t("skeletal.actions.matrixTitle")}</h3>
            <p>{t("skeletal.actions.matrixHint")}</p>
            <table>
              <thead>
                <tr>
                  <th>{t("skeletal.actions.matrix.body")}</th>
                  <th>{t("skeletal.actions.matrix.weapon")}</th>
                  <th>{t("skeletal.actions.matrix.hand")}</th>
                  <th>{t("skeletal.actions.matrix.cyber")}</th>
                  <th>{t("skeletal.actions.matrix.loadout")}</th>
                  <th>{t("skeletal.actions.matrix.result")}</th>
                </tr>
              </thead>
              <tbody>
                {matrix.cells.map((cell) => (
                  <tr key={cell.id} className={cell.ok ? "ok" : "fail"}>
                    <td>{cell.bodyProfileId}</td>
                    <td>{cell.weaponId ?? "-"}</td>
                    <td>{cell.handedness ?? "-"}</td>
                    <td>{cell.cyberlimbId ?? "-"}</td>
                    <td>{cell.loadoutName ?? "-"}</td>
                    <td>
                      {cell.ok
                        ? t("skeletal.actions.matrix.pass")
                        : <button type="button" className="px-btn danger" onClick={() => dispatch({ type: "loadCompatibilityFailure", cell })}>
                            {t("skeletal.actions.matrix.failAt", { time: (cell.failureTime ?? 0).toFixed(2), reason: cell.reason ?? "" })}
                          </button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!selectedTemplate && state.pane !== "matrix" && (
          <div className="skeletal-empty-state"><h2>{t("skeletal.actions.empty")}</h2><p>{t("skeletal.actions.emptyHint")}</p></div>
        )}
      </section>

      <section className="pixel-panel skeletal-action-preview">
        <header><h2>{t("skeletal.actions.preview")}</h2><p>{t("skeletal.actions.previewHint")}</p></header>
        {binding && previewClip
          ? <div className="skeletal-live-preview"><CharacterPreview binding={binding} skeleton={skeleton} clip={previewClip} time={state.previewTime} /></div>
          : <div className="skeletal-empty-state"><p>{t("skeletal.actions.needBinding")}</p></div>}
        {compiled?.diagnostics?.length ? (
          <ul className="skeletal-action-diagnostics">{compiled.diagnostics.map((issue, index) => <li key={`${issue.path}-${index}`}>{issue.message}</li>)}</ul>
        ) : null}
        {state.muzzlePlaceholder && (
          <div className="skeletal-action-muzzle-marker" data-socket={state.muzzlePlaceholder.socketId}>
            {t("skeletal.actions.muzzleMarker")}
          </div>
        )}
      </section>
    </div>
  );
}
