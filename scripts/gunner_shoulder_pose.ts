/** 修正正式枪手草稿的肩线和持握；保留旧 clip，单批替换动作引用，不发布。 */
import { mkdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const base = "http://127.0.0.1:3025";
const projectId = "e59892ac-d398-4055-950f-883b00ac0abd";
const out = "storage/aic-runs/gunner-shoulder-20260929";
mkdirSync(out, { recursive: true });
async function read(path: string): Promise<any> {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
  return response.json();
}
async function mcp(name: string, args: unknown): Promise<any> {
  const response = await fetch(base + "/mcp", {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await response.text();
  const line = text.split(/\r?\n/).find(line => line.startsWith("data: "));
  const envelope = JSON.parse(line ? line.slice(6) : text);
  if (!response.ok || envelope.error || envelope.result?.isError) throw new Error(JSON.stringify(envelope));
  return JSON.parse(envelope.result.content.find((item: any) => item.type === "text").text);
}
const summary = await mcp("aic_get_project_summary", { projectId, boneLimit: 0, attachmentLimit: 0 });
const checkpoint = `${out}/receipt.json`;
if (existsSync(checkpoint)) {
  const receipt = JSON.parse(readFileSync(checkpoint, "utf8"));
  if (summary.revision !== receipt.revision) throw new Error("草稿已变化；不得重放旧修复");
  console.log(JSON.stringify({ projectId, revision: summary.revision, reused: true }));
  process.exit(0);
}
if (summary.revision !== 13) throw new Error("本配方只修正已观察的 revision 13");
const document = (await read(`/api/projects/${projectId}/skeletal-document`)).document;
const before: any[] = [];
const operations: any[] = [];
const quat = (radians: number) => [0, 0, Math.sin(radians / 2), Math.cos(radians / 2)];
// 肩关节以躯干贴图实际肩线为准；禁止平移肩膀追逐不可达的握把。
const shoulders = { right: [9, 3], left: [-8, 3] };
function solve(side: "left" | "right", target: number[]) {
  const [sx, sy] = shoulders[side];
  const dx = target[0]! - sx!, dy = target[1]! - sy!;
  const length = Math.hypot(dx, dy), upper = 19, lower = 17;
  if (length >= upper + lower || length <= Math.abs(upper - lower)) throw new Error(`不可达 ${side}: ${target}`);
  const direction = Math.atan2(dy, dx);
  const angle = Math.acos((upper * upper + length * length - lower * lower) / (2 * upper * length));
  const upperAngle = direction - angle;
  const elbow = [sx! + upper * Math.cos(upperAngle), sy! + upper * Math.sin(upperAngle)];
  const lowerAngle = Math.atan2(target[1]! - elbow[1]!, target[0]! - elbow[0]!);
  return { upper: upperAngle + Math.PI / 2, lower: lowerAngle - upperAngle, hand: -(lowerAngle + Math.PI / 2) };
}
const schedules: Record<string, Array<[number, number[], number[]]>> = {
  idle: [[0,[0,-8],[11,-8]],[1.2,[0,-8],[11,-8]]],
  basic_prepare: [[0,[0,-8],[11,-8]],[0.4,[2,-5],[13,-5]],[0.6,[2,-5],[13,-5]]],
  basic_fire: [[0,[2,-5],[13,-5]],[0.06,[-1,-5],[10,-5]],[0.22,[1,-6],[12,-6]]],
  basic_recover: [[0,[1,-6],[12,-6]],[0.3,[0,-8],[11,-8]],[0.5,[0,-8],[11,-8]]],
  stimulant: [[0,[0,-8],[11,-8]],[0.25,[0,-8],[1,0]],[0.4,[0,-8],[1,0]],[0.6,[0,-8],[11,-8]]],
  emp: [[0,[0,-8],[11,-8]],[0.4,[0,-8],[-14,21]],[0.8,[0,-8],[23,8]],[1.2,[0,-8],[11,-8]]],
  orbital: [[0,[0,-8],[11,-8]],[0.7,[0,-8],[3,13]],[1.8,[0,-8],[3,13]],[2.5,[0,-8],[11,-8]]],
  hit: [[0,[0,-8],[11,-8]],[0.08,[-2,-10],[9,-10]],[0.45,[0,-8],[11,-8]]],
  death: [[0,[0,-8],[11,-8]],[0.4,[6,-23],[-10,-24]],[0.8,[9,-30],[-8,-30]]],
};
for (const action of document.animations) {
  const old = (await read(`/api/animation-assets/${action.motionClipId}`)).animationAsset.asset;
  before.push(old);
  const schedule = schedules[action.id];
  if (!schedule || schedule.at(-1)![0] !== old.duration) throw new Error(`动作合同不符: ${action.id}`);
  const clip = structuredClone(old);
  clip.id = `${old.id}-shoulder-v2`;
  clip.tracks = clip.tracks.filter((track: any) => !/^(upper_arm|forearm|hand)_(left|right)$/.test(track.targetId));
  for (const side of ["left", "right"] as const) {
    const poses = schedule.map(([time, right, left]) => ({ time, ...solve(side, side === "right" ? right : left) }));
    clip.tracks.push({ targetId: `upper_arm_${side}`, property: "translation", interpolation: "linear",
      keyframes: [0, old.duration].map(time => ({ time, value: [...shoulders[side], 0] })) });
    for (const [bone, key] of [["upper_arm", "upper"], ["forearm", "lower"], ["hand", "hand"]] as const) {
      clip.tracks.push({ targetId: `${bone}_${side}`, property: "rotation", interpolation: "linear",
        keyframes: poses.map(pose => ({ time: pose.time, value: quat(pose[key]) })) });
    }
  }
  operations.push({ type: "create-motion-clip", asset: clip }, { type: "upsert-action", action: { ...action, motionClipId: clip.id } });
}
const profile = structuredClone(document.bodyProfiles[0]);
profile.sockets.find((socket: any) => socket.id === "primary_grip").rest.translation = [0, 0, 0];
profile.sockets.find((socket: any) => socket.id === "muzzle").rest.translation = [26, 0, 0];
operations.push({ type: "upsert-body-profile", profile });
// 保存旧数据以便恢复，不覆盖旧动作资产；HTTP/MCP 是唯一写入入口。
writeFileSync(`${out}/before.json`, JSON.stringify({ document, clips: before }, null, 2));
const hash = createHash("sha256").update(JSON.stringify(operations)).digest("hex");
const result = await mcp("aic_apply_operations", { projectId, baseRevision: 13,
  idempotencyKey: `gunner-shoulder-v2-${hash}`, operations });
const diagnostics = await mcp("aic_get_diagnostics", { projectId });
writeFileSync(checkpoint, JSON.stringify({ projectId, baseRevision: 13, revision: result.revision,
  operationCount: operations.length, hash, result, diagnostics, status: "draft-awaiting-visual-check" }, null, 2));
console.log(JSON.stringify({ projectId, revision: result.revision, operationCount: operations.length, diagnostics }));
