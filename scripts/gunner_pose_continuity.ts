/** Narrow, repeatable continuity repair for the formal gunner draft. */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const projectId = "e59892ac-d398-4055-950f-883b00ac0abd";
const base = new URL(process.env.FRAMEBAKER_URL ?? "http://127.0.0.1:3025");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password) throw new Error("Only a local FrameBaker service is allowed");
const out = resolve(process.env.GUNNER_POSE_RECEIPT ?? "storage/aic-runs/gunner-pose-continuity-20260929/receipt.json");
const actions = ["idle", "basic_prepare", "basic_fire", "basic_recover", "stimulant", "emp", "orbital", "hit", "death"] as const;
const bodyProfileId = "gunner-body-e59892ac";
let requestId = 1;

async function mcp(name: string, args: Record<string, unknown>): Promise<any> {
  const response = await fetch(new URL("/mcp", base), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method: "tools/call", params: { name, arguments: args } }),
  });
  const raw = await response.text();
  const data = raw.split(/\r?\n/).find((line) => line.startsWith("data: "));
  const envelope = JSON.parse(data ? data.slice(6) : raw);
  const message = envelope.result?.content?.find((item: any) => item.type === "text")?.text;
  if (!response.ok || envelope.error || envelope.result?.isError || !message) throw new Error(`${name}: ${message ?? envelope.error?.message ?? response.status}`);
  return JSON.parse(message);
}

async function asset(id: string): Promise<any> {
  const response = await fetch(new URL(`/api/animation-assets/${encodeURIComponent(id)}`, base));
  if (!response.ok) throw new Error(`MotionClip ${id}: HTTP ${response.status}`);
  const clip = (await response.json()).animationAsset?.asset;
  if (clip?.kind !== "motion-clip" || clip.id !== id || clip.schemaVersion !== 1) throw new Error(`Unexpected MotionClip: ${id}`);
  return clip;
}

function key(clip: any, targetId: string, property: string, time: number): number[] {
  const track = clip.tracks.find((item: any) => item.targetId === targetId && item.property === property);
  const frame = track?.keyframes.find((item: any) => item.time === time);
  if (!frame || !Array.isArray(frame.value)) throw new Error(`Missing ${clip.id} ${targetId}.${property}@${time}`);
  return frame.value;
}

function distance(a: number[], b: number[]): number {
  return Math.hypot(...a.map((value, i) => value - b[i]!));
}

const documentResponse = await fetch(new URL(`/api/projects/${projectId}/skeletal-document`, base));
if (!documentResponse.ok) throw new Error(`Skeletal document: HTTP ${documentResponse.status}`);
const document = (await documentResponse.json()).document;
if (document?.projectId !== projectId) throw new Error("Unexpected skeletal document");
const mapped = new Map(document.animations.map((action: any) => [action.id, action.motionClipId]));
if (mapped.size !== actions.length || actions.some((id) => !mapped.has(id))) throw new Error("Gunner action set changed");
const summary = await mcp("aic_get_project_summary", { projectId, boneLimit: 0, attachmentLimit: 0 });
if (summary.revision < 6 || summary.actions.length !== actions.length) throw new Error("Unexpected gunner revision or action count");
const clips = new Map<string, any>();
for (const id of actions) clips.set(id, await asset(mapped.get(id) as string));
const idle = clips.get("idle")!;
const fire = clips.get("basic_fire")!;
const recover = clips.get("basic_recover")!;
const operations: any[] = [];
function copy(to: any, time: number, from: any, fromTime: number, targetId: string, property: string) {
  const value = key(from, targetId, property, fromTime);
  const current = to.tracks.find((item: any) => item.targetId === targetId && item.property === property)
    ?.keyframes.find((item: any) => item.time === time)?.value;
  if (current && JSON.stringify(current) === JSON.stringify(value)) return;
  operations.push({ type: "upsert-keyframe", clipId: to.id, targetId, property, time, value });
}

for (const [bone, property] of [
  ["chest", "rotation"], ["upper_arm_right", "rotation"],
  ["upper_arm_left", "translation"], ["upper_arm_left", "rotation"], ["forearm_left", "rotation"],
] as const) copy(recover, 0, fire, fire.duration, bone, property);
for (const id of ["stimulant", "emp"]) {
  const clip = clips.get(id)!;
  for (const time of [0, clip.duration]) for (const [bone, property] of [
    ["upper_arm_left", "translation"], ["upper_arm_left", "rotation"], ["forearm_left", "rotation"],
  ] as const) copy(clip, time, idle, 0, bone, property);
}
if (operations.length > 64) throw new Error(`Too many operations: ${operations.length}`);

let revision = summary.revision;
if (operations.length) {
  const digest = createHash("sha256").update(JSON.stringify(operations)).digest("hex").slice(0, 24);
  const result = await mcp("aic_apply_operations", { projectId, baseRevision: revision, idempotencyKey: `gunner-pose-continuity-v1-${revision}-${digest}`, operations });
  if (result.revision !== revision + 1) throw new Error("Unexpected revision after continuity edit");
  revision = result.revision;
}

const samples: any[] = [];
for (const id of actions) {
  const duration = clips.get(id)!.duration;
  for (const timeSeconds of [0, duration / 2, duration]) {
    const pose = await mcp("aic_sample_pose", { projectId, actionId: id, timeSeconds,
      boneIds: ["root", "chest", "hand_left", "hand_right"], socketIds: ["primary_grip", "support_hand", "muzzle", "center"], bodyProfileId });
    if (pose.revision !== revision) throw new Error("Project changed during pose sampling");
    samples.push({ actionId: id, timeSeconds, sockets: Object.fromEntries(pose.sockets.map((socket: any) => [socket.id, socket.position])) });
  }
}
function boundary(from: string, fromTime: number, to: string, toTime: number) {
  const a = samples.find((item) => item.actionId === from && item.timeSeconds === fromTime)!;
  const b = samples.find((item) => item.actionId === to && item.timeSeconds === toTime)!;
  return { from, to, pixels: Object.fromEntries(["primary_grip", "support_hand", "muzzle"].map((id) => [id, distance(a.sockets[id], b.sockets[id])])) };
}
const edges = [
  boundary("idle", 0, "basic_prepare", 0),
  boundary("basic_prepare", clips.get("basic_prepare")!.duration, "basic_fire", 0),
  boundary("basic_fire", fire.duration, "basic_recover", 0),
  boundary("basic_recover", recover.duration, "idle", 0),
  ...(["stimulant", "emp", "orbital", "hit", "death"] as const).flatMap((id) => [
    boundary("idle", 0, id, 0), boundary(id, clips.get(id)!.duration, "idle", 0),
  ]),
];
const diagnostics = await mcp("aic_get_diagnostics", { projectId });
if (diagnostics.revision !== revision || diagnostics.diagnostics?.some((item: any) => item.severity === "error")) throw new Error("Post-edit diagnostics failed or revision changed");
const receipt = { projectId, baseRevision: summary.revision, revision, operationCount: operations.length, operations,
  actionDurations: Object.fromEntries(actions.map((id) => [id, clips.get(id)!.duration])), edges, samples, diagnostics };
mkdirSync(resolve(out, ".."), { recursive: true });
writeFileSync(out, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ projectId, revision, operationCount: operations.length, edges, receipt: out }, null, 2));
