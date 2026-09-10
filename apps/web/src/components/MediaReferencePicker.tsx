import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, Upload, X } from "lucide-react";
import type { MediaKind, MediaPluginKind } from "@framebaker/shared";
import { api, materialFileUrl, materialImageUrl, type Material } from "../api";
import { useT } from "../i18n";
import { notify } from "../notice";
import IconBtn from "./IconBtn";
import {
  acceptedReferenceMediaKinds,
  filterMaterialsForPlugin,
  localFileAcceptedAsReference,
  maxReferenceCountForPlugin,
  referenceFileAccept,
} from "../mediaPluginUiState";

interface Props {
  kind: MediaPluginKind;
  constraints?: Record<string, unknown>;
  value: string[];
  onChange: (ids: string[]) => void;
}

export default function MediaReferencePicker({ kind, constraints = {}, value, onChange }: Props) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [mats, setMats] = useState<Material[] | null>(null);
  const [v, setV] = useState(() => Date.now());
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const max = maxReferenceCountForPlugin(kind, constraints);
  const accepted = acceptedReferenceMediaKinds(kind, constraints);

  const reload = async () => {
    const list = await api.listMaterials();
    setMats(list);
    setV(Date.now());
    return list;
  };

  useEffect(() => {
    if (mats !== null) return;
    void reload().catch((e) => notify(t("msg.load_materials_failed_msg", { msg: (e as Error).message })));
  }, [mats, t]);

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

  const ingestFiles = async (fileList: FileList | File[]) => {
    const files = [...fileList];
    if (!files.length || busy) return;
    setBusy(true);
    try {
      let ids = [...value];
      for (const file of files) {
        if (ids.length >= max) {
          notify(t("mediaPlugin.ref.limit", { max }));
          break;
        }
        if (!localFileAcceptedAsReference(file, accepted)) {
          notify(t("mediaPlugin.ref.fileKind"));
          continue;
        }
        const fd = new FormData();
        fd.append("file", file);
        const r = await api.uploadMaterial(fd);
        const id = "materialId" in r && typeof r.materialId === "string" ? r.materialId : undefined;
        if (!id) {
          notify(t("mediaPlugin.ref.queuedExtract"));
          continue;
        }
        if (!ids.includes(id)) ids = [...ids, id];
      }
      await reload().catch(() => {});
      onChange(ids);
    } catch (e) {
      notify(t("mediaPlugin.ref.uploadFailed", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
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
      <input
        ref={fileRef}
        hidden
        type="file"
        multiple={max > 1}
        accept={referenceFileAccept(accepted)}
        onChange={(event) => {
          void ingestFiles(event.target.files ?? []);
          event.currentTarget.value = "";
        }}
      />
      <div
        className={`file-drop${over ? " over" : ""}`}
        onClick={() => !busy && fileRef.current?.click()}
        onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setOver(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void ingestFiles(e.dataTransfer.files);
        }}
      >
        <span className="ref-empty">
          <Upload size={16} /> {busy ? t("mediaPlugin.ref.uploading") : t("mediaPlugin.ref.drop")} ({value.length}/{max})
        </span>
      </div>
      <button type="button" className="px-btn" disabled={busy} onClick={() => setOpen((o) => !o)}>
        <ImagePlus size={14} /> {t("mediaPlugin.ref.library")}
      </button>
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
