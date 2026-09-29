/** 在 revision14 肩线修复上烘焙两把长枪的动作覆盖，仅写独立制作草稿。 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const base = "http://127.0.0.1:3025";
const projectId = "e59892ac-d398-4055-950f-883b00ac0abd";
const out = "storage/aic-runs/gunner-weapon-poses-20260929";
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
  const body = await response.text();
  const line = body.split(/\r?\n/).find(line => line.startsWith("data: "));
  const envelope = JSON.parse(line ? line.slice(6) : body);
  if (!response.ok || envelope.error || envelope.result?.isError) throw new Error(JSON.stringify(envelope));
  return JSON.parse(envelope.result.content.find((item: any) => item.type === "text").text);
}
const summary = await mcp("aic_get_project_summary", { projectId, boneLimit: 0, attachmentLimit: 0 });
if (existsSync(`${out}/receipt.json`)) {
  const receipt = JSON.parse(readFileSync(`${out}/receipt.json`, "utf8"));
  if (summary.revision !== receipt.revision) throw new Error("草稿已变化，不重放旧配方");
  console.log(JSON.stringify({ projectId, revision: summary.revision, reused: true }));
  process.exit(0);
}
if (summary.revision !== 14) throw new Error("本配方仅接受已修正肩线的 revision14");
const document = (await read(`/api/projects/${projectId}/skeletal-document`)).document;
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
const held = new Set(["idle", "basic_prepare", "basic_fire", "basic_recover", "hit"]);
const quat = (angle: number) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
function solve(target: number[]) {
  const dx = target[0]! + 8, dy = target[1]! - 3, length = Math.hypot(dx, dy);
  if (length >= 36 || length <= 2) throw new Error(`辅手不可达 ${target}`);
  const upper = Math.atan2(dy, dx) - Math.acos((19*19 + length*length - 17*17)/(2*19*length));
  const lower = Math.atan2(dy - 19*Math.sin(upper), dx - 19*Math.cos(upper));
  return { upper: upper + Math.PI/2, lower: lower - upper, hand: -(lower + Math.PI/2) };
}
const originals = new Map<string, any>();
for (const action of document.animations) {
  if (!schedules[action.id]) throw new Error(`未知基础动作 ${action.id}`);
  originals.set(action.id, (await read(`/api/animation-assets/${action.motionClipId}`)).animationAsset.asset);
}
const operations: any[] = [];
for (const weapon of [{ prefix: "fission", id: "fission-projector-e59892ac", grip: 23 },
  { prefix: "phase", id: "phase-piercer-e59892ac", grip: 24 }]) {
  const equipment = structuredClone(document.equipment.find((item: any) => item.id === weapon.id));
  if (!equipment) throw new Error(`装备缺失 ${weapon.id}`);
  equipment.actionOverrides = { ...equipment.actionOverrides };
  for (const action of document.animations) {
    const clip = structuredClone(originals.get(action.id));
    clip.id = `${clip.id}-${weapon.prefix}-v1`;
    clip.name = `${clip.name} / ${weapon.prefix}`;
    const schedule = schedules[action.id]!;
    const poses = schedule.map(([time, right, originalLeft], index) => {
      // 技能中段与死亡终帧松手；只改起止持握，不把投掷手拉回枪身。
      const holding = held.has(action.id) || index === 0 || (action.id !== "death" && index === schedule.length - 1);
      return { time, ...solve(holding ? [right[0]! + weapon.grip, right[1]!] : originalLeft) };
    });
    clip.tracks = clip.tracks.filter((track: any) => !(track.property === "rotation" && /^(upper_arm|forearm|hand)_left$/.test(track.targetId)));
    for (const [bone, key] of [["upper_arm", "upper"], ["forearm", "lower"], ["hand", "hand"]] as const) {
      clip.tracks.push({ targetId: `${bone}_left`, property: "rotation", interpolation: "linear",
        keyframes: poses.map(pose => ({ time: pose.time, value: quat(pose[key]) })) });
    }
    const actionId = `${weapon.prefix}.${action.id}`;
    operations.push({ type: "create-motion-clip", asset: clip },
      { type: "upsert-action", action: { ...action, id: actionId, name: `${action.name} / ${weapon.prefix}`, motionClipId: clip.id } });
    equipment.actionOverrides[action.id] = actionId;
  }
  operations.push({ type: "upsert-equipment", equipment });
}
writeFileSync(`${out}/before.json`, JSON.stringify({ document, clips: [...originals.values()] }, null, 2));
const hash = createHash("sha256").update(JSON.stringify(operations)).digest("hex");
const result = await mcp("aic_apply_operations", { projectId, baseRevision: 14,
  idempotencyKey: `gunner-weapon-poses-v1-${hash}`, operations });
const diagnostics = await mcp("aic_get_diagnostics", { projectId });
writeFileSync(`${out}/receipt.json`, JSON.stringify({ projectId, baseRevision: 14, revision: result.revision,
  hash, operationCount: operations.length, diagnostics, status: "draft-awaiting-pose-and-visual-check" }, null, 2));
console.log(JSON.stringify({ projectId, revision: result.revision, operationCount: operations.length, diagnostics }));
