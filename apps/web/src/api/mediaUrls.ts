/** 帧图片 URL；size 仅用于列表/时间轴缩略图，编辑画布不传 size 以保留原图。 */
export const frameImageUrl = (id: string, v?: number, size?: number) =>
  `/api/frames/${id}/image.png?type=processed${v ? `&v=${v}` : ""}${size ? `&size=${size}` : ""}`;

/** 素材图片 URL；size 仅用于列表缩略图，详情/编辑不传 size。 */
export const materialImageUrl = (
  id: string,
  v?: number,
  type: "raw" | "processed" = "processed",
  size?: number,
  strict = false,
) =>
  `/api/materials/${id}/image.png?type=${type}${v ? `&v=${v}` : ""}${size ? `&size=${size}` : ""}${strict ? "&strict=1" : ""}`;

/** 绑定预览/导出：镜像等编辑写在 processed，缺失时回退 raw。 */
export async function fetchMaterialWorkingImage(id: string): Promise<Response> {
  const processed = await fetch(materialImageUrl(id, undefined, "processed", undefined, true));
  if (processed.ok) return processed;
  return fetch(materialImageUrl(id, undefined, "raw", undefined, true));
}

/** 素材文件 URL（视频勿用 .png 后缀，避免部分浏览器误判） */
export const materialFileUrl = (id: string, v?: number, type: "raw" | "processed" = "raw") =>
  `/api/materials/${id}/image?type=${type}${v ? `&v=${v}` : ""}`;

/** 素材视频海报 URL（服务端 materials/<id>/thumb.png；仅 API 相对路径） */
export const materialThumbnailUrl = (id: string, v?: number) =>
  `/api/materials/${id}/thumbnail${v ? `?v=${v}` : ""}`;

/** 项目缩略图 URL（前端渲染上传的 PNG；v 用于更新后破缓存） */
export const projectThumbnailUrl = (id: string, v?: number) =>
  `/api/projects/${id}/thumbnail${v ? `?v=${v}` : ""}`;
