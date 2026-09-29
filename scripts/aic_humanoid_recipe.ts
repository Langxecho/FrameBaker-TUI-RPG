/**
 * Reproducible D1 authoring recipe through the public MCP surface only.
 * Uses an existing generated 4x4 part-sheet material, not fabricated textures.
 * No DB access, runtime animation math, combat calculation or paid generation.
 *
 * bun scripts/aic_humanoid_recipe.ts --material <id> --url http://127.0.0.1:3025
 * Repeat with --variant to widen the torso without regenerating other assets.
 * Optional bounds: --max-calls N --max-wall-ms N --max-response-bytes N.
 * Optional --magenta-despill 0..100 requires a fresh --out directory when changed.
 * --seed-checkpoint <recipe-state.json> reuses published identities in a new output directory.
 * Outputs/checkpoints are local evidence under ignored storage/aic-runs/.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { CharacterBinding, MotionClip, Skeleton, Transform } from "@framebaker/shared";
import { createBudget, parseLimit, type BudgetState } from "./aic_recipe_budget";

const values = new Map<string, string>();
let variant = false;
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]!;
  if (key === "--variant") { variant = true; continue; }
  if (!["--material", "--url", "--out", "--seed-checkpoint", "--max-calls", "--max-wall-ms", "--max-response-bytes", "--magenta-despill"].includes(key) || values.has(key) || !process.argv[i + 1]) throw new Error(`Invalid argument: ${key}`);
  values.set(key, process.argv[++i]!);
}
const materialId = values.get("--material");
if (!materialId) throw new Error("--material <existing 4x4 generated sheet ID> is required");
const magentaDespill = Number(values.get("--magenta-despill") ?? 0);
if (!Number.isInteger(magentaDespill) || magentaDespill < 0 || magentaDespill > 100) throw new Error("--magenta-despill must be an integer from 0 to 100");
const base = new URL(values.get("--url") ?? "http://127.0.0.1:3025");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password) throw new Error("Recipe is local-development only");
const out = resolve(values.get("--out") ?? "storage/aic-runs/humanoid-d1");
mkdirSync(out, { recursive: true });
const checkpoint = join(out, "recipe-state.json");
type State = { materialId: string; magentaDespill?: number; projectId?: string; split?: any; base?: any; variant?: any; calls?: number; budget?: BudgetState; seedSource?: { checkpointPath: string; checkpointSha256: string; projectId: string; baseDigest: string; variantDigest: string; inheritedCost: "unknown" } };
const seedPath = values.get("--seed-checkpoint");
if (seedPath && existsSync(checkpoint)) throw new Error("--seed-checkpoint requires a new output directory");
const resolvedSeedPath = seedPath ? resolve(seedPath) : undefined;
const seedBytes = resolvedSeedPath ? readFileSync(resolvedSeedPath) : undefined;
const seed: State | undefined = seedBytes ? JSON.parse(seedBytes.toString("utf8")) : undefined;
if (seed && (seed.materialId !== materialId || !seed.projectId || !seed.split || !seed.base || !seed.variant)) throw new Error("Seed checkpoint is incomplete or belongs to another material");
if (seed && (seed.magentaDespill ?? 0) !== magentaDespill) throw new Error("Seed checkpoint uses different chroma cleanup settings");
const state: State = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, "utf8")) : seed
  ? { materialId, magentaDespill, projectId: seed.projectId, split: seed.split, base: seed.base, variant: seed.variant, seedSource: { checkpointPath: resolvedSeedPath!, checkpointSha256: createHash("sha256").update(seedBytes!).digest("hex"), projectId: seed.projectId!, baseDigest: seed.base!.digest, variantDigest: seed.variant!.digest, inheritedCost: "unknown" } }
  : { materialId, magentaDespill };
if (state.materialId !== materialId) throw new Error("Checkpoint belongs to another source material");
if ((state.magentaDespill ?? 0) !== magentaDespill) throw new Error("Checkpoint uses different chroma cleanup settings; use a new output directory");
function save() { writeFileSync(`${checkpoint}.tmp`, JSON.stringify(state, null, 2)); renameSync(`${checkpoint}.tmp`, checkpoint); }
const maxCalls = parseLimit(values.get("--max-calls"), "--max-calls");
const maxWallMs = parseLimit(values.get("--max-wall-ms"), "--max-wall-ms");
const maxResponseBytes = parseLimit(values.get("--max-response-bytes"), "--max-response-bytes");
const budget = createBudget(state, {
  ...(maxCalls === undefined ? {} : { maxCalls }),
  ...(maxWallMs === undefined ? {} : { maxWallMs }),
  ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
}, save);
let requestId = 1;
async function mcp(name: string, args: Record<string, unknown>) {
  return budget.run(name, (signal) => fetch(new URL("/mcp", base), { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method: "tools/call", params: { name, arguments: args } }), signal }), (bytes) => {
    const body = Buffer.from(bytes).toString("utf8");
    const line = body.split("\n").find((item) => item.startsWith("data: "));
    const envelope = JSON.parse(line ? line.slice(6) : body);
    if (envelope.error || envelope.result?.isError) throw new Error("MCP tool failed");
    const content = envelope.result?.content?.find((item: any) => item.type === "text")?.text;
    if (!content) throw new Error("missing structured response");
    return JSON.parse(content);
  });
}
const partNames = ["head", "torso", "pelvis", "sword", "upper_arm_left", "upper_arm_right", "forearm_left", "forearm_right", "thigh_left", "thigh_right", "shin_left", "shin_right", "foot_left", "foot_right", "hand_left", "hand_right"];
if (!state.split) {
  state.split = await mcp("split_material_parts", { materialId, rows: 4, cols: 4, keyColor: [255, 0, 255], tolerance: 100, ...(magentaDespill ? { magentaDespill } : {}), idempotencyKey: `aic-humanoid-d1-parts-v1${magentaDespill ? `-despill-${magentaDespill}` : ""}`, parts: partNames.map((name, cell) => ({ name, cell })) });
  save();
}
const parts = new Map<string, string>(state.split.parts.map((part: any) => [part.name, part.materialId]));
for (const name of partNames) if (!parts.has(name)) throw new Error(`Splitter result missing ${name}`);
const projectName = `AIC D1 neutral humanoid ${materialId}${magentaDespill ? ` despill ${magentaDespill}` : ""}`;
if (!state.projectId) {
  const existing = (await mcp("list_projects", {})).projects.filter((p: any) => p.name === projectName && p.kind === "skeletal");
  if (existing.length > 1) throw new Error("Ambiguous recovery project name");
  state.projectId = existing[0]?.id ?? (await mcp("create_project", { name: projectName, kind: "skeletal" })).id;
  save();
}
const projectId = state.projectId!;
const suffix = projectId.slice(0, 8);
const skeletonId = `aic-skeleton-${suffix}`;
const bindingId = `aic-binding-${suffix}`;
const bodyId = `aic-body-${suffix}`;
const q = (degrees: number): [number, number, number, number] => [0, 0, Math.sin(degrees * Math.PI / 360), Math.cos(degrees * Math.PI / 360)];
const tr = (x = 0, y = 0, degrees = 0): Transform => ({ translation: [x, y, 0], rotation: q(degrees), scale: [1, 1, 1] });
const bones: Skeleton["bones"] = [
  { id: "root", name: "Root", parentId: null, rest: tr() },
  { id: "hip", name: "Pelvis", parentId: "root", rest: tr(0, 44), semantic: "pelvis" },
  { id: "chest", name: "Chest", parentId: "hip", rest: tr(0, 13), semantic: "chest" },
  { id: "head", name: "Head", parentId: "chest", rest: tr(0, 30), semantic: "head" },
];
for (const [side, sign] of [["left", -1], ["right", 1]] as const) {
  bones.push(
    { id: `upper_arm_${side}`, name: `${side} upper arm`, parentId: "chest", rest: tr(sign * 17, 24), tipOffset: [0, -21, 0] },
    { id: `forearm_${side}`, name: `${side} forearm`, parentId: `upper_arm_${side}`, rest: tr(0, -19), tipOffset: [0, -20, 0] },
    { id: `hand_${side}`, name: `${side} hand`, parentId: `forearm_${side}`, rest: tr(0, -18) },
    { id: `thigh_${side}`, name: `${side} thigh`, parentId: "hip", rest: tr(sign * 8, -4), tipOffset: [0, -22, 0] },
    { id: `shin_${side}`, name: `${side} shin`, parentId: `thigh_${side}`, rest: tr(0, -21), tipOffset: [0, -19, 0] },
    { id: `foot_${side}`, name: `${side} foot`, parentId: `shin_${side}`, rest: tr(0, -18) },
  );
}
const skeleton: Skeleton = { schemaVersion: 1, kind: "skeleton", id: skeletonId, name: "AIC neutral humanoid (fixture only)", coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "pixel" }, bones };
const placement: Record<string, { bone: string; size: [number, number]; pivot: [number, number]; order: number; rest?: Transform }> = {
  head: { bone: "head", size: [25, 28], pivot: [0.5, 0.8], order: 15 },
  torso: { bone: "chest", size: [29, 35], pivot: [0.5, 0.88], order: 7 },
  pelvis: { bone: "hip", size: [27, 18], pivot: [0.5, 0.45], order: 6 },
  sword: { bone: "hand_right", size: [9, 42], pivot: [0.5, 0.84], order: 16, rest: tr(5, -4, -8) },
};
for (const [side, order] of [["left", 0], ["right", 8]] as const) {
  placement[`upper_arm_${side}`] = { bone: `upper_arm_${side}`, size: [11, 22], pivot: [0.5, 0.08], order: order + 3 };
  placement[`forearm_${side}`] = { bone: `forearm_${side}`, size: [10, 21], pivot: [0.5, 0.08], order: order + 4 };
  placement[`hand_${side}`] = { bone: `hand_${side}`, size: [10, 12], pivot: [0.5, 0.05], order: order + 5 };
  placement[`thigh_${side}`] = { bone: `thigh_${side}`, size: [13, 24], pivot: [0.5, 0.05], order };
  placement[`shin_${side}`] = { bone: `shin_${side}`, size: [11, 23], pivot: [0.5, 0.06], order: order + 1 };
  placement[`foot_${side}`] = { bone: `foot_${side}`, size: [16, 13], pivot: [0.5, 0.07], order: order + 2 };
}
const binding: CharacterBinding = {
  schemaVersion: 1, kind: "character-binding", id: bindingId, name: "Generated 16-part Region binding", skeletonId,
  slots: partNames.map((name) => ({ id: `slot-${name}`, name, boneId: placement[name]!.bone, attachmentId: `part-${name}`, drawOrder: placement[name]!.order })),
  attachments: partNames.map((name) => ({ id: `part-${name}`, name, type: "region", materialId: parts.get(name)!, imageSlot: "raw", size: placement[name]!.size, pivot: placement[name]!.pivot, rest: placement[name]!.rest ?? tr() })),
};
const rot = (targetId: string, keys: Array<[number, number]>): any => ({ targetId, property: "rotation", interpolation: "linear", keyframes: keys.map(([time, angle]) => ({ time, value: q(angle) })) });
const pos = (targetId: string, keys: Array<[number, number, number]>): any => ({ targetId, property: "translation", interpolation: "linear", keyframes: keys.map(([time, x, y]) => ({ time, value: [x, y, 0] })) });
const motionData: Array<{ id: string; duration: number; loop: boolean; tracks: any[] }> = [
  { id: "idle", duration: 1.2, loop: true, tracks: [pos("hip", [[0, 0, 44], [0.6, 0, 45], [1.2, 0, 44]]), rot("chest", [[0, -1], [0.6, 1], [1.2, -1]])] },
  { id: "attack", duration: 0.65, loop: false, tracks: [rot("upper_arm_right", [[0, 0], [0.18, -85], [0.32, 72], [0.55, 12], [0.65, 0]]), rot("forearm_right", [[0, 0], [0.18, -42], [0.32, -18], [0.65, 0]]), rot("chest", [[0, 0], [0.18, 9], [0.32, -8], [0.65, 0]]), pos("hip", [[0, 0, 44], [0.18, -2, 44], [0.32, 3, 43], [0.65, 0, 44]])] },
  { id: "hit", duration: 0.45, loop: false, tracks: [rot("chest", [[0, 0], [0.08, 13], [0.22, -5], [0.45, 0]]), pos("hip", [[0, 0, 44], [0.08, -4, 43], [0.22, -1, 44], [0.45, 0, 44]])] },
  { id: "death", duration: 0.8, loop: false, tracks: [rot("root", [[0, 0], [0.2, 12], [0.55, 76], [0.8, 88]]), pos("root", [[0, 0, 0], [0.2, 0, 0], [0.55, -4, 7], [0.8, -5, 9]]), rot("upper_arm_right", [[0, 0], [0.3, 20], [0.8, 35]])] },
];
if (!state.base) {
  const operations: any[] = [{ type: "create-skeleton", asset: skeleton }, { type: "upsert-binding", binding }, { type: "upsert-body-profile", profile: { schemaVersion: 1, id: bodyId, name: "AIC neutral body", skeletonId, mirrorAxis: "x", slots: [{ id: "weapon", semantic: "weapon_hand_right", capacity: 1, accepts: ["one_hand"] }], sockets: [{ id: "weapon_hand_right", semantic: "weapon_hand_right", boneId: "hand_right", rest: tr(5, -4), accepts: ["one_hand"] }] } }];
  for (const motion of motionData) {
    const clip: MotionClip = { schemaVersion: 1, kind: "motion-clip", id: `aic-${motion.id}-${suffix}`, name: motion.id, skeletonId, duration: motion.duration, loop: motion.loop, tracks: motion.tracks, events: [], rootMotion: "in-place", provenance: { source: "manual", adapter: "aic-structured-recipe", adapterVersion: "1", parameters: { fixtureOnly: true } } };
    operations.push({ type: "create-motion-clip", asset: clip }, { type: "upsert-action", action: { id: motion.id, name: motion.id, motionClipId: clip.id, speed: 1, repeat: 1, loop: motion.loop } });
  }
  await mcp("aic_apply_operations", { projectId, baseRevision: 0, idempotencyKey: "aic-d1-base-v1", operations });
  const diagnostics = await mcp("aic_get_diagnostics", { projectId });
  if (diagnostics.diagnostics.some((d: any) => d.severity === "error")) throw new Error(JSON.stringify(diagnostics));
  state.base = await mcp("aic_publish_v3", { projectId });
  save();
}
if (variant && !state.variant) {
  const updated = structuredClone(binding);
  updated.attachments.find((a) => a.name === "torso")!.size[0] *= 1.12;
  await mcp("aic_apply_operations", { projectId, baseRevision: 1, idempotencyKey: "aic-d1-wider-torso-v1", operations: [{ type: "upsert-binding", binding: updated }] });
  state.variant = await mcp("aic_publish_v3", { projectId });
  save();
}
for (const [name, artifact] of [["base", state.base], ["variant", state.variant]] as const) {
  if (!artifact) continue;
  const path = join(out, `${name}.fbanim`);
  if (existsSync(path)) {
    const existing = readFileSync(path);
    const digest = `sha256:${createHash("sha256").update(existing).digest("hex")}`;
    if (digest !== artifact.digest || existing.length !== artifact.byteLength) throw new Error(`Existing artifact identity mismatch: ${path}`);
    console.log(JSON.stringify({ artifact: name, projectId, revision: artifact.revision, digest, path, bytes: existing.length, reused: true }));
    continue;
  }
  const bytes = await budget.run(`download_${name}`, (signal) => fetch(new URL(artifact.downloadPath, base), { signal }), (body) => body);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== artifact.digest || bytes.length !== artifact.byteLength) throw new Error("Published artifact identity mismatch");
  if (existsSync(path) && !readFileSync(path).equals(Buffer.from(bytes))) throw new Error(`Refusing to overwrite different evidence: ${path}`);
  if (!existsSync(path)) writeFileSync(path, bytes, { flag: "wx" });
  console.log(JSON.stringify({ artifact: name, projectId, revision: artifact.revision, digest, path, bytes: bytes.length }));
}
console.log(JSON.stringify({ projectId, checkpoint, limits: budget.limits, cost: budget.totals(), status: "published-not-yet-accepted", claim: "Region skeletal fixture authoring; not a formal class, mesh skinning or terminal acceptance" }));
