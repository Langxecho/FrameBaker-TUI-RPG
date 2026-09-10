import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  MONSTER_ACTIONS,
  MONSTER_DEFAULT_DURATION_SECONDS,
  MONSTER_DEFAULT_EXTRACT_FPS,
  MONSTER_DEFAULT_HEIGHT,
  MONSTER_DEFAULT_VIDEO_PLUGIN_ID,
  MONSTER_DEFAULT_WIDTH,
  MONSTER_IMAGE_DEFAULT_BASE_URL,
  MONSTER_IMAGE_DEFAULT_MODEL,
  MONSTER_SIZE_MAX,
  MONSTER_SIZE_MIN,
  buildMonsterH3I2vaPrompt,
  clampMonsterPixel,
  normalizeMonsterImageBaseUrl,
  type Folder,
  type Job,
  type MediaPluginSummary,
  type Project,
  type ProviderTestResponse,
} from "@framebaker/shared";
import { api, materialImageUrl, wsClient } from "../api";
import { refreshServerConfig, useServerConfig } from "../config";
import { useT } from "../i18n";
import { notify } from "../notice";
import { parseMaterialIdsFromJobProgress } from "../mediaPluginUiState";
import MattingOption from "./MattingOption";
import MediaReferencePicker from "./MediaReferencePicker";
import MediaResultPreview, { type MediaGenerationResultItem } from "./MediaResultPreview";
import PxSelect from "./PxSelect";

interface Props {
  onOpenMaterials?: () => void;
}

const ACTION_LABEL: Record<(typeof MONSTER_ACTIONS)[number]["id"], "monster.action.idle" | "monster.action.attack" | "monster.action.special" | "monster.action.hurt" | "monster.action.death"> = {
  "monster-01-idle": "monster.action.idle",
  "monster-02-attack": "monster.action.attack",
  "monster-03-special": "monster.action.special",
  "monster-04-hurt": "monster.action.hurt",
  "monster-05-death": "monster.action.death",
};

export default function MonsterPipelinePage({ onOpenMaterials }: Props) {
  const t = useT();
  const cfg = useServerConfig();
  const [appearance, setAppearance] = useState("");
  const [name, setName] = useState("");
  const [actionPrompts, setActionPrompts] = useState<Record<string, string>>({});
  const [videoPrompts, setVideoPrompts] = useState<Record<string, string>>({});
  const [imageBaseUrl, setImageBaseUrl] = useState(MONSTER_IMAGE_DEFAULT_BASE_URL);
  const [imageApiKey, setImageApiKey] = useState("");
  const [imageModel, setImageModel] = useState(MONSTER_IMAGE_DEFAULT_MODEL);
  const [imageSaving, setImageSaving] = useState(false);
  const [imageTest, setImageTest] = useState<ProviderTestResponse | null>(null);
  const [imageTesting, setImageTesting] = useState(false);
  const [width, setWidth] = useState(MONSTER_DEFAULT_WIDTH);
  const [height, setHeight] = useState(MONSTER_DEFAULT_HEIGHT);
  const [videoPlugins, setVideoPlugins] = useState<MediaPluginSummary[]>([]);
  const [videoPluginId, setVideoPluginId] = useState(MONSTER_DEFAULT_VIDEO_PLUGIN_ID);
  const [durationSeconds, setDurationSeconds] = useState(MONSTER_DEFAULT_DURATION_SECONDS);
  const [fps4, setFps4] = useState(true);
  const [fps24, setFps24] = useState(false);
  const [extraFps, setExtraFps] = useState("");
  const [autoMatting, setAutoMatting] = useState(true);
  const [bgKey, setBgKey] = useState<"flood" | "none">("flood");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [importProjectId, setImportProjectId] = useState("");
  const [referenceMaterialId, setReferenceMaterialId] = useState("");
  const [refJobIds, setRefJobIds] = useState<string[]>([]);
  const [refSubmitting, setRefSubmitting] = useState(false);
  const [pipelineSubmitting, setPipelineSubmitting] = useState(false);
  const [pipelineId, setPipelineId] = useState("");
  const [trackedJobIds, setTrackedJobIds] = useState<string[]>([]);
  const [jobMap, setJobMap] = useState<Record<string, Job>>({});
  const [results, setResults] = useState<MediaGenerationResultItem[]>([]);
  const [cacheKey, setCacheKey] = useState(() => Date.now());

  const imageReady = Boolean(imageApiKey.trim() && normalizeMonsterImageBaseUrl(imageBaseUrl)) || Boolean(cfg?.monsterImage?.configured);
  const tujiangWarn = /tujiang/i.test(imageBaseUrl);

  useEffect(() => {
    api.listFolders("material").then(setFolders).catch(() => setFolders([]));
    api
      .listProjects()
      .then((list) => setProjects(list.filter((p) => p.kind === "frame")))
      .catch(() => setProjects([]));
    api
      .listMediaPlugins("video_api")
      .then((list) => {
        setVideoPlugins(list);
        setVideoPluginId((prev) => (prev && list.some((p) => p.id === prev) ? prev : list[0]?.id ?? ""));
      })
      .catch(() => setVideoPlugins([]));
    api
      .getSettings()
      .then((settings) => {
        const raw = settings.monsterImage;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
        const saved = raw as { apiBaseUrl?: unknown; apiKey?: unknown; model?: unknown };
        const base = normalizeMonsterImageBaseUrl(String(saved.apiBaseUrl ?? ""));
        if (base) setImageBaseUrl(base);
        if (typeof saved.apiKey === "string" && saved.apiKey.trim()) setImageApiKey(saved.apiKey);
        if (typeof saved.model === "string" && saved.model.trim()) setImageModel(saved.model.trim());
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!trackedJobIds.length && !pipelineId && !refJobIds.length) return;
    const unsub = wsClient.subscribe((msg) => {
      if (!msg.type.startsWith("job_")) return;
      const p = (msg.payload ?? {}) as Record<string, unknown>;
      const id = p.id as string | undefined;
      const jobPipeline = typeof p.pipelineId === "string" ? p.pipelineId : "";
      if (jobPipeline && pipelineId && jobPipeline === pipelineId && id && !trackedJobIds.includes(id)) {
        setTrackedJobIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      }
      if (!id || (!trackedJobIds.includes(id) && jobPipeline !== pipelineId && !refJobIds.includes(id))) return;
      if (msg.type === "job_done") {
        const payloadIds = Array.isArray(p.materialIds)
          ? p.materialIds.filter((x): x is string => typeof x === "string" && x.trim() !== "")
          : [];
        if (refJobIds.includes(id) && payloadIds[0]) setReferenceMaterialId(payloadIds[0]!);
        setResults((prev) => {
          let next = prev;
          for (const materialId of payloadIds) {
            if (next.some((r) => r.materialId === materialId && r.jobId === id)) continue;
            if (next === prev) next = [...prev];
            next.push({ materialId, mediaKind: String(p.type).includes("video") ? "video" : "image", jobId: id });
          }
          return next;
        });
        setCacheKey(Date.now());
      }
      api
        .getJob(id)
        .then((job) => {
          setJobMap((prev) => ({ ...prev, [id]: job }));
          const ids = parseMaterialIdsFromJobProgress(job.progress);
          if (job.status === "done" && ids.length) {
            if (refJobIds.includes(job.id) && ids[0]) setReferenceMaterialId(ids[0]!);
            setResults((prev) => {
              let next = prev;
              for (const materialId of ids) {
                if (next.some((r) => r.materialId === materialId && r.jobId === job.id)) continue;
                if (next === prev) next = [...prev];
                next.push({
                  materialId,
                  mediaKind: job.type === "media_plugin_video" ? "video" : "image",
                  jobId: job.id,
                });
              }
              return next;
            });
            setCacheKey(Date.now());
          }
        })
        .catch(() => {});
    });
    return () => unsub();
  }, [trackedJobIds, pipelineId, refJobIds]);

  const extractFps = useMemo(() => {
    const values: number[] = [];
    if (fps4) values.push(4);
    if (fps24) values.push(24);
    const extra = Number(extraFps);
    if (Number.isFinite(extra) && extra >= 1) values.push(Math.round(extra));
    return values.length ? [...new Set(values)] : [...MONSTER_DEFAULT_EXTRACT_FPS];
  }, [extraFps, fps24, fps4]);

  const trackedJobs = trackedJobIds.map((id) => jobMap[id]).filter(Boolean) as Job[];
  const filledCount = MONSTER_ACTIONS.filter(
    (a) => (actionPrompts[a.id] ?? "").trim() || (videoPrompts[a.id] ?? "").trim(),
  ).length;

  const persistImageSettings = async () => {
    await api.putSetting("monsterImage", {
      apiBaseUrl: normalizeMonsterImageBaseUrl(imageBaseUrl) || MONSTER_IMAGE_DEFAULT_BASE_URL,
      apiKey: imageApiKey.trim(),
      model: imageModel.trim() || MONSTER_IMAGE_DEFAULT_MODEL,
    });
    await refreshServerConfig();
  };

  const submitReference = async () => {
    if (!appearance.trim()) {
      notify(t("monster.form.appearanceRequired"));
      return;
    }
    if (!imageReady) {
      notify(t("monster.form.providerRequired"));
      return;
    }
    setRefSubmitting(true);
    try {
      await persistImageSettings();
      const w = clampMonsterPixel(width, MONSTER_DEFAULT_WIDTH);
      const h = clampMonsterPixel(height, MONSTER_DEFAULT_HEIGHT);
      const created = await api.startMonsterReference({
        appearance: appearance.trim(),
        name: name.trim() || undefined,
        width: w,
        height: h,
        autoMatting,
        folderId: folderId || null,
      });
      setRefJobIds((prev) => (prev.includes(created.jobId) ? prev : [...prev, created.jobId]));
      setTrackedJobIds((prev) => (prev.includes(created.jobId) ? prev : [...prev, created.jobId]));
      notify(t("monster.referenceQueued"), "info");
    } catch (e) {
      notify(t("monster.submitFailed", { msg: (e as Error).message }));
    } finally {
      setRefSubmitting(false);
    }
  };

  const submitPipeline = async () => {
    if (!referenceMaterialId) {
      notify(t("monster.form.referenceRequired"));
      return;
    }
    if (!imageReady) {
      notify(t("monster.form.providerRequired"));
      return;
    }
    if (!filledCount) {
      notify(t("monster.form.actionsRequired"));
      return;
    }
    setPipelineSubmitting(true);
    try {
      await persistImageSettings();
      const actions: Record<string, string> = {};
      const videos: Record<string, string> = {};
      for (const action of MONSTER_ACTIONS) {
        const prompt = (actionPrompts[action.id] ?? "").trim();
        const videoPrompt = (videoPrompts[action.id] ?? "").trim();
        if (prompt) actions[action.id] = prompt;
        if (videoPrompt) videos[action.id] = videoPrompt;
      }
      const w = clampMonsterPixel(width, MONSTER_DEFAULT_WIDTH);
      const h = clampMonsterPixel(height, MONSTER_DEFAULT_HEIGHT);
      const created = await api.startMonsterPipeline({
        appearance: appearance.trim() || undefined,
        name: name.trim() || undefined,
        referenceMaterialId,
        actions,
        videoPrompts: videos,
        width: w,
        height: h,
        videoPluginId: videoPluginId || null,
        durationSeconds,
        extractFps,
        autoMatting,
        bgKey,
        folderId: folderId || null,
        importProjectId: importProjectId || null,
      });
      setPipelineId(created.pipelineId);
      setTrackedJobIds((prev) => (prev.includes(created.jobId) ? prev : [...prev, created.jobId]));
      notify(t("monster.queued"), "info");
    } catch (e) {
      notify(t("monster.submitFailed", { msg: (e as Error).message }));
    } finally {
      setPipelineSubmitting(false);
    }
  };

  return (
    <div className="media-generate-layout">
      <section className="media-generate-form card-panel">
        <p className="hint">{t("monster.form.hint")}</p>
        <div className="section-title">{t("monster.form.imageSection")}</div>
        <p className="hint">{t("monster.form.imageHint")}</p>
        <span className={`engine-status ${imageReady ? "ok" : "bad"}`}>
          <span className="dot" />
          {imageReady
            ? t("monster.form.imageReady", { model: imageModel.trim() || cfg?.monsterImage?.model || MONSTER_IMAGE_DEFAULT_MODEL })
            : t("monster.form.imageNotReady")}
        </span>
        {cfg?.monsterImage?.usingPluginFallback && !imageApiKey.trim() ? (
          <p className="hint">{t("monster.form.imagePluginFallback")}</p>
        ) : null}
        {tujiangWarn ? <p className="hint">{t("monster.form.imageTujiangWarn")}</p> : null}
        <label className="field">
          <span>{t("monster.form.imageBaseUrl")}</span>
          <input
            className="px-input"
            value={imageBaseUrl}
            onChange={(e) => setImageBaseUrl(e.target.value)}
            placeholder={MONSTER_IMAGE_DEFAULT_BASE_URL}
          />
        </label>
        <label className="field">
          <span>{t("monster.form.imageApiKey")}</span>
          <input
            className="px-input"
            type="password"
            autoComplete="off"
            value={imageApiKey}
            onChange={(e) => setImageApiKey(e.target.value)}
            placeholder="sk-…"
          />
        </label>
        <label className="field">
          <span>{t("monster.form.imageModel")}</span>
          <input className="px-input" value={imageModel} onChange={(e) => setImageModel(e.target.value)} placeholder={MONSTER_IMAGE_DEFAULT_MODEL} />
        </label>
        <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
          <button
            type="button"
            className="px-btn"
            disabled={imageSaving}
            onClick={() => {
              setImageSaving(true);
              persistImageSettings()
                .then(() => notify(t("monster.form.imageSaved"), "info"))
                .catch((e) => notify(t("msg.save_failed_msg", { msg: (e as Error).message })))
                .finally(() => setImageSaving(false));
            }}
          >
            {imageSaving ? t("msg.processing") : t("monster.form.imageSave")}
          </button>
          <button
            type="button"
            className="px-btn"
            disabled={imageTesting}
            onClick={() => {
              const key = imageApiKey.trim();
              if (!key) {
                notify(t("monster.form.providerRequired"));
                return;
              }
              setImageTesting(true);
              setImageTest(null);
              api
                .testProvider({
                  type: "api",
                  apiBaseUrl: normalizeMonsterImageBaseUrl(imageBaseUrl) || MONSTER_IMAGE_DEFAULT_BASE_URL,
                  apiKey: key,
                  apiModel: imageModel.trim() || MONSTER_IMAGE_DEFAULT_MODEL,
                })
                .then(setImageTest)
                .catch((e) => setImageTest({ ok: false, error: (e as Error).message }))
                .finally(() => setImageTesting(false));
            }}
          >
            {imageTesting ? t("msg.processing") : t("msg.test_connection")}
          </button>
        </div>
        {imageTest ? <p className="hint">{imageTest.ok ? t("monster.form.imageTestOk") : imageTest.error || t("msg.fetch_failed")}</p> : null}
        <div className="section-title">{t("monster.form.referenceSection")}</div>
        <p className="hint">{t("monster.form.referenceHint")}</p>
        <label className="field">
          <span>{t("monster.form.appearance")}</span>
          <textarea className="px-input" rows={4} value={appearance} onChange={(e) => setAppearance(e.target.value)} placeholder={t("monster.form.appearancePlaceholder")} />
        </label>
        <label className="field">
          <span>{t("monster.form.name")}</span>
          <input className="px-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="form-row">
          <label className="field">
            <span>{t("monster.form.width")}</span>
            <input
              className="px-input"
              type="number"
              min={MONSTER_SIZE_MIN}
              max={MONSTER_SIZE_MAX}
              step={1}
              value={width}
              onChange={(e) => setWidth(clampMonsterPixel(e.target.value, MONSTER_DEFAULT_WIDTH))}
            />
          </label>
          <label className="field">
            <span>{t("monster.form.height")}</span>
            <input
              className="px-input"
              type="number"
              min={MONSTER_SIZE_MIN}
              max={MONSTER_SIZE_MAX}
              step={1}
              value={height}
              onChange={(e) => setHeight(clampMonsterPixel(e.target.value, MONSTER_DEFAULT_HEIGHT))}
            />
          </label>
        </div>
        <p className="hint">{t("monster.form.sizeHint")}</p>
        <MattingOption checked={autoMatting} onChange={setAutoMatting} />
        <label className="field">
          <span>{t("mediaPlugin.form.folder")}</span>
          <select className="px-input" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">{t("mediaPlugin.form.folderUngrouped")}</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </label>
        <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
          <button type="button" className="px-btn" disabled={refSubmitting || !imageReady} onClick={() => void submitReference()}>
            <Sparkles size={14} /> {refSubmitting ? t("msg.processing") : t("monster.form.generateReference")}
          </button>
        </div>
        <MediaReferencePicker
          kind="image_api"
          constraints={{ max_reference_images: 1 }}
          value={referenceMaterialId ? [referenceMaterialId] : []}
          onChange={(ids) => setReferenceMaterialId(ids[0] ?? "")}
        />
        {referenceMaterialId ? (
          <div className="field">
            <span>{t("monster.form.selectedReference")}</span>
            <div className="ref-selected-list">
              <div className="ref-selected">
                <img src={materialImageUrl(referenceMaterialId, cacheKey, "processed", 256)} alt="" />
              </div>
            </div>
          </div>
        ) : (
          <p className="hint">{t("monster.form.referenceRequiredHint")}</p>
        )}
        <div className="section-title">{t("monster.form.pipelineSection")}</div>
        <p className="hint">{t("monster.form.pipelineHint")}</p>
        <div className="section-title">{t("monster.form.actions")}</div>
        <p className="hint">{t("monster.form.actionsHint")}</p>
        {MONSTER_ACTIONS.map((action) => (
          <div className="field" key={action.id}>
            <span>{t(ACTION_LABEL[action.id])}</span>
            <textarea
              className="px-input"
              rows={2}
              value={actionPrompts[action.id] ?? ""}
              onChange={(e) => setActionPrompts((prev) => ({ ...prev, [action.id]: e.target.value }))}
              placeholder={t("monster.form.actionPlaceholder")}
            />
            <span>{t("monster.form.videoPrompt")}</span>
            <textarea
              className="px-input"
              rows={4}
              value={videoPrompts[action.id] ?? ""}
              onChange={(e) => setVideoPrompts((prev) => ({ ...prev, [action.id]: e.target.value }))}
              placeholder={t("monster.form.videoPromptPlaceholder")}
            />
            <button
              type="button"
              className="px-btn"
              onClick={() =>
                setVideoPrompts((prev) => ({
                  ...prev,
                  [action.id]: buildMonsterH3I2vaPrompt({
                    actionId: action.id,
                    actionPrompt: (actionPrompts[action.id] ?? "").trim() || undefined,
                    durationSeconds,
                  }),
                }))
              }
            >
              {t("monster.form.fillVideoPrompt")}
            </button>
          </div>
        ))}
        <label className="field">
          <span>{t("monster.form.videoPlugin")}</span>
          <PxSelect
            value={videoPluginId}
            onChange={setVideoPluginId}
            options={[{ value: "", label: t("monster.form.skipVideo") }, ...videoPlugins.map((p) => ({ value: p.id, label: p.runnable ? p.name : `${p.name} (${t("monster.form.pluginNotReady")})` }))]}
          />
        </label>
        <label className="field">
          <span>{t("monster.form.duration")}</span>
          <input className="px-input" type="number" min={4} max={15} step={0.1} value={durationSeconds} onChange={(e) => setDurationSeconds(Math.max(4, Math.min(15, Number(e.target.value) || MONSTER_DEFAULT_DURATION_SECONDS)))} />
        </label>
        <div className="form-row">
          <label className="px-check">
            <input type="checkbox" checked={fps4} onChange={(e) => setFps4(e.target.checked)} />
            4 fps
          </label>
          <label className="px-check">
            <input type="checkbox" checked={fps24} onChange={(e) => setFps24(e.target.checked)} />
            24 fps
          </label>
          <label className="field">
            <span>{t("monster.form.extraFps")}</span>
            <input className="px-input" value={extraFps} onChange={(e) => setExtraFps(e.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>{t("monster.form.bgKey")}</span>
          <PxSelect
            value={bgKey}
            onChange={(v) => setBgKey(v === "none" ? "none" : "flood")}
            options={[
              { value: "flood", label: t("monster.form.bgKeyFlood") },
              { value: "none", label: t("monster.form.bgKeyNone") },
            ]}
          />
        </label>
        <label className="field">
          <span>{t("monster.form.importProject")}</span>
          <select className="px-input" value={importProjectId} onChange={(e) => setImportProjectId(e.target.value)}>
            <option value="">{t("monster.form.materialsOnly")}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <p className="hint">{t("monster.form.packHint")}</p>
        <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
          <button type="button" className="px-btn accent" disabled={pipelineSubmitting || !imageReady || !referenceMaterialId} onClick={() => void submitPipeline()}>
            <Sparkles size={14} /> {pipelineSubmitting ? t("msg.processing") : t("monster.form.submit", { n: String(filledCount) })}
          </button>
        </div>
      </section>
      <section className="media-generate-side card-panel">
        <div className="section-title">{t("mediaPlugin.jobs.title")}</div>
        {trackedJobs.length === 0 ? (
          <div className="hint">{t("monster.jobs.empty")}</div>
        ) : (
          <ul className="media-job-list">
            {trackedJobs.map((job) => (
              <li key={job.id} className={`media-job-item ${job.status}`}>
                <span>{job.id.slice(0, 8)}</span>
                <span>
                  {job.status === "done"
                    ? t("msg.done")
                    : job.status === "error"
                      ? t("msg.failed")
                      : job.status === "cancelled"
                        ? t("msg.cancelled")
                        : job.progress ?? t("msg.processing")}
                </span>
              </li>
            ))}
          </ul>
        )}
        <MediaResultPreview results={results} cacheKey={cacheKey} onOpenMaterials={onOpenMaterials} />
      </section>
    </div>
  );
}
