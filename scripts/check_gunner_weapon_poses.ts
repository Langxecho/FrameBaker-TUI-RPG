/** 经公开姿态 API 验证装备覆盖的握点、肩线与技能松手，不代替视觉签收。 */
import { writeFileSync } from "node:fs";
const base = "http://127.0.0.1:3025";
const projectId = "e59892ac-d398-4055-950f-883b00ac0abd";
async function read(path: string): Promise<any> {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
  return response.json();
}
const summary = (await read(`/api/projects/${projectId}/aic-summary?boneLimit=0&attachmentLimit=0`)).summary;
if (summary.revision !== 15) throw new Error("仅检查 revision15 武器覆盖");
const document = (await read(`/api/projects/${projectId}/skeletal-document`)).document;
const held = new Set(["idle", "basic_prepare", "basic_fire", "basic_recover", "hit"]);
const failures: string[] = [], samples: any[] = [];
for (const weapon of [{ id: "pulse-array-e59892ac", grip: 11 },
  { id: "fission-projector-e59892ac", grip: 23 }, { id: "phase-piercer-e59892ac", grip: 24 }]) {
  const equipment = document.equipment.find((item: any) => item.id === weapon.id);
  for (const source of summary.actions.filter((action: any) => !action.id.includes("."))) {
    const actionId = equipment.actionOverrides?.[source.id] ?? source.id;
    if (!summary.actions.some((action: any) => action.id === actionId)) throw new Error(`缺少覆盖 ${actionId}`);
    for (let index = 0; index <= 16; index++) {
      const time = source.duration * index / 16;
      const query = new URLSearchParams({ actionId, timeSeconds: String(time),
        boneIds: "upper_arm_left,upper_arm_right,hand_left,hand_right",
        socketIds: "primary_grip,support_hand", bodyProfileId: "gunner-body-e59892ac" });
      const pose = (await read(`/api/projects/${projectId}/aic-pose?${query}`)).pose;
      if (pose.revision !== 15) throw new Error("采样期间草稿变化");
      for (const bone of pose.bones) {
        if (!bone.worldMatrix.every(Number.isFinite)) failures.push(`${actionId}: 非有限矩阵`);
        if (bone.id.startsWith("upper_arm_")) {
          const expected = bone.id.endsWith("left") ? [-8,3,0] : [9,3,0];
          if (bone.local.translation.some((value: number, i: number) => Math.abs(value - expected[i]!) > 1e-6)) failures.push(`${actionId}: 肩线漂移`);
        }
      }
      const sockets = Object.fromEntries(pose.sockets.map((socket: any) => [socket.id, socket.position]));
      const hand = pose.bones.find((bone: any) => bone.id === "hand_right").worldMatrix;
      const error = Math.hypot(...sockets.primary_grip.map((value: number, i: number) => value + weapon.grip * hand[i] - sockets.support_hand[i]));
      const holding = held.has(source.id) || index === 0 || (source.id !== "death" && index === 16);
      if (holding && error > 0.75) failures.push(`${actionId}@${time}: 握点误差 ${error}`);
      if (["stimulant", "emp", "orbital"].includes(source.id) && index === 8 && error < 3) failures.push(`${actionId}: 技能中段未松手`);
      samples.push({ weaponId: weapon.id, actionId, time, holding, gripError: error });
    }
  }
}
const report = { projectId, revision: 15, sampleCount: samples.length,
  heldGripMaxError: Math.max(...samples.filter(sample => sample.holding).map(sample => sample.gripError)),
  failures, visualAcceptance: "not-assessed", samples };
writeFileSync("storage/aic-runs/gunner-weapon-poses-20260929/pose-check.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, samples: undefined }));
if (failures.length) process.exitCode = 1;
