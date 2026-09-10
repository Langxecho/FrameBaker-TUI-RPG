import type { MonsterActionId } from "@framebaker/shared";

export type MonsterPipelineStep =
  | { type: "reference" }
  | { type: "still"; actionId: MonsterActionId }
  | { type: "video"; actionId: MonsterActionId }
  | { type: "extract"; actionId: MonsterActionId; fps: number };

export interface MonsterPipelineAction {
  id: MonsterActionId;
  title: string;
  prompt: string;
  videoPrompt?: string;
}

export interface MonsterPipelineRun {
  pipelineId: string;
  appearance: string;
  name: string;
  folderId: string | null;
  providerId?: string;
  model?: string;
  size?: string;
  videoPluginId: string | null;
  durationSeconds: number;
  extractFps: number[];
  autoMatting: boolean;
  bgKey: "flood" | "none";
  importProjectId?: string | null;
  spriteFit: { width: number; height: number };
  actions: MonsterPipelineAction[];
  referenceMaterialId?: string;
  actionStillIds: Record<string, string>;
  actionVideoIds: Record<string, string>;
  /** 拆帧产物：`actionId:fps` → 素材或项目帧 ID */
  extractFrameIds: Record<string, string[]>;
  archiveMaterialId?: string;
  cursor: number;
}
