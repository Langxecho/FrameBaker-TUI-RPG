import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import type { Folder, Job, MediaPluginDetail, MediaPluginSummary, Project } from "@framebaker/shared";
import { api, wsClient } from "../api";
import { useT } from "../i18n";
import { notify } from "../notice";
import MediaPluginForm from "./MediaPluginForm";
import MediaReferencePicker from "./MediaReferencePicker";
import MediaResultPreview, { type MediaGenerationResultItem } from "./MediaResultPreview";
import {
  MEDIA_GENERATE_TABS,
  buildMediaGenerationRequest,
  canUseProjectTarget,
  coerceParamValuesForSubmit,
  createParamDefaults,
  folderPathLabel,
  mediaKindForPluginKind,
  parseMaterialIdsFromJobProgress,
  pluginKindForTab,
  validateGenerationForm,
  validateMediaPluginParams,
  type MediaGenerateTab,
} from "../mediaPluginUiState";

interface Props {
  onOpenMaterials?: () => void;
}

export default function MediaGenerationPage({ onOpenMaterials }: Props) {
  const t = useT();
  const [tab, setTab] = useState<MediaGenerateTab>("image");
  const kind = pluginKindForTab(tab);
  const [plugins, setPlugins] = useState<MediaPluginSummary[]>([]);
  const [pluginId, setPluginId] = useState("");
  const [detail, setDetail] = useState<MediaPluginDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [name, setName] = useState("");
  const [params, setParams] = useState<Record<string, unknown>>({});
  const [references, setReferences] = useState<string[]>([]);
  const [count, setCount] = useState(1);
  const [durationSeconds, setDurationSeconds] = useState(5);
  const [projectId, setProjectId] = useState<string>("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [trackedJobIds, setTrackedJobIds] = useState<string[]>([]);
  const [jobMap, setJobMap] = useState<Record<string, Job>>({});
  const [results, setResults] = useState<MediaGenerationResultItem[]>([]);
  const [cacheKey, setCacheKey] = useState(() => Date.now());

  const bindJobResults = useCallback(
    (job: Job) => {
      if (job.status !== "done") return;
      const materialIds = parseMaterialIdsFromJobProgress(job.progress);
      if (!materialIds.length) return;
      setResults((prev) => {
        let next = prev;
        for (const materialId of materialIds) {
          if (next.some((r) => r.materialId === materialId && r.jobId === job.id)) continue;
          if (next === prev) next = [...prev];
          next.push({
            materialId,
            mediaKind: mediaKindForPluginKind(kind),
            jobId: job.id,
            name: name || undefined,
          });
        }
        return next;
      });
      setCacheKey(Date.now());
    },
    [kind, name],
  );

  useEffect(() => {
    let alive = true;
    api
      .listMediaPlugins(kind)
      .then((list) => {
        if (!alive) return;
        setPlugins(list);
        setPluginId((prev) => (prev && list.some((p) => p.id === prev) ? prev : list[0]?.id ?? ""));
      })
      .catch((e) => notify(t("mediaPlugin.loadFailed", { msg: (e as Error).message })));
    return () => {
      alive = false;
    };
  }, [kind, t]);

  useEffect(() => {
    setReferences([]);
    setDetail(null);
    setParams({});
    setFolderId("");
    if (tab !== "image") setProjectId("");
  }, [tab]);

  useEffect(() => {
    setReferences([]);
    setParams({});
    if (!pluginId) {
      setDetail(null);
      return;
    }
    let alive = true;
    setLoadingDetail(true);
    api
      .getMediaPlugin(kind, pluginId)
      .then((plugin) => {
        if (!alive) return;
        setDetail(plugin);
        setParams(createParamDefaults(plugin.paramsSchema ?? {}));
      })
      .catch((e) => {
        if (!alive) return;
        setDetail(null);
        notify(t("mediaPlugin.detailFailed", { msg: (e as Error).message }));
      })
      .finally(() => alive && setLoadingDetail(false));
    return () => {
      alive = false;
    };
  }, [kind, pluginId, t]);

  useEffect(() => {
    api
      .listFolders("material")
      .then(setFolders)
      .catch(() => setFolders([]));
    if (!canUseProjectTarget(kind)) return;
    api
      .listProjects()
      .then((list) => setProjects(list.filter((p) => p.kind === "frame")))
      .catch(() => setProjects([]));
  }, [kind]);

  useEffect(() => {
    if (!trackedJobIds.length) return;
    const unsub = wsClient.subscribe((msg) => {
      if (!msg.type.startsWith("job_")) return;
      const p = (msg.payload ?? {}) as Record<string, unknown>;
      const id = p.id as string | undefined;
      if (!id || !trackedJobIds.includes(id)) return;
      const payloadIds = Array.isArray(p.materialIds)
        ? p.materialIds.filter((x): x is string => typeof x === "string" && x.trim() !== "")
        : [];
      if (msg.type === "job_done" && payloadIds.length) {
        setResults((prev) => {
          let next = prev;
          for (const materialId of payloadIds) {
            if (next.some((r) => r.materialId === materialId && r.jobId === id)) continue;
            if (next === prev) next = [...prev];
            next.push({
              materialId,
              mediaKind: mediaKindForPluginKind(kind),
              jobId: id,
              name: name || undefined,
            });
          }
          return next;
        });
        setCacheKey(Date.now());
      }
      void api
        .getJob(id)
        .then((job) => {
          setJobMap((prev) => ({ ...prev, [id]: job }));
          bindJobResults(job);
          if (job.status === "error") {
            notify(job.error ?? t("mediaPlugin.jobFailed"));
          }
        })
        .catch(() => {});
    });
    const timer = window.setInterval(() => {
      for (const id of trackedJobIds) {
        void api
          .getJob(id)
          .then((job) => {
            setJobMap((prev) => ({ ...prev, [id]: job }));
            bindJobResults(job);
          })
          .catch(() => {});
      }
    }, 3000);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, [trackedJobIds, kind, name, t, bindJobResults]);

  const paramErrors = useMemo(
    () => (detail ? validateMediaPluginParams(detail.paramsSchema ?? {}, params) : {}),
    [detail, params],
  );

  const trackedJobs = trackedJobIds.map((id) => jobMap[id]).filter(Boolean) as Job[];

  const submit = async () => {
    const schema = detail?.paramsSchema ?? {};
    const check = validateGenerationForm({
      pluginId,
      prompt,
      schema,
      params,
      kind,
      projectId: projectId || null,
    });
    if (!check.ok) {
      if (check.field === "pluginId") notify(t("mediaPlugin.form.pickPlugin"));
      else if (check.field === "prompt") notify(t("mediaPlugin.form.promptRequired"));
      else if (check.field === "projectId") notify(t("mediaPlugin.form.projectImageOnly"));
      else notify(t(`mediaPlugin.paramError.${check.code}`, { field: check.field }));
      return;
    }
    let submitParams: Record<string, unknown>;
    try {
      submitParams = coerceParamValuesForSubmit(schema, params);
    } catch {
      notify(t("mediaPlugin.paramError.json", { field: "params" }));
      return;
    }
    setSubmitting(true);
    try {
      const body = buildMediaGenerationRequest({
        kind,
        pluginId,
        prompt: prompt.trim(),
        references,
        params: submitParams,
        count: tab === "image" || tab === "audio" ? count : 1,
        durationSeconds: tab === "video" || tab === "audio" ? durationSeconds : undefined,
        folderId: folderId || null,
        projectId: projectId || null,
        name: name.trim() || undefined,
      });
      const created = await api.createMediaGeneration(body);
      const ids = (created.jobIds && created.jobIds.length > 0) ? created.jobIds : [created.jobId];
      setTrackedJobIds(ids);
      setResults([]);
      notify(t("mediaPlugin.queued", { n: ids.length }), "info");
    } catch (e) {
      notify(t("mediaPlugin.submitFailed", { msg: (e as Error).message }));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page media-generate-page">
      <header className="home-header">
        <h1>
          <Sparkles size={24} /> {t("mediaPlugin.nav.generate")}
        </h1>
        <p className="subtitle">{t("mediaPlugin.generate.subtitle")}</p>
      </header>

      <div className="import-tabs media-generate-tabs" role="tablist">
        {MEDIA_GENERATE_TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`tab ${tab === id ? "active" : ""}`}
            onClick={() => setTab(id)}
          >
            {t(`mediaPlugin.tab.${id}`)}
          </button>
        ))}
      </div>

      <div className="media-generate-layout">
        <section className="media-generate-form card-panel">
          <MediaPluginForm
            plugins={plugins}
            detail={detail}
            pluginId={pluginId}
            params={params}
            errors={paramErrors}
            loadingDetail={loadingDetail}
            onPluginChange={setPluginId}
            onParamChange={(key, value) => setParams((prev) => ({ ...prev, [key]: value }))}
          />

          <label className="field">
            <span>{t("mediaPlugin.form.prompt")} *</span>
            <textarea
              className="px-input"
              rows={4}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={t("mediaPlugin.form.promptPlaceholder")}
            />
          </label>

          <label className="field">
            <span>{t("mediaPlugin.form.name")}</span>
            <input className="px-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <MediaReferencePicker
            kind={kind}
            constraints={detail?.constraints ?? {}}
            value={references}
            onChange={setReferences}
          />

          {(tab === "image" || tab === "audio") && (
            <label className="field">
              <span>{t("mediaPlugin.form.count")}</span>
              <input
                className="px-input"
                type="number"
                min={1}
                max={16}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
              />
            </label>
          )}

          {(tab === "video" || tab === "audio") && (
            <label className="field">
              <span>{t("mediaPlugin.form.duration")}</span>
              <input
                className="px-input"
                type="number"
                min={0.1}
                max={600}
                step={0.1}
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(Math.max(0.1, Math.min(600, Number(e.target.value) || 0.1)))}
              />
            </label>
          )}

          <label className="field">
            <span>{t("mediaPlugin.form.folder")}</span>
            <select className="px-input" value={folderId} onChange={(e) => setFolderId(e.target.value)}>
              <option value="">{t("mediaPlugin.form.folderUngrouped")}</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {folderPathLabel(folders, f.id) || f.name}
                </option>
              ))}
            </select>
          </label>

          {canUseProjectTarget(kind) && (
            <label className="field">
              <span>{t("mediaPlugin.form.projectTarget")}</span>
              <select className="px-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                <option value="">{t("mediaPlugin.form.materialsOnly")}</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <div className="hint">{t("mediaPlugin.form.projectHint")}</div>
            </label>
          )}

          <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
            <button type="button" className="px-btn accent" disabled={submitting || !plugins.length} onClick={() => void submit()}>
              <Sparkles size={14} /> {submitting ? t("msg.processing") : t("mediaPlugin.form.submit")}
            </button>
          </div>
        </section>

        <section className="media-generate-side card-panel">
          <div className="section-title">{t("mediaPlugin.jobs.title")}</div>
          {trackedJobs.length === 0 ? (
            <div className="hint">{t("mediaPlugin.jobs.empty")}</div>
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
    </div>
  );
}
