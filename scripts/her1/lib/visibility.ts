import type { AnyMotionTrack, MotionClip, Vec3 } from "../../../packages/shared/src/animation";
import { ATTACHMENT_TARGET_PREFIX } from "../../../packages/shared/src/animation";
import type { SkeletalProjectDocument } from "../../../packages/shared/src/skeletalProject";

export interface VisibilityPolicy {
  hideScaleThreshold: number;
  translateFarLimit: number;
  showOverscaleLimit: number;
  hideScaleAllowlist: string[];
  hideScaleForbidden: string[];
  stripOnlyPatterns: string[];
}

export interface VisibilityIssue {
  severity: "error" | "warning";
  code: "TRANSLATE_FAR" | "HIDE_SCALE_ON_REST_HIDDEN" | "HIDE_SCALE_FORBIDDEN" | "HIDE_SCALE_STRIP_ONLY" | "HIDE_SCALE_UNVERIFIED" | "SHOW_OVERSCALE" | "UNKNOWN_ATTACHMENT";
  clipId: string;
  attachmentId: string;
  time?: number;
  detail: string;
}

/** 附件 id → binding/装备中的 rest.scale；装备附件 id 自带装备前缀，可与 binding 共表。 */
export function collectRestScales(document: SkeletalProjectDocument): Map<string, Vec3> {
  const map = new Map<string, Vec3>();
  for (const attachment of document.character?.binding.attachments ?? []) map.set(attachment.id, attachment.rest.scale);
  for (const equipment of document.equipment ?? []) for (const attachment of equipment.attachments) if (!map.has(attachment.id)) map.set(attachment.id, attachment.rest.scale);
  return map;
}

function attachmentIdOf(track: AnyMotionTrack): string | null {
  return track.targetId.startsWith(ATTACHMENT_TARGET_PREFIX) ? track.targetId.slice(ATTACHMENT_TARGET_PREFIX.length) : null;
}

const minXY = (v: readonly number[]) => Math.min(Math.abs(v[0]), Math.abs(v[1]));
const restHidden = (rest: Vec3) => minXY(rest) <= 0.01;

/** 按 Region 显隐规范审计一条 clip 的 att: 轨（skill/fb-character-authoring/references/region-visibility.md）。 */
export function auditClipVisibility(clip: MotionClip, restScales: Map<string, Vec3>, policy: VisibilityPolicy): VisibilityIssue[] {
  const issues: VisibilityIssue[] = [];
  for (const track of clip.tracks as AnyMotionTrack[]) {
    const attachmentId = attachmentIdOf(track);
    if (!attachmentId) continue;
    const rest = restScales.get(attachmentId);
    if (!rest) {
      issues.push({ severity: "warning", code: "UNKNOWN_ATTACHMENT", clipId: clip.id, attachmentId, detail: "轨道目标不在 binding/装备附件中" });
      continue;
    }
    if (track.property === "translation") {
      for (const key of track.keyframes) {
        const v = key.value as number[];
        if (Math.abs(v[0]) >= policy.translateFarLimit || Math.abs(v[1]) >= policy.translateFarLimit) {
          issues.push({ severity: "error", code: "TRANSLATE_FAR", clipId: clip.id, attachmentId, time: key.time, detail: `平移 [${v.join(",")}] 属于 translate-far 藏层，禁止` });
        }
      }
      continue;
    }
    if (track.property !== "scale") continue;
    for (const key of track.keyframes) {
      const v = key.value as number[];
      const effective = Math.max(Math.abs(v[0] * rest[0]), Math.abs(v[1] * rest[1]));
      if (effective > policy.showOverscaleLimit) {
        issues.push({ severity: "error", code: "SHOW_OVERSCALE", clipId: clip.id, attachmentId, time: key.time, detail: `有效缩放 ${effective.toFixed(3)}（rest ${rest.join(",")} × clip ${v.join(",")}）；SHOW 只能把 rest 0.001 还原到 1` });
      }
      if (minXY(v) > policy.hideScaleThreshold) continue;
      if (restHidden(rest)) {
        issues.push({ severity: "error", code: "HIDE_SCALE_ON_REST_HIDDEN", clipId: clip.id, attachmentId, time: key.time, detail: "rest 已隐藏仍写 HIDE-scale；改为 STRIP 或 IDENT [1,1,1]" });
      } else if (policy.hideScaleForbidden.includes(attachmentId)) {
        issues.push({ severity: "error", code: "HIDE_SCALE_FORBIDDEN", clipId: clip.id, attachmentId, time: key.time, detail: "该附件 clip 0.001 会 PREVIEW_RENDER_FAILED" });
      } else if (policy.stripOnlyPatterns.some((pattern) => attachmentId.includes(pattern))) {
        issues.push({ severity: "error", code: "HIDE_SCALE_STRIP_ONLY", clipId: clip.id, attachmentId, time: key.time, detail: "该类附件只能 STRIP，不能 HIDE-scale" });
      } else if (!policy.hideScaleAllowlist.includes(attachmentId)) {
        issues.push({ severity: "warning", code: "HIDE_SCALE_UNVERIFIED", clipId: clip.id, attachmentId, time: key.time, detail: "rest 可见的附件用 clip 缩小隐藏；不在已验证例外名单内，需渲染证据" });
      }
    }
  }
  return issues;
}

export interface WiringSpec {
  newClipId: string;
  newClipName?: string;
  show: string[];
  strip: string[];
}

function showValue(rest: Vec3): Vec3 {
  return [rest[0] === 0 ? 1 : 1 / rest[0], rest[1] === 0 ? 1 : 1 / rest[1], rest[2] === 0 ? 1 : 1 / rest[2]].map((v) => Math.round(v * 1e6) / 1e6) as Vec3;
}

/** 从基线 clip 派生加性新 clip：STRIP 指定附件的 scale 轨，给 show 附件写整段常量 SHOW；其余轨道原样保留。 */
export function deriveWiringClip(base: MotionClip, spec: WiringSpec, restScales: Map<string, Vec3>): MotionClip {
  if (spec.newClipId === base.id) throw new Error("薄接线必须写新 clip id，不能原地改基线");
  for (const id of [...spec.show, ...spec.strip]) {
    if (!restScales.has(id)) throw new Error(`附件「${id}」不在 binding/装备中`);
    if (!id.includes("her1")) throw new Error(`附件「${id}」不是加性 her1 对象，禁止接线改动`);
  }
  const overlap = spec.show.filter((id) => spec.strip.includes(id));
  if (overlap.length) throw new Error(`同一附件不能同时 SHOW 与 STRIP：${overlap.join("、")}`);
  const touched = new Set([...spec.show, ...spec.strip]);
  const clip = structuredClone(base) as MotionClip;
  const kept = (clip.tracks as AnyMotionTrack[]).filter((track) => {
    const id = attachmentIdOf(track);
    return !(id && touched.has(id) && track.property === "scale");
  });
  const duration = Math.max(clip.duration, 0);
  for (const id of spec.show) {
    const rest = restScales.get(id)!;
    if (!restHidden(rest)) throw new Error(`附件「${id}」rest.scale=${rest.join(",")} 默认可见，不需要 SHOW`);
    const value = showValue(rest);
    const times = duration > 0 ? [0, duration] : [0];
    if (clip.schemaVersion === 2) {
      kept.push({ targetId: `${ATTACHMENT_TARGET_PREFIX}${id}`, property: "scale", keyframes: times.map((time, index) => ({ time, value: [...value] as Vec3, outInterpolation: index === times.length - 1 ? null : { type: "step" as const } })) });
    } else {
      kept.push({ targetId: `${ATTACHMENT_TARGET_PREFIX}${id}`, property: "scale", interpolation: "step", keyframes: times.map((time) => ({ time, value: [...value] as Vec3 })) });
    }
  }
  return { ...clip, id: spec.newClipId, name: spec.newClipName ?? spec.newClipId, tracks: kept } as MotionClip;
}
