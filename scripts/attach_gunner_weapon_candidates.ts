/** Upload repaired weapon images and make an idempotent narrow update to GUN-05. */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateLoadout } from "../packages/shared/src/index.ts";

const base = new URL(process.env.FRAMEBAKER_URL ?? "http://127.0.0.1:3025");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password) throw new Error("仅允许本地制作服务");
const projectId = "e59892ac-d398-4055-950f-883b00ac0abd";
const out = resolve("storage/aic-runs/gunner-weapons-20260929"); mkdirSync(out, { recursive: true });
const source = {
  fission: { path: resolve("storage/aic-runs/gunner-weapons-20260929/normalized/fission_projector.png"), sha256: "9b526ddd086e68c18f0a4f5f12b0f20e18f4f4c63a82fe9b3c534a0ef6ef853a" },
  phase: { path: resolve("storage/aic-runs/gunner-weapons-20260929/normalized/phase_piercer.png"), sha256: "565049101836c564efe1335d435b6e7797f260576d058e1ec1192505363d13bd" },
};
const checkpoint = resolve(process.env.GUNNER_CHECKPOINT ?? "storage/aic-runs/gunner-draft-20260928/recipe-state.json");
if (JSON.parse(readFileSync(checkpoint, "utf8")).projectId !== projectId) throw new Error("枪手草稿 projectId 不匹配");
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
for (const item of Object.values(source)) if (!existsSync(item.path) || sha(item.path) !== item.sha256) throw new Error(`规范化素材摘要不匹配: ${item.path}`);
let requestId = 1;
async function mcp(name: string, args: Record<string, unknown>): Promise<any> {
  const response = await fetch(new URL("/mcp", base), { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method: "tools/call", params: { name, arguments: args } }) });
  const body = await response.text(); const line = body.split("\n").find((item) => item.startsWith("data: ")); const envelope = JSON.parse(line ? line.slice(6) : body);
  if (envelope.error || envelope.result?.isError) throw new Error(`${name} failed: ${envelope.result?.content?.[0]?.text ?? envelope.error?.message ?? "unknown"}`);
  const content = envelope.result?.content?.find((item: any) => item.type === "text")?.text; if (!content) throw new Error(`${name} returned no structured content`); return JSON.parse(content);
}
async function upload(path: string, name: string): Promise<string> {
  const form = new FormData(); form.append("file", new Blob([readFileSync(path)], { type: "image/png" }), name);
  const response = await fetch(new URL("/api/materials/upload", base), { method: "POST", body: form }); if (!response.ok) throw new Error(`素材上传失败 ${response.status}: ${await response.text()}`);
  const result = await response.json() as { materialId?: string }; if (!result.materialId) throw new Error("素材上传响应缺少 materialId"); return result.materialId;
}
const summary = await mcp("aic_get_project_summary", { projectId, attachmentLimit: 64, boneLimit: 1 }); if (summary.revision < 7) throw new Error(`当前 revision=${summary.revision}，拒绝覆盖较旧草稿`);
const documentResponse = await fetch(new URL(`/api/projects/${projectId}/skeletal-document`, base)); if (!documentResponse.ok) throw new Error(`读取 skeletal document 失败: ${documentResponse.status}`); const document = (await documentResponse.json() as any).document;
const receiptPath = resolve(out, "attach-receipt.json"); const old = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, "utf8")) : null;
const materials = old?.materials?.fissionSha256 === source.fission.sha256 && old?.materials?.phaseSha256 === source.phase.sha256 ? { fission: old.materials.fission, phase: old.materials.phase } : { fission: await upload(source.fission.path, "gunner-fission-projector-repaired.png"), phase: await upload(source.phase.path, "gunner-phase-piercer-repaired.png") };
const equipment = document.equipment ?? []; const pulse = structuredClone(equipment.find((item: any) => item.id === "pulse-array-e59892ac")); const fission = structuredClone(equipment.find((item: any) => item.id === "fission-projector-e59892ac")); const phase = structuredClone(equipment.find((item: any) => item.id === "phase-piercer-e59892ac")); if (!pulse || !fission || !phase) throw new Error("找不到三件现有枪械定义");
pulse.tags = ["weapon"]; pulse.weapon.secondaryGrip.translation = [11, 0, 0];
fission.tags = ["weapon"]; fission.attachments[0].materialId = materials.fission; fission.weapon.secondaryGrip.translation = [23, 0, 0]; fission.weapon.muzzleSocket.translation = [40, 0, 0];
phase.tags = ["weapon"]; phase.attachments[0].materialId = materials.phase; phase.weapon.secondaryGrip.translation = [24, 0, 0]; phase.weapon.muzzleSocket.translation = [51, 0, 0];
const body = document.bodyProfiles?.find((item: any) => item.id === "gunner-body-e59892ac"); if (!body) throw new Error("找不到枪手 BodyProfile");
const compatibility = [pulse, fission, phase].map((item: any) => ({ equipmentId: item.id, result: validateLoadout(body, [item], { bodyProfileId: body.id, equipment: [{ equipmentId: item.id, primarySlot: item.primarySlot }] }) })); if (compatibility.some((item) => !item.result.ok)) throw new Error(`装备 loadout 不兼容: ${JSON.stringify(compatibility)}`);
const operations = [{ type: "upsert-equipment", equipment: pulse }, { type: "upsert-equipment", equipment: fission }, { type: "upsert-equipment", equipment: phase }]; const operationsHash = createHash("sha256").update(JSON.stringify(operations)).digest("hex"); const idempotencyKey = `gun05-weapon-candidates-repair-r${summary.revision}-${operationsHash.slice(0, 16)}`;
const result = await mcp("aic_apply_operations", { projectId, baseRevision: summary.revision, idempotencyKey, operations }); const after = await mcp("aic_get_project_summary", { projectId, attachmentLimit: 64, boneLimit: 1 });
const savedResponse = await fetch(new URL(`/api/projects/${projectId}/skeletal-document`, base)); if (!savedResponse.ok) throw new Error(`保存后读取 skeletal document 失败: ${savedResponse.status}`); const savedPayload = await savedResponse.json() as { document: any }; const savedDocument = savedPayload.document; const saved = (savedDocument.equipment ?? []).filter((item: any) => [pulse.id, fission.id, phase.id].includes(item.id)); if (saved.length !== 3 || saved.some((item: any) => JSON.stringify(item.tags) !== JSON.stringify(["weapon"]))) throw new Error("保存后装备标签未按预期更新");
const finalReceipt = { projectId, baseRevision: summary.revision, revision: result.revision, materialSource: source, materials: { fission: materials.fission, phase: materials.phase, fissionSha256: source.fission.sha256, phaseSha256: source.phase.sha256 }, operationsHash, idempotencyKey, compatibility, savedEquipment: saved, diagnostics: after.diagnostics, status: "draft-not-published", generatedAt: new Date().toISOString() }; writeFileSync(receiptPath, JSON.stringify(finalReceipt, null, 2)); console.log(JSON.stringify(finalReceipt, null, 2));
