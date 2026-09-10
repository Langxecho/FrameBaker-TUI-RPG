/** 怪物逐帧流水线：全身朝左静图 → 图生视频 → 拆帧。背景一律透明，禁止品红底。 */

export const MONSTER_REFERENCE_STEM = "monster-00-reference";
export const MONSTER_DEFAULT_WIDTH = 256;
export const MONSTER_DEFAULT_HEIGHT = 256;
export const MONSTER_DEFAULT_SIZE = "256x256";
export const MONSTER_SIZE_MIN = 64;
export const MONSTER_SIZE_MAX = 2048;
export const MONSTER_DEFAULT_EXTRACT_FPS = [4] as const;
export const MONSTER_DEFAULT_DURATION_SECONDS = 4;
export const MONSTER_DEFAULT_VIDEO_PLUGIN_ID = "minimax-h3-t8-i2v";
export const MONSTER_IMAGE_PROVIDER_ID = "monster-image";
export const MONSTER_IMAGE_PLUGIN_ID = "euzhi_gpt_image2";
export const MONSTER_IMAGE_DEFAULT_BASE_URL = "https://euzhi.vip/v1";
export const MONSTER_IMAGE_DEFAULT_MODEL = "gpt-image-2";
export const MONSTER_IMAGE_API_SIZE = "1024x1024";
export const MONSTER_SPRITE_FIT = { width: 256, height: 256 } as const;

/** OpenAI 兼容生图的 Base URL：不要带 /images/generations，服务端会自己拼。 */
export function normalizeMonsterImageBaseUrl(raw: string | null | undefined): string {
  let url = String(raw ?? "").trim().replace(/\/+$/, "");
  url = url.replace(/\/images\/(?:generations|edits)$/i, "");
  return url.replace(/\/+$/, "");
}

export const MONSTER_TRANSPARENT_BG =
  "fully transparent background with a real alpha channel; isolate the subject; no magenta, no #FF00FF, no solid color fill, no checkerboard, no studio backdrop, no floor, no scenery";

export const MONSTER_ACTIONS = [
  {
    id: "monster-01-idle",
    title: "待机",
    lock: "neutral idle keyframe, settled and readable, full body facing LEFT",
  },
  {
    id: "monster-02-attack",
    title: "平A",
    lock: "basic melee attack keyframe (wind-up or strike), same monster, full body facing LEFT, readable silhouette for image-to-video",
  },
  {
    id: "monster-03-special",
    title: "特殊攻击",
    lock: "special / charged attack keyframe, more telegraphed than the basic attack, same monster, full body facing LEFT",
  },
  {
    id: "monster-04-hurt",
    title: "受击",
    lock: "hit-reaction keyframe, flinch or recoil, same unit still intact, full body facing LEFT",
  },
  {
    id: "monster-05-death",
    title: "死亡",
    lock: "intact hovering start pose for a death clip, still complete, not wrecked, same unit identity, full body facing LEFT, entire subject still visible",
  },
] as const;

export type MonsterActionId = (typeof MONSTER_ACTIONS)[number]["id"];
export const MONSTER_IDLE_ACTION_ID: MonsterActionId = "monster-01-idle";

const REFERENCE_LOCK =
  "Full-body identity keyframe, facing LEFT. Neutral idle that matches the design: a flying machine HOVERS in mid-air with rotors or thrusters visible; otherwise a calm idle. Entire unit visible, hard-edged game sprite.";

const ACTION_REFERENCE_HINT =
  "PRIMARY: keep the exact design from the attached reference. Same silhouette, colors, parts, materials, and facing LEFT. Change only the pose and action. Fully transparent background.";

export function monsterActionById(id: string): (typeof MONSTER_ACTIONS)[number] | undefined {
  return MONSTER_ACTIONS.find((action) => action.id === id);
}

export function buildMonsterReferencePrompt(appearance: string | null | undefined): string {
  const body = (appearance || "").trim();
  const lock = `${REFERENCE_LOCK} ${MONSTER_TRANSPARENT_BG}.`;
  if (body) return `${body}\n\n${lock}`;
  return lock;
}

export function buildMonsterActionStillPrompt(input: {
  appearance?: string | null;
  actionPrompt?: string | null;
  hasReference?: boolean;
  actionId: string;
}): string {
  const action = monsterActionById(input.actionId);
  const chunks: string[] = [];
  const title = action?.title ?? "动作";
  const lock = action?.lock ?? "full-body keyframe facing LEFT";
  chunks.push(
    `CRITICAL TASK: full-body ${input.actionId} keyframe (${title}). ${lock}. Facing LEFT. Same unit as the reference. This still is for image-to-video. ${MONSTER_TRANSPARENT_BG}.`,
  );
  const typed = (input.actionPrompt || "").trim();
  if (typed) chunks.push(typed);
  const look = (input.appearance || "").trim();
  if (look && !input.hasReference) chunks.push(`APPEARANCE LOCK:\n${look}`);
  if (input.hasReference) chunks.push(ACTION_REFERENCE_HINT);
  return chunks.join("\n\n");
}

export function clampMonsterPixel(value: unknown, fallback = MONSTER_DEFAULT_WIDTH): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MONSTER_SIZE_MIN, Math.min(MONSTER_SIZE_MAX, n));
}

/** 把宽高编成各家生图 API 能吃的 size 字符串；Gemini/MiniMax 只认比例，像素由拆帧贴画保证。 */
export function formatMonsterImageSize(width: number, height: number, providerType?: string | null): string {
  const w = clampMonsterPixel(width);
  const h = clampMonsterPixel(height);
  if (providerType === "dashscope") return `${w}*${h}`;
  if (providerType === "gemini" || providerType === "minimax") {
    const ratio = w / Math.max(h, 1);
    if (Math.abs(ratio - 1) < 0.08) return "1:1";
    if (ratio >= 1.6) return "16:9";
    if (ratio <= 0.62) return "9:16";
    if (ratio > 1) return "3:2";
    return "2:3";
  }
  return `${w}x${h}`;
}

export function collectFilledMonsterJobs(
  actionPrompts: Array<string | null | undefined> | Record<string, string | null | undefined>,
  videoPrompts?: Array<string | null | undefined> | Record<string, string | null | undefined>,
): Array<{ id: MonsterActionId; title: string; prompt: string; videoPrompt?: string }> {
  const stills = Array.isArray(actionPrompts)
    ? actionPrompts
    : MONSTER_ACTIONS.map((action) => actionPrompts[action.id]);
  const videos = Array.isArray(videoPrompts)
    ? videoPrompts
    : MONSTER_ACTIONS.map((action) => videoPrompts?.[action.id]);
  const jobs: Array<{ id: MonsterActionId; title: string; prompt: string; videoPrompt?: string }> = [];
  for (let index = 0; index < MONSTER_ACTIONS.length; index++) {
    const action = MONSTER_ACTIONS[index]!;
    const prompt = String(stills[index] || "").trim();
    const videoPrompt = String(videos[index] || "").trim();
    if (!prompt && !videoPrompt) continue;
    jobs.push({
      id: action.id,
      title: action.title,
      prompt,
      ...(videoPrompt ? { videoPrompt } : {}),
    });
  }
  return jobs;
}

/** 图生视频时把待机放到最前；未填待机也会补一条空槽，用于生成待机关键帧当所有视频的首帧。 */
export function ensureMonsterIdleJob(
  jobs: Array<{ id: MonsterActionId; title: string; prompt: string; videoPrompt?: string }>,
): Array<{ id: MonsterActionId; title: string; prompt: string; videoPrompt?: string }> {
  const idle = MONSTER_ACTIONS[0]!;
  const existing = jobs.find((job) => job.id === idle.id);
  const rest = jobs.filter((job) => job.id !== idle.id);
  return [existing ?? { id: idle.id, title: idle.title, prompt: "" }, ...rest];
}

export function buildMonsterH3I2vaPrompt(input: {
  actionId: string;
  actionPrompt?: string | null;
  durationSeconds?: number;
}): string {
  const action = monsterActionById(input.actionId);
  const lock = action?.lock ?? "full-body action facing LEFT";
  const extra = (input.actionPrompt || "").trim();
  const seconds = Math.max(4, Math.min(15, input.durationSeconds ?? MONSTER_DEFAULT_DURATION_SECONDS));
  const motion = extra || lock;
  return [
    "For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.",
    "",
    `integrated_multimodal_description: [Shot 1] Pixel-art game enemy unit. <Picture 1> is the idle standing still. Keep the exact identity, silhouette, colors, and LEFT-facing. Begin in that idle pose, then ${motion}. Full body stays inside the frame with a locked camera at slow speed and small amplitude. Isolated subject on an empty void so every frame can be keyed to transparency. Duration about ${seconds.toFixed(1)} seconds. No text, logo, or watermark.`,
    "",
    "overall_soundscape: Soft mechanical or creature movement only; no crowd, no music bleed.",
    "",
    "non_diegetic_music: N/A",
  ].join("\n");
}

export function parseMonsterExtractFps(selected: Iterable<number | string> | null | undefined, extra?: number | null): number[] {
  const values: number[] = [];
  const seen = new Set<number>();
  const add = (raw: unknown) => {
    const number = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(number)) return;
    const fps = Math.round(number);
    if (fps < 1 || fps > 60 || seen.has(fps)) return;
    seen.add(fps);
    values.push(fps);
  };
  for (const item of selected ?? []) add(item);
  if (extra != null) add(extra);
  return values;
}
