import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  quaternionFromZRotation,
  zRotationFromQuaternion,
  type BodyProfile,
  type CharacterBinding,
  type MotionClip,
  type Skeleton,
} from "@framebaker/shared";
import { Plus, Redo2, Save, Trash2, Undo2 } from "lucide-react";
import {
  BODY_PROFILE_STANDARD_SEMANTICS,
  bodyProfileDiagnostics,
  createBodyProfileUiState,
  createEmptyBodyProfile,
  isBodyProfileDirty,
  normalizeSocketSemantic,
  reduceBodyProfileUi,
  type BodyProfileMode,
} from "../bodyProfileUiState";
import { localizeBoneName } from "../builtinAnimationLabels";
import { useT } from "../i18n";
import { askConfirm, notify } from "../notice";
import { CharacterPreview } from "./AnimationAssetsWorkspace";
import PxSelect from "./PxSelect";

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

function parseTags(value: string): string[] {
  return [...new Set(value.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean))];
}

export interface BodyProfileWorkspaceProps {
  profile?: BodyProfile | null;
  skeleton: Skeleton;
  binding?: CharacterBinding;
  clip?: MotionClip;
  busy?: boolean;
  onChange?: (profile: BodyProfile) => void;
  onSave: (profile: BodyProfile) => Promise<void> | void;
  onRequestClose?: () => void;
}

export default function BodyProfileWorkspace({
  profile,
  skeleton,
  binding,
  clip,
  busy = false,
  onChange,
  onSave,
  onRequestClose,
}: BodyProfileWorkspaceProps) {
  const t = useT();
  const initial = useMemo(
    () => profile ?? createEmptyBodyProfile(uid("body"), t("skeletal.bodyProfile.defaultName"), skeleton.id),
    [profile, skeleton.id, t],
  );
  const [state, dispatch] = useReducer(reduceBodyProfileUi, undefined, () => createBodyProfileUiState(initial, skeleton));
  const [customSemantic, setCustomSemantic] = useState("");
  const [acceptDraft, setAcceptDraft] = useState("");
  const [slotAcceptDraft, setSlotAcceptDraft] = useState("");
  const dirty = isBodyProfileDirty(state);
  const diagnostics = useMemo(() => bodyProfileDiagnostics(state, skeleton), [state, skeleton]);
  const selectedSocket = state.draft.sockets.find((socket) => socket.id === state.selectedSocketId);
  const selectedSlot = state.draft.slots.find((slot) => slot.id === state.selectedSlotId);
  const boneName = (bone: Skeleton["bones"][number]) => localizeBoneName(skeleton.id, bone.id, bone.name, t);
  const socketMarkers = useMemo(
    () => state.draft.sockets.map((socket) => ({
      id: socket.id,
      boneId: socket.boneId,
      rest: socket.rest,
      label: socket.semantic,
      selected: socket.id === state.selectedSocketId,
    })),
    [state.draft.sockets, state.selectedSocketId],
  );

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => { onChangeRef.current?.(state.draft); }, [state.draft]);

  useEffect(() => {
    const next = profile ?? createEmptyBodyProfile(uid("body"), t("skeletal.bodyProfile.defaultName"), skeleton.id);
    dispatch({ type: "replaceProfile", profile: { ...next, skeletonId: skeleton.id } });
  }, [profile, skeleton.id, t]);

  useEffect(() => {
    setAcceptDraft(selectedSocket?.accepts.join(", ") ?? "");
  }, [selectedSocket?.id, selectedSocket?.accepts]);

  useEffect(() => {
    setSlotAcceptDraft(selectedSlot?.accepts.join(", ") ?? "");
  }, [selectedSlot?.id, selectedSlot?.accepts]);

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

  const requestClose = async () => {
    if (!onRequestClose) return;
    if (dirty && !(await askConfirm(t("skeletal.bodyProfile.unsavedConfirm")))) return;
    onRequestClose();
  };

  const save = async () => {
    if (busy || diagnostics.length) {
      if (diagnostics.length) notify(t("skeletal.bodyProfile.fixBlocked", { msg: diagnostics[0]!.message }));
      return;
    }
    try {
      await onSave(state.draft);
      dispatch({ type: "markSaved", profile: state.draft });
      notify(t("skeletal.bodyProfile.saved"), "info");
    } catch (error) {
      notify(t("skeletal.bodyProfile.saveFailed", { msg: (error as Error).message }));
    }
  };

  const setMode = (mode: BodyProfileMode) => {
    if (mode === state.mode) return;
    dispatch({ type: "setMode", mode });
  };

  const semanticOptions = [
    ...BODY_PROFILE_STANDARD_SEMANTICS.map((semantic) => ({
      value: semantic,
      label: t(`skeletal.bodyProfile.semantic.${semantic}`),
    })),
    ...(selectedSocket && !(BODY_PROFILE_STANDARD_SEMANTICS as readonly string[]).includes(selectedSocket.semantic)
      ? [{ value: selectedSocket.semantic, label: selectedSocket.semantic }]
      : []),
  ];

  return (
    <section className="body-profile-workspace">
      <header className="body-profile-toolbar">
        <div className="body-profile-mode-tabs" role="tablist" aria-label={t("skeletal.bodyProfile.modes")}>
          <button type="button" role="tab" aria-selected={state.mode === "skeleton"} className={`px-btn ${state.mode === "skeleton" ? "accent" : ""}`} onClick={() => setMode("skeleton")}>{t("skeletal.bodyProfile.mode.skeleton")}</button>
          <button type="button" role="tab" aria-selected={state.mode === "parts"} className={`px-btn ${state.mode === "parts" ? "accent" : ""}`} onClick={() => setMode("parts")}>{t("skeletal.bodyProfile.mode.parts")}</button>
          <button type="button" role="tab" aria-selected={state.mode === "semantics"} className={`px-btn ${state.mode === "semantics" ? "accent" : ""}`} onClick={() => setMode("semantics")}>{t("skeletal.bodyProfile.mode.semantics")}</button>
        </div>
        <div className="body-profile-history-actions">
          <button type="button" className="px-btn icon" disabled={!state.past.length || busy} onClick={() => dispatch({ type: "undo" })} title={t("skeletal.bodyProfile.undo")}><Undo2 size={14} /></button>
          <button type="button" className="px-btn icon" disabled={!state.future.length || busy} onClick={() => dispatch({ type: "redo" })} title={t("skeletal.bodyProfile.redo")}><Redo2 size={14} /></button>
          <button type="button" className="px-btn accent" disabled={busy || !dirty || diagnostics.length > 0} onClick={() => void save()}><Save size={14} /> {t("common.save")}</button>
          {onRequestClose && <button type="button" className="px-btn" onClick={() => void requestClose()}>{t("common.close")}</button>}
        </div>
      </header>

      <div className="body-profile-layout">
        <div className="body-profile-canvas pixel-panel">
          <div className="body-profile-canvas-stage">
            {binding
              ? <CharacterPreview
                  binding={binding}
                  skeleton={skeleton}
                  clip={clip}
                  time={state.previewTime}
                  selectedBoneId={state.selectedBoneId}
                  showSkeleton
                  socketMarkers={socketMarkers}
                  onSelectBone={(boneId) => dispatch({ type: "selectBone", boneId })}
                  onSelectSocket={(socketId) => dispatch({ type: "selectSocket", socketId })}
                />
              : <div className="body-profile-empty-canvas">{t("skeletal.bodyProfile.needBinding")}</div>}
          </div>
          {clip && clip.duration > 0 && (
            <label className="body-profile-follow-time">
              {t("skeletal.bodyProfile.actionFollow")}
              <input
                type="range"
                min={0}
                max={clip.duration}
                step={0.001}
                value={Math.min(state.previewTime, clip.duration)}
                onChange={(event) => dispatch({ type: "setPreviewTime", time: +event.target.value })}
              />
              <span>{state.previewTime.toFixed(2)}s</span>
            </label>
          )}
        </div>

        <aside className="body-profile-inspector pixel-panel">
          <label>{t("skeletal.bodyProfile.name")}
            <input className="px-input" value={state.draft.name} disabled={busy} onChange={(event) => dispatch({ type: "setName", name: event.target.value })} />
          </label>
          <div className="body-profile-meta">
            <span>{t("skeletal.bodyProfile.mirrorAxis")}: X</span>
            <span className={dirty ? "dirty" : ""}>{t(dirty ? "skeletal.bodyProfile.unsaved" : "skeletal.bodyProfile.clean")}</span>
          </div>

          {(state.mode === "skeleton" || state.mode === "semantics") && (
            <section className="body-profile-section">
              <header><h3>{t("skeletal.bodyProfile.bones")}</h3></header>
              <div className="body-profile-bone-list">
                {skeleton.bones.map((bone) => (
                  <button
                    type="button"
                    key={bone.id}
                    className={state.selectedBoneId === bone.id ? "on" : ""}
                    onClick={() => dispatch({ type: "selectBone", boneId: bone.id })}
                  >
                    {boneName(bone)}
                  </button>
                ))}
              </div>
            </section>
          )}

          {(state.mode === "parts" || state.mode === "semantics") && (
            <section className="body-profile-section">
              <header>
                <h3>{t("skeletal.bodyProfile.slots")}</h3>
                <button type="button" className="px-btn" disabled={busy} onClick={() => dispatch({ type: "addSlot", slotId: uid("slot") })}><Plus size={13} />{t("skeletal.bodyProfile.addSlot")}</button>
              </header>
              <div className="body-profile-item-list">
                {state.draft.slots.map((slot) => (
                  <button type="button" key={slot.id} className={state.selectedSlotId === slot.id ? "on" : ""} onClick={() => dispatch({ type: "selectSlot", slotId: slot.id })}>
                    <strong>{slot.semantic}</strong>
                    <span>{slot.capacity} · {slot.accepts.join(", ") || t("skeletal.bodyProfile.noTags")}</span>
                  </button>
                ))}
                {!state.draft.slots.length && <p className="animation-empty">{t("skeletal.bodyProfile.noSlots")}</p>}
              </div>
              {selectedSlot && (
                <div className="body-profile-fields">
                  <label>{t("skeletal.bodyProfile.slotSemantic")}
                    <input className="px-input" value={selectedSlot.semantic} disabled={busy} onChange={(event) => dispatch({ type: "patchSlot", slotId: selectedSlot.id, patch: { semantic: event.target.value } })} />
                  </label>
                  <label>{t("skeletal.bodyProfile.slotCapacity")}
                    <input className="px-input" type="number" min={1} max={32} step={1} value={selectedSlot.capacity} disabled={busy} onChange={(event) => dispatch({ type: "patchSlot", slotId: selectedSlot.id, patch: { capacity: Math.max(1, Math.min(32, Math.round(+event.target.value || 1))) } })} />
                  </label>
                  <label>{t("skeletal.bodyProfile.accepts")}
                    <input
                      className="px-input"
                      value={slotAcceptDraft}
                      disabled={busy}
                      onChange={(event) => setSlotAcceptDraft(event.target.value)}
                      onBlur={() => dispatch({ type: "patchSlot", slotId: selectedSlot.id, patch: { accepts: parseTags(slotAcceptDraft) } })}
                    />
                  </label>
                  <button type="button" className="px-btn danger" disabled={busy} onClick={() => dispatch({ type: "deleteSlot", slotId: selectedSlot.id })}><Trash2 size={13} />{t("skeletal.bodyProfile.deleteSlot")}</button>
                </div>
              )}
            </section>
          )}

          {state.mode === "semantics" && (
            <section className="body-profile-section">
              <header>
                <h3>{t("skeletal.bodyProfile.sockets")}</h3>
                <button
                  type="button"
                  className="px-btn"
                  disabled={busy || !state.selectedBoneId}
                  onClick={() => dispatch({ type: "addSocket", socketId: uid("socket"), boneId: state.selectedBoneId, semantic: "custom:socket" })}
                ><Plus size={13} />{t("skeletal.bodyProfile.addSocket")}</button>
              </header>
              <div className="body-profile-item-list">
                {state.draft.sockets.map((socket) => (
                  <button type="button" key={socket.id} className={state.selectedSocketId === socket.id ? "on" : ""} onClick={() => dispatch({ type: "selectSocket", socketId: socket.id })}>
                    <strong>{socket.semantic}</strong>
                    <span>{boneName(skeleton.bones.find((bone) => bone.id === socket.boneId) ?? { id: socket.boneId, name: socket.boneId, parentId: null, rest: socket.rest })}</span>
                  </button>
                ))}
                {!state.draft.sockets.length && <p className="animation-empty">{t("skeletal.bodyProfile.noSockets")}</p>}
              </div>
              {selectedSocket && (
                <div className="body-profile-fields">
                  <label>{t("skeletal.bodyProfile.socketSemantic")}
                    <PxSelect
                      value={selectedSocket.semantic}
                      options={semanticOptions}
                      disabled={busy}
                      onChange={(value) => dispatch({ type: "patchSocket", socketId: selectedSocket.id, patch: { semantic: value } })}
                    />
                  </label>
                  <label>{t("skeletal.bodyProfile.customSemantic")}
                    <div className="body-profile-inline">
                      <input className="px-input" value={customSemantic} disabled={busy} placeholder="spine_implant" onChange={(event) => setCustomSemantic(event.target.value)} />
                      <button
                        type="button"
                        className="px-btn"
                        disabled={busy || !customSemantic.trim()}
                        onClick={() => {
                          dispatch({ type: "patchSocket", socketId: selectedSocket.id, patch: { semantic: normalizeSocketSemantic(customSemantic) } });
                          setCustomSemantic("");
                        }}
                      >{t("skeletal.bodyProfile.applyCustom")}</button>
                    </div>
                  </label>
                  <label>{t("skeletal.bodyProfile.socketBone")}
                    <PxSelect
                      value={selectedSocket.boneId}
                      options={skeleton.bones.map((bone) => ({ value: bone.id, label: boneName(bone) }))}
                      disabled={busy}
                      onChange={(value) => dispatch({ type: "patchSocket", socketId: selectedSocket.id, patch: { boneId: value } })}
                    />
                  </label>
                  <div className="body-profile-transform">
                    <label>{t("animation.translationX")}<input className="px-input" type="number" step="1" value={selectedSocket.rest.translation[0]} disabled={busy} onChange={(event) => dispatch({ type: "patchSocket", socketId: selectedSocket.id, patch: { rest: { translation: [+event.target.value || 0, selectedSocket.rest.translation[1], selectedSocket.rest.translation[2]] } } })} /></label>
                    <label>{t("animation.translationY")}<input className="px-input" type="number" step="1" value={selectedSocket.rest.translation[1]} disabled={busy} onChange={(event) => dispatch({ type: "patchSocket", socketId: selectedSocket.id, patch: { rest: { translation: [selectedSocket.rest.translation[0], +event.target.value || 0, selectedSocket.rest.translation[2]] } } })} /></label>
                    <label>{t("animation.rotationZ")}<input className="px-input" type="number" step="1" value={zRotationFromQuaternion(selectedSocket.rest.rotation) * 180 / Math.PI} disabled={busy} onChange={(event) => dispatch({ type: "patchSocket", socketId: selectedSocket.id, patch: { rest: { rotation: quaternionFromZRotation((+event.target.value || 0) * Math.PI / 180) } } })} /></label>
                  </div>
                  <label>{t("skeletal.bodyProfile.accepts")}
                    <input
                      className="px-input"
                      value={acceptDraft}
                      disabled={busy}
                      onChange={(event) => setAcceptDraft(event.target.value)}
                      onBlur={() => dispatch({ type: "patchSocket", socketId: selectedSocket.id, patch: { accepts: parseTags(acceptDraft) } })}
                    />
                  </label>
                  <div className="body-profile-inline">
                    <button
                      type="button"
                      className="px-btn"
                      disabled={busy || !!selectedSocket.mirrorSocketId}
                      onClick={() => dispatch({ type: "mirrorSocket", socketId: selectedSocket.id, pairId: uid("socket") })}
                    >{t("skeletal.bodyProfile.mirrorPair")}</button>
                    <button type="button" className="px-btn danger" disabled={busy} onClick={() => dispatch({ type: "deleteSocket", socketId: selectedSocket.id })}><Trash2 size={13} />{t("skeletal.bodyProfile.deleteSocket")}</button>
                  </div>
                  {selectedSocket.mirrorSocketId && <p className="body-profile-hint">{t("skeletal.bodyProfile.mirroredWith", { id: selectedSocket.mirrorSocketId })}</p>}
                </div>
              )}
            </section>
          )}

          <section className="body-profile-section">
            <header><h3>{t("skeletal.bodyProfile.diagnostics")}</h3></header>
            {diagnostics.length
              ? <ul className="body-profile-diagnostics">{diagnostics.map((issue, index) => <li key={`${issue.path}-${index}`}><code>{issue.path}</code> {issue.message}</li>)}</ul>
              : <p className="body-profile-hint">{t("skeletal.bodyProfile.diagnosticsOk")}</p>}
          </section>
        </aside>
      </div>
    </section>
  );
}

export async function confirmLeaveBodyProfile(dirty: boolean, message: string): Promise<boolean> {
  if (!dirty) return true;
  return askConfirm(message);
}
