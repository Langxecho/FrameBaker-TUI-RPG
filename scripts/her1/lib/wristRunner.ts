import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { MotionClip } from "../../../packages/shared/src/animation";
import { fetchClip, fetchMaterialImage, fetchSkeleton } from "./echo";
import type { AicOperation } from "./plans";
import { decodePng, encodePng, type RgbaImage } from "./png";
import type { EquipmentDefinition } from "../../../packages/shared/src/equipment";
import type { SkeletalProjectDocument } from "../../../packages/shared/src/skeletalProject";
import { composeScene, flattenChecker, rasterize, sceneBounds, upscale, type IkMode } from "./render";
import { applyGuarded, assertRevisionGate, connect, receipt, writeJson, writePlan, type ApplyGate, type RunContext } from "./runner";
import { hstack, measureSeam, type SeamMetrics, type SeamSpec } from "./seam";
import { clipKeyTimes, ensureDir, loadSnapshot, safeFileName, selectMaterials, snapshotPath, writeJsonFile, type LoadedSnapshot, type SnapshotManifest } from "./snapshot";
import { actionIdFor, clipIdFor, loadTask, REPO_ROOT, type GunKey, type Her1State } from "./state";
import { auditClipVisibility, collectRestScales } from "./visibility";
import { deriveWristFixClip, MAX_ALIGN_DEG, type WristFixSpec } from "./wristFix";
import { activeSupportIk, analyzeIkWrist, applyIkLever, classifyIkWrist, cutForEquipment, VERDICT_LABEL, type ArtSpec, type IkLever, type SupportIk, type WristVerdict } from "./wristIk";

export const CORE_PHASES = ["idle", "prepare", "aim", "fire", "recover"];
export const RENDER_TOOL = "aic_render_preview";

export interface WristDefaults { handAttachmentId: string; farRootBone: string; upperBone: string; lowerBone: string }
export const G3_WRIST: WristDefaults = { handAttachmentId: "c34-g3-K02-p19v-p19y-her1:support-hand", farRootBone: "upper_arm_far", upperBone: "upper_arm_far", lowerBone: "forearm_far" };

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** 腕口度量规格取自 T03c 合同：接缝带、原生尺寸、描边色。 */
export function seamSpecFromState(state: Her1State, defaults: WristDefaults, farRootBone = defaults.farRootBone): SeamSpec {
  const task = loadTask(state, "T03c");
  const sprite = task.sprites[0]!;
  const band = state.packs.T03c.sprites[0]?.openEdge?.band ?? sprite.intended_open_edge_band;
  if (!band) throw new Error("T03c 合同没有接缝带");
  const outline = task.palette.find((entry) => entry.key === "outline")?.rgb ?? [9, 5, 9];
  return { handAttachmentId: defaults.handAttachmentId, farRootBone, joinRootBone: defaults.lowerBone, openBand: [...band] as [number, number, number, number], nativeSize: [...sprite.native_size] as [number, number], outline: [...outline] as [number, number, number] };
}

function substitute(value: unknown, vars: Record<string, string | number>): unknown {
  if (typeof value === "string") {
    const exact = /^\{(\w+)\}$/.exec(value);
    if (exact && exact[1]! in vars) return vars[exact[1]!];
    return value.replace(/\{(\w+)\}/g, (match, key: string) => key in vars ? String(vars[key]) : match);
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, vars));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, vars)]));
  return value;
}

function evenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.round(i * (items.length - 1) / (max - 1))]!);
}

/** ECHO 只读：导出工程文档、骨架、her1bt clip、素材；可选按模板调 aic_render_preview 存参考图。 */
export async function runSnapshot(ctx: RunContext, input: { gun: GunKey; equipmentIds?: string[]; dir?: string; renderArgs?: string; maxRefTimes: number; farRootBone: string }): Promise<string> {
  const gun = ctx.state.guns[input.gun];
  const connection = await connect(ctx);
  const { document } = connection;
  const binding = document.character?.binding;
  if (!binding) throw new Error("工程没有 binding");
  const dir = ensureDir(input.dir ?? join(REPO_ROOT, "docs", "her1", "snapshots", `r${connection.revision}-${input.gun.toLowerCase()}`));
  ensureDir(join(dir, "clips"));
  ensureDir(join(dir, "materials"));
  const skeleton = await fetchSkeleton(ctx.apiBase, binding.skeletonId);
  const actions: SnapshotManifest["actions"] = [];
  const clips: MotionClip[] = [];
  for (const phase of ctx.state.phases) {
    const actionId = actionIdFor(gun, phase);
    const action = document.animations.find((item) => item.id === actionId);
    if (!action) { if (CORE_PHASES.includes(phase)) ctx.log(`  警告：缺动作 ${actionId}`); continue; }
    const clip = await fetchClip(ctx.apiBase, action.motionClipId);
    const clipFile = snapshotPath("clips", `${safeFileName(clip.id)}.json`);
    writeJsonFile(join(dir, clipFile), clip);
    actions.push({ phase, actionId, motionClipId: action.motionClipId, clipFile });
    clips.push(clip);
  }
  const equipmentIds = input.equipmentIds ?? gun.her1Equipment.filter((id) => (document.equipment ?? []).some((item) => item.id === id));
  const wanted = selectMaterials(document, skeleton, clips, equipmentIds.slice(-1), input.farRootBone);
  for (const id of equipmentIds.slice(0, -1)) for (const [materialId, entry] of selectMaterials(document, skeleton, [], [id], input.farRootBone)) if (!wanted.has(materialId)) wanted.set(materialId, entry);
  const materials: SnapshotManifest["materials"] = [];
  const missingMaterials: SnapshotManifest["missingMaterials"] = [];
  for (const [materialId, entry] of wanted) {
    try {
      const bytes = await fetchMaterialImage(ctx.apiBase, materialId, entry.imageSlot);
      const image = decodePng(bytes);
      const file = snapshotPath("materials", `${safeFileName(materialId)}.png`);
      writeFileSync(join(dir, file), bytes);
      materials.push({ materialId, file, imageSlot: entry.imageSlot, attachmentIds: [...entry.attachmentIds].sort(), size: [image.width, image.height] });
    } catch (error) {
      missingMaterials.push({ materialId, error: (error as Error).message });
    }
  }
  const tools = await connection.client.listTools();
  const renderTool = tools.find((tool) => tool.name === RENDER_TOOL);
  const references: SnapshotManifest["references"] = [];
  if (input.renderArgs) {
    if (!renderTool) throw new Error(`当前服务没有 ${RENDER_TOOL}，不能存参考渲染`);
    ensureDir(join(dir, "references"));
    const template = JSON.parse(readFileSync(input.renderArgs, "utf8")) as unknown;
    for (const action of actions.filter((item) => CORE_PHASES.includes(item.phase))) {
      const clip = clips.find((item) => item.id === action.motionClipId)!;
      for (const time of evenly(clipKeyTimes(clip), input.maxRefTimes)) {
        const args = substitute(template, { projectId: ctx.projectId, actionId: action.actionId, clipId: action.motionClipId, phase: action.phase, time, equipmentId: equipmentIds.at(-1) ?? "" }) as Record<string, unknown>;
        const result = await connection.client.callTool(RENDER_TOOL, args);
        if (result.isError || !result.images.length) { ctx.log(`  参考渲染失败 ${action.phase} t=${time}：${result.texts.join(" ").slice(0, 200)}`); continue; }
        const file = snapshotPath("references", `${action.phase}_t${time.toFixed(3)}.png`);
        writeFileSync(join(dir, file), result.images[0]!.data);
        references.push({ phase: action.phase, time, file, equipmentId: equipmentIds.at(-1) });
      }
    }
  }
  writeJsonFile(join(dir, "document.json"), document);
  writeJsonFile(join(dir, "skeleton.json"), skeleton);
  const manifest: SnapshotManifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    projectId: ctx.projectId,
    revision: connection.revision,
    gun: input.gun,
    equipmentIds,
    skeletonId: skeleton.id,
    actions,
    materials,
    missingMaterials,
    renderTool: renderTool ? { name: renderTool.name, inputSchema: renderTool.inputSchema } : undefined,
    references,
    notes: ["只读快照；live 未改。", `素材 ${materials.length} 张，缺 ${missingMaterials.length} 张；参考渲染 ${references.length} 张。`],
  };
  writeJsonFile(join(dir, "manifest.json"), manifest);
  ctx.log(`快照已写入 ${dir}（rev ${connection.revision}，动作 ${actions.length}，素材 ${materials.length}，缺 ${missingMaterials.length}，参考图 ${references.length}）`);
  const branch = `her1/snapshot-r${connection.revision}-${input.gun.toLowerCase()}`;
  ctx.log(`推给云端（单独分支，不进 PR）：git switch -c ${branch} && git add -f ${relative(REPO_ROOT, dir)} && git commit -m "her1: ${input.gun} 只读快照 r${connection.revision}" && git push -u origin ${branch}`);
  return dir;
}

export interface RenderInput {
  snapshot: string;
  phases?: string[];
  times?: number[];
  /** 按态指定时刻（优先于 times）；fix-wrist 用它让修前/修后同一时刻对照。 */
  phaseTimes?: Record<string, number[]>;
  maxTimes: number;
  plan?: string;
  equipmentId?: string;
  ik: IkMode;
  zoom: number;
  farRootBone: string;
  defaults: WristDefaults;
}

export interface RenderOutcome { metrics: Array<SeamMetrics & { phase: string; clipId: string }>; pass: boolean; outDir: string }

interface PlanFile {
  kind: "her1-wrist-fix";
  createdAt: string;
  gun: GunKey;
  snapshotRevision: number;
  baseTag: string;
  tag: string;
  spec: Omit<WristFixSpec, "equipmentIds"> & { equipmentIds: string[] };
  phases: Array<{ phase: string; actionId: string; baseClipId: string; baseClipSha: string; newClipId: string; clipFile: string; maxResidual: number; worstAlignDeg: number }>;
  operations: AicOperation[];
  selfQc?: { verdict: "PASS" | "FAIL"; failures: number; frames: number };
  /** clip：改远臂旋转轨；equipment-ik：远臂被双手 IK 驱动，改 her1 装备杠杆。 */
  mode?: "clip" | "equipment-ik";
  verdict?: WristVerdict;
  verdictLabel?: string;
  /** equipment-ik：候选装备（自审未过时只供 render --plan 复现，不进 operations）。 */
  candidateEquipment?: EquipmentDefinition;
  baseEquipment?: { id: string; sha: string };
  ik?: { constraintId: string; baseline: { worstAlignDeg: number; medianCutGap: number; unreachable: number }; best: { lever: IkLever; worstAlignDeg: number; unreachable: number }; artSpec: ArtSpec };
}

function readPlan(planPath?: string): PlanFile | undefined {
  return planPath ? JSON.parse(readFileSync(planPath, "utf8")) as PlanFile : undefined;
}

function clipsForRender(snapshot: LoadedSnapshot, planPath?: string): Record<string, MotionClip> {
  const plan = readPlan(planPath);
  if (!plan || !planPath) return snapshot.clips;
  const out = { ...snapshot.clips };
  const dir = join(planPath, "..");
  for (const phase of plan.phases) out[phase.phase] = JSON.parse(readFileSync(join(dir, phase.clipFile), "utf8")) as MotionClip;
  return out;
}

function documentForRender(snapshot: LoadedSnapshot, plan?: PlanFile): SkeletalProjectDocument {
  const candidate = plan?.candidateEquipment;
  if (!candidate) return snapshot.document;
  return { ...snapshot.document, equipment: [...(snapshot.document.equipment ?? []).filter((item) => item.id !== candidate.id), candidate] };
}

function defaultEquipment(snapshot: LoadedSnapshot, override?: string): string[] {
  return [override ?? snapshot.manifest.equipmentIds.at(-1)!].filter(Boolean);
}

const RENDER_FRAMES = 8;

function renderTimes(clip: MotionClip, times: number[] | undefined, max: number): number[] {
  if (times?.length) return times.filter((t) => t <= clip.duration + 1e-6);
  const keys = clipKeyTimes(clip);
  const mids = keys.slice(1).map((t, i) => Math.round((t + keys[i]!) / 2 * 1000) / 1000);
  return evenly([...new Set([...keys, ...mids])].sort((a, b) => a - b), max);
}

/** 自动选帧时并上 ECHO 参考图时刻，方便逐张对照。 */
function framesFor(snapshot: LoadedSnapshot, phase: string, clip: MotionClip, max: number): number[] {
  const refs = snapshot.manifest.references.filter((ref) => ref.phase === phase).map((ref) => ref.time);
  return [...new Set([...renderTimes(clip, undefined, max), ...refs].map((t) => Math.round(t * 1000) / 1000))].filter((t) => t <= clip.duration + 1e-6).sort((a, b) => a - b);
}

const evenTimes = (clip: MotionClip, steps: number) => Array.from({ length: steps + 1 }, (_, i) => Math.round(clip.duration * i / steps * 1e6) / 1e6);

/** 离线渲染 + 腕口度量：每帧全身图（×2）、腕口特写叠加（×zoom）、可选与 ECHO 参考图并排；结果写 seam.json。 */
export function runRender(ctx: RunContext, input: RenderInput): RenderOutcome {
  const snapshot = loadSnapshot(input.snapshot);
  const plan = readPlan(input.plan);
  const clips = clipsForRender(snapshot, input.plan);
  const document = documentForRender(snapshot, plan);
  const spec = seamSpecFromState(ctx.state, input.defaults, input.farRootBone);
  const equipmentIds = defaultEquipment(snapshot, input.equipmentId ?? plan?.candidateEquipment?.id);
  const phases = input.phases ?? snapshot.manifest.actions.map((item) => item.phase).filter((phase) => CORE_PHASES.includes(phase));
  const outDir = ensureDir(ctx.outDir);
  const metrics: RenderOutcome["metrics"] = [];
  const missing = new Set<string>();
  for (const phase of phases) {
    const clip = clips[phase];
    if (!clip) { ctx.log(`  ${phase}: 快照里没有 clip`); continue; }
    const strip: RgbaImage[] = [];
    const explicit = input.phaseTimes?.[phase] ?? input.times;
    for (const time of explicit?.length ? renderTimes(clip, explicit, input.maxTimes) : framesFor(snapshot, phase, clip, input.maxTimes)) {
      const scene = composeScene({ document, skeleton: snapshot.skeleton, clip, time, equipmentIds, ik: input.ik });
      for (const item of scene.items) if (!snapshot.images.has(item.materialId) && item.world && Math.abs(item.world[0]) + Math.abs(item.world[1]) > 0.01) missing.add(item.attachmentId);
      const full = rasterize(scene.items, snapshot.images, { bounds: sceneBounds(scene.items) });
      const stem = `${phase}_t${time.toFixed(3)}`;
      const fullImage = upscale(flattenChecker(full.image), 2);
      writeFileSync(join(outDir, `${stem}.png`), encodePng(fullImage));
      const seam = measureSeam(scene, snapshot.images, snapshot.skeleton, spec, { time, zoom: input.zoom });
      if (seam.overlay) {
        writeFileSync(join(outDir, `${stem}_wrist.png`), encodePng(seam.overlay));
        strip.push(seam.overlay);
      }
      const reference = snapshot.manifest.references.find((ref) => ref.phase === phase && Math.abs(ref.time - time) < 1e-3);
      if (reference && existsSync(join(snapshot.dir, reference.file))) {
        const echo = decodePng(new Uint8Array(readFileSync(join(snapshot.dir, reference.file))));
        writeFileSync(join(outDir, `${stem}_vs_echo.png`), encodePng(hstack([fullImage, flattenChecker(echo)])));
      }
      metrics.push({ ...seam.metrics, phase, clipId: clip.id });
      const m = seam.metrics;
      ctx.log(`  ${phase.padEnd(7)} t=${time.toFixed(3)} ${m.verdict}  接上 ${(m.joinRatio * 100).toFixed(0)}%（${m.joined}/${m.beyondSamples}）露出 ${m.exposed} 最大空档 ${m.maxGap.toFixed(1)} 透底缝 ${m.gapPixels}${m.reasons.length ? ` — ${m.reasons.join("；")}` : ""}`);
    }
    if (strip.length) writeFileSync(join(outDir, `${phase}_wrist_strip.png`), encodePng(hstack(strip)));
  }
  if (missing.size) ctx.log(`  注意：快照缺这些可见部件的素材（未画）：${[...missing].join("、")}`);
  const failures = metrics.filter((m) => m.verdict === "FAIL").length;
  writeJson(join(outDir, "seam.json"), { snapshot: input.snapshot, plan: input.plan ?? null, equipmentIds, ik: input.ik, spec, failures, frames: metrics.length, metrics });
  ctx.log(`腕口度量：${metrics.length} 帧，FAIL ${failures}；图与 seam.json 在 ${outDir}`);
  return { metrics, pass: metrics.length > 0 && failures === 0, outDir };
}

export interface FixWristInput {
  snapshot: string;
  gun: GunKey;
  tag: string;
  phases?: string[];
  upperBone: string;
  lowerBone: string;
  farRootBone: string;
  overlap: number;
  step: number;
  maxDelta: number;
  equipmentId?: string;
  defaults: WristDefaults;
  zoom: number;
}

/** 离线求解：远臂两骨逐采样烘焙，派生 her1 新 clip + 动作改指向的计划；随后前后对比渲染并自审。 */
export function runFixWrist(ctx: RunContext, input: FixWristInput): { planPath: string; pass: boolean } {
  const snapshot = loadSnapshot(input.snapshot);
  const gun = ctx.state.guns[input.gun];
  if (ctx.state.retiredClipTags[input.tag]) throw new Error(`tag ${input.tag} 已退役：${ctx.state.retiredClipTags[input.tag]}`);
  const equipmentIds = defaultEquipment(snapshot, input.equipmentId);
  const spec: WristFixSpec = { ...seamSpecFromState(ctx.state, input.defaults, input.farRootBone), upperBone: input.upperBone, lowerBone: input.lowerBone, equipmentIds, overlap: input.overlap, step: input.step, maxDelta: input.maxDelta };
  const phases = input.phases ?? snapshot.manifest.actions.map((item) => item.phase).filter((phase) => CORE_PHASES.includes(phase));
  const ik = equipmentIds[0] ? activeSupportIk(snapshot.document, snapshot.skeleton, equipmentIds[0], spec.handAttachmentId) : null;
  if (ik) return runFixWristIk(ctx, input, snapshot, spec, phases, ik);
  const restScales = collectRestScales(snapshot.document);
  const outDir = ensureDir(ctx.outDir);
  const plan: PlanFile = { kind: "her1-wrist-fix", createdAt: new Date().toISOString(), gun: input.gun, snapshotRevision: snapshot.manifest.revision, baseTag: "", tag: input.tag, spec, phases: [], operations: [] };
  const samples: Record<string, unknown> = {};
  const phaseTimes: Record<string, number[]> = {};
  for (const phase of phases) {
    const action = snapshot.manifest.actions.find((item) => item.phase === phase);
    const base = snapshot.clips[phase];
    if (!action || !base) throw new Error(`快照缺 ${phase}`);
    const baseTag = base.id.split("-clip-")[1] ?? "";
    plan.baseTag ||= baseTag;
    const newClipId = clipIdFor(gun, phase, input.tag);
    const result = deriveWristFixClip(snapshot.document, snapshot.skeleton, snapshot.images, base, newClipId, spec);
    const issues = auditClipVisibility(result.clip, restScales, ctx.state.visibility).filter((issue) => issue.severity === "error");
    if (issues.length) throw new Error(`${newClipId} 违反显隐规范：${issues.map((issue) => issue.code).join("、")}`);
    const clipFile = `${safeFileName(newClipId)}.clip.json`;
    writeJson(join(outDir, clipFile), result.clip);
    samples[phase] = result;
    const unreachable = result.samples.filter((s) => s.note).length;
    const worstBefore = Math.max(0, ...result.samples.map((s) => s.before ?? 0));
    const worstAlign = Math.max(0, ...result.samples.map((s) => s.alignDeg ?? 0));
    ctx.log(`  ${phase}: ${base.id} → ${newClipId}；采样 ${result.samples.length}，修前最大偏差 ${worstBefore.toFixed(1)}，修后复核残差 ${result.maxResidual.toFixed(2)}，前臂与腕口最大夹角 ${worstAlign.toFixed(0)}°${unreachable ? `，${unreachable} 个时刻有备注` : ""}`);
    for (const note of new Set(result.samples.flatMap((s) => s.note ? [s.note] : []))) ctx.log(`    备注：${note}`);
    for (const d of result.diagnostics) ctx.log(`    诊断：${d}`);
    plan.phases.push({ phase, actionId: action.actionId, baseClipId: base.id, baseClipSha: sha(base), newClipId, clipFile, maxResidual: result.maxResidual, worstAlignDeg: worstAlign });
    const doc = snapshot.document.animations.find((item) => item.id === action.actionId)!;
    phaseTimes[phase] = renderTimes(result.clip, undefined, RENDER_FRAMES);
    plan.operations.push({ type: "create-motion-clip", asset: result.clip });
    plan.operations.push({ type: "upsert-action", action: { id: doc.id, name: doc.name, motionClipId: newClipId, speed: doc.speed, repeat: doc.repeat, loop: doc.loop } });
  }
  writeJson(join(outDir, "wristfix-samples.json"), samples);
  const planPath = join(outDir, "plan.json");
  writeJson(planPath, plan);
  const { before, after } = renderBeforeAfter(ctx, input, outDir, phases, phaseTimes, planPath);
  const failures = after.metrics.filter((m) => m.verdict === "FAIL").length;
  plan.selfQc = { verdict: after.pass ? "PASS" : "FAIL", failures, frames: after.metrics.length };
  writeJson(planPath, plan);
  ctx.log(`修前 FAIL ${before.metrics.filter((m) => m.verdict === "FAIL").length}/${before.metrics.length}，修后 FAIL ${failures}/${after.metrics.length}；计划 ${planPath}`);
  ctx.log(after.pass ? "离线度量 PASS；仍需逐张看 after/*_wrist.png 与全身图再下结论。" : "离线度量 FAIL：不要交 ECHO 写入。");
  return { planPath, pass: after.pass };
}

function renderBeforeAfter(ctx: RunContext, input: FixWristInput, outDir: string, phases: string[], phaseTimes: Record<string, number[]>, planPath: string): { before: RenderOutcome; after: RenderOutcome } {
  const common = { snapshot: input.snapshot, phases, phaseTimes, maxTimes: RENDER_FRAMES, ik: "weapon-align" as const, zoom: input.zoom, farRootBone: input.farRootBone, defaults: input.defaults };
  const before = runRender({ ...ctx, outDir: join(outDir, "before") }, { ...common, equipmentId: input.equipmentId });
  const after = runRender({ ...ctx, outDir: join(outDir, "after") }, { ...common, plan: planPath });
  for (const phase of phases) {
    const b = join(outDir, "before", `${phase}_wrist_strip.png`), a = join(outDir, "after", `${phase}_wrist_strip.png`);
    if (existsSync(b) && existsSync(a)) {
      const top = decodePng(new Uint8Array(readFileSync(b))), bottom = decodePng(new Uint8Array(readFileSync(a)));
      writeFileSync(join(outDir, `${phase}_before_after.png`), encodePng(vstack([top, bottom])));
    }
  }
  return { before, after };
}

const IK_SEARCH_STEPS = 8;

/**
 * 远臂被双手 IK 驱动（clip 远臂旋转无效）：在 her1 装备上搜 secondaryGrip / 支撑手 rest / bendDirection，
 * 腕口切口移到 IK 目标、指节仍在护木上；几何 + 渲染都过才出 upsert-equipment，否则只给结论与画师规格。
 */
function runFixWristIk(ctx: RunContext, input: FixWristInput, snapshot: LoadedSnapshot, spec: WristFixSpec, phases: string[], ik: SupportIk): { planPath: string; pass: boolean } {
  const equipmentId = ik.equipment.id;
  const c = ik.constraint;
  ctx.log(`  ${equipmentId} 带双手 IK ${c.id}（mix ${c.mix}，${c.upperBoneId}→${c.lowerBoneId}→${c.endBoneId}${c.alignEnd ? "，alignEnd" : ""}）；支撑手挂在 ${ik.socketBone}（IK 链内）`);
  ctx.log("  clip 里的远臂旋转会被 IK 覆盖，改 clip 无效 → 搜 her1 装备杠杆（secondaryGrip / 支撑手 rest / bendDirection）");
  const clips = phases.map((phase) => {
    const clip = snapshot.clips[phase];
    if (!clip) throw new Error(`快照缺 ${phase}`);
    return { phase, clip, times: evenTimes(clip, IK_SEARCH_STEPS) };
  });
  const input0 = { document: snapshot.document, skeleton: snapshot.skeleton, images: snapshot.images, equipmentId, spec };
  const report = analyzeIkWrist(input0, ik, clips, undefined, input.overlap);
  if (typeof report === "string") throw new Error(report);
  const outDir = ensureDir(ctx.outDir);
  writeJson(join(outDir, "wristik-report.json"), report);
  const b = report.baseline, best = report.best;
  ctx.log(`  基线：前臂与腕口最大夹角 ${b.worstAlignDeg.toFixed(0)}°，腕口中心离前臂远端 ${b.medianCutGap.toFixed(0)}（中位），IK 够不着 ${b.unreachable}/${b.samples.length} 帧`);
  ctx.log(`  最佳杠杆：指节沿枪管 ${best.lever.slide}、垂直 ${best.lever.lift}、手转 ${best.lever.rotateDeg}°、bend ${best.lever.bend} → 最大夹角 ${best.worstAlignDeg.toFixed(0)}°，够不着 ${best.unreachable} 帧${report.geometricPass ? "" : `（> ${MAX_ALIGN_DEG}° 或够不着：几何上接不上）`}`);
  const cut = cutForEquipment(snapshot.document, snapshot.images, equipmentId, spec)!;
  const candidateId = `${equipmentId}-${input.tag}`;
  const { equipment: candidate } = applyIkLever(snapshot.document, snapshot.skeleton, equipmentId, spec.handAttachmentId, cut, best.lever, { newId: candidateId, overlap: input.overlap });
  const phaseTimes = Object.fromEntries(clips.map(({ phase, clip }) => [phase, framesFor(snapshot, phase, clip, RENDER_FRAMES)]));
  const plan: PlanFile = {
    kind: "her1-wrist-fix", mode: "equipment-ik", createdAt: new Date().toISOString(), gun: input.gun, snapshotRevision: snapshot.manifest.revision, baseTag: "", tag: input.tag,
    spec: { ...spec, equipmentIds: [candidateId] }, phases: [], operations: [],
    candidateEquipment: candidate, baseEquipment: { id: equipmentId, sha: sha(ik.equipment) },
    ik: { constraintId: report.constraintId, baseline: { worstAlignDeg: b.worstAlignDeg, medianCutGap: b.medianCutGap, unreachable: b.unreachable }, best: { lever: best.lever, worstAlignDeg: best.worstAlignDeg, unreachable: best.unreachable }, artSpec: report.artSpec },
  };
  const planPath = join(outDir, "plan.json");
  writeJson(planPath, plan);
  const { before, after } = renderBeforeAfter(ctx, input, outDir, phases, phaseTimes, planPath);
  const verdict = classifyIkWrist(report, after.pass);
  const failures = after.metrics.filter((m) => m.verdict === "FAIL").length;
  plan.verdict = verdict;
  plan.verdictLabel = VERDICT_LABEL[verdict];
  plan.selfQc = { verdict: verdict === "wiring-fixable" ? "PASS" : "FAIL", failures, frames: after.metrics.length };
  if (verdict === "wiring-fixable") plan.operations = [{ type: "upsert-equipment", equipment: candidate }];
  writeJson(planPath, plan);
  ctx.log(`修前 FAIL ${before.metrics.filter((m) => m.verdict === "FAIL").length}/${before.metrics.length}，候选装备 ${candidateId} 修后 FAIL ${failures}/${after.metrics.length}；计划 ${planPath}`);
  ctx.log(`结论：${VERDICT_LABEL[verdict]}`);
  if (verdict !== "wiring-fixable") {
    const spec2 = report.artSpec;
    ctx.log(`  画师规格：${spec2.pivot}`);
    for (const group of spec2.groups) ctx.log(`    ${group.phases.join("/")}：前臂进手 ${group.forearmRelDeg.toFixed(0)}°（${group.minDeg.toFixed(0)}~${group.maxDeg.toFixed(0)}°），腕口切口朝 ${group.cutOutwardRelDeg.toFixed(0)}°${group.forearm ? `；前臂可见 ${group.forearm.visiblePct}%` : ""}`);
    for (const t of spec2.transitions) ctx.log(`    过渡 ${t.phase}：${t.fromDeg.toFixed(0)}° → ${t.toDeg.toFixed(0)}°${t.swapAt === null ? "" : `，约 t=${t.swapAt.toFixed(2)} 换手`}`);
    ctx.log(`    现手图：腕口进手 ${spec2.current.cutRelDeg.toFixed(0)}°，切口中心离前臂远端 ${spec2.current.cutGap.toFixed(0)}`);
    for (const note of spec2.notes) ctx.log(`    ${note}`);
    ctx.log("计划不含写入操作；不要交 ECHO 写入。");
  } else ctx.log("离线度量 PASS；仍需逐张看 after/*_wrist.png 与全身图再下结论。");
  return { planPath, pass: verdict === "wiring-fixable" };
}

function vstack(images: RgbaImage[], gap = 8): RgbaImage {
  const width = Math.max(...images.map((im) => im.width));
  const height = images.reduce((s, im) => s + im.height, 0) + gap * (images.length - 1);
  const out = { width, height, data: new Uint8Array(width * height * 4) };
  for (let i = 0; i < out.data.length; i += 4) { out.data[i] = 40; out.data[i + 1] = 40; out.data[i + 2] = 48; out.data[i + 3] = 255; }
  let y0 = 0;
  for (const im of images) {
    for (let y = 0; y < im.height; y += 1) out.data.set(im.data.subarray(y * im.width * 4, (y + 1) * im.width * 4), ((y0 + y) * width) * 4);
    y0 += im.height + gap;
  }
  return out;
}

/** ECHO 写入修复计划：计划必须自审 PASS；基线 clip 内容与动作指针都须和快照时一致；写后 live 快照不变。 */
export async function runApplyPlan(ctx: RunContext, input: { plan: string; allowUnreviewed?: boolean } & ApplyGate): Promise<void> {
  const plan = JSON.parse(readFileSync(input.plan, "utf8")) as PlanFile;
  if (plan.kind !== "her1-wrist-fix") throw new Error("不是 her1-wrist-fix 计划");
  const equipmentMode = plan.mode === "equipment-ik";
  for (const op of plan.operations) {
    const allowed = equipmentMode ? op.type === "upsert-equipment" : op.type === "create-motion-clip" || op.type === "upsert-action";
    if (!allowed) throw new Error(`计划含不允许的操作 ${op.type}`);
    const id = op.type === "create-motion-clip" ? op.asset.id : op.type === "upsert-action" ? op.action.id : op.type === "upsert-equipment" ? op.equipment.id : "";
    if (!id.includes("her1")) throw new Error(`「${id}」不是加性 her1 对象`);
    if (op.type === "upsert-equipment" && id === plan.baseEquipment?.id) throw new Error(`计划会覆盖基线装备 ${id}；只允许写新 id`);
  }
  if (plan.selfQc?.verdict !== "PASS" && !input.allowUnreviewed) throw new Error(`计划未通过离线自审（selfQc 不是 PASS${plan.verdictLabel ? `，结论：${plan.verdictLabel}` : ""}），拒绝写入`);
  const connection = await connect(ctx);
  assertRevisionGate(connection, input);
  if (equipmentMode) {
    const base = (connection.document.equipment ?? []).find((item) => item.id === plan.baseEquipment?.id);
    if (!base || sha(base) !== plan.baseEquipment?.sha) throw new Error(`基线装备 ${plan.baseEquipment?.id ?? "?"} 与快照不同；重新快照`);
    for (const op of plan.operations) if (op.type === "upsert-equipment" && (connection.document.equipment ?? []).some((item) => item.id === op.equipment.id)) throw new Error(`装备 ${op.equipment.id} 已存在；换 tag 重跑 fix-wrist`);
  }
  for (const phase of plan.phases) {
    const action = connection.document.animations.find((item) => item.id === phase.actionId);
    if (action?.motionClipId !== phase.baseClipId) throw new Error(`${phase.actionId} 当前指向 ${action?.motionClipId ?? "缺失"}，计划基线是 ${phase.baseClipId}；重新快照`);
    const base = await fetchClip(ctx.apiBase, phase.baseClipId);
    if (sha(base) !== phase.baseClipSha) throw new Error(`${phase.baseClipId} 内容与快照不同；重新快照`);
  }
  writePlan(ctx, `wristfix-${plan.tag}`, connection, plan.operations);
  const summary = equipmentMode ? `新装备 ${plan.candidateEquipment?.id}（基于 ${plan.baseEquipment?.id}；loadout 切换仍等 ECHO）` : plan.phases.map((p) => `${p.actionId} → ${p.newClipId}`).join("、");
  ctx.log(`计划：${summary}（快照 rev ${plan.snapshotRevision}，当前 rev ${connection.revision}）`);
  if (!input.apply) { ctx.log(`dry-run 完成。确认后加 --apply --expected-rev ${connection.revision}`); return; }
  const outcome = await applyGuarded(ctx, connection, `wristfix-${plan.gun.toLowerCase()}-${plan.tag}`, plan.operations, input);
  receipt(ctx, `wristfix-${plan.tag}`, { revisionBefore: connection.revision, revisionAfter: outcome.revision, plan: input.plan, phases: plan.phases.map((p) => p.newClipId) });
  if (input.updateState && equipmentMode) {
    const gun = ctx.state.guns[plan.gun];
    const id = plan.candidateEquipment?.id;
    if (id && !gun.her1Equipment.includes(id)) gun.her1Equipment = [...gun.her1Equipment, id];
    ctx.state.echo.lastKnownRevision = outcome.revision;
    writeJson(ctx.statePath, ctx.state);
  } else if (input.updateState) {
    const gun = ctx.state.guns[plan.gun];
    const covered = plan.phases.map((p) => p.phase);
    if (CORE_PHASES.every((phase) => covered.includes(phase))) {
      gun.clipTag = plan.tag;
      if (gun.phaseClipTags) for (const phase of covered) delete gun.phaseClipTags[phase];
    } else {
      gun.phaseClipTags = { ...(gun.phaseClipTags ?? {}) };
      for (const phase of covered) gun.phaseClipTags[phase] = plan.tag;
    }
    ctx.state.echo.lastKnownRevision = outcome.revision;
    writeJson(ctx.statePath, ctx.state);
  }
  ctx.log("下一步：ECHO 用 aic_render_preview 自渲五态对照腕口；不符就用 revert --ops 回退。");
}