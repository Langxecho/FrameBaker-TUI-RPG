import { useEffect, useRef, useState } from "react";
import { Download, KeyRound, PlugZap, Trash2, Upload } from "lucide-react";
import type { MediaPluginDetail, MediaPluginKind, MediaPluginSummary } from "@framebaker/shared";
import { MEDIA_PLUGIN_KINDS, mediaPluginArchiveExtension } from "@framebaker/shared";
import { api, HttpError } from "../api";
import { useT } from "../i18n";
import { askConfirm, notify } from "../notice";
import {
  coerceParamValuesForSubmit,
  createParamDefaults,
  isAllowedPluginArchiveFilename,
  isHttpConflictStatus,
  pluginArchiveFileAccept,
  validateMediaPluginParams,
} from "../mediaPluginUiState";

type KindFilter = MediaPluginKind | "all";

export default function MediaPluginSettings() {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState<KindFilter>("all");
  const [plugins, setPlugins] = useState<MediaPluginSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<MediaPluginDetail | null>(null);
  const [secretDraft, setSecretDraft] = useState<Record<string, string>>({});
  const [paramDraft, setParamDraft] = useState<Record<string, unknown>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const list = await api.listMediaPlugins(filter === "all" ? undefined : filter);
      setPlugins(list);
    } catch (e) {
      notify(t("mediaPlugin.loadFailed", { msg: (e as Error).message }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [filter]);

  const openDetail = async (summary: MediaPluginSummary) => {
    setBusyId(summary.id);
    try {
      const detail = await api.getMediaPlugin(summary.kind, summary.id);
      setSelected(detail);
      setSecretDraft({});
      setParamDraft(createParamDefaults(detail.paramsSchema ?? {}));
    } catch (e) {
      notify(t("mediaPlugin.detailFailed", { msg: (e as Error).message }));
    } finally {
      setBusyId(null);
    }
  };

  const importFile = async (file: File, confirmReplace = false): Promise<boolean> => {
    if (!isAllowedPluginArchiveFilename(file.name)) {
      notify(t("mediaPlugin.import.badExt"));
      return false;
    }
    setBusyId("import");
    try {
      const plugin = await api.importMediaPlugin(file, file.name, confirmReplace);
      notify(t("mediaPlugin.import.ok", { name: plugin.name }), "info");
      await load();
      setSelected(plugin);
      setSecretDraft({});
      setParamDraft(createParamDefaults(plugin.paramsSchema ?? {}));
      return true;
    } catch (e) {
      if (e instanceof HttpError && isHttpConflictStatus(e.status) && !confirmReplace) {
        const ok = await askConfirm(t("mediaPlugin.import.replaceConfirm", { msg: e.message }));
        if (ok) return importFile(file, true);
        return false;
      }
      notify(t("mediaPlugin.import.failed", { msg: (e as Error).message }));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const saveSecrets = async () => {
    if (!selected) return;
    const values = Object.fromEntries(
      Object.entries(secretDraft).filter(([, v]) => String(v ?? "").trim() !== ""),
    );
    if (!Object.keys(values).length) {
      notify(t("mediaPlugin.secrets.empty"), "info");
      return;
    }
    setBusyId(selected.id);
    try {
      const plugin = await api.updateMediaPluginSecrets(selected.kind, selected.id, values);
      setSelected(plugin);
      setSecretDraft({});
      notify(t("mediaPlugin.secrets.saved"), "info");
      await load();
    } catch (e) {
      notify(t("mediaPlugin.secrets.failed", { msg: (e as Error).message }));
    } finally {
      setBusyId(null);
    }
  };

  const saveParams = async () => {
    if (!selected) return;
    const errors = validateMediaPluginParams(selected.paramsSchema ?? {}, paramDraft);
    const first = Object.entries(errors)[0];
    if (first) {
      notify(t(`mediaPlugin.paramError.${first[1]}`, { field: first[0] }));
      return;
    }
    let defaults: Record<string, unknown>;
    try {
      defaults = coerceParamValuesForSubmit(selected.paramsSchema ?? {}, paramDraft);
    } catch {
      notify(t("mediaPlugin.paramError.json", { field: "params" }));
      return;
    }
    setBusyId(selected.id);
    try {
      const plugin = await api.updateMediaPluginParams(selected.kind, selected.id, defaults);
      setSelected(plugin);
      notify(t("mediaPlugin.params.saved"), "info");
      await load();
    } catch (e) {
      notify(t("mediaPlugin.params.failed", { msg: (e as Error).message }));
    } finally {
      setBusyId(null);
    }
  };

  const testPlugin = async (summary: MediaPluginSummary | MediaPluginDetail) => {
    setBusyId(summary.id);
    try {
      const detail =
        "paramsSchema" in summary ? (summary as MediaPluginDetail) : await api.getMediaPlugin(summary.kind, summary.id);
      if (!detail.runnable) {
        notify(t("mediaPlugin.test.notRunnable"));
        return;
      }
      if (!(await askConfirm(t("mediaPlugin.test.confirm", { name: detail.name })))) return;
      const result = await api.testMediaPlugin(detail.kind, detail.id, {
        prompt: t("mediaPlugin.test.prompt"),
        params: createParamDefaults(detail.paramsSchema ?? {}),
        durationSeconds: detail.kind === "image_api" ? null : 2,
      });
      if (result.ok) {
        notify(
          t("mediaPlugin.test.ok", {
            ms: result.latencyMs,
            n: result.outputCount,
          }),
          "info",
        );
      } else {
        notify(t("mediaPlugin.test.failed", { msg: result.error || result.code || "test failed" }));
      }
    } catch (e) {
      notify(t("mediaPlugin.test.failed", { msg: (e as Error).message }));
    } finally {
      setBusyId(null);
    }
  };

  const exportPlugin = async (summary: MediaPluginSummary) => {
    if (!(await askConfirm(t("mediaPlugin.export.confirm", { name: summary.name })))) return;
    const a = document.createElement("a");
    a.href = api.exportMediaPluginUrl(summary.kind, summary.id);
    a.download = `${summary.id}${mediaPluginArchiveExtension(summary.kind)}`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    notify(t("mediaPlugin.export.sanitized"), "info");
  };

  const removePlugin = async (summary: MediaPluginSummary) => {
    if (!(await askConfirm(t("mediaPlugin.delete.confirm", { name: summary.name, id: summary.id })))) return;
    setBusyId(summary.id);
    try {
      await api.deleteMediaPlugin(summary.kind, summary.id);
      if (selected?.id === summary.id) setSelected(null);
      notify(t("mediaPlugin.delete.ok"), "info");
      await load();
    } catch (e) {
      notify(t("mediaPlugin.delete.failed", { msg: (e as Error).message }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="settings-sec media-plugin-settings">
      <h3>
        <PlugZap size={14} /> {t("mediaPlugin.settings.title")}
        <span className="settings-head-actions">
          <button type="button" className="px-btn mini" disabled={busyId === "import"} onClick={() => fileRef.current?.click()}>
            <Upload size={12} /> {t("mediaPlugin.import.action")}
          </button>
          <button type="button" className="px-btn mini" disabled={loading} onClick={() => void load()}>
            {loading ? t("msg.loading") : t("mediaPlugin.settings.refresh")}
          </button>
        </span>
      </h3>
      <div className="hint warn">{t("mediaPlugin.trustedWarning")}</div>
      <input
        ref={fileRef}
        type="file"
        accept={pluginArchiveFileAccept()}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importFile(file);
        }}
      />

      <div className="import-tabs media-plugin-filter" role="tablist">
        {(["all", ...MEDIA_PLUGIN_KINDS] as KindFilter[]).map((id) => (
          <button
            key={id}
            type="button"
            className={`tab ${filter === id ? "active" : ""}`}
            onClick={() => setFilter(id)}
          >
            {id === "all" ? t("mediaPlugin.filter.all") : t(`mediaPlugin.kind.${id}`)}
          </button>
        ))}
      </div>

      {plugins.length === 0 ? (
        <div className="hint">{loading ? t("msg.loading") : t("mediaPlugin.settings.empty")}</div>
      ) : (
        <div className="media-plugin-card-grid">
          {plugins.map((p) => (
            <article key={`${p.kind}:${p.id}`} className={`media-plugin-card ${selected?.id === p.id ? "active" : ""}`}>
              <div className="media-plugin-card-head">
                <strong>{p.name}</strong>
                <span className="provider-type">{t(`mediaPlugin.kind.${p.kind}`)}</span>
              </div>
              <div className="hint">
                {p.id} · v{p.version}
              </div>
              <div className="media-plugin-badges">
                <span className={`engine-status ${p.configured ? "ok" : "bad"}`}>
                  <span className="dot" />
                  {p.configured ? t("mediaPlugin.badge.configured") : t("mediaPlugin.badge.secretsNeeded")}
                </span>
                <span className={`engine-status ${p.runnable ? "ok" : "bad"}`}>
                  <span className="dot" />
                  {p.runnable ? t("mediaPlugin.badge.runnable") : t("mediaPlugin.badge.notRunnable")}
                </span>
              </div>
              <div className="media-plugin-card-actions">
                <button type="button" className="px-btn mini" disabled={busyId === p.id} onClick={() => void openDetail(p)}>
                  {t("mediaPlugin.settings.detail")}
                </button>
                <button type="button" className="px-btn mini" disabled={busyId === p.id} onClick={() => void testPlugin(p)}>
                  <PlugZap size={12} /> {t("mediaPlugin.test.action")}
                </button>
                <button type="button" className="px-btn mini" onClick={() => void exportPlugin(p)}>
                  <Download size={12} /> {t("mediaPlugin.export.action")}
                </button>
                <button type="button" className="px-btn mini danger" disabled={busyId === p.id} onClick={() => void removePlugin(p)}>
                  <Trash2 size={12} /> {t("common.delete")}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {selected && (
        <div className="media-plugin-detail provider-card">
          <div className="provider-head">
            <span className="provider-name">{selected.name}</span>
            <span className="provider-type">{t(`mediaPlugin.kind.${selected.kind}`)}</span>
          </div>
          <div className="hint">
            {selected.id} · v{selected.version} · {selected.entry.module}.{selected.entry.function}
          </div>
          <div className="hint">{t("mediaPlugin.form.capabilities")}: {selected.capabilities.join(", ") || t("mediaPlugin.form.noCapabilities")}</div>

          <div className="section-title">
            <KeyRound size={12} /> {t("mediaPlugin.secrets.title")}
          </div>
          <div className="hint">{t("mediaPlugin.secrets.hint")}</div>
          {selected.secrets.length === 0 ? (
            <div className="hint">{t("mediaPlugin.secrets.none")}</div>
          ) : (
            selected.secrets.map((s) => (
              <label className="field" key={s.id}>
                <span>
                  {s.label || s.id}
                  {s.required ? " *" : ""} · {s.configured ? t("mediaPlugin.badge.configured") : t("mediaPlugin.badge.secretsNeeded")}
                </span>
                <input
                  className="px-input"
                  type="password"
                  autoComplete="off"
                  placeholder={s.configured ? t("mediaPlugin.secrets.keep") : t("mediaPlugin.secrets.enter")}
                  value={secretDraft[s.id] ?? ""}
                  onChange={(e) => setSecretDraft((prev) => ({ ...prev, [s.id]: e.target.value }))}
                />
              </label>
            ))
          )}
          {selected.secrets.length > 0 && (
            <button type="button" className="px-btn mini accent" disabled={busyId === selected.id} onClick={() => void saveSecrets()}>
              {t("mediaPlugin.secrets.save")}
            </button>
          )}

          <div className="section-title">{t("mediaPlugin.params.title")}</div>
          {Object.keys(selected.paramsSchema ?? {}).length === 0 ? (
            <div className="hint">{t("mediaPlugin.params.none")}</div>
          ) : (
            Object.entries(selected.paramsSchema).map(([key, field]) => {
              const type = String(field.type ?? "string");
              const value = paramDraft[key];
              return (
                <div className="field" key={key}>
                  <span>
                    {field.label || key}
                    {field.required ? " *" : ""}
                  </span>
                  {type === "boolean" ? (
                    <label className="px-check">
                      <input
                        type="checkbox"
                        checked={Boolean(value)}
                        onChange={(e) => setParamDraft((prev) => ({ ...prev, [key]: e.target.checked }))}
                      />
                      {Boolean(value) ? t("mediaPlugin.form.boolOn") : t("mediaPlugin.form.boolOff")}
                    </label>
                  ) : type === "enum" ? (
                    <select
                      className="px-input"
                      value={value == null ? "" : String(value)}
                      onChange={(e) => {
                        const opt = (field.enum ?? []).find((x) => String(x) === e.target.value);
                        setParamDraft((prev) => ({ ...prev, [key]: opt ?? e.target.value }));
                      }}
                    >
                      {(field.enum ?? []).map((opt) => (
                        <option key={String(opt)} value={String(opt)}>
                          {String(opt)}
                        </option>
                      ))}
                    </select>
                  ) : type === "json" ? (
                    <textarea
                      className="px-input media-json-editor"
                      rows={3}
                      value={typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2)}
                      onChange={(e) => setParamDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                  ) : (
                    <input
                      className="px-input"
                      type={type === "integer" || type === "number" ? "number" : "text"}
                      value={value == null ? "" : String(value)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (type === "integer" || type === "number") {
                          const n = type === "integer" ? Number.parseInt(raw, 10) : Number(raw);
                          setParamDraft((prev) => ({ ...prev, [key]: raw.trim() === "" ? "" : Number.isFinite(n) ? n : raw }));
                        } else {
                          setParamDraft((prev) => ({ ...prev, [key]: raw }));
                        }
                      }}
                    />
                  )}
                </div>
              );
            })
          )}
          {Object.keys(selected.paramsSchema ?? {}).length > 0 && (
            <button type="button" className="px-btn mini accent" disabled={busyId === selected.id} onClick={() => void saveParams()}>
              {t("mediaPlugin.params.save")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
