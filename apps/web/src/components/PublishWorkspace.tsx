import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type CharacterBinding,
  type CharacterLoadout,
  type FbanimEntry,
  type MotionClip,
  type Skeleton,
} from "@framebaker/shared";
import { Download, Package, RefreshCw } from "lucide-react";
import type { SkeletalProjectDocument } from "../api";
import { useT } from "../i18n";
import { askConfirm, notify } from "../notice";
import {
  PUBLISH_STAGE_ORDER,
  collectPublishDiagnostics,
  type PublishDiagnostic,
  type PublishReport,
  type PublishStage,
} from "../publishDiagnostics";
import {
  downloadFbanimV3Package,
  downloadFixtureZip,
  loadProjectTextures,
} from "../skeletalExport";
import { CharacterPreview } from "./AnimationAssetsWorkspace";

export interface PublishWorkspaceProps {
  projectName: string;
  document: SkeletalProjectDocument;
  skeleton?: Skeleton;
  binding?: CharacterBinding;
  clips: Record<string, MotionClip>;
  clip?: MotionClip;
  busy?: boolean;
  onBusy?: (busy: boolean) => void;
}

const STAGE_I18N: Record<PublishStage, string> = {
  schema: "skeletal.publish.stage.schema",
  referenceClosure: "skeletal.publish.stage.referenceClosure",
  loadoutConflict: "skeletal.publish.stage.loadoutConflict",
  actionTemplate: "skeletal.publish.stage.actionTemplate",
  fullDurationIk: "skeletal.publish.stage.fullDurationIk",
  socketEvent: "skeletal.publish.stage.socketEvent",
  mirror: "skeletal.publish.stage.mirror",
  runtimeCapability: "skeletal.publish.stage.runtimeCapability",
  packageConstruction: "skeletal.publish.stage.packageConstruction",
  fbanimExport: "skeletal.publish.stage.fbanimExport",
};

function terminalPreviewStyle(width: number, height: number): Record<string, string | number> {
  return {
    width,
    height,
    imageRendering: "pixelated",
    overflow: "hidden",
    border: "1px solid var(--border)",
    background: "var(--bg)",
  };
}

export default function PublishWorkspace({
  projectName,
  document,
  skeleton,
  binding,
  clips,
  clip,
  busy = false,
  onBusy,
}: PublishWorkspaceProps) {
  const t = useT();
  const [report, setReport] = useState<PublishReport | null>(null);
  const [previousEntries, setPreviousEntries] = useState<FbanimEntry[] | undefined>();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [previewTime, setPreviewTime] = useState(0);

  const runDiagnostics = useCallback(async () => {
    if (!skeleton || !document.character) {
      setReport(null);
      return;
    }
    setRunning(true);
    onBusy?.(true);
    try {
      const textures = await loadProjectTextures(document);
      const next = await collectPublishDiagnostics({
        document,
        skeleton,
        clips,
        textures,
        previousEntries,
      });
      setReport(next);
      if (next.entries) setPreviousEntries(next.entries);
    } catch (e) {
      notify(t("skeletal.publish.validateFailed", { msg: (e as Error).message }));
    } finally {
      setRunning(false);
      onBusy?.(false);
    }
  }, [clips, document, onBusy, previousEntries, skeleton, t]);

  useEffect(() => {
    void runDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial + document identity
  }, [document.projectId, skeleton?.id, document.animations.length, document.equipment?.length, document.bodyProfiles?.length]);

  const stageGroups = useMemo(() => {
    const groups = Object.fromEntries(PUBLISH_STAGE_ORDER.map((s) => [s, [] as PublishDiagnostic[]])) as Record<
      PublishStage,
      PublishDiagnostic[]
    >;
    for (const d of report?.diagnostics ?? []) groups[d.stage].push(d);
    return groups;
  }, [report]);

  const exportPackage = async () => {
    if (!report) return;
    if (!report.canExport || !report.entries) {
      notify(t("skeletal.publish.exportBlocked"));
      return;
    }
    if (report.requiresConfirm && !(await askConfirm(t("skeletal.publish.warningsConfirm", { count: String(report.warnings.length) })))) {
      return;
    }
    onBusy?.(true);
    try {
      await downloadFbanimV3Package(projectName, report.entries);
      notify(t("skeletal.publish.exportDone"), "info");
    } catch (e) {
      notify(t("skeletal.publish.exportFailed", { msg: (e as Error).message }));
    } finally {
      onBusy?.(false);
    }
  };

  const exportFixture = async () => {
    if (!report?.canExport || !report.entries) {
      notify(t("skeletal.publish.exportBlocked"));
      return;
    }
    if (report.requiresConfirm && !(await askConfirm(t("skeletal.publish.warningsConfirm", { count: String(report.warnings.length) })))) {
      return;
    }
    onBusy?.(true);
    try {
      const loadout: CharacterLoadout = document.loadouts?.[0] ?? {
        bodyProfileId: document.bodyProfiles?.[0]?.id ?? "body",
        equipment: [],
      };
      await downloadFixtureZip(`${projectName}-minimal-region`, {
        fixtureId: "minimal-region",
        packageEntries: report.entries,
        loadout,
        actionSteps: (document.animations[0]
          ? [
              { actionId: document.animations[0].id, time: 0 },
              { actionId: document.animations[0].id, time: Math.min(0.5, clip?.duration ?? 0.5) },
            ]
          : []),
        expected: { matrices: [], events: [], slots: [] },
        metadata: { schemaVersion: 1, generatedBy: "FrameBaker", projectId: document.projectId },
      });
      notify(t("skeletal.publish.fixtureDone"), "info");
    } catch (e) {
      notify(t("skeletal.publish.fixtureFailed", { msg: (e as Error).message }));
    } finally {
      onBusy?.(false);
    }
  };

  if (!binding || !skeleton) {
    return (
      <div className="skeletal-empty-state">
        <Package size={38} />
        <h2>{t("skeletal.publish.needCharacterTitle")}</h2>
        <p>{t("skeletal.publish.needCharacter")}</p>
      </div>
    );
  }

  const summary = report?.summary;
  const reqs = summary?.requirements ?? {};

  return (
    <main className="skeletal-publish-workspace">
      <section className="pixel-panel skeletal-publish-panel">
        <header className="skeletal-publish-header">
          <div>
            <h2>{t("skeletal.publish.title")}</h2>
            <p>{t("skeletal.publish.hint")}</p>
          </div>
          <div className="skeletal-publish-toolbar">
            <button type="button" className="px-btn" disabled={busy || running} onClick={() => void runDiagnostics()}>
              <RefreshCw size={14} /> {t("skeletal.publish.revalidate")}
            </button>
            <button type="button" className="px-btn accent" disabled={busy || running || !report?.canExport} onClick={() => void exportPackage()}>
              <Download size={14} /> {t("skeletal.publish.exportV3")}
            </button>
            <button type="button" className="px-btn" disabled={busy || running || !report?.canExport} onClick={() => void exportFixture()}>
              <Package size={14} /> {t("skeletal.publish.exportFixture")}
            </button>
          </div>
        </header>

        <div className="skeletal-publish-status">
          {report ? (
            report.canExport
              ? <p className="skeletal-clean">{report.requiresConfirm ? t("skeletal.publish.status.warningsOk") : t("skeletal.publish.status.ok")}</p>
              : <p className="skeletal-dirty">{t("skeletal.publish.status.blocked", { count: String(report.errors.length) })}</p>
          ) : <p className="skeletal-clean">{t("skeletal.publish.status.pending")}</p>}
        </div>

        <div className="skeletal-publish-grid">
          <section className="skeletal-publish-section">
            <h3>{t("skeletal.publish.contents")}</h3>
            <ul className="skeletal-publish-list">
              <li>{t("skeletal.publish.bodyProfiles")}: {(summary?.bodyProfiles ?? []).join(", ") || "—"}</li>
              <li>{t("skeletal.publish.equipment")}: {(summary?.equipment ?? []).join(", ") || "—"}</li>
              <li>{t("skeletal.publish.actions")}: {(summary?.actions ?? []).join(", ") || "—"}</li>
              <li>{t("skeletal.publish.actionProfiles")}: {(summary?.actionProfiles ?? []).join(", ") || "—"}</li>
              <li>{t("skeletal.publish.textures")}: {(summary?.textures ?? []).join(", ") || "—"}</li>
              <li>{t("skeletal.publish.constraints")}: {(summary?.constraints ?? []).join(", ") || "—"}</li>
              <li>{t("skeletal.publish.loadouts")}: {summary?.loadouts ?? 0}</li>
            </ul>
          </section>

          <section className="skeletal-publish-section">
            <h3>{t("skeletal.publish.capabilities")}</h3>
            <ul className="skeletal-publish-list">
              {Object.keys(reqs).length === 0
                ? <li>{t("skeletal.publish.noRequirements")}</li>
                : Object.entries(reqs).map(([key, version]) => (
                  <li key={key}><code>{key}</code> ≥ {version}</li>
                ))}
            </ul>
          </section>

          <section className="skeletal-publish-section">
            <h3>{t("skeletal.publish.versionDiff")}</h3>
            {report?.versionDiff ? (
              <ul className="skeletal-publish-list">
                <li>{t("skeletal.publish.diff.added")}: {report.versionDiff.added.join(", ") || "—"}</li>
                <li>{t("skeletal.publish.diff.removed")}: {report.versionDiff.removed.join(", ") || "—"}</li>
                <li>{t("skeletal.publish.diff.changed")}: {report.versionDiff.changed.join(", ") || "—"}</li>
              </ul>
            ) : <p className="equipment-hint">{t("skeletal.publish.diff.none")}</p>}
          </section>

          <section className="skeletal-publish-section skeletal-publish-preview">
            <h3>{t("skeletal.publish.preview320")}</h3>
            <div className="skeletal-publish-terminal" style={terminalPreviewStyle(320, 180)}>
              <CharacterPreview binding={binding} skeleton={skeleton} clip={clip} time={previewTime} />
            </div>
            <label className="skeletal-publish-time">
              {t("skeletal.publish.previewTime")}
              <input
                type="range"
                min={0}
                max={clip?.duration ?? 1}
                step={0.001}
                value={previewTime}
                onChange={(e) => setPreviewTime(+e.target.value)}
              />
              <span>{previewTime.toFixed(2)}s</span>
            </label>
          </section>
        </div>

        <section className="skeletal-publish-section">
          <h3>{t("skeletal.publish.diagnostics")}</h3>
          <div className="skeletal-publish-stages">
            {PUBLISH_STAGE_ORDER.map((stage, index) => {
              const items = stageGroups[stage];
              const hasError = items.some((d) => d.severity === "error");
              const hasWarn = items.some((d) => d.severity === "warning");
              return (
                <div key={stage} className={`skeletal-publish-stage ${hasError ? "error" : hasWarn ? "warn" : "ok"}`}>
                  <header>
                    <strong>{index + 1}. {t(STAGE_I18N[stage])}</strong>
                    <span>{items.length ? items.length : t("skeletal.publish.stageOk")}</span>
                  </header>
                  {items.length > 0 && (
                    <ul className="skeletal-publish-diag">
                      {items.map((d, i) => (
                        <li key={`${d.code}-${d.path}-${i}`}>
                          <button
                            type="button"
                            className={selectedPath === d.path ? "on" : ""}
                            onClick={() => setSelectedPath(d.path)}
                          >
                            <span className={`sev ${d.severity}`}>{d.severity === "error" ? t("skeletal.publish.error") : t("skeletal.publish.warning")}</span>
                            <code>{d.code}</code>
                            <code className="path">{d.path}</code>
                            <span>{d.message}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
          {selectedPath && <p className="equipment-hint">{t("skeletal.publish.selectedPath")}: <code>{selectedPath}</code></p>}
        </section>
      </section>
    </main>
  );
}
