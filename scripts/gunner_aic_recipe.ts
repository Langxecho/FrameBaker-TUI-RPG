/** 正式枪手 Region 候选配方；仅调用公开 MCP，不自动发布。 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BodyProfile, CharacterBinding, EquipmentDefinition, MotionClip, Skeleton, Transform } from "@framebaker/shared";
import { createBudget, parseLimit, type BudgetState } from "./aic_recipe_budget";

export const GUNNER_REGION_PARTS = [
  "head", "torso", "pelvis", "weapon_pulse_array",
  "upper_arm_left", "upper_arm_right", "forearm_left", "forearm_right",
  "thigh_left", "thigh_right", "shin_left", "shin_right",
  "foot_left", "foot_right", "hand_left", "hand_right",
] as const;
export const GUNNER_ACTION_SEMANTICS = [
  "idle", "basic_prepare", "basic_fire", "basic_recover", "stimulant", "emp", "orbital", "hit", "death",
] as const;
const DEFAULT_MATERIAL = "ef5fa350-2a93-416c-9b3f-c9d2c8755794";
const EXPECTED_SHA = "a6aafb8f6c729d77d6403288cba8622b298cf93d93f3c29785d4ccf5b9693fb2";
type Split = { sourceSha256: string; parts: Array<{ name: string; materialId: string; width: number; height: number }> };
type State = { materialId: string; split?: Split; projectId?: string; applied?: boolean; gripPostureApplied?: boolean; gripIkApplied?: boolean; prepareIkApplied?: boolean; regionAlignmentVersion?: number; regionAlignmentReceipt?: unknown; diagnostics?: unknown; poseReport?: { version?: number; samples: unknown[] }; poseSamples?: unknown[]; calls?: number; budget?: BudgetState };
const args = new Map<string, string>();
const accepted = ["--material", "--url", "--out", "--max-calls", "--max-wall-ms", "--max-response-bytes"];
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]!;
  if (!accepted.includes(key) || args.has(key) || !process.argv[i + 1]) throw new Error(`参数无效：${key}`);
  args.set(key, process.argv[++i]!);
}
const materialId = args.get("--material") ?? DEFAULT_MATERIAL;
if (materialId !== DEFAULT_MATERIAL) throw new Error("本版配方只接受已审核的规范化素材 ID");
const base = new URL(args.get("--url") ?? "http://127.0.0.1:3025");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password) throw new Error("仅允许本地制作服务");
const out = resolve(args.get("--out") ?? "storage/aic-runs/gunner-draft-20260928");
mkdirSync(out, { recursive: true });
const checkpoint = join(out, "recipe-state.json");
const state: State = existsSync(checkpoint) ? JSON.parse(readFileSync(checkpoint, "utf8")) : { materialId };
if (state.materialId !== materialId) throw new Error("检查点素材身份不匹配");
function save() { writeFileSync(`${checkpoint}.tmp`, JSON.stringify(state, null, 2)); renameSync(`${checkpoint}.tmp`, checkpoint); }
const budget = createBudget(state, {
  maxCalls: parseLimit(args.get("--max-calls"), "--max-calls") ?? state.budget?.limits.maxCalls ?? 64,
  ...(parseLimit(args.get("--max-wall-ms"), "--max-wall-ms") === undefined ? {} : { maxWallMs: parseLimit(args.get("--max-wall-ms"), "--max-wall-ms")! }),
  ...(parseLimit(args.get("--max-response-bytes"), "--max-response-bytes") === undefined ? {} : { maxResponseBytes: parseLimit(args.get("--max-response-bytes"), "--max-response-bytes")! }),
}, save);
let requestId = 1;
async function mcp(name: string, input: Record<string, unknown>): Promise<any> {
  return budget.run(name, (signal) => fetch(new URL("/mcp", base), {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method: "tools/call", params: { name, arguments: input } }), signal,
  }), (bytes) => {
    const body = Buffer.from(bytes).toString("utf8");
    const line = body.split("\n").find((item) => item.startsWith("data: "));
    const envelope = JSON.parse(line ? line.slice(6) : body);
    if (envelope.error || envelope.result?.isError) {
      const detail = envelope.result?.content?.find((item: any) => item.type === "text")?.text;
      console.error(JSON.stringify({ tool: name, validation: detail ? JSON.parse(detail) : envelope.error?.code ?? "unknown" }));
      throw new Error("MCP 工具执行失败");
    }
    const content = envelope.result?.content?.find((item: any) => item.type === "text")?.text;
    if (!content) throw new Error("MCP 响应缺少结构化内容");
    return JSON.parse(content);
  });
}
if (!state.split) {
  state.split = await mcp("split_material_parts", {
    materialId, rows: 4, cols: 4, keyColor: [255, 0, 255], tolerance: 0,
    idempotencyKey: "gun05-normalized-16-split-a6aafb8f-v1",
    parts: GUNNER_REGION_PARTS.map((name, cell) => ({ name, cell })),
  });
  save();
}
if (state.split!.sourceSha256 !== EXPECTED_SHA || state.split!.parts.length !== 16 ||
  GUNNER_REGION_PARTS.some((name, cell) => state.split!.parts[cell]?.name !== name || !state.split!.parts[cell]?.materialId)) {
  throw new Error("分件结果与已审核 4x4 源身份不一致");
}
const parts = new Map(state.split!.parts.map((part) => [part.name, part]));
const projectName = `GUN-05 formal gunner pulse draft ${materialId}`;
if (!state.projectId) {
  const projects = (await mcp("list_projects", {})).projects.filter((item: any) => item.name === projectName && item.kind === "skeletal");
  if (projects.length > 1) throw new Error("同名草稿不唯一，拒绝恢复");
  state.projectId = projects[0]?.id ?? (await mcp("create_project", { name: projectName, kind: "skeletal" })).id;
  save();
}
const projectId = state.projectId!;
const suffix = projectId.slice(0, 8);
const q = (degrees: number): [number, number, number, number] => [0, 0, Math.sin(degrees * Math.PI / 360), Math.cos(degrees * Math.PI / 360)];
const tr = (x = 0, y = 0, degrees = 0): Transform => ({ translation: [x, y, 0], rotation: q(degrees), scale: [1, 1, 1] });
const bones: Skeleton["bones"] = [
  { id: "root", name: "根", parentId: null, rest: tr() },
  { id: "hip", name: "骨盆", parentId: "root", rest: tr(0, 44), semantic: "pelvis" },
  { id: "chest", name: "胸腔", parentId: "hip", rest: tr(0, 15), semantic: "chest" },
  { id: "head", name: "头", parentId: "chest", rest: tr(0, 27), semantic: "head" },
];
for (const [side, sign] of [["left", -1], ["right", 1]] as const) {
  bones.push(
    { id: `upper_arm_${side}`, name: `上臂_${side}`, parentId: "chest", rest: tr(sign * 15, 18), tipOffset: [0, -20, 0] },
    { id: `forearm_${side}`, name: `前臂_${side}`, parentId: `upper_arm_${side}`, rest: tr(0, -19), tipOffset: [0, -18, 0] },
    { id: `hand_${side}`, name: `手_${side}`, parentId: `forearm_${side}`, rest: tr(0, -17) },
    { id: `thigh_${side}`, name: `大腿_${side}`, parentId: "hip", rest: tr(sign * 8, -4), tipOffset: [0, -21, 0] },
    { id: `shin_${side}`, name: `小腿_${side}`, parentId: `thigh_${side}`, rest: tr(0, -20), tipOffset: [0, -19, 0] },
    { id: `foot_${side}`, name: `脚_${side}`, parentId: `shin_${side}`, rest: tr(0, -18) },
  );
}
const skeleton: Skeleton = { schemaVersion: 1, kind: "skeleton", id: `gunner-skeleton-${suffix}`, name: "正式枪手候选骨架", coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "pixel" }, bones };
const placement: Record<string, { bone: string; size: [number, number]; pivot: [number, number]; order: number; rest?: Transform }> = {
  // Region pivots are expressed from the image's lower-left corner in Y-up
  // space.  The reviewed cells contain transparent gutters, so joints sit
  // near the lower edge of vertical parts rather than at their source-image
  // top edge.
  head: { bone: "head", size: [25, 27], pivot: [0.5, 0.9], order: 15 },
  torso: { bone: "chest", size: [29, 33], pivot: [0.5, 0.82], order: 7 },
  pelvis: { bone: "hip", size: [27, 18], pivot: [0.5, 0.45], order: 6 },
  weapon_pulse_array: { bone: "hand_right", size: [35, 13], pivot: [0.25, 0.5], order: 16, rest: tr(8, 0) },
};
for (const [side, order] of [["left", 0], ["right", 8]] as const) {
  placement[`upper_arm_${side}`] = { bone: `upper_arm_${side}`, size: [11, 22], pivot: [0.5, 0.9], order: order + 3 };
  placement[`forearm_${side}`] = { bone: `forearm_${side}`, size: [10, 20], pivot: [0.5, 0.9], order: order + 4 };
  placement[`hand_${side}`] = { bone: `hand_${side}`, size: [11, 10], pivot: [0.5, 0.55], order: order + 5 };
  placement[`thigh_${side}`] = { bone: `thigh_${side}`, size: [13, 23], pivot: [0.5, 0.9], order };
  placement[`shin_${side}`] = { bone: `shin_${side}`, size: [11, 21], pivot: [0.5, 0.9], order: order + 1 };
  placement[`foot_${side}`] = { bone: `foot_${side}`, size: [16, 12], pivot: [0.5, 0.8], order: order + 2 };
}
const body: BodyProfile = {
  schemaVersion: 1, id: `gunner-body-${suffix}`, name: "正式枪手候选 BodyProfile", skeletonId: skeleton.id, mirrorAxis: "x",
  slots: [
    { id: "weapon", semantic: "hand_right", capacity: 1, accepts: ["weapon"] },
    { id: "support", semantic: "hand_left", capacity: 1, accepts: ["weapon"] },
  ],
  sockets: [
    { id: "primary_grip", semantic: "weapon_hand_right", boneId: "hand_right", rest: tr(8, 0), accepts: ["weapon"] },
    { id: "support_hand", semantic: "weapon_hand_left", boneId: "hand_left", rest: tr(0, 0), accepts: ["weapon"] },
    { id: "muzzle", semantic: "custom:muzzle", boneId: "hand_right", rest: tr(34, 0), accepts: ["effect"] },
    { id: "center", semantic: "custom:center", boneId: "chest", rest: tr(0, 0), accepts: ["effect"] },
  ],
};
const binding: CharacterBinding = {
  schemaVersion: 1, kind: "character-binding", id: `gunner-binding-${suffix}`, name: "正式枪手候选 Region 绑定", skeletonId: skeleton.id,
  slots: GUNNER_REGION_PARTS.filter((name) => name !== "weapon_pulse_array").map((name) => ({ id: `slot-${name}`, name, boneId: placement[name]!.bone, attachmentId: `part-${name}`, drawOrder: placement[name]!.order })),
  attachments: GUNNER_REGION_PARTS.filter((name) => name !== "weapon_pulse_array").map((name) => ({ id: `part-${name}`, name, type: "region" as const, materialId: parts.get(name)!.materialId, imageSlot: "raw", size: placement[name]!.size, pivot: placement[name]!.pivot, rest: tr() })),
};
const pulse: EquipmentDefinition = {
  schemaVersion: 1, id: `pulse-array-${suffix}`, name: "脉冲阵列候选", tags: ["weapon"], visualMode: "attached",
  primarySlot: "weapon", occupiedSlots: ["weapon", "support"], conflictTags: [], replacesParts: [], hidesSlots: [],
  attachments: [{ id: "pulse-region", name: "脉冲阵列", socket: "primary_grip", materialId: parts.get("weapon_pulse_array")!.materialId, imageSlot: "raw", size: [35, 13], pivot: [0.25, 0.5], rest: tr(), drawGroup: "equipment", drawOffset: 0 }],
  weapon: { holdMode: "two_hand", preferredPrimaryHand: "right", mirrorAllowed: false, primaryGrip: tr(), secondaryGrip: tr(-11, 0), muzzleSocket: tr(26, 0), stanceProfile: "gunner_pulse", secondaryHandConstraint: { id: "authoring-support", upperBoneId: "upper_arm_left", lowerBoneId: "forearm_left", endBoneId: "hand_left", targetSocket: "support_hand", bendDirection: "positive", mix: 0, stretch: "forbid" } },
};
const rot = (targetId: string, keys: Array<[number, number]>) => ({ targetId, property: "rotation" as const, interpolation: "linear" as const, keyframes: keys.map(([time, angle]) => ({ time, value: q(angle) })) });
const pos = (targetId: string, keys: Array<[number, number, number]>) => ({ targetId, property: "translation" as const, interpolation: "linear" as const, keyframes: keys.map(([time, x, y]) => ({ time, value: [x, y, 0] as [number, number, number] })) });
const motions = [
  { id: "idle", duration: 1.2, loop: true, tracks: [pos("hip", [[0, 0, 44], [0.6, 0, 45], [1.2, 0, 44]]), rot("chest", [[0, -1], [0.6, 1], [1.2, -1]])] },
  { id: "basic_prepare", duration: 0.6, loop: false, tracks: [rot("chest", [[0, 0], [0.4, -7], [0.6, -5]]), rot("upper_arm_right", [[0, 0], [0.4, 22], [0.6, 18]]), rot("upper_arm_left", [[0, 0], [0.4, -18], [0.6, -15]])] },
  { id: "basic_fire", duration: 0.22, loop: false, tracks: [pos("root", [[0, 0, 0], [0.06, -3, 0], [0.22, 0, 0]]), rot("chest", [[0, -5], [0.06, 8], [0.22, 0]]), rot("upper_arm_right", [[0, 18], [0.06, 30], [0.22, 8]])] },
  { id: "basic_recover", duration: 0.5, loop: false, tracks: [rot("chest", [[0, 8], [0.3, -2], [0.5, 0]]), rot("upper_arm_right", [[0, 30], [0.3, 8], [0.5, 0]])] },
  { id: "stimulant", duration: 0.6, loop: false, tracks: [rot("upper_arm_left", [[0, 0], [0.25, -70], [0.4, -58], [0.6, 0]]), rot("forearm_left", [[0, 0], [0.25, -48], [0.4, -55], [0.6, 0]]), rot("head", [[0, 0], [0.3, -10], [0.6, 0]])] },
  { id: "emp", duration: 1.2, loop: false, tracks: [rot("chest", [[0, 0], [0.4, -15], [0.8, 19], [1.2, 0]]), rot("upper_arm_left", [[0, 0], [0.4, 55], [0.8, -85], [1.2, 0]]), pos("hip", [[0, 0, 44], [0.4, -3, 43], [0.8, 4, 44], [1.2, 0, 44]])] },
  { id: "orbital", duration: 2.5, loop: false, tracks: [rot("head", [[0, 0], [0.7, 25], [1.8, 28], [2.5, 0]]), rot("upper_arm_right", [[0, 0], [0.7, 42], [1.8, 60], [2.5, 0]]), rot("chest", [[0, 0], [0.7, 8], [1.8, -12], [2.5, 0]])] },
  { id: "hit", duration: 0.45, loop: false, tracks: [rot("chest", [[0, 0], [0.08, 18], [0.23, -6], [0.45, 0]]), pos("hip", [[0, 0, 44], [0.08, -4, 42], [0.45, 0, 44]])] },
  { id: "death", duration: 0.8, loop: false, tracks: [rot("root", [[0, 0], [0.2, 12], [0.6, 75], [0.8, 88]]), pos("root", [[0, 0, 0], [0.2, 0, 0], [0.6, -4, 7], [0.8, -5, 9]]), rot("upper_arm_left", [[0, 0], [0.4, 25], [0.8, 45]])] },
] as const;
if (!state.applied) {
  const operations: any[] = [{ type: "create-skeleton", asset: skeleton }, { type: "upsert-binding", binding }, { type: "upsert-body-profile", profile: body }, { type: "upsert-equipment", equipment: pulse }];
  for (const motion of motions) {
    const clip: MotionClip = { schemaVersion: 1, kind: "motion-clip", id: `gunner-${motion.id}-${suffix}`, name: motion.id, skeletonId: skeleton.id, duration: motion.duration, loop: motion.loop, tracks: [...motion.tracks] as MotionClip["tracks"], events: [], rootMotion: "in-place", provenance: { source: "manual", adapter: "gunner-structured-recipe", adapterVersion: "1", parameters: { draftOnly: true } } };
    operations.push({ type: "create-motion-clip", asset: clip }, { type: "upsert-action", action: { id: motion.id, name: motion.id, motionClipId: clip.id, speed: 1, repeat: 1, loop: motion.loop } });
  }
  await mcp("aic_apply_operations", { projectId, baseRevision: 0, idempotencyKey: `gun05-pulse-draft-v1-${suffix}`, operations });
  state.applied = true;
  save();
}
if (!state.gripPostureApplied) {
  const operations: any[] = [];
  for (const motion of motions.filter((item) => ["idle", "basic_fire", "basic_recover", "orbital", "hit"].includes(item.id))) {
    const clipId = `gunner-${motion.id}-${suffix}`;
    for (const time of [0, motion.duration]) {
      operations.push(
        { type: "upsert-keyframe", clipId, targetId: "upper_arm_left", property: "translation", time, value: [-8, 10, 0] },
        { type: "upsert-keyframe", clipId, targetId: "upper_arm_left", property: "rotation", time, value: q(45) },
        { type: "upsert-keyframe", clipId, targetId: "forearm_left", property: "rotation", time, value: q(-23) },
      );
    }
  }
  await mcp("aic_apply_operations", { projectId, baseRevision: 1, idempotencyKey: `gun05-pulse-support-grip-v1-${suffix}`, operations });
  state.gripPostureApplied = true;
  state.diagnostics = undefined;
  state.poseReport = undefined;
  save();
}
if (!state.gripIkApplied || !state.prepareIkApplied) {
  const operations: any[] = [];
  const schedules: Array<[string, number[]]> = state.gripIkApplied
    ? [["basic_prepare", [0, 0.3, 0.6]]]
    : [["basic_fire", [0, 0.06, 0.22]], ["basic_recover", [0, 0.15, 0.3, 0.5]]];
  for (const [actionId, times] of schedules) {
    for (const timeSeconds of times) {
      const pose = await mcp("aic_sample_pose", { projectId, actionId, timeSeconds, boneIds: ["chest", "hand_right"], socketIds: ["primary_grip"], bodyProfileId: body.id });
      const chest = pose.bones.find((item: any) => item.id === "chest").worldMatrix as number[];
      const hand = pose.bones.find((item: any) => item.id === "hand_right").worldMatrix as number[];
      const grip = pose.sockets[0].position as number[];
      const targetWorld = [grip[0]! - 11 * hand[0]!, grip[1]! - 11 * hand[1]!];
      const deltaX = targetWorld[0]! - chest[12]!;
      const deltaY = targetWorld[1]! - chest[13]!;
      const target = [deltaX * chest[0]! + deltaY * chest[1]!, -deltaX * chest[1]! + deltaY * chest[0]!];
      let shoulder = [-8, 10];
      let dx = target[0]! - shoulder[0]!;
      let dy = target[1]! - shoulder[1]!;
      let distance = Math.hypot(dx, dy);
      if (distance > 35) {
        const shift = distance - 35;
        shoulder = [shoulder[0]! + dx / distance * shift, shoulder[1]! + dy / distance * shift];
        dx = target[0]! - shoulder[0]!;
        dy = target[1]! - shoulder[1]!;
        distance = Math.hypot(dx, dy);
      }
      if (distance < 3) throw new Error("支撑握点过近，拒绝解算");
      const direction = Math.atan2(dy, dx);
      const bend = Math.acos(Math.max(-1, Math.min(1, (19 * 19 + distance * distance - 17 * 17) / (2 * 19 * distance))));
      const upperDirection = direction + bend;
      const elbow = [shoulder[0]! + 19 * Math.cos(upperDirection), shoulder[1]! + 19 * Math.sin(upperDirection)];
      const lowerDirection = Math.atan2(target[1]! - elbow[1]!, target[0]! - elbow[0]!);
      const upperDegrees = (upperDirection + Math.PI / 2) * 180 / Math.PI;
      const lowerDegrees = (lowerDirection - upperDirection) * 180 / Math.PI;
      const clipId = `gunner-${actionId}-${suffix}`;
      operations.push(
        { type: "upsert-keyframe", clipId, targetId: "upper_arm_left", property: "translation", time: timeSeconds, value: [shoulder[0], shoulder[1], 0] },
        { type: "upsert-keyframe", clipId, targetId: "upper_arm_left", property: "rotation", time: timeSeconds, value: q(upperDegrees) },
        { type: "upsert-keyframe", clipId, targetId: "forearm_left", property: "rotation", time: timeSeconds, value: q(lowerDegrees) },
      );
    }
  }
  await mcp("aic_apply_operations", { projectId, baseRevision: state.gripIkApplied ? 3 : 2, idempotencyKey: `gun05-pulse-support-ik-${state.gripIkApplied ? "prepare" : "fire-recover"}-v1-${suffix}`, operations });
  if (state.gripIkApplied) state.prepareIkApplied = true;
  else state.gripIkApplied = true;
  state.diagnostics = undefined;
  state.poseReport = undefined;
  state.poseSamples = undefined;
  save();
}
if (state.regionAlignmentVersion !== 1) {
  const summary = await mcp("aic_get_project_summary", { projectId, attachmentLimit: 32, boneLimit: 1 });
  if (summary.projectId !== projectId || summary.revision !== 4 || summary.skeleton?.id !== skeleton.id || summary.binding?.skeletonId !== skeleton.id || summary.binding?.attachmentCount !== 15) {
    throw new Error("枪手草稿绑定身份或 expectedRevision 不匹配，拒绝迁移");
  }
  const result = await mcp("aic_apply_operations", {
    projectId,
    baseRevision: summary.revision,
    idempotencyKey: `gun05-region-alignment-v1-${suffix}`,
    operations: [{ type: "upsert-binding", binding }],
  });
  if (result.revision !== 5) throw new Error("枪手绑定迁移 revision 异常");
  state.regionAlignmentVersion = 1;
  state.regionAlignmentReceipt = { revision: result.revision, idempotencyKey: `gun05-region-alignment-v1-${suffix}`, attachmentCount: binding.attachments.length };
  state.diagnostics = undefined;
  save();
}
if (state.poseReport?.version !== 2) {
  state.poseReport = undefined;
  state.poseSamples = undefined;
  save();
}
if (!state.diagnostics) {
  const result = await mcp("aic_get_diagnostics", { projectId });
  state.diagnostics = result;
  save();
  if (result.diagnostics?.some((item: any) => item.severity === "error")) throw new Error("草稿诊断仍有错误，检查检查点");
}
if (!state.poseReport) {
  const samples = state.poseSamples ?? [];
  for (const motion of motions) {
    for (const timeSeconds of [0, motion.duration / 2, motion.duration]) {
      if (samples.some((item: any) => item.actionId === motion.id && item.timeSeconds === timeSeconds)) continue;
      const result = await mcp("aic_sample_pose", { projectId, actionId: motion.id, timeSeconds, boneIds: ["root", "chest", "hand_left", "hand_right"], socketIds: ["primary_grip", "support_hand", "muzzle", "center"], bodyProfileId: body.id });
      const sockets = Object.fromEntries(result.sockets.map((item: any) => [item.id, item.position]));
      const primary = sockets.primary_grip as number[];
      const support = sockets.support_hand as number[];
      const hand = result.bones.find((item: any) => item.id === "hand_right").worldMatrix as number[];
      const target = [primary[0]! - 11 * hand[0]!, primary[1]! - 11 * hand[1]!, primary[2]!];
      const supportGripErrorPx = Math.hypot(...support.map((value, index) => value - target[index]!));
      samples.push({ actionId: motion.id, timeSeconds, sockets, supportGripErrorPx, supportReleased: ["stimulant", "emp", "orbital", "death"].includes(motion.id) });
      state.poseSamples = samples;
      save();
    }
  }
  state.poseReport = { version: 2, samples };
  save();
}
console.log(JSON.stringify({ status: "draft-not-published", projectId, checkpoint, diagnostics: state.diagnostics, poseReport: state.poseReport }, null, 2));
