import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quaternionFromZRotation, type CharacterBinding, type MotionClip, type Skeleton, type Vec3 } from "../packages/shared/src/animation";
import type { BodyProfile, EquipmentDefinition } from "../packages/shared/src/equipment";
import type { SkeletalProjectDocument } from "../packages/shared/src/skeletalProject";
import { encodePng, type RgbaImage } from "../scripts/her1/lib/png";
import { composeScene, matrixAngle } from "../scripts/her1/lib/render";
import type { RunContext } from "../scripts/her1/lib/runner";
import { measureSeam, type SeamSpec } from "../scripts/her1/lib/seam";
import { loadSnapshot, snapshotPath, type SnapshotManifest } from "../scripts/her1/lib/snapshot";
import { loadState } from "../scripts/her1/lib/state";
import { MAX_ALIGN_DEG } from "../scripts/her1/lib/wristFix";
import { activeSupportIk, analyzeIkWrist, applyIkLever, classifyIkWrist, cutForEquipment, sampleIkWrist, type IkSearchSpace } from "../scripts/her1/lib/wristIk";
import { G3_WRIST, runApplyPlan, runFixWrist } from "../scripts/her1/lib/wristRunner";
import { paintBlock, PROJECT_ID } from "./her1-fixture";

/** 合成双手 IK rig：远臂骨朝下（子骨平移沿 -y），支撑手挂在 IK 末端骨 hand_far；手图腕口开在左缘，pivot 在右侧指节。 */
const T = (x: number, y: number, angleDeg = 0, scale: Vec3 = [1, 1, 1]) => ({ translation: [x, y, 0] as Vec3, rotation: quaternionFromZRotation(angleDeg * Math.PI / 180), scale });
const SKIN: [number, number, number] = [237, 155, 112];
const GLOVE: [number, number, number] = [51, 51, 58];
const EQUIP = "ik-rifle-her1";
const HAND = "ik-rifle-her1:support-hand";
const MAT = { forearm: "f0f0f0f0-0000-4000-8000-000000000001", hand: "a1a1a1a1-0000-4000-8000-000000000002" };

const skeleton: Skeleton = {
  schemaVersion: 1, kind: "skeleton", id: "ik-rig", name: "ik-rig",
  coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "pixel" },
  bones: [
    { id: "root", name: "root", parentId: null, rest: T(0, 0) },
    { id: "chest", name: "chest", parentId: "root", rest: T(0, 100) },
    { id: "upper_arm_far", name: "upper_arm_far", parentId: "chest", rest: T(0, 0) },
    { id: "forearm_far", name: "forearm_far", parentId: "upper_arm_far", rest: T(0, -60) },
    { id: "hand_far", name: "hand_far", parentId: "forearm_far", rest: T(0, -50) },
    { id: "hand_near", name: "hand_near", parentId: "chest", rest: T(80, -20) },
  ],
};

const spec: SeamSpec = { handAttachmentId: HAND, farRootBone: "upper_arm_far", joinRootBone: "forearm_far", openBand: [0, 0, 59, 37], nativeSize: [89, 38], outline: [9, 5, 9] };

function images(): Map<string, RgbaImage> {
  return new Map([[MAT.forearm, paintBlock(10, 25, SKIN, [0, 0, 9, 24])], [MAT.hand, paintBlock(89, 38, GLOVE, [20, 10, 80, 30], true)]]);
}

function makeDocument(options: { mix?: number; bend?: "positive" | "negative" } = {}): SkeletalProjectDocument {
  const binding = {
    schemaVersion: 1, kind: "character-binding", id: "ik-binding", name: "ik", skeletonId: skeleton.id,
    attachments: [{ id: "att-forearm_far", name: "forearm", type: "region", materialId: MAT.forearm, imageSlot: "raw", size: [11, 50], pivot: [0.5, 1], rest: T(0, 0) }],
    slots: [{ id: "slot-forearm", name: "forearm", boneId: "forearm_far", attachmentId: "att-forearm_far", drawOrder: 0 }],
  } as CharacterBinding;
  const body: BodyProfile = { schemaVersion: 1, id: "ik-body", name: "ik", skeletonId: skeleton.id, mirrorAxis: "x", slots: [{ id: "main-hand", name: "main", accepts: ["rifle"] } as never], sockets: [
    { id: "rifle-main", semantic: "weapon_hand_right", boneId: "hand_near", rest: T(0, 0), accepts: ["rifle"] },
    { id: "rifle-support", semantic: "weapon_hand_left", boneId: "hand_far", rest: T(0, 0), accepts: ["rifle"] },
  ] };
  const equipment: EquipmentDefinition = {
    schemaVersion: 1, id: EQUIP, name: EQUIP, tags: ["rifle"], visualMode: "attached", primarySlot: "main-hand", occupiedSlots: ["main-hand", "support-hand"], conflictTags: [], replacesParts: [], hidesSlots: [],
    attachments: [{ id: HAND, name: "support", socket: "rifle-support", materialId: MAT.hand, imageSlot: "raw", size: [44.5, 19], pivot: [0.9, 0.5], rest: T(0, 0), drawGroup: "rifle-hold", drawOffset: 0 }],
    weapon: {
      holdMode: "two_hand", preferredPrimaryHand: "right", mirrorAllowed: false, stanceProfile: "ik", primaryGrip: T(0, 0), secondaryGrip: T(-30, -10),
      secondaryHandConstraint: { id: "ik-support", upperBoneId: "upper_arm_far", lowerBoneId: "forearm_far", endBoneId: "hand_far", targetSocket: "rifle-support", bendDirection: options.bend ?? "positive", mix: options.mix ?? 1, stretch: "forbid", alignEnd: true } as never,
    },
  };
  return { schemaVersion: 2, projectId: PROJECT_ID, character: { binding }, animations: [], activeAnimationId: null, bodyProfiles: [body], equipment: [equipment] };
}

/** aim：主手在 (80,80)；idle：主手压到 (20,40)，远臂换成另一种折法。 */
function clip(phase: "aim" | "idle"): MotionClip {
  const tracks = phase === "idle" ? [{ targetId: "hand_near", property: "translation" as const, interpolation: "linear" as const, keyframes: [{ time: 0, value: [20, -60, 0] as Vec3 }, { time: 0.4, value: [20, -60, 0] as Vec3 }] }] : [];
  return { schemaVersion: 1, kind: "motion-clip", id: `ik-g3:${phase}-clip-her1am3c`, name: phase, skeletonId: skeleton.id, duration: 0.4, loop: phase === "idle", events: [], tracks };
}

const workRoot = mkdtempSync(join(tmpdir(), "her1-wrist-ik-"));
afterAll(() => rmSync(workRoot, { recursive: true, force: true }));

describe("双手武器 IK（FB 预览语义）", () => {
  test("末端骨原点到 secondaryGrip；两骨长度不变；bend 正负给镜像肘位；alignEnd 让手跟枪", () => {
    const doc = makeDocument();
    const pos = composeScene({ document: doc, skeleton, clip: clip("aim"), time: 0, equipmentIds: [EQUIP], ik: "weapon-align" }).pose.worldMatrices;
    expect(pos.hand_far![12]).toBeCloseTo(50, 4);
    expect(pos.hand_far![13]).toBeCloseTo(70, 4);
    expect(Math.hypot(pos.forearm_far![12], pos.forearm_far![13] - 100)).toBeCloseTo(60, 4);
    expect(matrixAngle(pos.hand_far!)).toBeCloseTo(0, 6);
    const neg = composeScene({ document: makeDocument({ bend: "negative" }), skeleton, clip: clip("aim"), time: 0, equipmentIds: [EQUIP], ik: "weapon-align" }).pose.worldMatrices;
    const side = (m: number[]) => Math.sign((50 - 0) * (m[13]! - 100) - (70 - 100) * (m[12]! - 0));
    expect(side(pos.forearm_far!)).toBe(-side(neg.forearm_far!));
    const noAlign = composeScene({ document: doc, skeleton, clip: clip("aim"), time: 0, equipmentIds: [EQUIP], ik: "weapon" }).pose.worldMatrices;
    expect(Math.abs(matrixAngle(noAlign.hand_far!))).toBeGreaterThan(0.1);
    const off = composeScene({ document: doc, skeleton, clip: clip("aim"), time: 0, equipmentIds: [EQUIP], ik: "off" }).pose.worldMatrices;
    expect(off.hand_far![12]).toBeCloseTo(0, 6);
    expect(off.hand_far![13]).toBeCloseTo(-10, 6);
  });

  test("只有 mix>0 且支撑手挂在 IK 链内才算 IK 驱动", () => {
    expect(activeSupportIk(makeDocument(), skeleton, EQUIP, HAND)?.socketBone).toBe("hand_far");
    expect(activeSupportIk(makeDocument({ mix: 0 }), skeleton, EQUIP, HAND)).toBeNull();
  });

  test("快照清单里的 Windows 反斜杠路径归一", () => {
    expect(snapshotPath("clips\\a.json")).toBe("clips/a.json");
    expect(snapshotPath("materials", "x\\y.png")).toBe("materials/x/y.png");
    const dir = join(workRoot, "backslash");
    mkdirSync(join(dir, "clips"), { recursive: true });
    mkdirSync(join(dir, "materials"), { recursive: true });
    writeFileSync(join(dir, "clips", "aim.json"), JSON.stringify(clip("aim")));
    writeFileSync(join(dir, "materials", "hand.png"), encodePng(images().get(MAT.hand)!));
    const manifest: SnapshotManifest = { schemaVersion: 1, createdAt: "test", projectId: PROJECT_ID, revision: 1, gun: "G3", equipmentIds: [EQUIP], skeletonId: skeleton.id, actions: [{ phase: "aim", actionId: "a", motionClipId: clip("aim").id, clipFile: "clips\\aim.json" }], materials: [{ materialId: MAT.hand, file: "materials\\hand.png", imageSlot: "raw", attachmentIds: [], size: [89, 38] }], missingMaterials: [], references: [], notes: [] };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "document.json"), JSON.stringify(makeDocument()));
    writeFileSync(join(dir, "skeleton.json"), JSON.stringify(skeleton));
    const snap = loadSnapshot(dir);
    expect(snap.clips.aim?.id).toBe(clip("aim").id);
    expect(snap.images.has(MAT.hand)).toBe(true);
  });
});

const SMALL: IkSearchSpace = { slide: [-10, 0, 10], lift: [0], rotateDeg: [-20, 0, 20], bends: ["positive", "negative"] };
const input = (document: SkeletalProjectDocument) => ({ document, skeleton, images: images(), equipmentId: EQUIP, spec });

describe("IK 腕口：装备杠杆与结论", () => {
  test("腕口切口在指节另一头：基线离前臂远端一整只手长，夹角大", () => {
    const doc = makeDocument();
    const ik = activeSupportIk(doc, skeleton, EQUIP, HAND)!;
    const s = sampleIkWrist(input(doc), ik, clip("aim"), "aim", 0)!;
    expect(s.reached).toBe(true);
    expect(s.cutGap).toBeGreaterThan(20);
    expect(s.cutRelDeg).toBeCloseTo(0, 0);
  });

  test("切口挪到 IK 目标（前臂塞进腕口 4）、再绕前臂远端转正：几何对齐且腕口度量 PASS（接线可修）", () => {
    const base = makeDocument();
    const cut = cutForEquipment(base, images(), EQUIP, spec)!;
    const moved = applyIkLever(base, skeleton, EQUIP, HAND, cut, { slide: 0, lift: 0, rotateDeg: 0, bend: "positive" }, { overlap: 4 }).document;
    const ik = activeSupportIk(moved, skeleton, EQUIP, HAND)!;
    const s = sampleIkWrist(input(moved), ik, clip("aim"), "aim", 0)!;
    expect(s.cutGap).toBeCloseTo(4, 3);
    const delta = s.forearmRelDeg - s.cutRelDeg;
    const hand = moved.equipment![0]!.attachments[0]!;
    const r = delta * Math.PI / 180, [tx, ty] = hand.rest.translation;
    hand.rest = { ...hand.rest, translation: [tx * Math.cos(r) - ty * Math.sin(r), tx * Math.sin(r) + ty * Math.cos(r), 0], rotation: quaternionFromZRotation(r) };
    const aligned = sampleIkWrist(input(moved), activeSupportIk(moved, skeleton, EQUIP, HAND)!, clip("aim"), "aim", 0)!;
    expect(aligned.alignDeg).toBeLessThan(1);
    expect(aligned.cutGap).toBeCloseTo(4, 3);
    const scene = composeScene({ document: moved, skeleton, clip: clip("aim"), time: 0, equipmentIds: [EQUIP], ik: "weapon-align" });
    expect(measureSeam(scene, images(), skeleton, spec, { time: 0 }).metrics.verdict).toBe("PASS");
    const report = analyzeIkWrist(input(moved), activeSupportIk(moved, skeleton, EQUIP, HAND)!, [{ phase: "aim", clip: clip("aim"), times: [0, 0.2] }], { slide: [0], lift: [0], rotateDeg: [0], bends: ["positive"] }, 4);
    if (typeof report === "string") throw new Error(report);
    expect(report.geometricPass).toBe(true);
    expect(classifyIkWrist(report, true)).toBe("wiring-fixable");
  });

  test("两种稳定折法要的前臂方向差太大：一张刚性手图接不住 → 仍需画师新手，规格分两组", () => {
    const doc = makeDocument();
    const ik = activeSupportIk(doc, skeleton, EQUIP, HAND)!;
    const report = analyzeIkWrist(input(doc), ik, [{ phase: "aim", clip: clip("aim"), times: [0, 0.2, 0.4] }, { phase: "idle", clip: clip("idle"), times: [0, 0.2, 0.4] }], SMALL);
    if (typeof report === "string") throw new Error(report);
    expect(report.baseline.unreachable).toBe(0);
    expect(report.best.worstAlignDeg).toBeGreaterThan(MAX_ALIGN_DEG);
    expect(report.geometricPass).toBe(false);
    expect(classifyIkWrist(report, false)).toBe("needs-art");
    expect(report.artSpec.groups.length).toBe(2);
    const [a, b] = report.artSpec.groups;
    expect(Math.abs(a!.forearmRelDeg - b!.forearmRelDeg)).toBeGreaterThan(30);
    expect(a!.forearm?.width).toBeGreaterThan(0);
  });

  test("fix-wrist 遇 IK 驱动走装备路径：结论进 plan.json，不含写入操作，apply-plan 拒绝", async () => {
    const dir = join(workRoot, "snap");
    mkdirSync(join(dir, "clips"), { recursive: true });
    mkdirSync(join(dir, "materials"), { recursive: true });
    const actions = (["idle", "aim"] as const).map((phase) => {
      const c = clip(phase);
      writeFileSync(join(dir, "clips", `${phase}.json`), JSON.stringify(c));
      return { phase, actionId: `ik-g3:her1bt-${phase}`, motionClipId: c.id, clipFile: `clips/${phase}.json` };
    });
    const materials = [...images()].map(([materialId, image]) => {
      writeFileSync(join(dir, "materials", `${materialId}.png`), encodePng(image));
      return { materialId, file: `materials/${materialId}.png`, imageSlot: "raw" as const, attachmentIds: [], size: [image.width, image.height] as [number, number] };
    });
    const manifest: SnapshotManifest = { schemaVersion: 1, createdAt: "test", projectId: PROJECT_ID, revision: 7, gun: "G3", equipmentIds: [EQUIP], skeletonId: skeleton.id, actions, materials, missingMaterials: [], references: [], notes: [] };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "document.json"), JSON.stringify(makeDocument()));
    writeFileSync(join(dir, "skeleton.json"), JSON.stringify(skeleton));
    const statePath = join(workRoot, "state.json");
    writeFileSync(statePath, readFileSync(join(import.meta.dir, "..", "docs", "her1", "state.json")));
    const lines: string[] = [];
    const ctx: RunContext = { state: loadState(statePath), statePath, outDir: join(workRoot, "fix"), mcpUrl: "http://127.0.0.1:9/mcp", apiBase: "http://127.0.0.1:9", projectId: PROJECT_ID, log: (line) => lines.push(line) };
    const defaults = { ...G3_WRIST, handAttachmentId: HAND };
    const outcome = runFixWrist(ctx, { snapshot: dir, gun: "G3", tag: "her1am3d", upperBone: "upper_arm_far", lowerBone: "forearm_far", farRootBone: "upper_arm_far", overlap: 4, step: 0.1, maxDelta: 1.2, defaults, zoom: 2 });
    expect(outcome.pass).toBe(false);
    const plan = JSON.parse(readFileSync(outcome.planPath, "utf8"));
    expect(plan.mode).toBe("equipment-ik");
    expect(plan.verdictLabel).toBe("仍需画师新手");
    expect(plan.operations).toEqual([]);
    expect(plan.candidateEquipment.id).toBe(`${EQUIP}-her1am3d`);
    expect(plan.ik.artSpec.groups.length).toBe(2);
    expect(lines.some((line) => line.includes("clip 里的远臂旋转会被 IK 覆盖"))).toBe(true);
    await expect(runApplyPlan(ctx, { plan: outcome.planPath, apply: false, updateState: false })).rejects.toThrow("仍需画师新手");
  }, 120_000);
});
