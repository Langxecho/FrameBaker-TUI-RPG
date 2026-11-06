import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AnyMotionTrack, MotionClip, Vec3 } from "../packages/shared/src/animation";
import { validateMotionClip } from "../packages/shared/src/animation";
import { assertAdditiveId, checkClipPointers, checkLiveMaterials, liveSnapshot, planT03c, planT10b, planWiring } from "../scripts/her1/lib/plans";
import { findSprite } from "../scripts/her1/lib/checkArt";
import { clipIdFor, loadState, loadTask, REPO_ROOT } from "../scripts/her1/lib/state";
import { auditClipVisibility, collectRestScales, deriveWiringClip } from "../scripts/her1/lib/visibility";
import { applyOperations, baseClip, cloneState, her1Document, HIDDEN, VISIBLE } from "./her1-fixture";

const state = loadState();
const FOREARM = "att-p19x-forearm_far_foreshrt_g1aim-her1";
const ELBOW = "att-p19x-elbow_far_foreshrt_g1aim-her1";
const UPPER = "att-p19x-upper_arm_far_foreshrt_g1aim-her1";

function scaleTrack(clip: MotionClip, attachmentId: string) {
  return (clip.tracks as AnyMotionTrack[]).find((track) => track.targetId === `att:${attachmentId}` && track.property === "scale");
}

function g1BaseClips(phases: string[], schemaVersion: 1 | 2 = 1) {
  return Object.fromEntries(phases.map((phase) => [phase, baseClip(clipIdFor(state.guns.G1, phase, "her1am_c21n"), schemaVersion)]));
}

describe("her1 Region 显隐审计", () => {
  const restScales = new Map<string, Vec3>([
    ["att-live", VISIBLE],
    ["att-hidden-her1", HIDDEN],
    ["att-cap_far", VISIBLE],
    ["att-shoulder_cap_near-redraw1", VISIBLE],
    ["c34-g1-K05-p19y-her1:p15-idle-support", VISIBLE],
  ]);
  const clipWith = (tracks: AnyMotionTrack[]): MotionClip => ({ ...baseClip("audit"), tracks } as MotionClip);
  const codes = (tracks: AnyMotionTrack[]) => auditClipVisibility(clipWith(tracks), restScales, state.visibility).map((issue) => issue.code);
  const scale = (id: string, value: Vec3): AnyMotionTrack => ({ targetId: `att:${id}`, property: "scale", interpolation: "step", keyframes: [{ time: 0, value }] });

  test("translate-far 藏层是错误", () => {
    expect(codes([{ targetId: "att:att-live", property: "translation", interpolation: "step", keyframes: [{ time: 0, value: [5000, 5000, 0] }] }])).toEqual(["TRANSLATE_FAR"]);
  });

  test("rest 已隐藏、禁用名单、idle-support 写 HIDE-scale 都是错误", () => {
    expect(codes([scale("att-hidden-her1", [0.001, 0.001, 1])])).toEqual(["HIDE_SCALE_ON_REST_HIDDEN"]);
    expect(codes([scale("att-shoulder_cap_near-redraw1", [0.001, 0.001, 1])])).toEqual(["HIDE_SCALE_FORBIDDEN"]);
    expect(codes([scale("c34-g1-K05-p19y-her1:p15-idle-support", [0.001, 0.001, 1])])).toEqual(["HIDE_SCALE_STRIP_ONLY"]);
  });

  test("cap 例外放行，未验证的 rest 可见附件只给警告", () => {
    expect(codes([scale("att-cap_far", [0.001, 0.001, 1])])).toEqual([]);
    const issues = auditClipVisibility(clipWith([scale("att-live", [0.001, 0.001, 1])]), restScales, state.visibility);
    expect(issues.map((issue) => [issue.code, issue.severity])).toEqual([["HIDE_SCALE_UNVERIFIED", "warning"]]);
  });

  test("SHOW 只能还原 rest 0.001；对可见件写 1000 是错误；IDENT/SHOW 合规", () => {
    expect(codes([scale("att-live", [1000, 1000, 1])])).toEqual(["SHOW_OVERSCALE"]);
    expect(codes([scale("att-hidden-her1", [1000, 1000, 1]), scale("att-live", [1, 1, 1])])).toEqual([]);
    expect(codes([scale("att-nope", [1, 1, 1])])).toEqual(["UNKNOWN_ATTACHMENT"]);
  });

  test("collectRestScales 同时收 binding 与装备附件", () => {
    const scales = collectRestScales(her1Document());
    expect(scales.get(FOREARM)).toEqual(HIDDEN);
    expect(scales.get("c34-g3-K02-p19v-p19y-her1:support-hand")).toEqual(VISIBLE);
  });
});

describe("her1 薄接线派生", () => {
  const restScales = collectRestScales(her1Document());

  for (const schemaVersion of [1, 2] as const) {
    test(`v${schemaVersion}：新 id、STRIP 旧轨、整段常量 SHOW、其余轨原样且通过 validateMotionClip`, () => {
      const base = baseClip("c34-g1:aim-clip-her1am_c21n", schemaVersion);
      const clip = deriveWiringClip(base, { newClipId: "c34-g1:aim-clip-her1am_c21o", show: [FOREARM], strip: [UPPER] }, restScales);
      expect(clip.id).toBe("c34-g1:aim-clip-her1am_c21o");
      expect(scaleTrack(clip, UPPER)).toBeUndefined();
      const show = scaleTrack(clip, FOREARM)!;
      expect(show.keyframes.map((key) => [key.time, key.value])).toEqual([[0, [1000, 1000, 1]], [1.2, [1000, 1000, 1]]]);
      if (schemaVersion === 2) expect(show.keyframes.map((key) => (key as { outInterpolation: unknown }).outInterpolation)).toEqual([{ type: "step" }, null]);
      else expect((show as { interpolation: string }).interpolation).toBe("step");
      const untouched = (base.tracks as AnyMotionTrack[]).filter((track) => track.targetId !== `att:${UPPER}`);
      for (const track of untouched) expect(clip.tracks).toContainEqual(track as never);
      expect(base.id).toBe("c34-g1:aim-clip-her1am_c21n");
      const validation = validateMotionClip(clip);
      expect(validation.issues ?? []).toEqual([]);
      expect(validation.ok).toBe(true);
    });
  }

  test("拒绝原地改基线、live 附件、rest 可见件 SHOW、同件既 SHOW 又 STRIP", () => {
    const base = baseClip("c34-g1:aim-clip-her1am_c21n");
    expect(() => deriveWiringClip(base, { newClipId: base.id, show: [FOREARM], strip: [] }, restScales)).toThrow("新 clip id");
    expect(() => deriveWiringClip(base, { newClipId: "x-her1", show: [], strip: ["att-upper_arm_far"] }, restScales)).toThrow("不是加性 her1");
    expect(() => deriveWiringClip(base, { newClipId: "x-her1", show: ["c34-g3-K02-p19v-p19y-her1:support-hand"], strip: [] }, restScales)).toThrow("默认可见");
    expect(() => deriveWiringClip(base, { newClipId: "x-her1", show: [FOREARM], strip: [FOREARM] }, restScales)).toThrow("同时 SHOW 与 STRIP");
  });
});

describe("her1 计划层", () => {
  test("assertAdditiveId 拦住 live id", () => {
    expect(() => assertAdditiveId("c34-g3-K02-p19v-p19y")).toThrow("live");
    expect(() => assertAdditiveId("c34-g3-K02-p19v-p19y-her1")).not.toThrow();
  });

  test("夹具工程的 live 素材与 clip 指针都与 state.json 一致", () => {
    const document = her1Document();
    expect(checkLiveMaterials(document, state).filter((item) => !item.ok)).toEqual([]);
    expect(checkClipPointers(document, state).filter((item) => !item.ok)).toEqual([]);
  });

  test("T03c 只改两件 her1 G3 装备的 support-hand 素材/尺寸/轴心，live 快照不变", () => {
    const document = her1Document();
    const task = loadTask(state, "T03c");
    const operations = planT03c(document, state, task, "new-mat-t03c");
    expect(operations.map((op) => op.type === "upsert-equipment" && op.equipment.id)).toEqual(["c34-g3-K02-p19v-p19y-her1", "c34-g3-K02-p19v-p19y-her1-hd"]);
    for (const op of operations) {
      if (op.type !== "upsert-equipment") throw new Error("unexpected op");
      const hand = op.equipment.attachments.find((item) => item.id === "c34-g3-K02-p19v-p19y-her1:support-hand")!;
      expect(hand.materialId).toBe("new-mat-t03c");
      expect(hand.size).toEqual([178, 76]);
      expect(hand.pivot).toEqual(task.sprites[0].pivot);
      expect(hand.rest).toEqual(document.equipment!.find((item) => item.id === op.equipment.id)!.attachments[0].rest);
      expect(op.equipment.attachments[1]).toEqual(document.equipment!.find((item) => item.id === op.equipment.id)!.attachments[1]);
    }
    const after = applyOperations(document, new Map(), operations);
    expect(liveSnapshot(after)).toBe(liveSnapshot(document));
    expect(checkLiveMaterials(after, state).every((item) => item.ok)).toBe(true);
  });

  test("T10b 只交前臂：rematerialize 前臂、手肘不动；aim/fire 新 tag SHOW 前臂、大臂 STRIP、手肘不 SHOW", () => {
    const document = her1Document();
    const task = loadTask(state, "T10b");
    const plan = planT10b(document, state, task, { materials: { "att-p19x-forearm_far_foreshrt_g1aim": "new-forearm" }, baseClips: g1BaseClips(["aim", "fire"]), tag: "her1am_c21o", phases: ["aim", "fire"], wiring: true });
    expect(plan.operations.map((op) => op.type)).toEqual(["upsert-binding", "create-motion-clip", "upsert-action", "create-motion-clip", "upsert-action"]);
    const binding = plan.operations[0].type === "upsert-binding" ? plan.operations[0].binding : null;
    const forearm = binding!.attachments.find((item) => item.id === FOREARM)!;
    expect(forearm.materialId).toBe("new-forearm");
    expect(forearm.size).toEqual([50, 78]);
    expect(forearm.rest.scale).toEqual(HIDDEN);
    expect(binding!.attachments.find((item) => item.id === ELBOW)!.materialId).toStartWith("e329720b");
    expect(plan.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    for (const clip of plan.newClips) {
      expect(clip.id).toEndWith("-clip-her1am_c21o");
      expect(scaleTrack(clip, FOREARM)!.keyframes[0].value).toEqual([1000, 1000, 1]);
      expect(scaleTrack(clip, UPPER)).toBeUndefined();
      expect(scaleTrack(clip, ELBOW)).toBeUndefined();
    }
    const clips = new Map<string, MotionClip>();
    const after = applyOperations(document, clips, plan.operations);
    expect(liveSnapshot(after)).toBe(liveSnapshot(document));
    expect(after.animations.find((item) => item.id === "c34-g1:her1bt-aim")!.motionClipId).toBe("c34-g1:aim-clip-her1am_c21o");
    expect(after.animations.find((item) => item.id === "c34-g1:her1bt-idle")!.motionClipId).toBe("c34-g1:idle-clip-her1am_c21n");
    const next = cloneState(state);
    next.guns.G1.phaseClipTags = { aim: "her1am_c21o", fire: "her1am_c21o" };
    expect(checkClipPointers(after, next).filter((item) => !item.ok)).toEqual([]);
  });

  test("T10b 交了手肘时一并 SHOW；--no-wiring 只出 upsert-binding", () => {
    const document = her1Document();
    const task = loadTask(state, "T10b");
    const materials = { "att-p19x-forearm_far_foreshrt_g1aim": "f", "att-p19x-elbow_far_foreshrt_g1aim": "e" };
    const plan = planT10b(document, state, task, { materials, baseClips: g1BaseClips(["aim"], 2), tag: "her1am_c21o", phases: ["aim"], wiring: true });
    expect(scaleTrack(plan.newClips[0], ELBOW)!.keyframes[0].value).toEqual([1000, 1000, 1]);
    expect(planT10b(document, state, task, { materials, baseClips: {}, tag: "her1am_c21o", phases: ["aim"], wiring: false }).operations.map((op) => op.type)).toEqual(["upsert-binding"]);
    expect(() => planT10b(document, state, task, { materials: { "att-p19x-elbow_far_foreshrt_g1aim": "e" }, baseClips: {}, tag: "her1am_c21o", phases: [], wiring: false })).toThrow("缺少必交件");
  });

  test("接线闸门：指针漂移、退役 tag、同名 tag、缺基线都拒绝", () => {
    const input = { gun: "G1" as const, baseTag: "her1am_c21n", tag: "her1am_c21o", phases: ["aim"], show: [FOREARM], strip: [UPPER], baseClips: g1BaseClips(["aim"]) };
    const drifted = her1Document();
    drifted.animations.find((item) => item.id === "c34-g1:her1bt-aim")!.motionClipId = "c34-g1:aim-clip-her1am_c21m";
    expect(() => planWiring(drifted, state, input)).toThrow("先 probe");
    expect(() => planWiring(her1Document(), state, { ...input, tag: "her1f" })).toThrow("已退役");
    expect(() => planWiring(her1Document(), state, { ...input, tag: "her1am_c21n" })).toThrow("相同");
    expect(() => planWiring(her1Document(), state, { ...input, baseClips: {} })).toThrow("缺少基线");
    expect(() => planWiring(her1Document(), state, { ...input, gun: "G2" })).toThrow("没有 her1bt");
  });
});

describe("docs/her1/state.json 一致性", () => {
  test("美术包目录、任务文件与 sprite 映射齐全", () => {
    for (const [packId, pack] of Object.entries(state.packs)) {
      expect(existsSync(join(REPO_ROOT, pack.dir, "_task.json"))).toBe(true);
      expect(existsSync(join(REPO_ROOT, pack.dir, "README_给美术.txt"))).toBe(true);
      const task = loadTask(state, packId);
      expect(task.task_id).toBe(packId);
      for (const sprite of pack.sprites) {
        expect(findSprite(task, sprite.spriteId).required !== false).toBe(sprite.required);
        expect(sprite.target.attachmentId).toContain("her1");
        if (sprite.target.kind === "equipment-attachment") for (const id of sprite.target.equipment) expect(id).toContain("her1");
      }
      for (const id of [...(pack.wiring.show ?? []), ...(pack.wiring.showIfDelivered ?? []), ...(pack.wiring.strip ?? [])]) expect(id).toContain("her1");
      expect(state.retiredClipTags[pack.wiring.suggestedTag]).toBeUndefined();
    }
  });

  test("live 清单不含 her1，当前指针不指向退役 tag，T03c 优先于 T10b", () => {
    for (const id of [...Object.keys(state.live.bindingMaterials), ...Object.keys(state.live.equipmentMaterials), ...state.live.equipment]) expect(id).not.toContain("her1");
    for (const gun of Object.values(state.guns)) {
      if (gun.clipTag) expect(state.retiredClipTags[gun.clipTag]).toBeUndefined();
      for (const id of gun.her1Equipment) expect(id).toContain("her1");
    }
    expect(state.guns.G1.clipTag).toBe("her1am_c21n");
    expect(state.packs.T03c.priority).toBeLessThan(state.packs.T10b.priority);
  });
});
