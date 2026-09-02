import { Download, ExternalLink } from "lucide-react";
import type { MediaKind } from "@framebaker/shared";
import { materialFileUrl, materialImageUrl } from "../api";
import { useT } from "../i18n";

export interface MediaGenerationResultItem {
  materialId: string;
  mediaKind: MediaKind;
  name?: string;
  jobId?: string;
}

interface Props {
  results: MediaGenerationResultItem[];
  cacheKey?: number;
  onOpenMaterials?: () => void;
}

export default function MediaResultPreview({ results, cacheKey = 0, onOpenMaterials }: Props) {
  const t = useT();
  if (!results.length) {
    return <div className="media-result-empty hint">{t("mediaPlugin.result.empty")}</div>;
  }

  return (
    <div className="media-result-preview">
      <div className="media-result-head">
        <span>{t("mediaPlugin.result.title")}</span>
        {onOpenMaterials && (
          <button type="button" className="px-btn mini" onClick={onOpenMaterials}>
            <ExternalLink size={12} /> {t("mediaPlugin.result.openMaterials")}
          </button>
        )}
      </div>
      <div className="media-result-grid">
        {results.map((item) => {
          const fileUrl = materialFileUrl(item.materialId, cacheKey, "raw");
          const imageUrl = materialImageUrl(item.materialId, cacheKey, "processed", 512);
          return (
            <article className="media-result-card" key={`${item.materialId}:${item.jobId ?? ""}`}>
              <div className="media-result-body">
                {item.mediaKind === "image" && <img src={imageUrl} alt={item.name ?? item.materialId} draggable={false} />}
                {item.mediaKind === "video" && (
                  <video src={fileUrl} controls playsInline preload="metadata" />
                )}
                {item.mediaKind === "audio" && <audio src={fileUrl} controls preload="metadata" />}
              </div>
              <div className="media-result-meta">
                <span className="media-result-name">{item.name ?? item.materialId}</span>
                <a className="px-btn mini" href={fileUrl} download>
                  <Download size={12} /> {t("mediaPlugin.result.download")}
                </a>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
