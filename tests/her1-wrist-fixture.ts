import { quaternionFromZRotation, type CharacterBinding, type MotionClip, type RegionAttachment, type Skeleton, type Vec3 } from "../packages/shared/src/animation";
import type { BodyProfile, EquipmentAttachment, EquipmentDefinition } from "../packages/shared/src/equipment";
import type { SkeletalProjectDocument } from "../packages/shared/src/skeletalProject";
import { encodePng, type RgbaImage } from "../scripts/her1/lib/png";
import type { SnapshotManifest } from "../scripts/her1/lib/snapshot";
import { G3_WRIST } from "../scripts/her1/lib/wristRunner";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paintBlock, PROJECT_ID } from "./her1-fixture";

/** 合成 G3 rig：胸 → 远臂上臂 → 前臂；枪手骨挂 rifle-support，支撑手按 T03c 合同尺寸/pivot。 */
const HIDDEN: Vec3 = [0.001, 0.001, 1];
export const deg = (d: number) => quaternionFromZRotation(d * Math.PI / 180);
const T = (x: number, y: number, angle = 0, scale: Vec3 = [1, 1, 1]) => ({ translation: [x, y, 0] as Vec3, rotation: deg(angle), scale });
const SKIN: [number, number, number] = [237, 155, 112];
const GLOVE: [number, number, number] = [51, 51, 58];
export const HAND_ID = G3_WRIST.handAttachmentId;

export const skeleton: Skeleton = {
  schemaVersion: 1, kind: "skeleton", id: "humanoid", name: "humanoid",
  coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "pixel" },
  bones: [
    { id: "root", name: "root", parentId: null, rest: T(0, 0) },
    { id: "chest", name: "chest", parentId: "root", rest: T(0, 100) },
    { id: "upper_arm_far", name: "upper_arm_far", parentId: "chest", rest: T(16, -16), tipOffset: [40, 0, 0] },
    { id: "forearm_far", name: "forearm_far", parentId: "upper_arm_far", rest: T(40, 0), tipOffset: [40, 0, 0] },
    { id: "hand_near", name: "hand_near", parentId: "chest", rest: T(183, -23) },
  ],
};

const body: BodyProfile = { schemaVersion: 1, id: "her1-body", name: "her1", skeletonId: "humanoid", mirrorAxis: "x", slots: [{ id: "main-hand", name: "main", accepts: ["weapon"] } as never], sockets: [{ id: "rifle-support", semantic: "support", boneId: "hand_near", rest: T(0, 0), accepts: ["weapon"] }] };

function region(id: string, materialId: string, size: [number, number], pivot: [number, number], scale: Vec3 = [1, 1, 1]): RegionAttachment {
  return { id, name: id, type: "region", materialId, imageSlot: "raw", size, pivot, rest: T(0, 0, 0, scale) };
}

function handAttachment(id: string, materialId: string): EquipmentAttachment {
  return { id, name: id, socket: "rifle-support", materialId, imageSlot: "raw", size: [178, 76], pivot: [0.7865168539325843, 0.7894736842105263], rest: T(0, 0), drawGroup: "weapon", drawOffset: 0 };
}

function equipment(id: string, attachments: EquipmentAttachment[]): EquipmentDefinition {
  return { schemaVersion: 1, id, name: id, tags: [], visualMode: "attached", primarySlot: "main-hand", occupiedSlots: ["main-hand"], conflictTags: [], replacesParts: [], hidesSlots: [], attachments };
}

export const MAT = {
  torso: "70750000-0000-4000-8000-000000000001",
  upper: "8b5194c2-0000-4000-8000-000000000002",
  forearm: "71bb17a1-0000-4000-8000-000000000003",
  hand: "e53e3c92-0000-4000-8000-000000000004",
  liveHand: "59fc3f63-0000-4000-8000-000000000005",
};

/** 腕口在左侧（接缝带内左缘不描边），掌心在右侧带外；与 T03c 合同同尺寸、同 pivot。 */
function handImage(): RgbaImage {
  return paintBlock(89, 38, GLOVE, [20, 10, 80, 30], true);
}

export function images(forearmHeight = 22): Map<string, RgbaImage> {
  return new Map([
    [MAT.torso, paintBlock(30, 40, SKIN, [0, 0, 29, 39])],
    [MAT.upper, paintBlock(20, 22, SKIN, [0, 0, 19, 21])],
    [MAT.forearm, paintBlock(24, forearmHeight, SKIN, [0, 0, 23, forearmHeight - 1])],
    [MAT.hand, handImage()],
    [MAT.liveHand, paintBlock(29, 31, GLOVE, [0, 0, 28, 30])],
  ]);
}

export function document(options: { handOnForearm?: boolean; forearmHeight?: number; handAngle?: number } = {}): SkeletalProjectDocument {
  const fh = options.forearmHeight ?? 22;
  const attachments: RegionAttachment[] = [
    region("att-torso-her1", MAT.torso, [60, 80], [0.5, 0.5]),
    region("att-p19x-upper_arm_far_c22c-her1", MAT.upper, [40, 44], [0, 0.5]),
    region("att-p19x-forearm_far_c21c-her1", MAT.forearm, [48, fh * 2], [0, 0.5]),
    region("att-upper_arm_far", "68a7242a-0000-4000-8000-000000000011", [40, 20], [0, 0.5], HIDDEN),
    region("att-forearm_far", "47d77217-0000-4000-8000-000000000012", [40, 20], [0, 0.5], HIDDEN),
    region("att-upper_arm_near", "1a614ab6-0000-4000-8000-000000000013", [40, 20], [0, 0.5], HIDDEN),
    region("att-p19x-upper_arm_far_c22c", "3dd07aff-0000-4000-8000-000000000014", [40, 20], [0, 0.5], HIDDEN),
    region("att-p19x-forearm_far_c21c", "de1c4516-0000-4000-8000-000000000015", [40, 20], [0, 0.5], HIDDEN),
  ];
  const boneOf: Record<string, string> = { "att-torso-her1": "chest", "att-p19x-upper_arm_far_c22c-her1": "upper_arm_far", "att-p19x-forearm_far_c21c-her1": "forearm_far", "att-upper_arm_far": "upper_arm_far", "att-forearm_far": "forearm_far", "att-upper_arm_near": "chest", "att-p19x-upper_arm_far_c22c": "upper_arm_far", "att-p19x-forearm_far_c21c": "forearm_far" };
  const binding = { schemaVersion: 1, kind: "character-binding", id: "her1-binding", name: "her1", skeletonId: "humanoid", attachments, slots: attachments.map((item, index) => ({ id: `slot-${item.id}`, name: item.id, boneId: boneOf[item.id]!, attachmentId: item.id, drawOrder: index })) } as CharacterBinding;
  const profile = structuredClone(body);
  if (options.handOnForearm) profile.sockets[0]!.boneId = "forearm_far";
  if (options.handAngle) profile.sockets[0]!.rest = T(0, 0, options.handAngle);
  const her1 = ["c34-g3-K02-p19v-p19y-her1", "c34-g3-K02-p19v-p19y-her1-hd"].map((id) => equipment(id, [handAttachment(HAND_ID, MAT.hand)]));
  return {
    schemaVersion: 2, projectId: PROJECT_ID, character: { binding },
    animations: ["idle", "prepare", "aim", "fire", "recover"].map((phase) => ({ id: `c34-g3:her1bt-${phase}`, name: `g3 ${phase}`, motionClipId: `c34-g3:${phase}-clip-her1am3c`, speed: 1, repeat: 1, loop: phase === "idle" })),
    activeAnimationId: null, bodyProfiles: [profile],
    equipment: [equipment("c34-g3-K02-p19v-p19y", [handAttachment("c34-g3-K02-p19v-p19y:support-hand", MAT.liveHand)]), ...her1],
  };
}

/** her1am3c 风格基线：前臂往下掉，远端停在腕口下方（断腕）；存在一个前臂近水平送进腕口的可解姿势。 */
export function baseClip(phase: string): MotionClip {
  const swing = phase === "aim" ? -6 : 0;
  const loop = phase === "idle";
  // 循环 clip 首尾相同（否则基线自己在循环接缝处跳帧）。
  const keys = <T>(start: T, mid: T, end: T) => loop
    ? [{ time: 0, value: start }, { time: 0.3, value: mid }, { time: 0.6, value: start }]
    : [{ time: 0, value: start }, { time: 0.6, value: end }];
  return {
    schemaVersion: 1, kind: "motion-clip", id: `c34-g3:${phase}-clip-her1am3c`, name: phase, skeletonId: "humanoid", duration: 0.6, loop, events: [],
    tracks: [
      { targetId: "upper_arm_far", property: "rotation", interpolation: "linear", keyframes: keys(deg(-40 + swing), deg(-42 + swing), deg(-44 + swing)) },
      { targetId: "forearm_far", property: "rotation", interpolation: "linear", keyframes: keys(deg(10), deg(12), deg(14)) },
      { targetId: "hand_near", property: "translation", interpolation: "linear", keyframes: keys<Vec3>([183, -23, 0], [182, -22, 0], [181, -21, 0]) },
    ],
  };
}

export function writeSnapshot(dir: string, doc: SkeletalProjectDocument, imgs: Map<string, RgbaImage>, phases = ["idle", "aim"]): string {
  mkdirSync(join(dir, "clips"), { recursive: true });
  mkdirSync(join(dir, "materials"), { recursive: true });
  const actions = phases.map((phase) => {
    const clip = baseClip(phase);
    const clipFile = join("clips", `${clip.id.replace(/[^A-Za-z0-9._-]/g, "_")}.json`);
    writeFileSync(join(dir, clipFile), JSON.stringify(clip));
    return { phase, actionId: `c34-g3:her1bt-${phase}`, motionClipId: clip.id, clipFile };
  });
  const materials = [...imgs].map(([materialId, image]) => {
    const file = join("materials", `${materialId}.png`);
    writeFileSync(join(dir, file), encodePng(image));
    return { materialId, file, imageSlot: "raw" as const, attachmentIds: [], size: [image.width, image.height] as [number, number] };
  });
  const manifest: SnapshotManifest = { schemaVersion: 1, createdAt: "test", projectId: PROJECT_ID, revision: 1339, gun: "G3", equipmentIds: ["c34-g3-K02-p19v-p19y-her1", "c34-g3-K02-p19v-p19y-her1-hd"], skeletonId: "humanoid", actions, materials, missingMaterials: [], references: [], notes: [] };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  writeFileSync(join(dir, "document.json"), JSON.stringify(doc));
  writeFileSync(join(dir, "skeleton.json"), JSON.stringify(skeleton));
  return dir;
}

