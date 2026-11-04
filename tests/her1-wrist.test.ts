import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MotionClip } from "../packages/shared/src/animation";
import type { SkeletalProjectDocument } from "../packages/shared/src/skeletalProject";
import type { AicOperation } from "../scripts/her1/lib/plans";
import { encodePng } from "../scripts/her1/lib/png";
import { composeScene, rasterize } from "../scripts/her1/lib/render";
import type { RunContext } from "../scripts/her1/lib/runner";
import { measureSeam } from "../scripts/her1/lib/seam";
import { loadSnapshot } from "../scripts/her1/lib/snapshot";
import { loadState, type Her1State } from "../scripts/her1/lib/state";
import { deriveWristFixClip, MAX_ALIGN_DEG } from "../scripts/her1/lib/wristFix";
import { G3_WRIST, runApplyPlan, runFixWrist, runRender, runSnapshot, seamSpecFromState } from "../scripts/her1/lib/wristRunner";
import { applyOperations, PROJECT_ID } from "./her1-fixture";
import { baseClip, document, HAND_ID, images, MAT, skeleton, writeSnapshot } from "./her1-wrist-fixture";

const workRoot = mkdtempSync(join(tmpdir(), "her1-wrist-"));
let ctx: RunContext;
let lines: string[];

function newContext(name: string): RunContext {
  const dir = mkdtempSync(join(workRoot, `${name}-`));
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, readFileSync(join(import.meta.dir, "..", "docs", "her1", "state.json")));
  lines = [];
  return { state: loadState(statePath), statePath, outDir: join(dir, "out"), mcpUrl: "http://127.0.0.1:9/mcp", apiBase: "http://127.0.0.1:9", projectId: PROJECT_ID, log: (line) => lines.push(line) };
}

describe("her1 离线渲染与腕口度量", () => {
  test("装备附件按 socket 合成，pivot 左下原点：手图 pivot 像素落在 socket 上", () => {
    const doc = document();
    const scene = composeScene({ document: doc, skeleton, clip: baseClip("idle"), time: 0, equipmentIds: ["c34-g3-K02-p19v-p19y-her1-hd"] });
    const hand = scene.items.find((item) => item.attachmentId === HAND_ID)!;
    expect(hand.boneId).toBe("hand_near");
    expect(scene.items.at(-1)!.attachmentId).toBe(HAND_ID);
    expect(hand.world[12]).toBeCloseTo(183, 6);
    expect(hand.world[13]).toBeCloseTo(77, 6);
    const raster = rasterize(scene.items, images(), { scale: 1 });
    expect(raster.image.width).toBeGreaterThan(100);
    expect(scene.items.filter((item) => item.attachmentId === "att-forearm_far")).toHaveLength(1);
  });

  test("基线断腕：切口外侧露出，度量 FAIL", () => {
    const spec = seamSpecFromState(loadState(), G3_WRIST);
    const scene = composeScene({ document: document(), skeleton, clip: baseClip("idle"), time: 0, equipmentIds: ["c34-g3-K02-p19v-p19y-her1-hd"] });
    const { metrics, overlay } = measureSeam(scene, images(), skeleton, spec, { time: 0 });
    expect(metrics.handVisible).toBe(true);
    expect(metrics.farItems).toEqual(["att-p19x-upper_arm_far_c22c-her1", "att-p19x-forearm_far_c21c-her1"]);
    expect(metrics.cuffPixels).toBe(19);
    expect(metrics.verdict).toBe("FAIL");
    expect(metrics.exposed).toBeGreaterThan(0);
    expect(overlay!.width).toBeGreaterThan(0);
  });

  test("求解远臂两骨后腕口接上，且只替换远臂两条旋转轨", () => {
    const spec = { ...seamSpecFromState(loadState(), G3_WRIST), upperBone: "upper_arm_far", lowerBone: "forearm_far", equipmentIds: ["c34-g3-K02-p19v-p19y-her1-hd"], overlap: 4, step: 0.05, maxDelta: 1.2 };
    const base = baseClip("aim");
    const result = deriveWristFixClip(document(), skeleton, images(), base, "c34-g3:aim-clip-her1am3d", spec);
    expect(result.maxResidual).toBeLessThan(0.5);
    expect(result.samples.every((s) => (s.after ?? 99) < 0.05)).toBe(true);
    expect(Math.max(...result.samples.map((s) => s.before ?? 0))).toBeGreaterThan(5);
    const hand = result.clip.tracks.find((track) => track.targetId === "hand_near")!;
    expect(hand).toEqual(base.tracks[2]!);
    expect(result.clip.tracks.filter((track) => track.property === "rotation").map((track) => track.targetId).sort()).toEqual(["forearm_far", "upper_arm_far"]);
    const sseam = seamSpecFromState(loadState(), G3_WRIST);
    for (const time of [0, 0.17, 0.33, 0.6]) {
      const scene = composeScene({ document: document(), skeleton, clip: result.clip, time, equipmentIds: ["c34-g3-K02-p19v-p19y-her1-hd"] });
      expect(measureSeam(scene, images(), skeleton, sseam, { time }).metrics.verdict).toBe("PASS");
    }
  });

  test("前臂比腕口细：接线修完仍 FAIL（判定为素材问题，不是接线）", () => {
    const spec = { ...seamSpecFromState(loadState(), G3_WRIST), upperBone: "upper_arm_far", lowerBone: "forearm_far", equipmentIds: ["c34-g3-K02-p19v-p19y-her1-hd"], overlap: 4, step: 0.1, maxDelta: 1.2 };
    const thin = document({ forearmHeight: 6 }), imgs = images(6);
    const result = deriveWristFixClip(thin, skeleton, imgs, baseClip("idle"), "c34-g3:idle-clip-her1am3d", spec);
    expect(result.maxResidual).toBeLessThan(0.5);
    const scene = composeScene({ document: thin, skeleton, clip: result.clip, time: 0, equipmentIds: ["c34-g3-K02-p19v-p19y-her1-hd"] });
    const { metrics } = measureSeam(scene, imgs, skeleton, seamSpecFromState(loadState(), G3_WRIST), { time: 0 });
    expect(metrics.verdict).toBe("FAIL");
    expect(metrics.reasons.join("")).toContain("切口外侧接上远臂");
  });

  test("腕口朝向与远臂可达方向不一致：点能接上但斜插，判为需对着画", () => {
    const spec = { ...seamSpecFromState(loadState(), G3_WRIST), upperBone: "upper_arm_far", lowerBone: "forearm_far", equipmentIds: ["c34-g3-K02-p19v-p19y-her1-hd"], overlap: 4, step: 0.1, maxDelta: 1.2 };
    const tilted = document({ handAngle: -40 }), imgs = images();
    const result = deriveWristFixClip(tilted, skeleton, imgs, baseClip("aim"), "c34-g3:aim-clip-her1am3d", spec);
    expect(result.samples[0]!.after!).toBeLessThan(0.05);
    expect(result.samples[0]!.alignDeg!).toBeGreaterThan(MAX_ALIGN_DEG);
    expect(result.samples[0]!.note).toContain("需对着画");
    const scene = composeScene({ document: tilted, skeleton, clip: result.clip, time: 0, equipmentIds: ["c34-g3-K02-p19v-p19y-her1-hd"] });
    expect(measureSeam(scene, imgs, skeleton, spec, { time: 0 }).metrics.verdict).toBe("FAIL");
  });

  test("外轮廓凹角处的背景不算透底缝", () => {
    const spec = { ...seamSpecFromState(loadState(), G3_WRIST), upperBone: "upper_arm_far", lowerBone: "forearm_far", equipmentIds: ["c34-g3-K02-p19v-p19y-her1-hd"], overlap: 4, step: 0.1, maxDelta: 1.2 };
    const result = deriveWristFixClip(document(), skeleton, images(), baseClip("aim"), "c34-g3:aim-clip-her1am3d", spec);
    const scene = composeScene({ document: document(), skeleton, clip: result.clip, time: 0, equipmentIds: ["c34-g3-K02-p19v-p19y-her1-hd"] });
    expect(measureSeam(scene, images(), skeleton, spec, { time: 0 }).metrics.gapPixels).toBe(0);
  });

  test("支撑手挂在远臂链上时拒绝用远臂旋转修", () => {
    const spec = { ...seamSpecFromState(loadState(), G3_WRIST), upperBone: "upper_arm_far", lowerBone: "forearm_far", equipmentIds: ["c34-g3-K02-p19v-p19y-her1-hd"], overlap: 4, step: 0.1, maxDelta: 1.2 };
    expect(() => deriveWristFixClip(document({ handOnForearm: true }), skeleton, images(), baseClip("idle"), "c34-g3:idle-clip-her1am3d", spec)).toThrow("随手臂移动");
    expect(() => deriveWristFixClip(document(), skeleton, images(), baseClip("idle"), "c34-g3:idle-clip-p16k11", spec)).toThrow("不是加性 her1");
  });
});

describe("her1 render / fix-wrist 运行器（离线快照）", () => {
  beforeEach(() => { ctx = newContext("offline"); });

  test("render 写全身图、腕口特写与 seam.json；fix-wrist 出计划且离线自审 PASS", () => {
    const snap = writeSnapshot(mkdtempSync(join(workRoot, "snap-")), document(), images());
    const before = runRender(ctx, { snapshot: snap, maxTimes: 4, ik: "off", zoom: 3, farRootBone: "upper_arm_far", defaults: G3_WRIST });
    expect(before.pass).toBe(false);
    expect(existsSync(join(ctx.outDir, "idle_wrist_strip.png"))).toBe(true);
    expect(existsSync(join(ctx.outDir, "aim_t0.000.png"))).toBe(true);
    expect(JSON.parse(readFileSync(join(ctx.outDir, "seam.json"), "utf8")).failures).toBeGreaterThan(0);
    ctx = newContext("fix");
    const fix = runFixWrist(ctx, { snapshot: snap, gun: "G3", tag: "her1am3d", upperBone: "upper_arm_far", lowerBone: "forearm_far", farRootBone: "upper_arm_far", overlap: 4, step: 0.05, maxDelta: 1.2, defaults: G3_WRIST, zoom: 3 });
    expect(fix.pass).toBe(true);
    const plan = JSON.parse(readFileSync(fix.planPath, "utf8"));
    expect(plan.selfQc.verdict).toBe("PASS");
    expect(plan.baseTag).toBe("her1am3c");
    expect(plan.operations.map((op: AicOperation) => op.type)).toEqual(["create-motion-clip", "upsert-action", "create-motion-clip", "upsert-action"]);
    expect(plan.phases.map((p: { newClipId: string }) => p.newClipId)).toEqual(["c34-g3:idle-clip-her1am3d", "c34-g3:aim-clip-her1am3d"]);
    expect(existsSync(join(ctx.outDir, "aim_before_after.png"))).toBe(true);
    expect(() => runFixWrist(ctx, { snapshot: snap, gun: "G3", tag: "her1am3b", upperBone: "upper_arm_far", lowerBone: "forearm_far", farRootBone: "upper_arm_far", overlap: 4, step: 0.05, maxDelta: 1.2, defaults: G3_WRIST, zoom: 3 })).toThrow("已退役");
  }, 60_000);
});

interface FakeEcho { revision: number; document: SkeletalProjectDocument; clips: Map<string, MotionClip>; applyCalls: Array<{ baseRevision: number; operations: AicOperation[] }>; renderCalls: Array<Record<string, unknown>> }
const fake: FakeEcho = { revision: 1339, document: document(), clips: new Map(), applyCalls: [], renderCalls: [] };
const fakeImages = images();

const toolText = (value: unknown, isError = false) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }], isError });

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/mcp" && request.method === "POST") {
      const message = await request.json() as { id?: number; method: string; params?: { name: string; arguments: Record<string, unknown> } };
      if (message.id === undefined) return new Response(null, { status: 202 });
      let result: unknown;
      if (message.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-echo", version: "0" } };
      else if (message.method === "tools/list") result = { tools: ["aic_get_project_summary", "aic_apply_operations", "aic_render_preview"].map((name) => ({ name, inputSchema: { type: "object" } })) };
      else {
        const { name, arguments: args } = message.params!;
        if (name === "aic_get_project_summary") result = toolText({ revision: fake.revision });
        else if (name === "aic_render_preview") {
          fake.renderCalls.push(args);
          result = { content: [{ type: "image", mimeType: "image/png", data: Buffer.from(encodePng(fakeImages.get(MAT.hand)!)).toString("base64") }] };
        } else {
          const call = args as unknown as FakeEcho["applyCalls"][number];
          if (call.baseRevision !== fake.revision) result = toolText("REVISION_CONFLICT", true);
          else {
            fake.applyCalls.push(call);
            fake.document = applyOperations(fake.document, fake.clips, call.operations);
            fake.revision += 1;
            result = toolText({ revision: fake.revision });
          }
        }
      }
      return Response.json({ jsonrpc: "2.0", id: message.id, result }, { headers: { "mcp-session-id": "s" } });
    }
    if (url.pathname === `/api/projects/${PROJECT_ID}/skeletal-document`) return Response.json({ document: fake.document });
    const asset = url.pathname.match(/^\/api\/animation-assets\/(.+)$/);
    if (asset) {
      const id = decodeURIComponent(asset[1]!);
      if (id === "humanoid") return Response.json({ animationAsset: { asset: skeleton } });
      const clip = fake.clips.get(id);
      return clip ? Response.json({ animationAsset: { asset: clip } }) : new Response("missing", { status: 404 });
    }
    const material = url.pathname.match(/^\/api\/materials\/([^/]+)\/image$/);
    if (material) {
      const image = fakeImages.get(decodeURIComponent(material[1]!));
      return image ? new Response(encodePng(image), { headers: { "content-type": "image/png" } }) : new Response("missing", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  },
});

afterAll(() => {
  server.stop(true);
  rmSync(workRoot, { recursive: true, force: true });
});

describe("her1 snapshot / apply-plan（假 ECHO）", () => {
  beforeEach(() => {
    fake.revision = 1339;
    fake.document = document();
    fake.clips = new Map(["idle", "prepare", "aim", "fire", "recover"].map((phase) => [`c34-g3:${phase}-clip-her1am3c`, baseClip(phase)]));
    fake.applyCalls = [];
    fake.renderCalls = [];
    ctx = { ...newContext("echo"), mcpUrl: `http://127.0.0.1:${server.port}/mcp`, apiBase: `http://127.0.0.1:${server.port}` };
  });

  test("snapshot 只读导出文档/骨架/五态 clip/素材/参考图；fix-wrist → apply-plan 带闸门写入并更新指针", async () => {
    const argsPath = join(workRoot, "render-args.json");
    writeFileSync(argsPath, JSON.stringify({ projectId: "{projectId}", actionId: "{actionId}", time: "{time}", equipmentIds: ["{equipmentId}"] }));
    const dir = await runSnapshot(ctx, { gun: "G3", dir: join(workRoot, "echo-snap"), renderArgs: argsPath, maxRefTimes: 2, farRootBone: "upper_arm_far" });
    expect(fake.applyCalls).toEqual([]);
    const snapshot = loadSnapshot(dir);
    expect(snapshot.manifest.revision).toBe(1339);
    expect(snapshot.manifest.actions.map((a) => a.phase)).toEqual(["idle", "prepare", "aim", "fire", "recover"]);
    expect(snapshot.images.has(MAT.hand) && snapshot.images.has(MAT.forearm) && snapshot.images.has(MAT.upper)).toBe(true);
    expect(snapshot.images.has(MAT.liveHand)).toBe(false);
    expect(snapshot.manifest.references).toHaveLength(10);
    expect(fake.renderCalls[0]).toEqual({ projectId: PROJECT_ID, actionId: "c34-g3:her1bt-idle", time: 0, equipmentIds: ["c34-g3-K02-p19v-p19y-her1-hd"] });
    expect(snapshot.manifest.renderTool?.name).toBe("aic_render_preview");

    const fixCtx = { ...ctx, outDir: join(ctx.outDir, "fix") };
    const fix = runFixWrist(fixCtx, { snapshot: dir, gun: "G3", tag: "her1am3d", upperBone: "upper_arm_far", lowerBone: "forearm_far", farRootBone: "upper_arm_far", overlap: 4, step: 0.05, maxDelta: 1.2, defaults: G3_WRIST, zoom: 2 });
    expect(fix.pass).toBe(true);
    expect(existsSync(join(fixCtx.outDir, "before", "aim_t0.000_vs_echo.png"))).toBe(true);

    await expect(runApplyPlan(ctx, { plan: fix.planPath, apply: true, expectedRev: 1300, updateState: true })).rejects.toThrow("不符");
    await runApplyPlan(ctx, { plan: fix.planPath, apply: false, updateState: true });
    expect(fake.applyCalls).toEqual([]);
    await runApplyPlan(ctx, { plan: fix.planPath, apply: true, expectedRev: 1339, updateState: true });
    expect(fake.revision).toBe(1340);
    for (const phase of ["idle", "prepare", "aim", "fire", "recover"]) {
      expect(fake.document.animations.find((a) => a.id === `c34-g3:her1bt-${phase}`)!.motionClipId).toBe(`c34-g3:${phase}-clip-her1am3d`);
      expect(fake.clips.has(`c34-g3:${phase}-clip-her1am3d`)).toBe(true);
    }
    const saved = JSON.parse(readFileSync(ctx.statePath, "utf8")) as Her1State;
    expect(saved.guns.G3.clipTag).toBe("her1am3d");
    expect(saved.echo.lastKnownRevision).toBe(1340);
    expect(existsSync(join(ctx.outDir, "wristfix-her1am3d-revert-operations.json"))).toBe(true);
  }, 60_000);

  test("apply-plan：未自审 PASS、基线 clip 被改或含非 her1 操作时拒绝", async () => {
    const dir = await runSnapshot(ctx, { gun: "G3", dir: join(workRoot, "echo-snap-2"), maxRefTimes: 0, farRootBone: "upper_arm_far" });
    const fix = runFixWrist({ ...ctx, outDir: join(ctx.outDir, "fix2") }, { snapshot: dir, gun: "G3", tag: "her1am3d", phases: ["aim"], upperBone: "upper_arm_far", lowerBone: "forearm_far", farRootBone: "upper_arm_far", overlap: 4, step: 0.1, maxDelta: 1.2, defaults: G3_WRIST, zoom: 2 });
    const plan = JSON.parse(readFileSync(fix.planPath, "utf8"));
    const unreviewed = join(workRoot, "plan-unreviewed.json");
    writeFileSync(unreviewed, JSON.stringify({ ...plan, selfQc: { verdict: "FAIL", failures: 1, frames: 1 } }));
    await expect(runApplyPlan(ctx, { plan: unreviewed, apply: true, expectedRev: 1339, updateState: false })).rejects.toThrow("未通过离线自审");
    const live = join(workRoot, "plan-live.json");
    writeFileSync(live, JSON.stringify({ ...plan, operations: [{ type: "upsert-action", action: { id: "c34-g3:p16k10-aim", name: "x", motionClipId: "y", speed: 1, repeat: 1, loop: false } }] }));
    await expect(runApplyPlan(ctx, { plan: live, apply: true, expectedRev: 1339, updateState: false })).rejects.toThrow("不是加性 her1");
    fake.clips.get("c34-g3:aim-clip-her1am3c")!.duration = 0.7;
    await expect(runApplyPlan(ctx, { plan: fix.planPath, apply: true, expectedRev: 1339, updateState: false })).rejects.toThrow("内容与快照不同");
    expect(fake.applyCalls).toEqual([]);
  }, 60_000);
});
