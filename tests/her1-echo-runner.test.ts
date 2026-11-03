import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MotionClip } from "../packages/shared/src/animation";
import type { SkeletalProjectDocument } from "../packages/shared/src/skeletalProject";
import type { AicOperation } from "../scripts/her1/lib/plans";
import { encodePng } from "../scripts/her1/lib/png";
import { runProbe, runRevert, runT03c, runT10b, type RunContext } from "../scripts/her1/lib/runner";
import { clipIdFor, loadState, loadTask, type Her1State } from "../scripts/her1/lib/state";
import { applyOperations, baseClip, her1Document, paintBlock, PROJECT_ID } from "./her1-fixture";

interface FakeEcho {
  revision: number;
  document: SkeletalProjectDocument;
  clips: Map<string, MotionClip>;
  applyCalls: Array<{ baseRevision: number; idempotencyKey: string; operations: AicOperation[] }>;
  uploads: Array<{ name: string; metadata: Record<string, unknown> }>;
  tools: string[];
  tamperLive: boolean;
}

const fake: FakeEcho = { revision: 0, document: her1Document(), clips: new Map(), applyCalls: [], uploads: [], tools: [], tamperLive: false };

function reset() {
  fake.revision = 1335;
  fake.document = her1Document();
  fake.clips = new Map(["aim", "fire"].map((phase) => {
    const id = `c34-g1:${phase}-clip-her1am_c21n`;
    return [id, baseClip(id)];
  }));
  fake.applyCalls = [];
  fake.uploads = [];
  fake.tools = ["aic_get_project_summary", "aic_apply_operations", "aic_render_preview"];
  fake.tamperLive = false;
}

const toolText = (value: unknown, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], isError });

function callTool(name: string, args: Record<string, unknown>) {
  if (args.projectId !== PROJECT_ID) return toolText("unknown project", true);
  if (name === "aic_get_project_summary") return toolText({ projectId: PROJECT_ID, revision: fake.revision });
  if (name === "aic_apply_operations") {
    const call = args as unknown as FakeEcho["applyCalls"][number];
    if (call.baseRevision !== fake.revision) return toolText(`REVISION_CONFLICT ${fake.revision}`, true);
    fake.applyCalls.push(call);
    fake.document = applyOperations(fake.document, fake.clips, call.operations);
    if (fake.tamperLive) fake.document.character!.binding.attachments.find((item) => item.id === "att-forearm_far")!.rest.scale = [0.5, 0.5, 1];
    fake.revision += 1;
    return toolText({ revision: fake.revision, applied: call.operations.length });
  }
  return toolText(`unknown tool ${name}`, true);
}

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" && request.method === "POST") {
      const message = await request.json() as { id?: number; method: string; params?: { name: string; arguments: Record<string, unknown> } };
      if (message.id === undefined) return new Response(null, { status: 202 });
      let result: unknown;
      if (message.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-echo", version: "0" } };
      else if (message.method === "tools/list") result = { tools: fake.tools.map((name) => ({ name })) };
      else if (message.method === "tools/call") result = callTool(message.params!.name, message.params!.arguments);
      const body = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
      if (message.method === "tools/call") return new Response(`event: message\ndata: ${body}\n\n`, { headers: { "content-type": "text/event-stream", "mcp-session-id": "fake-session" } });
      return new Response(body, { headers: { "content-type": "application/json", "mcp-session-id": "fake-session" } });
    }
    if (url.pathname === `/api/projects/${PROJECT_ID}/skeletal-document`) return Response.json({ document: fake.document });
    const asset = url.pathname.match(/^\/api\/animation-assets\/(.+)$/);
    if (asset) {
      const clip = fake.clips.get(decodeURIComponent(asset[1]));
      return clip ? Response.json({ animationAsset: { asset: clip } }) : new Response("动画资产不存在", { status: 404 });
    }
    if (url.pathname === "/api/materials/upload" && request.method === "POST") {
      const form = await request.formData();
      const file = form.get("file") as File;
      fake.uploads.push({ name: file.name, metadata: JSON.parse(String(form.get("metadata"))) });
      return Response.json({ materialId: `abcdef${String(fake.uploads.length).padStart(2, "0")}-1111-4111-8111-111111111111` });
    }
    return new Response("not found", { status: 404 });
  },
});

const workRoot = mkdtempSync(join(tmpdir(), "her1-runner-"));
afterAll(() => {
  server.stop(true);
  rmSync(workRoot, { recursive: true, force: true });
});

let ctx: RunContext;
let lines: string[];

beforeEach(() => {
  reset();
  const dir = mkdtempSync(join(workRoot, "run-"));
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, readFileSync(join(import.meta.dir, "..", "docs", "her1", "state.json")));
  lines = [];
  ctx = { state: loadState(statePath), statePath, outDir: join(dir, "out"), mcpUrl: `http://127.0.0.1:${server.port}/mcp`, apiBase: `http://127.0.0.1:${server.port}`, projectId: PROJECT_ID, log: (line) => lines.push(line) };
});

function writeArt(name: string, packId: "T03c" | "T10b", spriteIndex = 0): string {
  const task = loadTask(loadState(), packId);
  const [w, h] = task.sprites[spriteIndex].native_size;
  const path = join(workRoot, name);
  writeFileSync(path, encodePng(paintBlock(w, h, task.palette[0].rgb, [2, 2, w - 3, h - 3])));
  return path;
}

const savedState = (): Her1State => JSON.parse(readFileSync(ctx.statePath, "utf8"));

describe("her1 ECHO 运行器（假 ECHO 服务）", () => {
  test("probe：工具、revision、live 素材与 her1bt 指针全部核对", async () => {
    const result = await runProbe(ctx);
    expect(result).toEqual({ revision: 1335, pointerMismatches: 0 });
    expect(existsSync(join(ctx.outDir, "probe-receipt.json"))).toBe(true);
    fake.document.animations.find((item) => item.id === "c34-g3:her1bt-aim")!.motionClipId = "c34-g3:aim-clip-her1am3b";
    expect((await runProbe(ctx)).pointerMismatches).toBe(1);
  });

  test("缺少必需工具或 live 素材不符时连接即停止", async () => {
    fake.tools = ["aic_get_project_summary"];
    await expect(runProbe(ctx)).rejects.toThrow("缺少工具：aic_apply_operations");
    reset();
    fake.document.character!.binding.attachments.find((item) => item.id === "att-upper_arm_far")!.materialId = "deadbeef";
    await expect(runProbe(ctx)).rejects.toThrow("live 素材与 state.json 不符");
  });

  test("T03c dry-run：不上传、不写入，只出计划", async () => {
    await runT03c(ctx, { input: writeArt("t03c-dry.png", "T03c"), apply: false, updateState: true });
    expect(fake.applyCalls).toEqual([]);
    expect(fake.uploads).toEqual([]);
    const operations = JSON.parse(readFileSync(join(ctx.outDir, "T03c-operations.json"), "utf8")) as AicOperation[];
    expect(operations).toHaveLength(2);
    expect(JSON.stringify(operations)).toContain("pending-upload:hand_sup_g3_y");
    expect(lines.join("\n")).toContain("--apply --expected-rev 1335");
    expect(savedState().packs.T03c.status).toBe("waiting-artist");
  });

  test("T03c 检查 FAIL 时不连接 ECHO", async () => {
    const path = join(workRoot, "t03c-bad.png");
    writeFileSync(path, encodePng(paintBlock(10, 10, [1, 2, 3], [0, 0, 9, 9])));
    await expect(runT03c(ctx, { input: path, apply: true, expectedRev: 1335, updateState: true })).rejects.toThrow("check_art FAIL");
    expect(fake.uploads).toEqual([]);
    expect(fake.applyCalls).toEqual([]);
  });

  test("T03c --expected-rev 不符时拒绝写入", async () => {
    await expect(runT03c(ctx, { input: writeArt("t03c-rev.png", "T03c"), apply: true, expectedRev: 1300, updateState: true })).rejects.toThrow("与当前 revision 1335 不符");
    expect(fake.uploads).toEqual([]);
    expect(fake.applyCalls).toEqual([]);
  });

  test("T03c apply：上传、带 baseRevision/幂等键写入、live 不变、回写 state.json", async () => {
    await runT03c(ctx, { input: writeArt("t03c-ok.png", "T03c"), apply: true, expectedRev: 1335, updateState: true, record: true });
    expect(fake.uploads.map((item) => item.metadata.her1Task)).toEqual(["T03c"]);
    expect(fake.applyCalls).toHaveLength(1);
    expect(fake.applyCalls[0].baseRevision).toBe(1335);
    expect(fake.applyCalls[0].idempotencyKey).toMatch(/^her1-t03c-r1335-[0-9a-f]{16}$/);
    for (const id of ["c34-g3-K02-p19v-p19y-her1", "c34-g3-K02-p19v-p19y-her1-hd"]) {
      const hand = fake.document.equipment!.find((item) => item.id === id)!.attachments.find((item) => item.id === "c34-g3-K02-p19v-p19y-her1:support-hand")!;
      expect(hand.materialId).toStartWith("abcdef01");
      expect(hand.size).toEqual([178, 76]);
    }
    expect(fake.document.equipment!.find((item) => item.id === "c34-g3-K02-p19v-p19y")!.attachments[0].materialId).toStartWith("59fc3f63");
    const state = savedState();
    expect(state.packs.T03c.status).toBe("rematerialized-pending-self-qc");
    expect(state.packs.T03c.sprites[0].target.currentMaterial).toBe("abcdef01");
    expect(state.packs.T03c.sprites[0].target.currentSize).toEqual([178, 76]);
    expect(state.packs.T03c.checkHistory.at(-1)).toMatchObject({ verdict: "PASS", sprite: "hand_sup_g3_y" });
    expect(state.echo.lastKnownRevision).toBe(1336);
    expect(readdirSync(ctx.outDir)).toContain("T03c-receipt.json");
    expect(lines.join("\n")).toContain("PASS 前不发给 ECHO、不联络美术对接师");
  });

  test("T10b apply：前臂 rematerialize + aim/fire 新 tag 接线，state 记录分相位指针", async () => {
    await runT10b(ctx, { forearm: writeArt("t10b-forearm.png", "T10b"), tag: "her1am_c21o", phases: ["aim", "fire"], wiring: true, apply: true, expectedRev: 1335, updateState: true });
    const forearm = fake.document.character!.binding.attachments.find((item) => item.id === "att-p19x-forearm_far_foreshrt_g1aim-her1")!;
    expect(forearm.materialId).toStartWith("abcdef01");
    expect(forearm.size).toEqual([50, 78]);
    for (const phase of ["aim", "fire"]) {
      const id = clipIdFor(ctx.state.guns.G1, phase, "her1am_c21o");
      expect(fake.clips.has(id)).toBe(true);
      expect(fake.document.animations.find((item) => item.id === `c34-g1:her1bt-${phase}`)!.motionClipId).toBe(id);
    }
    expect(fake.document.animations.find((item) => item.id === "c34-g1:her1bt-idle")!.motionClipId).toBe("c34-g1:idle-clip-her1am_c21n");
    expect(fake.document.animations.find((item) => item.id === "c34-g1:p16k10-aim")!.motionClipId).toBe("c34-g1:aim-clip-p16k10");
    const state = savedState();
    expect(state.guns.G1.clipTag).toBe("her1am_c21n");
    expect(state.guns.G1.phaseClipTags).toEqual({ aim: "her1am_c21o", fire: "her1am_c21o" });
    expect(state.packs.T10b.status).toBe("rematerialized-pending-self-qc");
    ctx.state = state;
    expect((await runProbe(ctx)).pointerMismatches).toBe(0);
  });

  test("revert：用同次运行生成的回退文件恢复 T10b 写入前的素材与指针", async () => {
    await runT10b(ctx, { forearm: writeArt("t10b-revert.png", "T10b"), tag: "her1am_c21o", phases: ["aim", "fire"], wiring: true, apply: true, expectedRev: 1335, updateState: false });
    const revertPath = join(ctx.outDir, "T10b-revert-operations.json");
    const revert = JSON.parse(readFileSync(revertPath, "utf8")) as AicOperation[];
    expect(revert.map((op) => op.type)).toEqual(["upsert-binding", "upsert-action", "upsert-action"]);
    await expect(runRevert(ctx, { ops: revertPath, apply: true, expectedRev: 1335, updateState: false })).rejects.toThrow("与当前 revision 1336 不符");
    await runRevert(ctx, { ops: revertPath, apply: true, expectedRev: 1336, updateState: false });
    expect(fake.revision).toBe(1337);
    expect(fake.document.character!.binding.attachments.find((item) => item.id === "att-p19x-forearm_far_foreshrt_g1aim-her1")!.materialId).toStartWith("1475c51c");
    expect(fake.document.animations.find((item) => item.id === "c34-g1:her1bt-aim")!.motionClipId).toBe("c34-g1:aim-clip-her1am_c21n");
    const livePath = join(workRoot, "bad-revert.json");
    writeFileSync(livePath, JSON.stringify([{ type: "upsert-action", action: { id: "c34-g1:p16k10-aim", name: "x", motionClipId: "y", speed: 1, repeat: 1, loop: false } }]));
    await expect(runRevert(ctx, { ops: livePath, apply: true, expectedRev: 1337, updateState: false })).rejects.toThrow("live 轨禁止写入");
  });

  test("写入后 live 快照若被改动，运行器报警停止", async () => {
    fake.tamperLive = true;
    await expect(runT03c(ctx, { input: writeArt("t03c-tamper.png", "T03c"), apply: true, expectedRev: 1335, updateState: true })).rejects.toThrow("live 快照发生变化");
    expect(savedState().packs.T03c.status).toBe("waiting-artist");
  });
});
