import { useEffect, useMemo, useReducer, useState } from "react";
import {
  type BodyProfile,
  type CharacterBinding,
  type CharacterLoadout,
  type EquipmentDefinition,
  type MotionClip,
  type Skeleton,
  type Transform,
} from "@framebaker/shared";
import { Crosshair, Plus, Redo2, Save, Trash2, Undo2 } from "lucide-react";
import {
  canCompleteWeaponWizard,
  createDefaultSecondaryHandConstraint,
  createEmptyWeapon,
  createWeaponUiState,
  isWeaponDirty,
  reduceWeaponUi,
  weaponWizardBlockingIssues,
  type WeaponGripTarget,
  type WeaponHoldMode,
  type WeaponPrimaryHand,
} from "../weaponUiState";
import { createWeaponSampleFixtures } from "../weaponFixtures";
import { bindingWithAssembledLoadout } from "../loadoutPreview";
import { useT } from "../i18n";
import { askConfirm, notify } from "../notice";
import { CharacterPreview } from "./AnimationAssetsWorkspace";
import PxSelect from "./PxSelect";

const uid = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

function isWeaponItem(item: EquipmentDefinition): boolean {
  return item.weapon !== undefined || item.tags.includes("weapon");
}

export interface WeaponWorkspaceProps {
  equipment?: EquipmentDefinition[];
  loadouts?: CharacterLoadout[];
  bodyProfiles: BodyProfile[];
  skeleton: Skeleton;
  binding?: CharacterBinding;
  clip?: MotionClip;
  busy?: boolean;
  onSaveWeapons: (equipment: EquipmentDefinition[], loadouts: CharacterLoadout[]) => Promise<void> | void;
  onRequestClose?: () => void;
}

export default function WeaponWorkspace({
  equipment = [],
  loadouts = [],
  bodyProfiles,
  skeleton,
  binding,
  clip,
  busy = false,
  onSaveWeapons,
  onRequestClose,
}: WeaponWorkspaceProps) {
  const t = useT();
  const body = bodyProfiles[0] ?? null;
  const weaponLibrary = useMemo(() => equipment.filter(isWeaponItem), [equipment]);
  const [state, dispatch] = useReducer(
    (current: ReturnType<typeof createWeaponUiState>, action: Parameters<typeof reduceWeaponUi>[1]) => {
      const nextBodyId = action.type === "selectBodyProfile" ? action.bodyProfileId : current.selectedBodyProfileId;
      const selectedBody = bodyProfiles.find((item) => item.id === nextBodyId) ?? body;
      return reduceWeaponUi(current, action, selectedBody, binding ?? null, skeleton);
    },
    undefined,
    () => createWeaponUiState(weaponLibrary, body, binding ?? null, skeleton),
  );
  const activeBody = bodyProfiles.find((item) => item.id === state.selectedBodyProfileId) ?? body;
  const dirty = isWeaponDirty(state);
  const draft = state.draft;
  const weapon = draft?.weapon ?? null;
  const issues = useMemo(
    () => weaponWizardBlockingIssues(draft, activeBody, skeleton),
    [draft, activeBody, skeleton],
  );
  const [holdModeDraft, setHoldModeDraft] = useState<WeaponHoldMode>("one_hand");

  useEffect(() => {
    dispatch({ type: "replaceLibrary", equipment: weaponLibrary });
  }, [weaponLibrary]);

  useEffect(() => {
    setHoldModeDraft(draft?.weapon?.holdMode ?? "one_hand");
  }, [draft?.id, draft?.weapon?.holdMode]);

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

  const socketMarkers = useMemo(() => {
    if (!activeBody) return [];
    return activeBody.sockets.map((socket) => ({
      id: socket.id,
      boneId: socket.boneId,
      rest: socket.rest,
      label: socket.semantic,
      selected: weapon?.secondaryHandConstraint?.targetSocket === socket.id,
    }));
  }, [activeBody, weapon?.secondaryHandConstraint?.targetSocket]);

  const requestClose = async () => {
    if (!onRequestClose) return;
    if (dirty && !(await askConfirm(t("skeletal.weapon.unsavedConfirm")))) return;
    onRequestClose();
  };

  const save = async () => {
    if (busy || !draft) return;
    if (!canCompleteWeaponWizard(draft, activeBody, skeleton)) {
      notify(t("skeletal.weapon.fixBlocked", { msg: issues[0]?.message ?? "" }));
      return;
    }
    try {
      const nonWeapons = equipment.filter((item) => !isWeaponItem(item));
      const nextWeapons = state.library.some((item) => item.id === draft.id)
        ? state.library.map((item) => item.id === draft.id ? draft : item)
        : [...state.library, draft];
      const nextEquipment = [...nonWeapons, ...nextWeapons];
      const nextLoadouts = loadouts.length
        ? loadouts
        : state.previewLoadout.equipment.length
          ? [state.previewLoadout]
          : [];
      await onSaveWeapons(nextEquipment, nextLoadouts);
      dispatch({ type: "markSaved", equipment: draft });
      notify(t("skeletal.weapon.saved"), "info");
    } catch (error) {
      notify(t("skeletal.weapon.saveFailed", { msg: (error as Error).message }));
    }
  };

  const createItem = (holdMode: WeaponHoldMode = "one_hand", hand: WeaponPrimaryHand = "right") => {
    if (!activeBody) {
      notify(t("skeletal.weapon.needBody"));
      return;
    }
    const item = createEmptyWeapon(uid("wpn"), t("skeletal.weapon.defaultName"), activeBody, {
      holdMode,
      preferredPrimaryHand: hand,
    });
    dispatch({ type: "createWeapon", equipment: item });
  };

  const loadFixtures = async () => {
    if (!(await askConfirm(t("skeletal.weapon.loadFixturesConfirm")))) return;
    const fixtures = createWeaponSampleFixtures(skeleton.id);
    const merged = [...state.library];
    for (const item of fixtures) {
      const index = merged.findIndex((entry) => entry.id === item.id);
      if (index >= 0) merged[index] = item;
      else merged.push(item);
    }
    dispatch({ type: "replaceLibrary", equipment: merged, selectedId: fixtures[0]?.id ?? null });
    notify(t("skeletal.weapon.fixturesLoaded"), "info");
  };

  const gripTargets: WeaponGripTarget[] = ["primaryGrip", "secondaryGrip", "muzzleSocket", "ejectSocket"];
  const selectedGrip = state.selectedGripTarget;
  const selectedGripTransform: Transform | undefined = weapon
    ? selectedGrip === "primaryGrip"
      ? weapon.primaryGrip
      : selectedGrip === "secondaryGrip"
        ? weapon.secondaryGrip
        : selectedGrip === "muzzleSocket"
          ? weapon.muzzleSocket
          : weapon.ejectSocket
    : undefined;

  const boneOptions = skeleton.bones.map((bone) => ({ value: bone.id, label: bone.name || bone.id }));
  const socketOptions = (activeBody?.sockets ?? []).map((socket) => ({
    value: socket.id,
    label: `${socket.semantic} (${socket.id})`,
  }));
  const previewBinding = useMemo(() => {
    if (!binding || !activeBody || !state.legalPreview) return binding;
    return bindingWithAssembledLoadout(binding, activeBody, state.legalPreview);
  }, [activeBody, binding, state.legalPreview]);

  return (
    <section className="weapon-workspace">
      <header className="weapon-toolbar">
        <div className="weapon-pane-tabs" role="tablist" aria-label={t("skeletal.weapon.panes")}>
          <button type="button" role="tab" aria-selected={state.pane === "library"} className={`px-btn ${state.pane === "library" ? "accent" : ""}`} onClick={() => dispatch({ type: "setPane", pane: "library" })}>{t("skeletal.weapon.pane.library")}</button>
          <button type="button" role="tab" aria-selected={state.pane === "editor"} className={`px-btn ${state.pane === "editor" ? "accent" : ""}`} onClick={() => dispatch({ type: "setPane", pane: "editor" })} disabled={!draft}>{t("skeletal.weapon.pane.editor")}</button>
          <button type="button" role="tab" aria-selected={state.pane === "preview"} className={`px-btn ${state.pane === "preview" ? "accent" : ""}`} onClick={() => dispatch({ type: "setPane", pane: "preview" })}>{t("skeletal.weapon.pane.preview")}</button>
        </div>
        <div className="weapon-history-actions">
          <button type="button" className="px-btn icon" disabled={!state.past.length || busy} onClick={() => dispatch({ type: "undo" })} title={t("skeletal.weapon.undo")}><Undo2 size={14} /></button>
          <button type="button" className="px-btn icon" disabled={!state.future.length || busy} onClick={() => dispatch({ type: "redo" })} title={t("skeletal.weapon.redo")}><Redo2 size={14} /></button>
          <button type="button" className="px-btn accent" disabled={busy || !dirty || issues.length > 0} onClick={() => void save()}><Save size={14} /> {t("common.save")}</button>
          {onRequestClose && <button type="button" className="px-btn" onClick={() => void requestClose()}>{t("common.close")}</button>}
        </div>
      </header>

      <div className="weapon-layout">
        <div className="weapon-canvas pixel-panel">
          <div className={`weapon-canvas-stage${state.facing === "left" ? " facing-left" : ""}`}>
            {previewBinding
              ? <CharacterPreview
                  binding={previewBinding}
                  skeleton={skeleton}
                  clip={clip}
                  time={state.previewTime}
                  showSkeleton
                  socketMarkers={socketMarkers}
                />
              : <div className="weapon-empty-canvas">{t("skeletal.weapon.needBinding")}</div>}
          </div>
          <div className="weapon-preview-controls">
            {clip && clip.duration > 0 && (
              <label className="weapon-follow-time">
                {t("skeletal.weapon.actionPlayback")}
                <input type="range" min={0} max={clip.duration} step={0.001} value={Math.min(state.previewTime, clip.duration)} onChange={(event) => dispatch({ type: "setPreviewTime", time: +event.target.value })} />
                <span>{state.previewTime.toFixed(2)}s</span>
              </label>
            )}
            <div className="weapon-inline">
              <button type="button" className={`px-btn ${state.facing === "right" ? "accent" : ""}`} onClick={() => dispatch({ type: "setFacing", facing: "right" })}>{t("skeletal.weapon.facing.right")}</button>
              <button type="button" className={`px-btn ${state.facing === "left" ? "accent" : ""}`} onClick={() => dispatch({ type: "setFacing", facing: "left" })}>{t("skeletal.weapon.facing.left")}</button>
            </div>
            {weapon && (
              <div className="weapon-grip-summary">
                <Crosshair size={14} />
                <span>{t("skeletal.weapon.gripSummary", {
                  primary: weapon.primaryGrip.translation.map((n) => n.toFixed(1)).join(","),
                  secondary: weapon.secondaryGrip
                    ? weapon.secondaryGrip.translation.map((n) => n.toFixed(1)).join(",")
                    : "-",
                  muzzle: weapon.muzzleSocket
                    ? weapon.muzzleSocket.translation.map((n) => n.toFixed(1)).join(",")
                    : "-",
                })}</span>
              </div>
            )}
            {state.legalPreview && (
              <p className="weapon-hint">
                {t("skeletal.weapon.previewSummary", {
                  occupied: state.legalPreview.occupiedSlots.join(", ") || "-",
                  attachments: String(state.legalPreview.attachments.length),
                })}
              </p>
            )}
            {state.conflictIssues.length > 0 && (
              <ul className="weapon-diagnostics">
                {state.conflictIssues.map((issue, index) => (
                  <li key={`${issue.path}-${index}`}><code>{issue.path}</code> {issue.message}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <aside className="weapon-inspector pixel-panel">
          <div className="weapon-meta">
            <span className={dirty ? "dirty" : ""}>{t(dirty ? "skeletal.weapon.unsaved" : "skeletal.weapon.clean")}</span>
            {activeBody && <span>{activeBody.name}</span>}
          </div>

          {state.pane === "library" && (
            <section className="weapon-section">
              <header>
                <h3>{t("skeletal.weapon.library")}</h3>
                <div className="weapon-inline">
                  <button type="button" className="px-btn" disabled={busy || !activeBody} onClick={() => createItem(holdModeDraft)}><Plus size={13} />{t("skeletal.weapon.create")}</button>
                  <button type="button" className="px-btn" disabled={busy || !activeBody} onClick={() => void loadFixtures()}>{t("skeletal.weapon.loadFixtures")}</button>
                </div>
              </header>
              <label>
                {t("skeletal.weapon.holdMode")}
                <PxSelect
                  value={holdModeDraft}
                  options={[
                    { value: "one_hand", label: t("skeletal.weapon.hold.one_hand") },
                    { value: "two_hand", label: t("skeletal.weapon.hold.two_hand") },
                    { value: "either", label: t("skeletal.weapon.hold.either") },
                  ]}
                  onChange={(value) => setHoldModeDraft(value as WeaponHoldMode)}
                />
              </label>
              <div className="weapon-item-list">
                {state.library.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={state.selectedEquipmentId === item.id ? "on" : ""}
                    onClick={() => dispatch({ type: "selectWeapon", equipmentId: item.id })}
                  >
                    <strong>{item.name}</strong>
                    <span>{item.weapon?.holdMode ?? "-"} · {item.weapon?.preferredPrimaryHand ?? "-"}</span>
                  </button>
                ))}
                {!state.library.length && <p className="weapon-hint">{t("skeletal.weapon.emptyLibrary")}</p>}
              </div>
              {draft && (
                <button
                  type="button"
                  className="px-btn"
                  disabled={busy}
                  onClick={() => {
                    void askConfirm(t("skeletal.weapon.deleteConfirm")).then((ok) => {
                      if (ok) dispatch({ type: "deleteWeapon", equipmentId: draft.id });
                    });
                  }}
                >
                  <Trash2 size={13} /> {t("skeletal.weapon.delete")}
                </button>
              )}
            </section>
          )}

          {state.pane === "editor" && draft && weapon && activeBody && (
            <section className="weapon-section">
              <header><h3>{t("skeletal.weapon.editor")}</h3></header>
              <div className="weapon-fields">
                <label>
                  {t("skeletal.weapon.name")}
                  <input value={draft.name} onChange={(event) => dispatch({ type: "patchDraft", patch: { name: event.target.value } })} />
                </label>
                <label>
                  {t("skeletal.weapon.holdMode")}
                  <PxSelect
                    value={weapon.holdMode}
                    options={[
                      { value: "one_hand", label: t("skeletal.weapon.hold.one_hand") },
                      { value: "two_hand", label: t("skeletal.weapon.hold.two_hand") },
                      { value: "either", label: t("skeletal.weapon.hold.either") },
                    ]}
                    onChange={(value) => dispatch({ type: "setHoldMode", holdMode: value as WeaponHoldMode })}
                  />
                </label>
                <label>
                  {t("skeletal.weapon.preferredPrimaryHand")}
                  <PxSelect
                    value={weapon.preferredPrimaryHand}
                    options={[
                      { value: "right", label: t("skeletal.weapon.hand.right") },
                      { value: "left", label: t("skeletal.weapon.hand.left") },
                    ]}
                    onChange={(value) => dispatch({ type: "setPreferredPrimaryHand", hand: value as WeaponPrimaryHand })}
                  />
                </label>
                <label className="weapon-check">
                  <input
                    type="checkbox"
                    checked={weapon.mirrorAllowed}
                    onChange={(event) => dispatch({ type: "patchWeapon", patch: { mirrorAllowed: event.target.checked } })}
                  />
                  {t("skeletal.weapon.mirrorAllowed")}
                </label>
                <label>
                  {t("skeletal.weapon.stanceProfile")}
                  <input
                    value={weapon.stanceProfile}
                    onChange={(event) => dispatch({ type: "patchWeapon", patch: { stanceProfile: event.target.value } })}
                  />
                </label>
                <label>
                  {t("skeletal.weapon.recoilProfile")}
                  <input
                    value={weapon.recoilProfile ?? ""}
                    onChange={(event) => dispatch({
                      type: "patchWeapon",
                      patch: { recoilProfile: event.target.value.trim() || undefined },
                    })}
                  />
                </label>
                <p className="weapon-hint">
                  {t("skeletal.weapon.slotsSummary", {
                    primary: draft.primarySlot,
                    occupied: draft.occupiedSlots.join(", "),
                  })}
                </p>

                <h4>{t("skeletal.weapon.grips")}</h4>
                <div className="weapon-step-tabs">
                  {gripTargets.map((target) => {
                    const disabled = target === "secondaryGrip" && weapon.holdMode !== "two_hand" && !weapon.secondaryGrip;
                    return (
                      <button
                        key={target}
                        type="button"
                        className={`px-btn ${selectedGrip === target ? "accent" : ""}`}
                        disabled={disabled && target === "secondaryGrip" && weapon.holdMode !== "two_hand"}
                        onClick={() => {
                          if (target === "secondaryGrip" && !weapon.secondaryGrip) {
                            dispatch({ type: "patchWeapon", patch: { secondaryGrip: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } } });
                          }
                          if ((target === "muzzleSocket" || target === "ejectSocket") && !weapon[target]) {
                            dispatch({ type: "patchWeapon", patch: { [target]: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } } });
                          }
                          dispatch({ type: "selectGripTarget", target });
                        }}
                      >
                        {t(`skeletal.weapon.grip.${target}`)}
                      </button>
                    );
                  })}
                </div>
                {selectedGripTransform && (
                  <div className="weapon-transform">
                    {(["x", "y", "z"] as const).map((axis, index) => (
                      <label key={axis}>
                        {axis.toUpperCase()}
                        <input
                          type="number"
                          step={0.1}
                          value={selectedGripTransform.translation[index]}
                          onChange={(event) => {
                            const next = [...selectedGripTransform.translation] as Transform["translation"];
                            next[index] = Number(event.target.value);
                            dispatch({ type: "patchGrip", target: selectedGrip, rest: { translation: next } });
                          }}
                        />
                      </label>
                    ))}
                    <label>
                      {t("skeletal.weapon.scale")}
                      <input
                        type="number"
                        step={0.05}
                        value={selectedGripTransform.scale[0]}
                        onChange={(event) => {
                          const s = Number(event.target.value);
                          dispatch({
                            type: "patchGrip",
                            target: selectedGrip,
                            rest: { scale: [s, s, selectedGripTransform.scale[2]] },
                          });
                        }}
                      />
                    </label>
                  </div>
                )}

                <h4>{t("skeletal.weapon.secondaryIk")}</h4>
                <div className="weapon-inline">
                  <button
                    type="button"
                    className="px-btn"
                    onClick={() => {
                      const constraint = createDefaultSecondaryHandConstraint(skeleton, activeBody, weapon.preferredPrimaryHand);
                      dispatch({ type: "setSecondaryHandConstraint", constraint });
                    }}
                  >
                    {t("skeletal.weapon.enableIk")}
                  </button>
                  <button
                    type="button"
                    className="px-btn"
                    disabled={!weapon.secondaryHandConstraint}
                    onClick={() => dispatch({ type: "setSecondaryHandConstraint", constraint: null })}
                  >
                    {t("skeletal.weapon.disableIk")}
                  </button>
                </div>
                {weapon.secondaryHandConstraint && (
                  <div className="weapon-fields">
                    <label>
                      {t("skeletal.weapon.ik.upper")}
                      <PxSelect
                        value={weapon.secondaryHandConstraint.upperBoneId}
                        options={boneOptions}
                        onChange={(value) => dispatch({ type: "patchSecondaryHandConstraint", patch: { upperBoneId: value } })}
                      />
                    </label>
                    <label>
                      {t("skeletal.weapon.ik.lower")}
                      <PxSelect
                        value={weapon.secondaryHandConstraint.lowerBoneId}
                        options={boneOptions}
                        onChange={(value) => dispatch({ type: "patchSecondaryHandConstraint", patch: { lowerBoneId: value } })}
                      />
                    </label>
                    <label>
                      {t("skeletal.weapon.ik.end")}
                      <PxSelect
                        value={weapon.secondaryHandConstraint.endBoneId}
                        options={boneOptions}
                        onChange={(value) => dispatch({ type: "patchSecondaryHandConstraint", patch: { endBoneId: value } })}
                      />
                    </label>
                    <label>
                      {t("skeletal.weapon.ik.target")}
                      <PxSelect
                        value={weapon.secondaryHandConstraint.targetSocket}
                        options={socketOptions}
                        onChange={(value) => dispatch({ type: "patchSecondaryHandConstraint", patch: { targetSocket: value } })}
                      />
                    </label>
                    <label>
                      {t("skeletal.weapon.ik.bend")}
                      <PxSelect
                        value={weapon.secondaryHandConstraint.bendDirection}
                        options={[
                          { value: "positive", label: t("skeletal.weapon.ik.bend.positive") },
                          { value: "negative", label: t("skeletal.weapon.ik.bend.negative") },
                        ]}
                        onChange={(value) => dispatch({
                          type: "patchSecondaryHandConstraint",
                          patch: { bendDirection: value as "positive" | "negative" },
                        })}
                      />
                    </label>
                    <label>
                      {t("skeletal.weapon.ik.stretch")}
                      <PxSelect
                        value={weapon.secondaryHandConstraint.stretch}
                        options={[
                          { value: "forbid", label: t("skeletal.weapon.ik.stretch.forbid") },
                          { value: "limited", label: t("skeletal.weapon.ik.stretch.limited") },
                        ]}
                        onChange={(value) => dispatch({
                          type: "patchSecondaryHandConstraint",
                          patch: {
                            stretch: value as "forbid" | "limited",
                            maxStretch: value === "limited" ? (weapon.secondaryHandConstraint?.maxStretch ?? 1.2) : undefined,
                          },
                        })}
                      />
                    </label>
                    <label>
                      {t("skeletal.weapon.ik.mix")}
                      <input
                        type="number"
                        min={0}
                        max={1}
                        step={0.05}
                        value={weapon.secondaryHandConstraint.mix}
                        onChange={(event) => dispatch({
                          type: "patchSecondaryHandConstraint",
                          patch: { mix: Number(event.target.value) },
                        })}
                      />
                    </label>
                    {weapon.secondaryHandConstraint.stretch === "limited" && (
                      <label>
                        {t("skeletal.weapon.ik.maxStretch")}
                        <input
                          type="number"
                          min={1}
                          step={0.05}
                          value={weapon.secondaryHandConstraint.maxStretch ?? 1}
                          onChange={(event) => dispatch({
                            type: "patchSecondaryHandConstraint",
                            patch: { maxStretch: Number(event.target.value) },
                          })}
                        />
                      </label>
                    )}
                  </div>
                )}

                {issues.length > 0 && (
                  <ul className="weapon-diagnostics">
                    {issues.map((issue, index) => (
                      <li key={`${issue.path}-${index}`}><code>{issue.path}</code> {issue.message}</li>
                    ))}
                  </ul>
                )}
                {issues.length === 0 && <p className="weapon-hint">{t("skeletal.weapon.diagnosticsOk")}</p>}
              </div>
            </section>
          )}

          {state.pane === "preview" && (
            <section className="weapon-section">
              <header><h3>{t("skeletal.weapon.preview")}</h3></header>
              <label>
                {t("skeletal.weapon.bodyProfile")}
                <PxSelect
                  value={state.selectedBodyProfileId}
                  options={bodyProfiles.map((item) => ({ value: item.id, label: item.name }))}
                  onChange={(value) => dispatch({ type: "selectBodyProfile", bodyProfileId: value })}
                  placeholder={t("skeletal.weapon.chooseBody")}
                />
              </label>
              <div className="weapon-item-list">
                {state.library.map((item) => {
                  const equipped = state.previewLoadout.equipment.some((entry) => entry.equipmentId === item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={equipped ? "on" : ""}
                      onClick={() => dispatch({
                        type: equipped ? "unequip" : "tryEquip",
                        equipmentId: item.id,
                      })}
                    >
                      <strong>{item.name}</strong>
                      <span>{equipped ? t("skeletal.weapon.equipped") : t("skeletal.weapon.unequipped")}</span>
                    </button>
                  );
                })}
              </div>
              <div className="weapon-inline">
                <button type="button" className="px-btn" onClick={() => dispatch({ type: "clearPreview" })}>{t("skeletal.weapon.clearPreview")}</button>
              </div>
              <p className="weapon-hint">{t("skeletal.weapon.compatibilityHint")}</p>
              {state.conflictIssues.length === 0
                ? <p className="weapon-hint">{t("skeletal.weapon.diagnosticsOk")}</p>
                : (
                  <ul className="weapon-diagnostics">
                    {state.conflictIssues.map((issue, index) => (
                      <li key={`${issue.path}-${index}`}><code>{issue.path}</code> {issue.message}</li>
                    ))}
                  </ul>
                )}
            </section>
          )}
        </aside>
      </div>
    </section>
  );
}
