import { useEffect, useMemo, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import type { MediaKind, MediaPluginKind } from "@framebaker/shared";
import { api, materialFileUrl, materialImageUrl, type Material } from "../api";
import { useT } from "../i18n";
import { notify } from "../notice";
import IconBtn from "./IconBtn";
import {
  acceptedReferenceMediaKinds,
  filterMaterialsForPlugin,
  maxReferenceCountForPlugin,
} from "../mediaPluginUiState";

interface Props {
  kind: MediaPluginKind;
  constraints?: Record<string, unknown>;
  value: string[];
  onChange: (ids: string[]) => void;
}

export default function MediaReferencePicker({ kind, constraints = {}, value, onChange }: Props) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [mats, setMats] = useState<Material[] | null>(null);
  const [v, setV] = useState(() => Date.now());
  const max = maxReferenceCountForPlugin(kind, constraints);
  const accepted = acceptedReferenceMediaKinds(kind, constraints);

  useEffect(() => {
    if (!open || mats !== null) return;
    api
      .listMaterials()
      .then((list) => {
        setMats(list);
        setV(Date.now());
      })
      .catch((e) => notify(t("msg.load_materials_failed_msg", { msg: (e as Error).message })));
  }, [open, mats, t]);

  const filtered = useMemo(
    () => (mats ? filterMaterialsForPlugin(mats, kind, constraints) : []),
    [mats, kind, constraints],
  );

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((x) => x !== id));
      return;
    }
    if (value.length >= max) {
      notify(t("mediaPlugin.ref.limit", { max }));
      return;
    }
    onChange([...value, id]);
  };

  const thumb = (m: Material) => {
    const mk = (m.mediaKind ?? m.kind) as MediaKind;
    if (mk === "image") return materialImageUrl(m.id, v, "processed", 256);
    return materialFileUrl(m.id, v, "raw");
  };

  const kindLabel = (mk: MediaKind) =>
    mk === "image" ? t("msg.image") : mk === "video" ? t("msg.video") : t("msg.audio");

  return (
    <div className="form-row media-ref-picker">
      <label>{t("mediaPlugin.ref.label")}</label>
      <div className="hint">
        {t("mediaPlugin.ref.hint", {
          kinds: accepted.map(kindLabel).join(" / "),
          max,
        })}
      </div>
      {value.length > 0 && (
        <div className="ref-selected-list">
          {value.map((id) => {
            const m = mats?.find((x) => x.id === id);
            const mk = ((m?.mediaKind ?? m?.kind) || "image") as MediaKind;
            return (
              <div className="ref-selected" key={id}>
                {mk === "image" ? (
                  <img src={thumb(m ?? ({ id, kind: "image", mediaKind: "image" } as Material))} alt="" draggable={false} />
                ) : mk === "audio" ? (
                  <div className="mat-thumb-audio" />
                ) : (
                  <video src={thumb(m ?? ({ id, kind: "video", mediaKind: "video" } as Material))} muted playsInline preload="metadata" />
                )}
                <span className="ref-kind">{kindLabel(mk)}</span>
                <IconBtn title={t("msg.clear_reference")} onClick={() => toggle(id)}>
                  <X size={14} />
                </IconBtn>
              </div>
            );
          })}
        </div>
      )}
      <div className="file-drop" onClick={() => setOpen((o) => !o)}>
        <span className="ref-empty">
          <ImagePlus size={16} /> {t("mediaPlugin.ref.choose")} ({value.length}/{max})
        </span>
      </div>
      {open && (
        <div className="ref-panel">
          <div className="mat-pick-grid ref-grid">
            {mats === null ? (
              <div className="empty">{t("msg.loading")}</div>
            ) : filtered.length === 0 ? (
              <div className="empty">{t("mediaPlugin.ref.empty")}</div>
            ) : (
              filtered.map((m) => {
                const mk = (m.mediaKind ?? m.kind) as MediaKind;
                const selected = value.includes(m.id);
                return (
                  <button
                    type="button"
                    key={m.id}
                    className={`mat-pick ${selected ? "selected" : ""}`}
                    onClick={() => toggle(m.id)}
                  >
                    {mk === "image" ? (
                      <img src={thumb(m)} alt="" draggable={false} loading="lazy" />
                    ) : mk === "audio" ? (
                      <div className="mat-thumb-audio" />
                    ) : (
                      <video src={thumb(m)} muted playsInline preload="metadata" />
                    )}
                    <span className="mat-pick-name">{m.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
