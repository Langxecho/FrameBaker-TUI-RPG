import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { MotionClip } from "../../../packages/shared/src/animation";
import type { SkeletalProjectDocument } from "../../../packages/shared/src/skeletalProject";
import { checkSprite, findSprite, normalizedSprite, renderCheckOverlay, type CheckReport } from "./checkArt";
import { currentRevision, fetchClip, fetchDocument, McpClient, uploadMaterial } from "./echo";
import { assertRevertable, checkClipPointers, checkLiveMaterials, liveSnapshot, planT03c, planT10b, planWiring, revertOperations, type AicOperation, type WiringPlanResult } from "./plans";
import { decodePng, encodePng, type RgbaImage } from "./png";
import { findLayer, layerToCanvas, readPsd } from "./psd";
import { clipIdFor, loadTask, type GunKey, type Her1State } from "./state";

export const REQUIRED_TOOLS = ["aic_get_project_summary", "aic_apply_operations"];

export interface RunContext {
  state: Her1State;
  statePath: string;
  outDir: string;
  mcpUrl: string;
  apiBase: string;
  projectId: string;
  log: (line: string) => void;
}

export interface ApplyGate {
  apply: boolean;
  expectedRev?: number;
  updateState: boolean;
}

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function loadArtLayer(path: string, layerName: string, log: (line: string) => void): RgbaImage {
  const bytes = new Uint8Array(readFileSync(path));
  if (path.toLowerCase().endsWith(".png")) return decodePng(bytes);
  const psd = readPsd(bytes);
  const layer = findLayer(psd, layerName);
  if (layer.hidden) log(`警告：图层「${layerName}」在 PSD 中是隐藏状态，仍按其像素检查`);
  if (layer.opacity < 255) log(`警告：图层「${layerName}」不透明度 ${layer.opacity}/255，会产生半透明像素`);
  return layerToCanvas(psd, layer);
}

function maskPixels(path: string): Array<[number, number]> {
  const mask = decodePng(new Uint8Array(readFileSync(path)));
  const out: Array<[number, number]> = [];
  for (let i = 0; i < mask.width * mask.height; i += 1) if (mask.data[i * 4 + 3] > 0) out.push([i % mask.width, Math.floor(i / mask.width)]);
  return out;
}

export interface CheckInput {
  packId: string;
  input: string;
  spriteId?: string;
  starter?: string;
  openEdgeMask?: string;
  record?: boolean;
}

export interface CheckOutcome { report: CheckReport; image: RgbaImage; spriteId: string; pngPath: string }

/** 离线检查美术交回件，写报告、叠加图和规范化 PNG；`record` 时把结论追加到 state.json。 */
export function runCheck(ctx: RunContext, input: CheckInput): CheckOutcome {
  const pack = ctx.state.packs[input.packId];
  if (!pack) throw new Error(`未知美术包 ${input.packId}`);
  const task = loadTask(ctx.state, input.packId);
  const sprite = findSprite(task, input.spriteId ?? pack.sprites.find((item) => basename(input.input) === item.psd)?.spriteId);
  const spriteState = pack.sprites.find((item) => item.spriteId === sprite.sprite_id);
  const image = loadArtLayer(input.input, pack.layerName, ctx.log);
  const report = checkSprite(image, task, sprite, {
    openEdgeBand: spriteState?.openEdge,
    extraOpenEdge: input.openEdgeMask ? maskPixels(input.openEdgeMask) : undefined,
    starter: input.starter ? decodePng(new Uint8Array(readFileSync(input.starter))) : undefined,
  });
  mkdirSync(ctx.outDir, { recursive: true });
  const stem = `${input.packId}_${sprite.sprite_id}`;
  writeJson(join(ctx.outDir, `${stem}_check.json`), { source: input.input, ...report });
  writeFileSync(join(ctx.outDir, `${stem}_check_overlay.png`), encodePng(renderCheckOverlay(image, report, sprite)));
  const pngPath = join(ctx.outDir, `${sprite.sprite_id}-her1.png`);
  if (report.verdict === "PASS") writeFileSync(pngPath, encodePng(normalizedSprite(image)));
  ctx.log(`${input.packId} ${sprite.sprite_id}: ${report.verdict}${report.failures.length ? ` — ${report.failures.join("；")}` : ""}`);
  ctx.log(`  不透明 ${report.opaquePixels} px，open_edge 豁免 ${report.openEdgeExempt} px${report.starterDelta ? `，相对起点改动 ${report.starterDelta.changed} px` : ""}`);
  ctx.log(`  报告与叠加图：${ctx.outDir}`);
  if (input.record) {
    pack.checkHistory.push({ round: basename(input.input), sprite: sprite.sprite_id, date: new Date().toISOString().slice(0, 10), verdict: report.verdict, semi: report.semiTransparent.length, outlineBreaks: report.outlineBreaks.length, offPalette: report.offPalette.length, source: "scripts/her1 check" });
    writeJson(ctx.statePath, ctx.state);
  }
  return { report, image, spriteId: sprite.sprite_id, pngPath };
}

export interface Connection { client: McpClient; revision: number; document: SkeletalProjectDocument }

/** 连接 ECHO：确认必需工具、读取 revision 与工程文档、核对 live 素材；任何一项不符都停止。 */
export async function connect(ctx: RunContext): Promise<Connection> {
  const client = new McpClient(ctx.mcpUrl);
  const tools = (await client.listTools()).map((tool) => tool.name);
  const missing = REQUIRED_TOOLS.filter((name) => !tools.includes(name));
  if (missing.length) throw new Error(`当前 FB 服务缺少工具：${missing.join("、")}（tools/list 共 ${tools.length} 个）`);
  const revision = await currentRevision(client, ctx.projectId);
  const document = await fetchDocument(ctx.apiBase, ctx.projectId);
  const live = checkLiveMaterials(document, ctx.state);
  const broken = live.filter((item) => !item.ok);
  if (broken.length) throw new Error(`live 素材与 state.json 不符，停止：${broken.map((item) => `${item.id} 期望 ${item.expected} 实际 ${item.actual ?? "缺失"}`).join("；")}`);
  ctx.log(`已连接 ${ctx.mcpUrl}：revision ${revision}（state.json 记录 ${ctx.state.echo.lastKnownRevision}），live 素材 ${live.length} 项一致`);
  return { client, revision, document };
}

function idempotencyKey(task: string, revision: number, operations: AicOperation[]): string {
  return `her1-${task}-r${revision}-${createHash("sha256").update(JSON.stringify(operations)).digest("hex").slice(0, 16)}`;
}

export interface ApplyOutcome { revision: number; after: SkeletalProjectDocument; result: unknown }

/** 上传素材前就要过 revision 闸门，否则 revision 不符时会在 ECHO 留下孤儿素材。 */
function assertRevisionGate(connection: Connection, gate: ApplyGate): void {
  if (!gate.apply) return;
  if (gate.expectedRev !== connection.revision) throw new Error(`--expected-rev ${gate.expectedRev ?? "（未给）"} 与当前 revision ${connection.revision} 不符；重新 dry-run 核对后再 apply`);
}

/** 带 revision 闸门写入；写后重读，live 快照必须逐字节不变。 */
export async function applyGuarded(ctx: RunContext, connection: Connection, task: string, operations: AicOperation[], gate: ApplyGate): Promise<ApplyOutcome> {
  assertRevisionGate(connection, { ...gate, apply: true });
  if (operations.length > 64) throw new Error(`单次最多 64 个操作（当前 ${operations.length}）`);
  const key = idempotencyKey(task, connection.revision, operations);
  const result = await connection.client.callJson<{ revision?: number }>("aic_apply_operations", { projectId: ctx.projectId, baseRevision: connection.revision, idempotencyKey: key, operations });
  const after = await fetchDocument(ctx.apiBase, ctx.projectId);
  if (liveSnapshot(after) !== liveSnapshot(connection.document)) throw new Error("写入后 live 快照发生变化！立即停止，按 docs/her1/ECHO_RUNBOOK.md 回退并回报 ECHO");
  const live = checkLiveMaterials(after, ctx.state).filter((item) => !item.ok);
  if (live.length) throw new Error(`写入后 live 素材不符：${live.map((item) => item.id).join("、")}`);
  const revision = typeof result?.revision === "number" ? result.revision : await currentRevision(connection.client, ctx.projectId);
  ctx.log(`已写入 revision ${connection.revision} → ${revision}（幂等键 ${key}），live 未变`);
  return { revision, after, result };
}

/** 计划与回退操作同时落盘；apply 失败或自审 FAIL 时用 `revert --ops <name>-revert-operations.json` 恢复。 */
function writePlan(ctx: RunContext, name: string, connection: Connection, operations: AicOperation[]): void {
  mkdirSync(ctx.outDir, { recursive: true });
  writeJson(join(ctx.outDir, `${name}-operations.json`), operations);
  writeJson(join(ctx.outDir, `${name}-revert-operations.json`), revertOperations(connection.document, operations));
}

function receipt(ctx: RunContext, name: string, body: Record<string, unknown>): void {
  writeJson(join(ctx.outDir, `${name}-receipt.json`), { createdAt: new Date().toISOString(), projectId: ctx.projectId, mcpUrl: ctx.mcpUrl, ...body });
}

function reportIssues(ctx: RunContext, plan: WiringPlanResult): void {
  for (const issue of plan.issues) ctx.log(`  ${issue.severity === "error" ? "错误" : "警告"} ${issue.code} ${issue.clipId} ${issue.attachmentId}${issue.time === undefined ? "" : ` t=${issue.time}`}：${issue.detail}`);
  if (plan.issues.some((issue) => issue.severity === "error")) throw new Error("新 clip 违反 Region 显隐规范，未写入");
}

async function fetchBaseClips(ctx: RunContext, gun: GunKey, baseTag: string, phases: string[]): Promise<Record<string, MotionClip>> {
  const out: Record<string, MotionClip> = {};
  for (const phase of phases) out[phase] = await fetchClip(ctx.apiBase, clipIdFor(ctx.state.guns[gun], phase, baseTag));
  return out;
}

function nextSteps(ctx: RunContext, applied: boolean, task: string, revision: number): void {
  if (!applied) {
    ctx.log(`dry-run 完成，计划写在 ${ctx.outDir}。确认后加 --apply --expected-rev ${revision} 执行。`);
    return;
  }
  ctx.log("下一步：按 skill/her1-fb-self-qc 自渲染受影响动作并看图；PASS 前不发给 ECHO、不联络美术对接师。");
  ctx.log(`然后更新 docs/her1/README.md 的 ${task} 小节并提交（state.json 已由脚本同步）。`);
}

export async function runT03c(ctx: RunContext, input: { input: string; record?: boolean } & ApplyGate): Promise<void> {
  const check = runCheck(ctx, { packId: "T03c", input: input.input, record: input.record });
  if (check.report.verdict !== "PASS") throw new Error("check_art FAIL：退回美术，不 rematerialize");
  const task = loadTask(ctx.state, "T03c");
  const connection = await connect(ctx);
  assertRevisionGate(connection, input);
  const pointers = checkClipPointers(connection.document, ctx.state).filter((item) => item.gun === "G3" && !item.ok);
  for (const item of pointers) ctx.log(`  警告：${item.actionId} 指向 ${item.actual ?? "缺失"}，state.json 期望 ${item.expected}`);
  const png = new Uint8Array(readFileSync(check.pngPath));
  const materialId = input.apply
    ? await uploadMaterial(ctx.apiBase, png, basename(check.pngPath), { her1Task: "T03c", spriteId: check.spriteId, sha256: createHash("sha256").update(png).digest("hex"), source: basename(input.input) })
    : "pending-upload:hand_sup_g3_y";
  const operations = planT03c(connection.document, ctx.state, task, materialId);
  writePlan(ctx, "T03c", connection, operations);
  ctx.log(`计划：${operations.length} 个 upsert-equipment（${operations.map((op) => op.type === "upsert-equipment" ? op.equipment.id : op.type).join("、")}），只换 support-hand 素材/尺寸/轴心`);
  if (!input.apply) return nextSteps(ctx, false, "T03c", connection.revision);
  const outcome = await applyGuarded(ctx, connection, "t03c", operations, input);
  receipt(ctx, "T03c", { revisionBefore: connection.revision, revisionAfter: outcome.revision, materialId, operations: operations.length, check: check.report.verdict });
  if (input.updateState) {
    const sprite = ctx.state.packs.T03c.sprites[0];
    sprite.target.currentMaterial = materialId.slice(0, 8);
    sprite.target.currentSize = [task.sprites[0].native_size[0] * 2, task.sprites[0].native_size[1] * 2];
    ctx.state.packs.T03c.status = "rematerialized-pending-self-qc";
    ctx.state.echo.lastKnownRevision = outcome.revision;
    writeJson(ctx.statePath, ctx.state);
  }
  nextSteps(ctx, true, "T03c", outcome.revision);
}

export async function runT10b(ctx: RunContext, input: { forearm: string; elbow?: string; tag: string; phases: string[]; wiring: boolean; record?: boolean } & ApplyGate): Promise<void> {
  const pack = ctx.state.packs.T10b;
  const files: Record<string, string> = { [pack.sprites[0].spriteId]: input.forearm };
  if (input.elbow && pack.sprites[1]) files[pack.sprites[1].spriteId] = input.elbow;
  const checks: CheckOutcome[] = [];
  for (const [spriteId, path] of Object.entries(files)) checks.push(runCheck(ctx, { packId: "T10b", input: path, spriteId, record: input.record }));
  if (checks.some((item) => item.report.verdict !== "PASS")) throw new Error("check_art FAIL：退回美术，不 rematerialize");
  const task = loadTask(ctx.state, "T10b");
  const connection = await connect(ctx);
  assertRevisionGate(connection, input);
  const baseClips = input.wiring ? await fetchBaseClips(ctx, pack.gun, pack.wiring.baseClipTag, input.phases) : {};
  const materials: Record<string, string> = {};
  for (const item of checks) {
    const png = new Uint8Array(readFileSync(item.pngPath));
    materials[item.spriteId] = input.apply
      ? await uploadMaterial(ctx.apiBase, png, basename(item.pngPath), { her1Task: "T10b", spriteId: item.spriteId, sha256: createHash("sha256").update(png).digest("hex") })
      : `pending-upload:${item.spriteId}`;
  }
  const plan = planT10b(connection.document, ctx.state, task, { materials, baseClips, tag: input.tag, phases: input.phases, wiring: input.wiring });
  reportIssues(ctx, plan);
  writePlan(ctx, "T10b", connection, plan.operations);
  for (const clip of plan.newClips) writeJson(join(ctx.outDir, `${clip.id.replace(/[:/]/g, "_")}.json`), clip);
  ctx.log(`计划：upsert-binding 1 个；新 clip ${plan.newClips.map((clip) => clip.id).join("、") || "（不接线）"}`);
  if (!input.apply) return nextSteps(ctx, false, "T10b", connection.revision);
  const outcome = await applyGuarded(ctx, connection, "t10b", plan.operations, input);
  receipt(ctx, "T10b", { revisionBefore: connection.revision, revisionAfter: outcome.revision, materials, newClips: plan.newClips.map((clip) => clip.id), warnings: plan.issues });
  if (input.updateState) {
    for (const sprite of pack.sprites) {
      const materialId = materials[sprite.spriteId];
      if (!materialId) continue;
      const native = task.sprites.find((item) => item.sprite_id === sprite.spriteId)!.native_size;
      sprite.target.currentMaterial = materialId.slice(0, 8);
      sprite.target.currentSize = [native[0] * 2, native[1] * 2];
    }
    if (input.wiring) setPhaseTags(ctx.state, pack.gun, input.phases, input.tag);
    pack.status = "rematerialized-pending-self-qc";
    ctx.state.echo.lastKnownRevision = outcome.revision;
    writeJson(ctx.statePath, ctx.state);
  }
  nextSteps(ctx, true, "T10b", outcome.revision);
}

function setPhaseTags(state: Her1State, gun: GunKey, phases: string[], tag: string): void {
  const entry = state.guns[gun];
  entry.phaseClipTags = { ...(entry.phaseClipTags ?? {}) };
  for (const phase of phases) entry.phaseClipTags[phase] = tag;
}

export async function runWire(ctx: RunContext, input: { gun: GunKey; baseTag: string; tag: string; phases: string[]; show: string[]; strip: string[] } & ApplyGate): Promise<void> {
  const connection = await connect(ctx);
  assertRevisionGate(connection, input);
  const baseClips = await fetchBaseClips(ctx, input.gun, input.baseTag, input.phases);
  const plan = planWiring(connection.document, ctx.state, { ...input, baseClips });
  reportIssues(ctx, plan);
  writePlan(ctx, "wire", connection, plan.operations);
  ctx.log(`计划：新 clip ${plan.newClips.map((clip) => clip.id).join("、")}`);
  if (!input.apply) return nextSteps(ctx, false, `${input.gun} 接线`, connection.revision);
  const outcome = await applyGuarded(ctx, connection, `wire-${input.gun.toLowerCase()}-${input.tag}`, plan.operations, input);
  receipt(ctx, `wire-${input.gun}`, { revisionBefore: connection.revision, revisionAfter: outcome.revision, newClips: plan.newClips.map((clip) => clip.id), warnings: plan.issues });
  if (input.updateState) {
    setPhaseTags(ctx.state, input.gun, input.phases, input.tag);
    ctx.state.echo.lastKnownRevision = outcome.revision;
    writeJson(ctx.statePath, ctx.state);
  }
  nextSteps(ctx, true, `${input.gun} 接线`, outcome.revision);
}

/** 只读核对：工具、revision、live 素材、her1bt 指针。 */
export async function runProbe(ctx: RunContext): Promise<{ revision: number; pointerMismatches: number }> {
  const connection = await connect(ctx);
  const pointers = checkClipPointers(connection.document, ctx.state);
  const mismatches = pointers.filter((item) => !item.ok);
  for (const item of pointers) ctx.log(`  ${item.ok ? "OK " : "≠  "} ${item.actionId} → ${item.actual ?? "缺失"}${item.ok ? "" : `（期望 ${item.expected}）`}`);
  const her1Equipment = Object.values(ctx.state.guns).flatMap((gun) => gun.her1Equipment);
  const missingEquipment = her1Equipment.filter((id) => !(connection.document.equipment ?? []).some((item) => item.id === id));
  if (missingEquipment.length) ctx.log(`  缺少 her1 装备：${missingEquipment.join("、")}`);
  mkdirSync(ctx.outDir, { recursive: true });
  receipt(ctx, "probe", { revision: connection.revision, pointers, missingEquipment });
  if (connection.revision !== ctx.state.echo.lastKnownRevision) ctx.log(`注意：revision 已从 ${ctx.state.echo.lastKnownRevision} 变为 ${connection.revision}，先核对变化来源并更新 docs/her1`);
  return { revision: connection.revision, pointerMismatches: mismatches.length };
}

/** 应用某次运行留下的回退操作；同样要求 --expected-rev，写后核对 live。state.json 需随 git 一并改回。 */
export async function runRevert(ctx: RunContext, input: { ops: string } & ApplyGate): Promise<void> {
  const operations = JSON.parse(readFileSync(input.ops, "utf8")) as AicOperation[];
  assertRevertable(operations);
  const connection = await connect(ctx);
  assertRevisionGate(connection, input);
  ctx.log(`回退计划：${operations.map((op) => op.type === "upsert-equipment" ? `装备 ${op.equipment.id}` : op.type === "upsert-action" ? `动作 ${op.action.id} → ${op.action.motionClipId}` : op.type).join("、")}`);
  if (!input.apply) return nextSteps(ctx, false, "回退", connection.revision);
  const outcome = await applyGuarded(ctx, connection, "revert", operations, input);
  receipt(ctx, "revert", { revisionBefore: connection.revision, revisionAfter: outcome.revision, source: input.ops, operations: operations.length });
  if (input.updateState) {
    ctx.state.echo.lastKnownRevision = outcome.revision;
    writeJson(ctx.statePath, ctx.state);
  }
  ctx.log("已回退。把 docs/her1/state.json 中对应任务的素材/状态/phaseClipTags 改回（git 历史里有写入前版本），并在 docs/her1/README.md 记一笔。");
}
