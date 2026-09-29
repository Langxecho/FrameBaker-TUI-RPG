/** 只读采样当前枪手动作；结构检查不能替代贴图/动作目视验收。 */
import { writeFileSync } from "node:fs";
const base = "http://127.0.0.1:3025";
const projectId = "e59892ac-d398-4055-950f-883b00ac0abd";
async function read(path: string): Promise<any> {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${path}`);
  return response.json();
}
const summary = (await read(`/api/projects/${projectId}/aic-summary?boneLimit=0&attachmentLimit=0`)).summary;
if (summary.revision !== 14) throw new Error("只验收修正后的 revision 14");
const held = new Set(["idle", "basic_prepare", "basic_fire", "basic_recover", "hit"]);
const samples: any[] = [];
const failures: string[] = [];
for (const action of summary.actions) {
  for (let index = 0; index <= 8; index++) {
    const time = action.duration * index / 8;
    const query = new URLSearchParams({ actionId: action.id, timeSeconds: String(time),
      boneIds: "chest,upper_arm_left,upper_arm_right,forearm_left,forearm_right,hand_left,hand_right",
      socketIds: "primary_grip,support_hand,muzzle", bodyProfileId: "gunner-body-e59892ac" });
    const pose = (await read(`/api/projects/${projectId}/aic-pose?${query}`)).pose;
    if (pose.revision !== summary.revision) throw new Error("采样期间草稿变化");
    for (const bone of pose.bones) {
      if (!bone.worldMatrix.every(Number.isFinite)) failures.push(`${action.id}@${time}: ${bone.id} nonfinite`);
      if (bone.id.startsWith("upper_arm_")) {
        const expected = bone.id.endsWith("left") ? [-8, 3, 0] : [9, 3, 0];
        if (bone.local.translation.some((v: number, i: number) => Math.abs(v - expected[i]!) > 1e-6)) failures.push(`${action.id}@${time}: 肩线漂移`);
      }
    }
    const sockets = Object.fromEntries(pose.sockets.map((socket: any) => [socket.id, socket.position]));
    const hand = pose.bones.find((bone: any) => bone.id === "hand_right").worldMatrix;
    const target = sockets.primary_grip.map((value: number, i: number) => value + 11 * hand[i]);
    const gripError = Math.hypot(...target.map((value: number, i: number) => value - sockets.support_hand[i]));
    if (held.has(action.id) && gripError > 0.75) failures.push(`${action.id}@${time}: 脉冲阵列持握误差 ${gripError}`);
    samples.push({ actionId: action.id, timeSeconds: time, sockets, pulseGripError: held.has(action.id) ? gripError : null });
  }
}
const report = { projectId, revision: summary.revision, sampleCount: samples.length,
  heldGripMaxError: Math.max(...samples.map(sample => sample.pulseGripError ?? 0)),
  visualAcceptance: "separate-review-required", failures, samples };
writeFileSync("storage/aic-runs/gunner-shoulder-20260929/pose-check.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, samples: undefined }));
if (failures.length) process.exitCode = 1;
