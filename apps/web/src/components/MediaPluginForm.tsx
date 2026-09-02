import type { MediaPluginDetail, MediaPluginParamSchema, MediaPluginSummary } from "@framebaker/shared";
import { useT } from "../i18n";

interface Props {
  plugins: MediaPluginSummary[];
  detail: MediaPluginDetail | null;
  pluginId: string;
  params: Record<string, unknown>;
  errors?: Record<string, string>;
  loadingDetail?: boolean;
  onPluginChange: (pluginId: string) => void;
  onParamChange: (key: string, value: unknown) => void;
}

function fieldLabel(t: (k: string, vars?: Record<string, string | number>) => string, key: string, field: MediaPluginParamSchema) {
  return field.label?.trim() || key;
}

export default function MediaPluginForm({
  plugins,
  detail,
  pluginId,
  params,
  errors = {},
  loadingDetail,
  onPluginChange,
  onParamChange,
}: Props) {
  const t = useT();
  const schema = detail?.paramsSchema ?? {};

  return (
    <div className="media-plugin-form">
      <label className="field">
        <span>{t("mediaPlugin.form.plugin")}</span>
        <select className="px-input" value={pluginId} onChange={(e) => onPluginChange(e.target.value)}>
          <option value="">{t("mediaPlugin.form.pickPlugin")}</option>
          {plugins.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.version}){p.runnable ? "" : ` · ${t("mediaPlugin.badge.notRunnable")}`}
            </option>
          ))}
        </select>
      </label>

      {detail && (
        <div className="media-plugin-caps">
          <div className="hint">{t("mediaPlugin.form.capabilities")}: {detail.capabilities.length ? detail.capabilities.join(", ") : t("mediaPlugin.form.noCapabilities")}</div>
          {!detail.configured && <div className="hint warn">{t("mediaPlugin.form.secretsNeeded")}</div>}
          {!detail.runnable && <div className="hint warn">{t("mediaPlugin.form.notRunnableHint")}</div>}
        </div>
      )}

      {loadingDetail && <div className="hint">{t("msg.loading")}</div>}

      {Object.keys(schema).length > 0 && (
        <div className="media-plugin-params">
          <div className="section-title">{t("mediaPlugin.form.params")}</div>
          {Object.entries(schema).map(([key, field]) => {
            const type = String(field.type ?? "string");
            const value = params[key];
            const err = errors[key];
            const label = fieldLabel(t, key, field);
            return (
              <div className="field" key={key}>
                <span>
                  {label}
                  {field.required ? " *" : ""}
                </span>
                {field.description ? <div className="hint">{field.description}</div> : null}
                {type === "boolean" ? (
                  <label className="px-check">
                    <input
                      type="checkbox"
                      checked={Boolean(value)}
                      onChange={(e) => onParamChange(key, e.target.checked)}
                    />
                    {Boolean(value) ? t("mediaPlugin.form.boolOn") : t("mediaPlugin.form.boolOff")}
                  </label>
                ) : type === "enum" ? (
                  <select
                    className="px-input"
                    value={value == null ? "" : String(value)}
                    onChange={(e) => {
                      const opt = (field.enum ?? []).find((x) => String(x) === e.target.value);
                      onParamChange(key, opt ?? e.target.value);
                    }}
                  >
                    {(field.enum ?? []).map((opt) => (
                      <option key={String(opt)} value={String(opt)}>
                        {String(opt)}
                      </option>
                    ))}
                  </select>
                ) : type === "integer" || type === "number" ? (
                  <input
                    className="px-input"
                    type="number"
                    step={type === "integer" ? 1 : "any"}
                    value={typeof value === "number" ? value : value == null ? "" : String(value)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw.trim() === "") {
                        onParamChange(key, "");
                        return;
                      }
                      const n = type === "integer" ? Number.parseInt(raw, 10) : Number(raw);
                      onParamChange(key, Number.isFinite(n) ? n : raw);
                    }}
                  />
                ) : type === "json" ? (
                  <textarea
                    className="px-input media-json-editor"
                    rows={4}
                    value={typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2)}
                    onChange={(e) => onParamChange(key, e.target.value)}
                  />
                ) : (
                  <input
                    className="px-input"
                    type="text"
                    value={value == null ? "" : String(value)}
                    onChange={(e) => onParamChange(key, e.target.value)}
                  />
                )}
                {err ? <div className="field-error">{t(`mediaPlugin.paramError.${err}`, { field: label })}</div> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
