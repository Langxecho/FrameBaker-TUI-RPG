import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import {
  measureSkeletonHeight,
  quaternionFromZRotation,
  zRotationFromQuaternion,
  type BodyProfile,
  type CharacterBinding,
  type CharacterLoadout,
  type EquipmentDefinition,
  type Material,
  type MotionClip,
  type Skeleton,
  type Transform,
} from "@framebaker/shared";
import { materialImageUrl } from "../api";
import { fitAttachmentSizeToImage } from "../bindingGeometry";
import { Copy, Eye, Plus, Redo2, Save, Trash2, Undo2 } from "lucide-react";
import {
  EQUIPMENT_WIZARD_STEPS,
  canCompleteEquipmentWizard,
  createEmptyAttachment,
  createEmptyEquipment,
  createEquipmentUiState,
  equipmentWizardBlockingIssues,
  isEquipmentDirty,
  reduceEquipmentUi,
  slotIdForSocket,
  type EquipmentWizardStep,
  type FocusZoomTarget,
  type SavedTestLoadout,
} from "../equipmentUiState";
import { createEquipmentSampleFixtures } from "../equipmentFixtures";
import { attachmentRestFromComposed, bindingWithAssembledLoadout, overlayDraftEquipment } from "../loadoutPreview";
import { useT } from "../i18n";
import { askConfirm, notify } from "../notice";
import { CharacterPreview } from "./AnimationAssetsWorkspace";
import PxSelect from "./PxSelect";

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const FOCUS_CAMERA: Record<FocusZoomTarget, { zoom: number; panY: string }> = {
  none: { zoom: 1, panY: "0%" },
  eye: { zoom: 2.2, panY: "-12%" },
  hand: { zoom: 1.8, panY: "8%" },
  body: { zoom: 1.45, panY: "0%" },
};

function parseList(value: string): string[] {
  return [...new Set(value.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean))];
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function parseOverrides(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of value.split(/[,;\n]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [key, ...rest] = trimmed.split(/[:=]/);
    const action = key?.trim();
    const clip = rest.join(":").trim();
    if (action && clip) result[action] = clip;
  }
  return result;
}

function overridesToText(value: Record<string, string> | undefined): string {
  return Object.entries(value ?? {}).map(([key, clip]) => `${key}:${clip}`).join(", ");
}

export interface EquipmentWorkspaceProps {
  equipment?: EquipmentDefinition[];
  loadouts?: CharacterLoadout[];
  bodyProfiles: BodyProfile[];
  skeleton: Skeleton;
  binding?: CharacterBinding;
  clip?: MotionClip;
  materials?: Material[];
  busy?: boolean;
  onSaveEquipment: (equipment: EquipmentDefinition[], loadouts: CharacterLoadout[]) => Promise<void> | void;
  onRequestClose?: () => void;
}

export default function EquipmentWorkspace({
  equipment = [],
  loadouts = [],
  bodyProfiles,
  skeleton,
  binding,
  clip,
  materials = [],
  busy = false,
  onSaveEquipment,
  onRequestClose,
}: EquipmentWorkspaceProps) {
  const t = useT();
  const body = bodyProfiles[0] ?? null;
  const initialSaved: SavedTestLoadout[] = loadouts.map((item, index) => ({
    name: item.equipment.map((entry) => entry.equipmentId).join("+") || `loadout-${index + 1}`,
    loadout: item,
  }));
  const [state, dispatch] = useReducer(
    (current: ReturnType<typeof createEquipmentUiState>, action: Parameters<typeof reduceEquipmentUi>[1]) => {
      const nextBodyId = action.type === "selectBodyProfile" ? action.bodyProfileId : current.selectedBodyProfileId;
      const selectedBody = bodyProfiles.find((item) => item.id === nextBodyId) ?? body;
      return reduceEquipmentUi(current, action, selectedBody, binding ?? null);
    },
    undefined,
    () => createEquipmentUiState(equipment, body, binding ?? null, initialSaved),
  );
  const activeBody = bodyProfiles.find((item) => item.id === state.selectedBodyProfileId) ?? body;
  const dirty = isEquipmentDirty(state);
  const draft = state.draft;
  const selectedAttachment = draft?.attachments.find((item) => item.id === state.selectedAttachmentId) ?? null;
  const stepIssues = useMemo(
    () => equipmentWizardBlockingIssues(draft, activeBody, state.wizardStep),
    [draft, activeBody, state.wizardStep],
  );
  const allIssues = useMemo(() => equipmentWizardBlockingIssues(draft, activeBody), [draft, activeBody]);
  const materialOptions = useMemo(
    () => materials.filter((item) => item.kind === "image").map((item) => ({ value: item.id, label: item.name })),
    [materials],
  );
  const bindingParts = useMemo(() => {
    if (!binding) return [];
    return binding.slots.map((slot) => {
      const attachment = binding.attachments.find((item) => item.id === slot.attachmentId);
      return { id: slot.id, label: slot.name?.trim() || attachment?.name || slot.id };
    });
  }, [binding]);
  const canvasEditBeforeRef = useRef<EquipmentDefinition | null>(null);
  const canvasStageRef = useRef<HTMLDivElement | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const fitRequestRef = useRef(0);
  const defaultGearSize = useMemo((): [number, number] => {
    const span = Math.max(48, measureSkeletonHeight(skeleton) * 0.28);
    return [span, span];
  }, [skeleton]);
  const [loadoutName, setLoadoutName] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [conflictDraft, setConflictDraft] = useState("");
  const [overridesDraft, setOverridesDraft] = useState("");
  const [effectEvent, setEffectEvent] = useState("weapon.fire");
  const [effectId, setEffectId] = useState("muzzle-flash");

  useEffect(() => {
    dispatch({ type: "replaceLibrary", equipment });
  }, [equipment]);

  useEffect(() => {
    setTagsDraft(draft?.tags.join(", ") ?? "");
    setConflictDraft(draft?.conflictTags.join(", ") ?? "");
    setOverridesDraft(overridesToText(draft?.actionOverrides));
  }, [draft?.id, draft?.tags, draft?.conflictTags, draft?.actionOverrides]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      dispatch({ type: event.shiftKey ? "redo" : "undo" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const stage = canvasStageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.92 : 1.08;
      setCanvasZoom((zoom) => Math.min(3, Math.max(0.5, Number((zoom * factor).toFixed(2)))));
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  const socketMarkers = useMemo(() => {
    if (!activeBody) return [];
    return activeBody.sockets.map((socket) => ({
      id: socket.id,
      boneId: socket.boneId,
      rest: socket.rest,
      label: socket.semantic,
      selected: selectedAttachment?.socket === socket.id,
    }));
  }, [activeBody, selectedAttachment?.socket]);

  const canvasCameraStyle = {
    "--eq-zoom": String(canvasZoom),
    "--eq-pan-y": FOCUS_CAMERA[state.focusZoom].panY,
  } as CSSProperties;

  const requestClose = async () => {
    if (!onRequestClose) return;
    if (dirty && !(await askConfirm(t("skeletal.equipment.unsavedConfirm")))) return;
    onRequestClose();
  };

  const save = async () => {
    if (busy || !draft) return;
    if (!canCompleteEquipmentWizard(draft, activeBody)) {
      notify(t("skeletal.equipment.fixBlocked", { msg: allIssues[0]?.message ?? "" }));
      return;
    }
    try {
      const nextLibrary = state.library.some((item) => item.id === draft.id)
        ? state.library.map((item) => item.id === draft.id ? draft : item)
        : [...state.library, draft];
      const nextLoadouts = state.savedLoadouts.map((item) => item.loadout);
      await onSaveEquipment(nextLibrary, nextLoadouts);
      dispatch({ type: "markSaved", equipment: draft });
      notify(t("skeletal.equipment.saved"), "info");
    } catch (error) {
      notify(t("skeletal.equipment.saveFailed", { msg: (error as Error).message }));
    }
  };

  const createItem = () => {
    if (!activeBody) {
      notify(t("skeletal.equipment.needBody"));
      return;
    }
    const item = createEmptyEquipment(uid("eq"), t("skeletal.equipment.defaultName"), activeBody, "attached");
    dispatch({ type: "createEquipment", equipment: item });
  };

  const loadFixtures = async () => {
    if (!(await askConfirm(t("skeletal.equipment.loadFixturesConfirm")))) return;
    const fixtures = createEquipmentSampleFixtures();
    const merged = [...state.library];
    for (const item of fixtures) {
      const index = merged.findIndex((entry) => entry.id === item.id);
      if (index >= 0) merged[index] = item;
      else merged.push(item);
    }
    dispatch({ type: "replaceLibrary", equipment: merged, selectedId: fixtures[0]?.id ?? null });
    notify(t("skeletal.equipment.fixturesLoaded"), "info");
  };

  const stepLabel = (step: EquipmentWizardStep) => t(`skeletal.equipment.step.${step}`);

  const setFocus = (focus: FocusZoomTarget) => {
    dispatch({ type: "setFocusZoom", focus });
    setCanvasZoom(FOCUS_CAMERA[focus].zoom);
  };

  const previewBinding = useMemo(() => {
    if (!binding || !activeBody) return binding;
    const assembled = overlayDraftEquipment(state.legalPreview, draft, activeBody.id);
    return bindingWithAssembledLoadout(binding, activeBody, assembled, {
      showHiddenBase: state.showHiddenBase,
      isolateAttachmentIds: state.isolateSelected && draft?.attachments.length
        ? draft.attachments.map((item) => item.id)
        : undefined,
    });
  }, [activeBody, binding, draft, state.isolateSelected, state.legalPreview, state.showHiddenBase]);

  const onSelectAttachmentSocket = (socketId: string) => {
    if (!selectedAttachment || !activeBody) return;
    dispatch({ type: "patchAttachment", attachmentId: selectedAttachment.id, patch: { socket: socketId } });
  };

  const onSelectCanvasAttachment = (attachmentId: string) => {
    if (!draft?.attachments.some((item) => item.id === attachmentId)) return;
    dispatch({ type: "selectAttachment", attachmentId });
    dispatch({ type: "setWizardStep", step: "attachments" });
  };

  const onTransformCanvasAttachment = (attachmentId: string, patch: Partial<CharacterBinding["attachments"][number]>) => {
    if (!draft || !activeBody) return;
    const attachment = draft.attachments.find((item) => item.id === attachmentId);
    if (!attachment) return;
    const socket = activeBody.sockets.find((item) => item.id === attachment.socket);
    if (!socket) return;
    const restPatch: Partial<Transform> | undefined = patch.rest
      ? attachmentRestFromComposed(socket.rest, patch.rest)
      : undefined;
    dispatch({
      type: "patchAttachment",
      attachmentId,
      skipHistory: true,
      patch: {
        ...(patch.size ? { size: [...patch.size] as [number, number] } : {}),
        ...(patch.pivot ? { pivot: [...patch.pivot] as [number, number] } : {}),
        ...(restPatch ? { rest: restPatch } : {}),
      },
    });
  };

  const onBeginCanvasTransform = () => {
    if (draft && !canvasEditBeforeRef.current) canvasEditBeforeRef.current = structuredClone(draft);
  };

  const onEndCanvasTransform = () => {
    const before = canvasEditBeforeRef.current;
    canvasEditBeforeRef.current = null;
    if (before) dispatch({ type: "commitCanvasEdit", before });
  };

  const fitEquipmentToMaterial = async (attachmentId: string, materialId: string, imageSlot: "raw" | "processed", currentSize: [number, number]) => {
    if (!materialId || materialId === "mat-placeholder") return;
    const requestId = ++fitRequestRef.current;
    try {
      const response = await fetch(materialImageUrl(materialId, undefined, imageSlot, undefined, true));
      if (!response.ok) throw new Error(`${response.status}`);
      const bitmap = await createImageBitmap(await response.blob());
      if (requestId !== fitRequestRef.current) {
        bitmap.close();
        return;
      }
      const figure = defaultGearSize[1];
      const base: [number, number] = Math.max(currentSize[0], currentSize[1]) < figure * 0.5 ? [figure, figure] : currentSize;
      const size = fitAttachmentSizeToImage(base, bitmap.width, bitmap.height);
      bitmap.close();
      dispatch({ type: "patchAttachment", attachmentId, patch: { size } });
    } catch (error) {
      if (requestId === fitRequestRef.current) notify(t("animation.binding.fitImageAspectFailed", { msg: (error as Error).message }));
    }
  };

  useEffect(() => {
    if (!selectedAttachment || selectedAttachment.materialId === "mat-placeholder") return;
    if (Math.max(selectedAttachment.size[0], selectedAttachment.size[1]) >= 32) return;
    void fitEquipmentToMaterial(selectedAttachment.id, selectedAttachment.materialId, selectedAttachment.imageSlot, selectedAttachment.size);
  }, [selectedAttachment?.id, selectedAttachment?.materialId, selectedAttachment?.imageSlot, selectedAttachment?.size]);

  return (
    <section className="equipment-workspace">
      <header className="equipment-toolbar">
        <div className="equipment-pane-tabs" role="tablist" aria-label={t("skeletal.equipment.panes")}>
          <button type="button" role="tab" aria-selected={state.pane === "library"} className={`px-btn ${state.pane === "library" ? "accent" : ""}`} onClick={() => dispatch({ type: "setPane", pane: "library" })}>{t("skeletal.equipment.pane.library")}</button>
          <button type="button" role="tab" aria-selected={state.pane === "wizard"} className={`px-btn ${state.pane === "wizard" ? "accent" : ""}`} onClick={() => dispatch({ type: "setPane", pane: "wizard" })} disabled={!draft}>{t("skeletal.equipment.pane.wizard")}</button>
          <button type="button" role="tab" aria-selected={state.pane === "loadout"} className={`px-btn ${state.pane === "loadout" ? "accent" : ""}`} onClick={() => dispatch({ type: "setPane", pane: "loadout" })}>{t("skeletal.equipment.pane.loadout")}</button>
        </div>
        <div className="equipment-history-actions">
          <button type="button" className="px-btn icon" disabled={!state.past.length || busy} onClick={() => dispatch({ type: "undo" })} title={t("skeletal.equipment.undo")}><Undo2 size={14} /></button>
          <button type="button" className="px-btn icon" disabled={!state.future.length || busy} onClick={() => dispatch({ type: "redo" })} title={t("skeletal.equipment.redo")}><Redo2 size={14} /></button>
          <button type="button" className="px-btn accent" disabled={busy || !dirty || allIssues.length > 0} onClick={() => void save()}><Save size={14} /> {t("common.save")}</button>
          {onRequestClose && <button type="button" className="px-btn" onClick={() => void requestClose()}>{t("common.close")}</button>}
        </div>
      </header>

      <div className="equipment-layout">
        <div className="equipment-canvas pixel-panel" style={canvasCameraStyle}>
          <div ref={canvasStageRef} className={`equipment-canvas-stage${state.facing === "left" ? " facing-left" : ""}`}>
            {previewBinding
              ? <CharacterPreview
                  binding={previewBinding}
                  skeleton={skeleton}
                  clip={clip}
                  time={state.previewTime}
                  selectedAttachmentId={selectedAttachment?.id ?? undefined}
                  showSkeleton
                  socketMarkers={socketMarkers}
                  onSelectAttachment={onSelectCanvasAttachment}
                  onTransformAttachment={onTransformCanvasAttachment}
                  onBeginTransform={onBeginCanvasTransform}
                  onEndTransform={onEndCanvasTransform}
                  pickAttachments
                  fitTo="skeleton"
                />
              : <div className="equipment-empty-canvas">{t("skeletal.equipment.needBinding")}</div>}
          </div>
          <div className="equipment-preview-controls">
            {clip && clip.duration > 0 && (
              <label className="equipment-follow-time">
                {t("skeletal.equipment.actionPlayback")}
                <input type="range" min={0} max={clip.duration} step={0.001} value={Math.min(state.previewTime, clip.duration)} onChange={(event) => dispatch({ type: "setPreviewTime", time: +event.target.value })} />
                <span>{state.previewTime.toFixed(2)}s</span>
              </label>
            )}
            <div className="equipment-inline">
              <button type="button" className={`px-btn ${state.facing === "right" ? "accent" : ""}`} onClick={() => dispatch({ type: "setFacing", facing: "right" })}>{t("skeletal.equipment.facing.right")}</button>
              <button type="button" className={`px-btn ${state.facing === "left" ? "accent" : ""}`} onClick={() => dispatch({ type: "setFacing", facing: "left" })}>{t("skeletal.equipment.facing.left")}</button>
              <button type="button" className={`px-btn ${state.showHiddenBase ? "accent" : ""}`} onClick={() => dispatch({ type: "setShowHiddenBase", show: !state.showHiddenBase })}>{t("skeletal.equipment.showHiddenBase")}</button>
              <button type="button" className={`px-btn ${state.isolateSelected ? "accent" : ""}`} onClick={() => dispatch({ type: "setIsolateSelected", isolate: !state.isolateSelected })}>{t("skeletal.equipment.isolate")}</button>
            </div>
            <div className="equipment-inline">
              <span>{t("skeletal.equipment.canvasZoom")}</span>
              <input type="range" min={0.5} max={3} step={0.05} value={canvasZoom} onChange={(event) => setCanvasZoom(+event.target.value)} />
              <span>{Math.round(canvasZoom * 100)}%</span>
            </div>
            <div className="equipment-inline">
              <span>{t("skeletal.equipment.focusZoom")}</span>
              {(["none", "eye", "hand", "body"] as const).map((focus) => (
                <button key={focus} type="button" className={`px-btn ${state.focusZoom === focus ? "accent" : ""}`} onClick={() => setFocus(focus)}>{t(`skeletal.equipment.focus.${focus}`)}</button>
              ))}
            </div>
            {state.legalPreview && (
              <p className="equipment-hint">
                {t("skeletal.equipment.previewSummary", {
                  attachments: String(state.legalPreview.attachments.length),
                  hidden: String(state.legalPreview.hiddenParts.length),
                  effects: String(state.legalPreview.effects.length),
                })}
              </p>
            )}
            <p className="equipment-hint">{t("skeletal.equipment.canvasHint")}</p>
            {state.conflictIssues.length > 0 && (
              <ul className="equipment-diagnostics">
                {state.conflictIssues.map((issue, index) => (
                  <li key={`${issue.path}-${index}`}><code>{issue.path}</code> {issue.message}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <aside className="equipment-inspector pixel-panel">
          <div className="equipment-meta">
            <span className={dirty ? "dirty" : ""}>{t(dirty ? "skeletal.equipment.unsaved" : "skeletal.equipment.clean")}</span>
            {activeBody && <span>{activeBody.name}</span>}
          </div>

          {state.pane === "library" && (
            <section className="equipment-section">
              <header>
                <h3>{t("skeletal.equipment.library")}</h3>
                <div className="equipment-inline">
                  <button type="button" className="px-btn" disabled={busy || !activeBody} onClick={createItem}><Plus size={13} />{t("skeletal.equipment.create")}</button>
                  <button type="button" className="px-btn" disabled={busy || !activeBody} onClick={() => void loadFixtures()}>{t("skeletal.equipment.loadFixtures")}</button>
                </div>
              </header>
              <div className="equipment-item-list">
                {state.library.map((item) => (
                  <button type="button" key={item.id} className={item.id === state.selectedEquipmentId ? "on" : ""} onClick={() => dispatch({ type: "selectEquipment", equipmentId: item.id })}>
                    <strong>{item.name}</strong>
                    <span>{item.visualMode} · {item.primarySlot}</span>
                  </button>
                ))}
              </div>
              {!state.library.length && <p className="animation-empty">{t("skeletal.equipment.emptyLibrary")}</p>}
              {draft && (
                <button type="button" className="px-btn danger" disabled={busy} onClick={() => dispatch({ type: "deleteEquipment", equipmentId: draft.id })}>
                  <Trash2 size={13} />{t("skeletal.equipment.delete")}
                </button>
              )}
            </section>
          )}

          {state.pane === "wizard" && draft && (
            <section className="equipment-section">
              <header><h3>{t("skeletal.equipment.wizard")}</h3></header>
              <div className="equipment-step-tabs" role="tablist">
                {EQUIPMENT_WIZARD_STEPS.map((step, index) => (
                  <button key={step} type="button" role="tab" aria-selected={state.wizardStep === step} className={`px-btn ${state.wizardStep === step ? "accent" : ""}`} onClick={() => dispatch({ type: "setWizardStep", step })}>
                    {index + 1}. {stepLabel(step)}
                  </button>
                ))}
              </div>

              {state.wizardStep === "identity" && (
                <div className="equipment-fields">
                  <label>{t("skeletal.equipment.name")}<input className="px-input" value={draft.name} disabled={busy} onChange={(event) => dispatch({ type: "patchDraft", patch: { name: event.target.value } })} /></label>
                  <label>{t("skeletal.equipment.tags")}<input className="px-input" value={tagsDraft} disabled={busy} onChange={(event) => setTagsDraft(event.target.value)} onBlur={() => dispatch({ type: "patchDraft", patch: { tags: parseList(tagsDraft) } })} /></label>
                  <p className="equipment-hint">{t("skeletal.equipment.tagsHint")}</p>
                  <label>{t("skeletal.equipment.conflictTags")}<input className="px-input" value={conflictDraft} disabled={busy} onChange={(event) => setConflictDraft(event.target.value)} onBlur={() => dispatch({ type: "patchDraft", patch: { conflictTags: parseList(conflictDraft) } })} /></label>
                  <p className="equipment-hint">{t("skeletal.equipment.conflictTagsHint")}</p>
                </div>
              )}

              {state.wizardStep === "visualMode" && (
                <div className="equipment-fields">
                  <label>{t("skeletal.equipment.visualMode")}
                    <PxSelect
                      value={draft.visualMode}
                      options={(["none", "attached", "replacement", "effect"] as const).map((mode) => ({ value: mode, label: t(`skeletal.equipment.mode.${mode}`) }))}
                      onChange={(value) => dispatch({ type: "setVisualMode", visualMode: value as EquipmentDefinition["visualMode"] })}
                    />
                  </label>
                  <p className="equipment-hint">{t(`skeletal.equipment.modeHint.${draft.visualMode}`)}</p>
                </div>
              )}

              {state.wizardStep === "slots" && activeBody && (
                <div className="equipment-fields">
                  <label>{t("skeletal.equipment.primarySlot")}
                    <PxSelect
                      value={draft.primarySlot}
                      options={activeBody.slots.map((slot) => ({ value: slot.id, label: `${slot.semantic} (${slot.id})` }))}
                      onChange={(value) => dispatch({ type: "setPrimarySlot", slotId: value })}
                      placeholder={t("skeletal.equipment.chooseSlot")}
                    />
                  </label>
                  <p className="equipment-hint">{t("skeletal.equipment.slotHint")}</p>
                  <div className="equipment-slot-grid">
                    {activeBody.slots.map((slot) => {
                      const checked = draft.occupiedSlots.includes(slot.id);
                      return (
                        <label key={slot.id} className="equipment-check">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={busy || slot.id === draft.primarySlot}
                            title={slot.id === draft.primarySlot ? t("skeletal.equipment.primarySlotLocked") : undefined}
                            onChange={(event) => {
                              const next = event.target.checked
                                ? [...draft.occupiedSlots, slot.id]
                                : draft.occupiedSlots.filter((id) => id !== slot.id);
                              dispatch({ type: "setOccupiedSlots", slotIds: next });
                            }}
                          />
                          {slot.semantic} · {slot.id}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {state.wizardStep === "attachments" && (
                <div className="equipment-fields">
                  {(draft.visualMode === "none" || draft.visualMode === "effect")
                    ? <p className="equipment-hint">{t("skeletal.equipment.noAttachmentsForMode")}</p>
                    : <>
                      <header className="equipment-inline">
                        <h4>{t("skeletal.equipment.attachments")}</h4>
                        <button
                          type="button"
                          className="px-btn"
                          disabled={busy || !activeBody?.sockets[0]}
                          onClick={() => {
                            const preferred = draft.primarySlot
                              ? activeBody!.sockets.find((item) => slotIdForSocket(activeBody!, item.id) === draft.primarySlot)
                              : undefined;
                            const socket = preferred ?? activeBody!.sockets[0]!;
                            const attachment = createEmptyAttachment(uid("att"), t("skeletal.equipment.defaultAttachment"), socket.id, materialOptions[0]?.value ?? "mat-placeholder", defaultGearSize);
                            dispatch({ type: "addAttachment", attachment });
                            if (attachment.materialId !== "mat-placeholder") {
                              void fitEquipmentToMaterial(attachment.id, attachment.materialId, attachment.imageSlot, attachment.size);
                            }
                          }}
                        ><Plus size={13} />{t("skeletal.equipment.addAttachment")}</button>
                      </header>
                      <div className="equipment-item-list">
                        {draft.attachments.map((item) => (
                          <button type="button" key={item.id} className={item.id === state.selectedAttachmentId ? "on" : ""} onClick={() => {
                            dispatch({ type: "selectAttachment", attachmentId: item.id });
                          }}>
                            <strong>{item.name}</strong>
                            <span>{item.socket} · z{item.drawOffset}</span>
                          </button>
                        ))}
                      </div>
                      {selectedAttachment && activeBody && (
                        <div className="equipment-fields">
                          <label>{t("skeletal.equipment.attachmentName")}<input className="px-input" value={selectedAttachment.name} disabled={busy} onChange={(event) => dispatch({ type: "patchAttachment", attachmentId: selectedAttachment.id, patch: { name: event.target.value } })} /></label>
                          <label>{t("skeletal.equipment.socket")}
                            <PxSelect
                              value={selectedAttachment.socket}
                              options={activeBody.sockets.map((socket) => ({ value: socket.id, label: `${socket.semantic} (${socket.id})` }))}
                              onChange={(value) => onSelectAttachmentSocket(value)}
                            />
                          </label>
                          <label>{t("skeletal.equipment.material")}
                            <PxSelect
                              value={selectedAttachment.materialId}
                              options={materialOptions.length ? materialOptions : [{ value: selectedAttachment.materialId, label: selectedAttachment.materialId }]}
                              onChange={(value) => {
                                dispatch({ type: "patchAttachment", attachmentId: selectedAttachment.id, patch: { materialId: value } });
                                void fitEquipmentToMaterial(selectedAttachment.id, value, selectedAttachment.imageSlot, selectedAttachment.size);
                              }}
                            />
                          </label>
                          <div className="equipment-transform">
                            <label>X<input className="px-input" type="number" step="0.1" value={selectedAttachment.rest.translation[0]} disabled={busy} onChange={(event) => dispatch({ type: "patchAttachment", attachmentId: selectedAttachment.id, patch: { rest: { translation: [+event.target.value, selectedAttachment.rest.translation[1], selectedAttachment.rest.translation[2]] } } })} /></label>
                            <label>Y<input className="px-input" type="number" step="0.1" value={selectedAttachment.rest.translation[1]} disabled={busy} onChange={(event) => dispatch({ type: "patchAttachment", attachmentId: selectedAttachment.id, patch: { rest: { translation: [selectedAttachment.rest.translation[0], +event.target.value, selectedAttachment.rest.translation[2]] } } })} /></label>
                            <label>{t("skeletal.equipment.rotation")}<input className="px-input" type="number" step="1" value={Number(((zRotationFromQuaternion(selectedAttachment.rest.rotation) * 180) / Math.PI).toFixed(2))} disabled={busy} onChange={(event) => dispatch({ type: "patchAttachment", attachmentId: selectedAttachment.id, patch: { rest: { rotation: quaternionFromZRotation((+event.target.value * Math.PI) / 180) } } })} /></label>
                            <label>{t("skeletal.equipment.scale")}<input className="px-input" type="number" step="0.05" value={selectedAttachment.rest.scale[0]} disabled={busy} onChange={(event) => {
                              const scale = +event.target.value || 1;
                              dispatch({ type: "patchAttachment", attachmentId: selectedAttachment.id, patch: { rest: { scale: [scale, scale, scale] } } });
                            }} /></label>
                            <label>{t("skeletal.equipment.pivotX")}<input className="px-input" type="number" min="0" max="1" step="0.01" value={selectedAttachment.pivot[0]} disabled={busy} onChange={(event) => dispatch({ type: "patchAttachment", attachmentId: selectedAttachment.id, patch: { pivot: [+event.target.value, selectedAttachment.pivot[1]] } })} /></label>
                            <label>{t("skeletal.equipment.pivotY")}<input className="px-input" type="number" min="0" max="1" step="0.01" value={selectedAttachment.pivot[1]} disabled={busy} onChange={(event) => dispatch({ type: "patchAttachment", attachmentId: selectedAttachment.id, patch: { pivot: [selectedAttachment.pivot[0], +event.target.value] } })} /></label>
                            <label>{t("skeletal.equipment.drawOrder")}<input className="px-input" type="number" step="1" value={selectedAttachment.drawOffset} disabled={busy} onChange={(event) => dispatch({ type: "patchAttachment", attachmentId: selectedAttachment.id, patch: { drawOffset: Math.round(+event.target.value || 0) } })} /></label>
                            <label>{t("skeletal.equipment.drawGroup")}<input className="px-input" value={selectedAttachment.drawGroup} disabled={busy} onChange={(event) => dispatch({ type: "patchAttachment", attachmentId: selectedAttachment.id, patch: { drawGroup: event.target.value } })} /></label>
                          </div>
                          <p className="equipment-hint">{t("skeletal.equipment.drawOrderHint")}</p>
                          <div className="equipment-inline">
                            <button
                              type="button"
                              className="px-btn"
                              disabled={busy}
                              onClick={() => {
                                const socket = activeBody.sockets.find((item) => item.id === selectedAttachment.socket);
                                const mirrorId = socket?.mirrorSocketId ?? activeBody.sockets.find((item) => item.mirrorSocketId === selectedAttachment.socket)?.id;
                                if (!mirrorId) {
                                  notify(t("skeletal.equipment.noMirrorSocket"));
                                  return;
                                }
                                dispatch({ type: "mirrorAttachment", attachmentId: selectedAttachment.id, pairId: uid("att"), socketId: mirrorId });
                              }}
                            ><Copy size={13} />{t("skeletal.equipment.mirrorAttachment")}</button>
                            <button type="button" className="px-btn danger" disabled={busy} onClick={() => dispatch({ type: "deleteAttachment", attachmentId: selectedAttachment.id })}><Trash2 size={13} />{t("skeletal.equipment.deleteAttachment")}</button>
                          </div>
                        </div>
                      )}
                    </>}
                </div>
              )}

              {state.wizardStep === "replacement" && (
                <div className="equipment-fields">
                  <p className="equipment-hint">{t("skeletal.equipment.replacementHint")}</p>
                  <p className="equipment-hint">{t("skeletal.equipment.pickPartsHint")}</p>
                  <h4>{t("skeletal.equipment.replacesParts")}</h4>
                  {bindingParts.length
                    ? <div className="equipment-item-list">
                      {bindingParts.map((part) => (
                        <button
                          type="button"
                          key={`replace-${part.id}`}
                          className={draft.replacesParts.includes(part.id) ? "on" : ""}
                          disabled={busy || draft.visualMode !== "replacement"}
                          onClick={() => dispatch({ type: "patchDraft", patch: { replacesParts: toggleId(draft.replacesParts, part.id) } })}
                        >
                          <strong>{part.label}</strong>
                          <span>{part.id}</span>
                        </button>
                      ))}
                    </div>
                    : <p className="equipment-hint">{t("skeletal.equipment.noBindingParts")}</p>}
                  <p className="equipment-hint">{t("skeletal.equipment.replacesPartsHint")}</p>
                  <h4>{t("skeletal.equipment.hidesSlots")}</h4>
                  {bindingParts.length
                    ? <div className="equipment-item-list">
                      {bindingParts.map((part) => (
                        <button
                          type="button"
                          key={`hide-${part.id}`}
                          className={draft.hidesSlots.includes(part.id) ? "on" : ""}
                          disabled={busy}
                          onClick={() => dispatch({ type: "patchDraft", patch: { hidesSlots: toggleId(draft.hidesSlots, part.id) } })}
                        >
                          <strong>{part.label}</strong>
                          <span>{part.id}</span>
                        </button>
                      ))}
                    </div>
                    : <p className="equipment-hint">{t("skeletal.equipment.noBindingParts")}</p>}
                  <p className="equipment-hint">{t("skeletal.equipment.hidesSlotsHint")}</p>
                  {draft.visualMode !== "replacement" && <p className="equipment-hint">{t("skeletal.equipment.replacementOnlyHint")}</p>}
                </div>
              )}

              {state.wizardStep === "actions" && (
                <div className="equipment-fields">
                  <p className="equipment-hint">{t("skeletal.equipment.actionsHint")}</p>
                  <label>{t("skeletal.equipment.actionProfile")}<input className="px-input" value={draft.actionProfile ?? ""} disabled={busy} onChange={(event) => dispatch({ type: "patchDraft", patch: { actionProfile: event.target.value || undefined } })} /></label>
                  <p className="equipment-hint">{t("skeletal.equipment.actionProfileHint")}</p>
                  <label>{t("skeletal.equipment.actionOverrides")}<input className="px-input" value={overridesDraft} disabled={busy} onChange={(event) => setOverridesDraft(event.target.value)} onBlur={() => dispatch({ type: "setActionOverrides", overrides: parseOverrides(overridesDraft) })} /></label>
                  <p className="equipment-hint">{t("skeletal.equipment.actionOverridesHint")}</p>
                  {draft.visualMode === "effect" && (
                    <>
                      <p className="equipment-hint">{t("skeletal.equipment.effectHint")}</p>
                      <div className="equipment-inline">
                        <label>{t("skeletal.equipment.effectEvent")}<input className="px-input" value={effectEvent} disabled={busy} onChange={(event) => setEffectEvent(event.target.value)} /></label>
                        <label>{t("skeletal.equipment.effectId")}<input className="px-input" value={effectId} disabled={busy} onChange={(event) => setEffectId(event.target.value)} /></label>
                        <button
                          type="button"
                          className="px-btn"
                          disabled={busy}
                          onClick={() => {
                            const socket = activeBody?.sockets[0]?.id;
                            dispatch({
                              type: "setEffectBindings",
                              bindings: [...(draft.effectBindings ?? []), { event: effectEvent.trim() || "weapon.fire", effectId: effectId.trim() || "effect", socket }],
                            });
                          }}
                        ><Plus size={13} />{t("skeletal.equipment.addEffect")}</button>
                      </div>
                      <ul className="equipment-diagnostics">
                        {(draft.effectBindings ?? []).map((effect, index) => (
                          <li key={`${effect.effectId}-${index}`}>
                            <code>{effect.event}</code> → {effect.effectId}
                            <button type="button" className="px-btn" onClick={() => dispatch({ type: "setEffectBindings", bindings: (draft.effectBindings ?? []).filter((_, i) => i !== index) })}><Trash2 size={12} /></button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}

              {state.wizardStep === "compatibility" && (
                <div className="equipment-fields">
                  <p className="equipment-hint">{t("skeletal.equipment.compatibilityHint")}</p>
                  <div className="equipment-inline">
                    <button type="button" className="px-btn accent" disabled={busy || !draft} onClick={() => {
                      dispatch({ type: "setPane", pane: "loadout" });
                      dispatch({ type: "tryEquip", equipmentId: draft.id });
                    }}><Eye size={13} />{t("skeletal.equipment.tryOn")}</button>
                  </div>
                  {allIssues.length
                    ? <ul className="equipment-diagnostics">{allIssues.map((issue, index) => <li key={`${issue.path}-${index}`}><code>{issue.path}</code> {issue.message}</li>)}</ul>
                    : <p className="equipment-hint">{t("skeletal.equipment.diagnosticsOk")}</p>}
                </div>
              )}

              {stepIssues.length > 0 && state.wizardStep !== "compatibility" && (
                <ul className="equipment-diagnostics">
                  {stepIssues.map((issue, index) => <li key={`${issue.path}-${index}`}><code>{issue.path}</code> {issue.message}</li>)}
                </ul>
              )}
            </section>
          )}

          {state.pane === "loadout" && (
            <section className="equipment-section">
              <header><h3>{t("skeletal.equipment.loadout")}</h3></header>
              <label>{t("skeletal.equipment.bodyProfile")}
                <PxSelect
                  value={state.selectedBodyProfileId}
                  options={bodyProfiles.map((item) => ({ value: item.id, label: item.name }))}
                  onChange={(value) => dispatch({ type: "selectBodyProfile", bodyProfileId: value })}
                  placeholder={t("skeletal.equipment.chooseBody")}
                />
              </label>
              <div className="equipment-item-list">
                {state.library.map((item) => {
                  const equipped = state.previewLoadout.equipment.some((entry) => entry.equipmentId === item.id);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={equipped ? "on" : ""}
                      onClick={() => {
                        if (item.id !== state.selectedEquipmentId) {
                          dispatch({ type: "selectEquipment", equipmentId: item.id, keepPane: true });
                        }
                        if (equipped && item.id === state.selectedEquipmentId) {
                          dispatch({ type: "unequip", equipmentId: item.id });
                          return;
                        }
                        if (!equipped) dispatch({ type: "tryEquip", equipmentId: item.id });
                      }}
                    >
                      <strong>{item.name}</strong>
                      <span>{equipped ? t("skeletal.equipment.equipped") : t("skeletal.equipment.unequipped")}</span>
                    </button>
                  );
                })}
              </div>
              <div className="equipment-inline">
                <input className="px-input" value={loadoutName} placeholder={t("skeletal.equipment.loadoutName")} onChange={(event) => setLoadoutName(event.target.value)} />
                <button type="button" className="px-btn" disabled={busy || !loadoutName.trim()} onClick={() => {
                  dispatch({ type: "saveLoadout", name: loadoutName.trim() });
                  setLoadoutName("");
                  notify(t("skeletal.equipment.loadoutSaved"), "info");
                }}>{t("skeletal.equipment.saveLoadout")}</button>
              </div>
              <div className="equipment-item-list">
                {state.savedLoadouts.map((item) => (
                  <button type="button" key={item.name} onClick={() => dispatch({ type: "loadSavedLoadout", name: item.name })}>
                    <strong>{item.name}</strong>
                    <span>{item.loadout.equipment.map((entry) => entry.equipmentId).join(", ") || t("skeletal.equipment.emptyLoadout")}</span>
                  </button>
                ))}
              </div>
              {!state.savedLoadouts.length && <p className="animation-empty">{t("skeletal.equipment.noSavedLoadouts")}</p>}
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}

export async function confirmLeaveEquipment(dirty: boolean, message: string): Promise<boolean> {
  if (!dirty) return true;
  return askConfirm(message);
}
