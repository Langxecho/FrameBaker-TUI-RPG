import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtTask } from "./checkArt";
import type { OpenEdgeBand } from "./checkArt";
import type { VisibilityPolicy } from "./visibility";

export const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
export const STATE_PATH = join(REPO_ROOT, "docs", "her1", "state.json");

export type GunKey = "G1" | "G2" | "G3" | "G4" | "G5";

export interface GunState {
  kCode: string | null;
  label: string;
  clipPrefix: string;
  actionPrefix: string | null;
  clipTag: string | null;
  /** 薄接线只改部分相位时，这些相位指向的 tag；其余相位仍用 clipTag。 */
  phaseClipTags?: Record<string, string>;
  liveEquipment: string | null;
  her1Equipment: string[];
  note?: string;
}

export interface PackSpriteState {
  spriteId: string;
  psd: string;
  required: boolean;
  openEdge?: OpenEdgeBand;
  target:
    | { kind: "equipment-attachment"; equipment: string[]; attachmentId: string; currentMaterial: string; currentSize: [number, number] }
    | { kind: "binding-attachment"; attachmentId: string; currentMaterial: string; currentSize: [number, number] };
}

export interface PackState {
  title: string;
  priority: number;
  status: string;
  gun: GunKey;
  dir: string;
  echoPackDir: string;
  returnDir: string;
  layerName: string;
  checkHistory: Array<Record<string, unknown>>;
  /** 落地记录（ECHO 回执摘要）；只有 status=landed 时存在。 */
  landed?: Record<string, unknown>;
  sprites: PackSpriteState[];
  wiring: {
    default: "none" | "show-delivered";
    baseClipTag: string;
    suggestedTag: string;
    phases?: string[];
    show?: string[];
    showIfDelivered?: string[];
    strip?: string[];
    note?: string;
  };
}

export interface Her1State {
  schemaVersion: number;
  updatedAt: string;
  /** budgetLeft 为 null 表示 ECHO 尚未回报当前余量，见 budgetNote。 */
  echo: { mcpUrl: string; apiBase: string; projectId: string; storage: string; lastKnownRevision: number; budgetLeft: number | null; budgetNote?: string; workDir: string; machine: string };
  liaison: { role: string; agentId: string };
  phases: string[];
  guns: Record<GunKey, GunState>;
  live: { bindingMaterials: Record<string, string>; equipmentMaterials: Record<string, string>; equipment: string[]; clipTags: string[] };
  retiredClipTags: Record<string, string>;
  visibility: VisibilityPolicy;
  packs: Record<string, PackState>;
}

export function loadState(path = STATE_PATH): Her1State {
  return JSON.parse(readFileSync(path, "utf8")) as Her1State;
}

export function loadTask(state: Her1State, packId: string): ArtTask {
  const pack = state.packs[packId];
  if (!pack) throw new Error(`state.json 中没有美术包 ${packId}；可选：${Object.keys(state.packs).join("、")}`);
  return JSON.parse(readFileSync(join(REPO_ROOT, pack.dir, "_task.json"), "utf8")) as ArtTask;
}

export function clipIdFor(gun: GunState, phase: string, tag: string): string {
  return `${gun.clipPrefix}:${phase}-clip-${tag}`;
}

export function actionIdFor(gun: GunState, phase: string): string {
  if (!gun.actionPrefix) throw new Error(`${gun.label} 没有 her1bt 动作`);
  return `${gun.actionPrefix}${phase}`;
}
