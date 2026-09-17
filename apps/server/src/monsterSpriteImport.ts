/** 已有 PNG 文件夹或 ZIP → R1-A sidecar + frames/{actionId}/*.png。纯分组校验，不重新生成。 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getMaterial, uid } from "./db";
import { readPngSize } from "./jobs/spriteKey";
import { createStoreZip, listZipEntries, listZipPayloadEntries } from "./mediaPlugins/zipArchive";
import { listZipEntriesSync } from "./mediaPlugins/installer";
import { commitMonsterExtractZipMaterial } from "./monsterExtractArchive";
import {
  buildMonsterExtractSidecar,
  buildMonsterExtractZipFiles,
  toContractId,
  type MonsterExtractClipInput,
  type MonsterSpritePresentationAnchor,
  type MonsterSpritePresentationMarker,
  type MonsterSpriteExtractSidecar,
  type MonsterSpriteLoopMode,
} from "./monsterExtractZip";

export type NamedPng = { relativePath: string; bytes: Uint8Array };

export type MonsterSpriteActionSpec = {
  folder: string;
  actionId: string;
  displayName: string;
  loopMode: MonsterSpriteLoopMode;
  /** 未提供逐帧覆盖时复制到该动作的每一帧。 */
  anchors?: MonsterSpritePresentationAnchor[];
  /** 索引与导入后自然排序的帧一致。 */
  frameAnchors?: Array<MonsterSpritePresentationAnchor[] | undefined>;
  /** 仅美术时刻，不能表达命中、目标或伤害。 */
  markers?: MonsterSpritePresentationMarker[];
};

export type MonsterSpriteImportSpec = {
  displayName: string;
  projectId: string;
  sampleRateHz: number;
  defaultFacing: "left" | "right";
  objectOriginPx: { x: number; y: number };
  actions: MonsterSpriteActionSpec[];
};

export type AssembleOk = {
  ok: true;
  files: Record<string, Uint8Array>;
  sidecar: MonsterSpriteExtractSidecar;
  spec: MonsterSpriteImportSpec;
};

export type AssembleFail = { ok: false; error: string };

export type AssembleResult = AssembleOk | AssembleFail;

/** A1 目录名 → LIAF 动作；loopMode 写在表里，导入层不会按 actionId 猜测。 */
export const A1_FOLDER_PRESET: MonsterSpriteActionSpec[] = [
  { folder: "idle", actionId: "monster-01-idle", displayName: "待机", loopMode: "loop" },
  { folder: "attack", actionId: "monster-02-attack", displayName: "平A", loopMode: "once" },
  { folder: "electric_loop", actionId: "monster-03-special", displayName: "特殊攻击", loopMode: "loop" },
  { folder: "hit_received", actionId: "monster-04-hurt", displayName: "受击", loopMode: "once" },
  { folder: "death", actionId: "monster-05-death", displayName: "死亡", loopMode: "hold" },
];

const LOOP_MODES = new Set<MonsterSpriteLoopMode>(["once", "loop", "hold"]);
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
const MAX_ACTIONS = 64;
const MAX_FRAMES_PER_ACTION = 3600;
const MAX_CANVAS_DIMENSION = 2048;

function fail(error: string): AssembleFail {
  return { ok: false, error };
}

export function isSafeZipPath(name: string): boolean {
  const n = String(name ?? "").replace(/\\/g, "/");
  if (!n || n.includes("\0")) return false;
  if (n.startsWith("/") || /^[a-zA-Z]:/.test(n)) return false;
  const parts = n.split("/");
  return parts.every((p) => p.length > 0 && p !== "." && p !== "..");
}

export function pngFolderName(relativePath: string): string | null {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  parts.pop();
  while (parts.length && /^\d+fps$/i.test(parts[parts.length - 1]!)) parts.pop();
  return parts.pop() ?? null;
}

export function listPngFolders(paths: string[]): string[] {
  const set = new Set<string>();
  for (const p of paths) {
    if (!isSafeZipPath(p)) continue;
    const folder = pngFolderName(p);
    if (folder) set.add(folder);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "en"));
}

function numericIndex(filename: string): number | null {
  const base = filename.replace(/\.[^.]+$/, "");
  const matches = [...base.matchAll(/\d+/g)];
  if (!matches.length) return null;
  const n = Number(matches[matches.length - 1]![0]);
  return Number.isFinite(n) ? n : null;
}

function isPngBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && PNG_MAGIC.every((b, i) => bytes[i] === b);
}

function normalizeFolder(raw: string): string {
  return raw.replace(/\\/g, "/").split("/").filter(Boolean).pop()?.trim() ?? "";
}

function parsePresentationAnchors(raw: unknown, label: string): MonsterSpritePresentationAnchor[] | null | AssembleFail {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return fail(`${label} 的 anchors 必须是数组`);
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label} 的第 ${index + 1} 个挂点无效`);
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const x = Number(value.x);
    const y = Number(value.y);
    const directionDegrees = value.directionDegrees === undefined ? undefined : Number(value.directionDegrees);
    if (!id || !Number.isFinite(x) || !Number.isFinite(y) || (directionDegrees !== undefined && !Number.isFinite(directionDegrees))) {
      throw new Error(`${label} 的第 ${index + 1} 个挂点字段无效`);
    }
    return directionDegrees === undefined ? { id, x, y } : { id, x, y, directionDegrees };
  });
}

function parsePresentationMarkers(raw: unknown, label: string): MonsterSpritePresentationMarker[] | null | AssembleFail {
  if (raw === undefined) return null;
  if (!Array.isArray(raw)) return fail(`${label} 的 markers 必须是数组`);
  return raw.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${label} 的第 ${index + 1} 个标记无效`);
    const value = item as Record<string, unknown>;
    const id = typeof value.id === "string" ? value.id.trim() : "";
    const atMs = Number(value.atMs);
    if (!id || !Number.isInteger(atMs) || value.presentationOnly !== true) {
      throw new Error(`${label} 的第 ${index + 1} 个标记必须含整数 atMs 且 presentationOnly 为 true`);
    }
    return { id, atMs, presentationOnly: true };
  });
}

export function parseMonsterSpriteImportSpec(raw: unknown): { ok: true; spec: MonsterSpriteImportSpec } | AssembleFail {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return fail("spec 不是合法 JSON");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("缺少 spec");
  const o = value as Record<string, unknown>;
  const displayName = typeof o.displayName === "string" ? o.displayName.trim().slice(0, 120) : "";
  const projectId = typeof o.projectId === "string" ? o.projectId.trim().slice(0, 96) : "";
  const sampleRateHz = Number(o.sampleRateHz);
  const defaultFacing = o.defaultFacing === "right" ? "right" as const : o.defaultFacing === "left" ? "left" as const : null;
  const origin = o.objectOriginPx && typeof o.objectOriginPx === "object" && !Array.isArray(o.objectOriginPx)
    ? o.objectOriginPx as Record<string, unknown>
    : null;
  const ox = origin ? Number(origin.x) : NaN;
  const oy = origin ? Number(origin.y) : NaN;
  if (!displayName) return fail("请填写 displayName");
  if (!projectId) return fail("请填写 projectId");
  if (sampleRateHz !== 24) return fail("sampleRateHz 必须是 24");
  if (!defaultFacing) return fail("请显式指定 defaultFacing（left 或 right）");
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return fail("请显式指定 objectOriginPx");
  if (!Array.isArray(o.actions) || o.actions.length < 1) return fail("请至少映射一个动作文件夹");
  if (o.actions.length > MAX_ACTIONS) return fail(`动作数量不能超过 ${MAX_ACTIONS}`);

  const actions: MonsterSpriteActionSpec[] = [];
  const folders = new Set<string>();
  const actionIds = new Set<string>();
  for (const item of o.actions) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail("动作映射无效");
    const row = item as Record<string, unknown>;
    const folder = typeof row.folder === "string" ? normalizeFolder(row.folder) : "";
    const actionId = typeof row.actionId === "string" ? row.actionId.trim() : "";
    const display = typeof row.displayName === "string" ? row.displayName.trim().slice(0, 120) : "";
    const loopMode = row.loopMode;
    if (!folder) return fail("动作映射缺少 folder");
    if (!actionId) return fail(`文件夹 ${folder} 缺少 actionId`);
    if (!LOOP_MODES.has(loopMode as MonsterSpriteLoopMode)) {
      return fail(`文件夹 ${folder} 必须显式指定 loopMode（once / loop / hold）`);
    }
    if (folders.has(folder)) return fail(`文件夹 ${folder} 重复映射`);
    const contractActionId = toContractId(actionId);
    if (actionIds.has(contractActionId)) {
      return fail(`actionId ${actionId} 与已有动作规范化后重复（${contractActionId}）`);
    }
    folders.add(folder);
    actionIds.add(contractActionId);
    try {
      const anchors = parsePresentationAnchors(row.anchors, `文件夹 ${folder}`);
      if (anchors && "error" in anchors) return anchors;
      const markers = parsePresentationMarkers(row.markers, `文件夹 ${folder}`);
      if (markers && "error" in markers) return markers;
      let frameAnchors: Array<MonsterSpritePresentationAnchor[] | undefined> | undefined;
      if (row.frameAnchors !== undefined) {
        if (!Array.isArray(row.frameAnchors)) return fail(`文件夹 ${folder} 的 frameAnchors 必须是数组`);
        frameAnchors = [];
        for (const [index, item] of row.frameAnchors.entries()) {
          const parsed = parsePresentationAnchors(item, `文件夹 ${folder} 的第 ${index + 1} 帧`);
          if (parsed && "error" in parsed) return parsed;
          frameAnchors.push(parsed ?? undefined);
        }
      }
      actions.push({
        folder,
        actionId,
        displayName: display || actionId,
        loopMode: loopMode as MonsterSpriteLoopMode,
        anchors: anchors ?? undefined,
        frameAnchors,
        markers: markers ?? undefined,
      });
    } catch (error) {
      return fail(error instanceof Error ? error.message : `文件夹 ${folder} 的表现数据无效`);
    }
  }
  return {
    ok: true,
    spec: {
      displayName,
      projectId,
      sampleRateHz: 24,
      defaultFacing,
      objectOriginPx: { x: Math.round(ox), y: Math.round(oy) },
      actions,
    },
  };
}

export function assembleMonsterSpriteExtract(opts: {
  pngs: NamedPng[];
  spec: MonsterSpriteImportSpec;
  exportId?: string;
  toolVersion?: string;
  exportedAt?: string;
}): AssembleResult {
  const parsed = parseMonsterSpriteImportSpec(opts.spec);
  if (!parsed.ok) return parsed;
  const spec = parsed.spec;

  for (const png of opts.pngs) {
    if (!isSafeZipPath(png.relativePath)) return fail(`不安全的路径：${png.relativePath}`);
  }

  const clips: MonsterExtractClipInput[] = [];
  for (const action of spec.actions) {
    const group = opts.pngs.filter((p) => pngFolderName(p.relativePath) === action.folder && isPngBytes(p.bytes));
    if (!group.length) return fail(`文件夹 ${action.folder} 没有 PNG`);
    const keyed: { index: number; bytes: Uint8Array; name: string }[] = [];
    for (const item of group) {
      const name = item.relativePath.replace(/\\/g, "/").split("/").pop() ?? "";
      const index = numericIndex(name);
      if (index === null) return fail(`${item.relativePath} 文件名缺少自然序号`);
      keyed.push({ index, bytes: item.bytes, name });
    }
    keyed.sort((a, b) => a.index - b.index || a.name.localeCompare(b.name, "en"));
    if (keyed.length > MAX_FRAMES_PER_ACTION) {
      return fail(`文件夹 ${action.folder} 帧数不能超过 ${MAX_FRAMES_PER_ACTION}`);
    }
    clips.push({
      actionId: action.actionId,
      actionTitle: action.displayName,
      fps: 24,
      frames: keyed.map((k) => k.bytes),
      loopMode: action.loopMode,
      anchors: action.anchors,
      frameAnchors: action.frameAnchors,
      markers: action.markers,
    });
  }

  let canvas: { width: number; height: number } | null = null;
  for (const clip of clips) {
    for (const frame of clip.frames) {
      const size = readPngSize(frame);
      if (!size) return fail("PNG 无法读取宽高");
      if (size.width > MAX_CANVAS_DIMENSION || size.height > MAX_CANVAS_DIMENSION) {
        return fail(`PNG 画布不能超过 ${MAX_CANVAS_DIMENSION}×${MAX_CANVAS_DIMENSION}`);
      }
      if (!canvas) canvas = size;
      else if (size.width !== canvas.width || size.height !== canvas.height) return fail("所有帧必须同一画布尺寸");
    }
  }
  if (!canvas) return fail("没有有效 PNG");
  const { x, y } = spec.objectOriginPx;
  if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) {
    return fail(`objectOriginPx 超出画布 ${canvas.width}×${canvas.height}`);
  }

  const files = buildMonsterExtractZipFiles(clips);
  let sidecar: MonsterSpriteExtractSidecar;
  try {
    sidecar = buildMonsterExtractSidecar({
      displayName: spec.displayName,
      projectId: spec.projectId,
      exportId: opts.exportId ?? "import",
      toolVersion: opts.toolVersion ?? "0.4.0",
      exportedAt: opts.exportedAt ?? new Date().toISOString(),
      canvas,
      clips,
      objectOriginPx: spec.objectOriginPx,
      defaultFacing: spec.defaultFacing,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "无法构建表现 sidecar");
  }
  return { ok: true, files, sidecar, spec };
}

export function attachMonsterExtractSidecarFiles(
  assembled: AssembleOk,
  meta: { exportId: string; toolVersion: string; exportedAt: string },
): Record<string, Uint8Array> {
  const sidecar: MonsterSpriteExtractSidecar = {
    ...assembled.sidecar,
    source: {
      ...assembled.sidecar.source,
      exportId: assembled.sidecar.source.exportId && meta.exportId
        ? assembled.sidecar.source.exportId
        : assembled.sidecar.source.exportId,
      toolVersion: meta.toolVersion.slice(0, 64) || assembled.sidecar.source.toolVersion,
      exportedAt: meta.exportedAt,
    },
  };
  sidecar.source.exportId = meta.exportId.slice(0, 96);
  sidecar.source.toolVersion = meta.toolVersion.slice(0, 64) || "0.4.0";
  const files = { ...assembled.files };
  files["sidecar.json"] = new TextEncoder().encode(`${JSON.stringify(sidecar, null, 2)}\n`);
  return files;
}

export async function pngsFromZip(zipBytes: Uint8Array): Promise<{ ok: true; pngs: NamedPng[] } | AssembleFail> {
  let entries: { name: string; data: Uint8Array }[];
  const limits = { maxEntries: 16384, maxUncompressedBytes: 2 * 1024 * 1024 * 1024 };
  try {
    entries = listZipPayloadEntries(zipBytes, limits);
  } catch (first) {
    try {
      entries = listZipEntriesSync(zipBytes, {
        maxEntries: limits.maxEntries,
        maxCompressedBytes: 512 * 1024 * 1024,
        maxUncompressedBytes: limits.maxUncompressedBytes,
      });
    } catch {
      try {
        entries = await listZipEntries(zipBytes);
      } catch {
        const detail = first instanceof Error ? first.message : "格式不支持";
        return fail(`无法读取 ZIP：${detail}`);
      }
    }
  }
  const pngs: NamedPng[] = [];
  for (const entry of entries) {
    if (!isSafeZipPath(entry.name)) return fail(`不安全的路径：${entry.name}`);
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith(".png")) continue;
    pngs.push({ relativePath: entry.name.replace(/\\/g, "/"), bytes: entry.data });
  }
  if (!pngs.length) return fail("ZIP 里没有 PNG");
  return { ok: true, pngs };
}

export async function assembleMonsterSpriteExtractFromZip(
  zipBytes: Uint8Array,
  spec: MonsterSpriteImportSpec,
): Promise<AssembleResult> {
  const listed = await pngsFromZip(zipBytes);
  if (!listed.ok) return listed;
  return assembleMonsterSpriteExtract({ pngs: listed.pngs, spec });
}

function toolVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8")) as { version?: string };
    return pkg.version?.slice(0, 64) || "0.4.0";
  } catch {
    return "0.4.0";
  }
}

export async function importMonsterSpriteExtract(opts: {
  zipBytes: Uint8Array;
  spec: unknown;
  folderId?: string | null;
}): Promise<{ materialId: string } | AssembleFail> {
  const parsed = parseMonsterSpriteImportSpec(opts.spec);
  if (!parsed.ok) return parsed;
  const assembled = await assembleMonsterSpriteExtractFromZip(opts.zipBytes, parsed.spec);
  if (!assembled.ok) return assembled;
  const exportId = uid();
  const files = attachMonsterExtractSidecarFiles(assembled, {
    exportId,
    toolVersion: toolVersion(),
    exportedAt: new Date().toISOString(),
  });
  const bytes = createStoreZip(files);
  const materialId = commitMonsterExtractZipMaterial({
    bytes,
    name: `${parsed.spec.displayName} 拆帧包`,
    folderId: opts.folderId ?? null,
    source: "extract",
    metadata: {
      mediaKind: "archive",
      format: "framebaker.monster-sprite-extract",
      schemaVersion: 1,
      notAMonsterPackage: true,
      importKind: "png-folders",
      displayName: parsed.spec.displayName,
    },
  });
  return { materialId };
}

export async function importMonsterSpriteExtractFromMaterial(opts: {
  sourceMaterialId: string;
  spec: unknown;
  folderId?: string | null;
}): Promise<{ materialId: string } | AssembleFail> {
  const m = getMaterial(opts.sourceMaterialId);
  if (!m) return fail("素材不存在");
  const path = m.raw_path;
  if (!path || !existsSync(path)) return fail("素材文件不存在");
  const zipBytes = new Uint8Array(readFileSync(path));
  return importMonsterSpriteExtract({ zipBytes, spec: opts.spec, folderId: opts.folderId ?? m.folder_id });
}
