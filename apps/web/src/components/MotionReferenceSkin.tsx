import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Film, ImagePlus, Trash2, Upload } from "lucide-react";
import { api, materialFileUrl, materialImageUrl, materialThumbnailUrl, type Material } from "../api";
import { useModalEscClose } from "../hooks/useModalEscClose";
import { useT } from "../i18n";
import { notify } from "../notice";
import {
  inferMotionReferenceKind,
  mapClipTimeToMedia,
  type MotionReferenceKind,
  type MotionReferenceOrder,
  type MotionReferenceSyncMode,
} from "../motionReferenceSkin";
import PxSelect from "./PxSelect";

interface Source {
  url: string;
  kind: MotionReferenceKind;
  label: string;
  revoke?: string;
}

export default function MotionReferenceSkin({
  clipTime,
  clipDuration,
  children,
}: {
  clipTime: number;
  clipDuration: number;
  children: ReactNode;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [source, setSource] = useState<Source>();
  const [opacity, setOpacity] = useState(0.38);
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [sync, setSync] = useState(true);
  const [syncMode, setSyncMode] = useState<MotionReferenceSyncMode>("stretch");
  const [order, setOrder] = useState<MotionReferenceOrder>("behind");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [materials, setMaterials] = useState<Material[] | null>(null);
  const sourceRef = useRef<Source>();
  sourceRef.current = source;
  const closePicker = useCallback(() => setPickerOpen(false), []);
  useModalEscClose(closePicker, pickerOpen);

  const clearSource = useCallback(() => {
    setSource((prev) => {
      if (prev?.revoke) URL.revokeObjectURL(prev.revoke);
      return undefined;
    });
  }, []);

  useEffect(() => () => {
    const prev = sourceRef.current;
    if (prev?.revoke) URL.revokeObjectURL(prev.revoke);
  }, []);

  const applyFile = (file: File | undefined) => {
    if (!file) return;
    const kind = inferMotionReferenceKind(file.name, file.type);
    if (!kind) {
      notify(t("animation.refSkin.unsupported"));
      return;
    }
    const url = URL.createObjectURL(file);
    setSource((prev) => {
      if (prev?.revoke) URL.revokeObjectURL(prev.revoke);
      return { url, kind, label: file.name, revoke: url };
    });
  };

  const applyMaterial = (item: Material) => {
    const kind = item.mediaKind === "video" ? "video" : "image";
    if (item.mediaKind === "audio") {
      notify(t("animation.refSkin.unsupported"));
      return;
    }
    setSource((prev) => {
      if (prev?.revoke) URL.revokeObjectURL(prev.revoke);
      return {
        url: kind === "video" ? materialFileUrl(item.id, undefined, "raw") : materialImageUrl(item.id, undefined, "processed"),
        kind,
        label: item.name,
      };
    });
    setPickerOpen(false);
  };

  const openPicker = async () => {
    setPickerOpen(true);
    if (materials) return;
    try {
      const list = await api.listMaterials();
      setMaterials(list.filter((item) => item.mediaKind !== "audio"));
    } catch (e) {
      notify(t("msg.load_materials_failed_msg", { msg: (e as Error).message }));
    }
  };

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !source || source.kind !== "video" || !sync) return;
    const seek = () => {
      const next = mapClipTimeToMedia(clipTime, clipDuration, el.duration || 0, syncMode);
      if (!Number.isFinite(next)) return;
      if (Math.abs(el.currentTime - next) > 0.04) el.currentTime = next;
    };
    el.pause();
    el.muted = true;
    if (el.readyState >= 1) seek();
    el.addEventListener("loadedmetadata", seek);
    seek();
    return () => el.removeEventListener("loadedmetadata", seek);
  }, [clipDuration, clipTime, source, sync, syncMode]);

  const mediaStyle = {
    opacity,
    transform: `translate(${offsetX}%, ${offsetY}%) scale(${scale})`,
  };

  return (
    <>
      <div className="animation-ref-toolbar">
        <strong><Film size={14} /> {t("animation.refSkin.title")}</strong>
        <input
          ref={fileRef}
          hidden
          type="file"
          accept="video/mp4,video/webm,video/quicktime,image/gif,image/png,image/jpeg,image/webp,.mp4,.webm,.mov,.gif,.png,.jpg,.jpeg,.webp"
          onChange={(event) => {
            applyFile(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
        <button type="button" className="px-btn" onClick={() => fileRef.current?.click()}><Upload size={13} />{t("animation.refSkin.import")}</button>
        <button type="button" className="px-btn" onClick={() => void openPicker()}><ImagePlus size={13} />{t("animation.refSkin.fromLibrary")}</button>
        <button type="button" className="px-btn" disabled={!source} onClick={clearSource}><Trash2 size={13} />{t("animation.refSkin.clear")}</button>
        {source && <span className="animation-ref-label" title={source.label}>{source.label}</span>}
        <label>{t("animation.refSkin.opacity")}
          <input type="range" min="0.08" max="0.9" step="0.01" value={opacity} disabled={!source} onChange={(e) => setOpacity(+e.target.value)} />
        </label>
        <label>{t("animation.refSkin.scale")}
          <input type="range" min="0.3" max="2.4" step="0.01" value={scale} disabled={!source} onChange={(e) => setScale(+e.target.value)} />
        </label>
        <label>{t("animation.refSkin.offsetX")}
          <input type="range" min="-40" max="40" step="1" value={offsetX} disabled={!source} onChange={(e) => setOffsetX(+e.target.value)} />
        </label>
        <label>{t("animation.refSkin.offsetY")}
          <input type="range" min="-40" max="40" step="1" value={offsetY} disabled={!source} onChange={(e) => setOffsetY(+e.target.value)} />
        </label>
        <label>{t("animation.refSkin.order")}
          <PxSelect
            value={order}
            disabled={!source}
            options={[
              { value: "behind", label: t("animation.refSkin.orderBehind") },
              { value: "front", label: t("animation.refSkin.orderFront") },
            ]}
            onChange={(value) => setOrder(value as MotionReferenceOrder)}
          />
        </label>
        <label className="px-check">
          <input type="checkbox" checked={sync} disabled={!source || source.kind !== "video"} onChange={(e) => setSync(e.target.checked)} />
          {t("animation.refSkin.sync")}
        </label>
        <label>{t("animation.refSkin.syncMode")}
          <PxSelect
            value={syncMode}
            disabled={!source || source.kind !== "video" || !sync}
            options={[
              { value: "stretch", label: t("animation.refSkin.syncStretch") },
              { value: "seconds", label: t("animation.refSkin.syncSeconds") },
            ]}
            onChange={(value) => setSyncMode(value as MotionReferenceSyncMode)}
          />
        </label>
        <p>{t("animation.refSkin.hint")}</p>
      </div>
      <div className="animation-ref-stage" data-ref-order={order}>
        {source && (
          <div className="animation-ref-layer" aria-hidden>
            {source.kind === "video"
              ? <video ref={videoRef} src={source.url} muted playsInline preload="metadata" style={mediaStyle} />
              : <img src={source.url} alt="" draggable={false} style={mediaStyle} />}
          </div>
        )}
        {children}
      </div>
      {pickerOpen && (
        <div className="modal-mask">
          <section className="modal pixel-panel animation-ref-picker" role="dialog" aria-modal="true" aria-labelledby="animation-ref-picker-title">
            <h2 id="animation-ref-picker-title">{t("animation.refSkin.fromLibrary")}</h2>
            <p>{t("animation.refSkin.libraryHint")}</p>
            <div className="animation-ref-picker-grid">
              {materials === null && <p>{t("animation.refSkin.loading")}</p>}
              {materials && materials.length === 0 && <p>{t("animation.refSkin.libraryEmpty")}</p>}
              {materials?.map((item) => (
                <button type="button" key={item.id} onClick={() => applyMaterial(item)}>
                  <img src={item.mediaKind === "video" ? materialThumbnailUrl(item.id) : materialImageUrl(item.id, undefined, "processed", 256)} alt="" />
                  <strong>{item.name}</strong>
                  <span>{item.mediaKind === "video" ? t("msg.video") : t("msg.image")}</span>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="px-btn" onClick={closePicker}>{t("common.cancel")}</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
