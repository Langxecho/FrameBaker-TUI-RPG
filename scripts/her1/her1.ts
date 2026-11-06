#!/usr/bin/env bun
/**
 * her1 续作工具链（云端可读、ECHO 上执行写入）。
 * 用法见 docs/her1/ECHO_RUNBOOK.md；`bun scripts/her1/her1.ts help` 打印子命令。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { MotionClip } from "../../packages/shared/src/animation";
import type { SkeletalProjectDocument } from "../../packages/shared/src/skeletalProject";
import { apiBaseFromMcp, McpClient } from "./lib/echo";
import { runCheck, runHandSet, runProbe, runRevert, runT03c, runT10b, runWire, type RunContext } from "./lib/runner";
import { loadState, REPO_ROOT, STATE_PATH, type GunKey } from "./lib/state";
import { auditClipVisibility, collectRestScales } from "./lib/visibility";
import type { IkMode } from "./lib/render";
import { G3_WRIST, runApplyPlan, runFixWrist, runRender, runSnapshot } from "./lib/wristRunner";

const HELP = `her1 工具链

离线（云端可跑，不连 ECHO）：
  status                                   打印 state.json：待交美术包、clip 指针、live 规则
  check --pack T03c|T10b --input <psd|png> [--sprite <id>] [--starter <png>] [--open-edge-mask <png>] [--record]
  audit-clip --clip <clip.json> --document <skeletal-document.json>
  render --snapshot <dir> [--plan <plan.json>] [--phases …] [--times 0,0.4] [--equipment <id>] [--ik weapon-align|weapon|off]
                                           离线渲染快照（默认按 FB 双手 IK + alignEnd；全身 ×2 + 腕口特写），量支撑手腕口，写 seam.json
  fix-wrist --snapshot <dir> [--tag her1am3d] [--phases …] [--upper upper_arm_far] [--lower forearm_far]
            [--overlap 4] [--step 0.04]    远臂被双手 IK 驱动时搜 her1 装备杠杆并判「接线可修 / 仍需画师新手 / 够不着」；
                                           否则求解远臂两骨派生新 clip；都会前后对比渲染并自审

连接 ECHO FB（默认 dry-run，写入需 --apply --expected-rev N）：
  tools [--name <tool>]                    tools/list；给 --name 时打印该工具完整 inputSchema
  call <tool> [--args <args.json>]         调用任意 MCP 工具，image 结果存为 PNG
  probe                                    只读核对 revision、live 素材、her1bt 指针
  t03c --input <T03c_支撑手.psd>            check → rematerialize 两件 her1 G3 支撑手
  hand-set --dir docs/her1/packs/T03c/cloud-r1
                                           多档支撑手：逐张 check → 两件 her1 装备换成多张隐藏手图 + 五态新 tag 换显 clip
  t10b --forearm <psd> [--elbow <psd>] [--tag her1am_c21o] [--phases aim,fire] [--no-wiring]
  wire --gun G3 --base-tag her1am3c --tag her1am3d --phases aim,fire --show <att,…> --strip <att,…>
  revert --ops <run>/<任务>-revert-operations.json   恢复某次写入前的 her1 binding/装备/动作指针
  snapshot [--gun G3] [--dir <dir>] [--render-args <args.json>] [--ref-times 5]
                                           只读导出工程/骨架/her1bt clip/素材（+ 参考渲染）到 docs/her1/snapshots/
  apply-plan --plan <plan.json>            写入 fix-wrist 计划（要求 selfQc PASS、基线 clip 未变）

通用选项：--mcp <url>（或 FRAMEBAKER_MCP_URL）--api <base> --project <id> --out <dir> --no-state-update
`;

function parseArgs(argv: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { positional.push(arg); continue; }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) flags[key] = true;
    else { flags[key] = next; i += 1; }
  }
  return { positional, flags };
}

function str(flags: Record<string, string | true>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function need(flags: Record<string, string | true>, key: string): string {
  const value = str(flags, key);
  if (!value) throw new Error(`缺少 --${key}`);
  return value;
}

function list(value: string | undefined, fallback: string[] = []): string[] {
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : fallback;
}

function context(command: string, flags: Record<string, string | true>): RunContext {
  const state = loadState();
  const mcpUrl = str(flags, "mcp") ?? process.env.FRAMEBAKER_MCP_URL ?? state.echo.mcpUrl;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    state,
    statePath: STATE_PATH,
    outDir: resolve(str(flags, "out") ?? join(REPO_ROOT, "storage", "her1-runs", `${stamp}-${command}`)),
    mcpUrl,
    apiBase: str(flags, "api") ?? apiBaseFromMcp(mcpUrl),
    projectId: str(flags, "project") ?? state.echo.projectId,
    log: (line) => console.log(line),
  };
}

function gate(flags: Record<string, string | true>) {
  const rev = str(flags, "expected-rev");
  return { apply: flags.apply === true, expectedRev: rev === undefined ? undefined : Number(rev), updateState: flags["no-state-update"] !== true };
}

function status(): void {
  const state = loadState();
  console.log(`her1 状态（state.json 更新于 ${state.updatedAt}；ECHO 最后已知 rev ${state.echo.lastKnownRevision}，预算余 ${state.echo.budgetLeft ?? `未知（${state.echo.budgetNote ?? "待核实"}）`}）`);
  console.log("\n枪种与 clip 指针：");
  for (const [key, gun] of Object.entries(state.guns)) {
    const overrides = gun.phaseClipTags ? `；相位覆盖 ${JSON.stringify(gun.phaseClipTags)}` : "";
    console.log(`  ${key} ${gun.kCode ?? "—"} ${gun.label}: ${gun.clipTag ? `${gun.actionPrefix}* → *-clip-${gun.clipTag}` : gun.note ?? "未开工"}${overrides}`);
  }
  console.log("\n美术包（按优先级）：");
  for (const [id, pack] of Object.entries(state.packs).sort((a, b) => a[1].priority - b[1].priority)) {
    const last = pack.checkHistory.at(-1);
    console.log(`  ${id} [${pack.status}] ${pack.title}${last ? `；最近检查 ${String(last.round)} ${String(last.verdict)}` : ""}`);
  }
  console.log("\n已退役 clip tag（不要再指向）：");
  for (const [tag, why] of Object.entries(state.retiredClipTags)) console.log(`  ${tag}: ${why}`);
}

function auditClip(flags: Record<string, string | true>): number {
  const state = loadState();
  const clip = JSON.parse(readFileSync(need(flags, "clip"), "utf8")) as MotionClip | { animationAsset: { asset: MotionClip } };
  const documentBody = JSON.parse(readFileSync(need(flags, "document"), "utf8")) as SkeletalProjectDocument | { document: SkeletalProjectDocument };
  const asset = "animationAsset" in clip ? clip.animationAsset.asset : clip;
  const document = "document" in documentBody ? documentBody.document : documentBody;
  const issues = auditClipVisibility(asset, collectRestScales(document), state.visibility);
  for (const issue of issues) console.log(`${issue.severity === "error" ? "错误" : "警告"} ${issue.code} ${issue.attachmentId}${issue.time === undefined ? "" : ` t=${issue.time}`}：${issue.detail}`);
  const errors = issues.filter((issue) => issue.severity === "error").length;
  console.log(errors ? `FAIL：${errors} 个错误` : `PASS（${issues.length} 个警告）`);
  return errors ? 2 : 0;
}

async function callTool(ctx: RunContext, tool: string, argsPath?: string): Promise<void> {
  const client = new McpClient(ctx.mcpUrl);
  const args = argsPath ? JSON.parse(readFileSync(argsPath, "utf8")) as Record<string, unknown> : {};
  const result = await client.callTool(tool, args);
  for (const text of result.texts) console.log(text);
  if (result.images.length) {
    mkdirSync(ctx.outDir, { recursive: true });
    result.images.forEach((image, index) => {
      const path = join(ctx.outDir, `${tool}-${index}.png`);
      writeFileSync(path, image.data);
      console.log(`图片：${path}`);
    });
  }
  if (result.isError) process.exitCode = 1;
}

async function main(): Promise<number> {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const command = positional[0] ?? "help";
  if (command === "help") { console.log(HELP); return 0; }
  if (command === "status") { status(); return 0; }
  if (command === "audit-clip") return auditClip(flags);
  const ctx = context(command, flags);
  if (command === "check") {
    const outcome = runCheck(ctx, { packId: need(flags, "pack"), input: need(flags, "input"), spriteId: str(flags, "sprite"), starter: str(flags, "starter"), openEdgeMask: str(flags, "open-edge-mask"), record: flags.record === true });
    return outcome.report.verdict === "PASS" ? 0 : 2;
  }
  if (command === "tools") {
    const tools = await new McpClient(ctx.mcpUrl).listTools();
    const name = str(flags, "name");
    if (name) {
      const tool = tools.find((item) => item.name === name);
      if (!tool) throw new Error(`当前服务没有工具 ${name}`);
      console.log(JSON.stringify(tool, null, 2));
      return 0;
    }
    for (const tool of tools) console.log(`${tool.name}${tool.description ? ` — ${tool.description.slice(0, 120)}` : ""}`);
    return 0;
  }
  if (command === "call") { await callTool(ctx, positional[1] ?? need(flags, "tool"), str(flags, "args")); return Number(process.exitCode ?? 0); }
  if (command === "probe") { const result = await runProbe(ctx); return result.pointerMismatches ? 3 : 0; }
  const record = flags.record === true || flags.apply === true;
  if (command === "hand-set") { await runHandSet(ctx, { dir: resolve(need(flags, "dir")), ...gate(flags) }); return 0; }
  if (command === "t03c") { await runT03c(ctx, { input: need(flags, "input"), record, ...gate(flags) }); return 0; }
  if (command === "t10b") {
    const pack = ctx.state.packs.T10b;
    await runT10b(ctx, { forearm: need(flags, "forearm"), elbow: str(flags, "elbow"), tag: str(flags, "tag") ?? pack.wiring.suggestedTag, phases: list(str(flags, "phases"), pack.wiring.phases), wiring: flags["no-wiring"] !== true, record, ...gate(flags) });
    return 0;
  }
  if (command === "wire") {
    await runWire(ctx, { gun: need(flags, "gun") as GunKey, baseTag: need(flags, "base-tag"), tag: need(flags, "tag"), phases: list(need(flags, "phases")), show: list(str(flags, "show")), strip: list(str(flags, "strip")), ...gate(flags) });
    return 0;
  }
  if (command === "revert") { await runRevert(ctx, { ops: need(flags, "ops"), ...gate(flags) }); return 0; }
  const farRootBone = str(flags, "far-root") ?? G3_WRIST.farRootBone;
  if (command === "snapshot") {
    await runSnapshot(ctx, { gun: (str(flags, "gun") ?? "G3") as GunKey, equipmentIds: str(flags, "equipment") ? list(str(flags, "equipment")) : undefined, dir: str(flags, "dir") ? resolve(str(flags, "dir")!) : undefined, renderArgs: str(flags, "render-args"), maxRefTimes: Number(str(flags, "ref-times") ?? 5), farRootBone });
    return 0;
  }
  if (command === "render") {
    const outcome = runRender(ctx, { snapshot: resolve(need(flags, "snapshot")), plan: str(flags, "plan") ? resolve(str(flags, "plan")!) : undefined, phases: str(flags, "phases") ? list(str(flags, "phases")) : undefined, times: str(flags, "times") ? list(str(flags, "times")).map(Number) : undefined, maxTimes: Number(str(flags, "max-times") ?? 8), equipmentId: str(flags, "equipment"), ik: (str(flags, "ik") ?? "weapon-align") as IkMode, zoom: Number(str(flags, "zoom") ?? 4), farRootBone, defaults: G3_WRIST });
    return outcome.pass ? 0 : 2;
  }
  if (command === "fix-wrist") {
    const outcome = runFixWrist(ctx, { snapshot: resolve(need(flags, "snapshot")), gun: (str(flags, "gun") ?? "G3") as GunKey, tag: str(flags, "tag") ?? ctx.state.packs.T03c.wiring.suggestedTag, phases: str(flags, "phases") ? list(str(flags, "phases")) : undefined, upperBone: str(flags, "upper") ?? G3_WRIST.upperBone, lowerBone: str(flags, "lower") ?? G3_WRIST.lowerBone, farRootBone, overlap: Number(str(flags, "overlap") ?? 4), step: Number(str(flags, "step") ?? 0.04), maxDelta: Number(str(flags, "max-delta") ?? 1.2), equipmentId: str(flags, "equipment"), defaults: G3_WRIST, zoom: Number(str(flags, "zoom") ?? 4) });
    return outcome.pass ? 0 : 2;
  }
  if (command === "apply-plan") { await runApplyPlan(ctx, { plan: resolve(need(flags, "plan")), allowUnreviewed: flags["allow-unreviewed"] === true, ...gate(flags) }); return 0; }
  console.error(`未知子命令 ${command}\n\n${HELP}`);
  return 1;
}

main().then((code) => process.exit(code), (error: Error) => {
  console.error(`停止：${error.message}`);
  process.exit(1);
});
