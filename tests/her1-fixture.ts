import type { CharacterBinding, MotionClip, RegionAttachment, Vec3 } from "../packages/shared/src/animation";
import type { EquipmentAttachment, EquipmentDefinition } from "../packages/shared/src/equipment";
import type { SkeletalProjectDocument } from "../packages/shared/src/skeletalProject";
import type { AicOperation } from "../scripts/her1/lib/plans";
import { createImage, type RgbaImage } from "../scripts/her1/lib/png";
import type { Her1State } from "../scripts/her1/lib/state";

export const PROJECT_ID = "90acc389-43ae-44de-bb7e-daed07f85472";
export const HIDDEN: Vec3 = [0.001, 0.001, 1];
export const VISIBLE: Vec3 = [1, 1, 1];

const IDENTITY_ROTATION: [number, number, number, number] = [0, 0, 0, 1];

function region(id: string, materialId: string, scale: Vec3 = VISIBLE): RegionAttachment {
  return { id, name: id, type: "region", materialId, imageSlot: "raw", size: [40, 40], pivot: [0.5, 0.5], rest: { translation: [0, 0, 0], rotation: IDENTITY_ROTATION, scale } };
}

function equipAttachment(id: string, materialId: string, scale: Vec3 = VISIBLE): EquipmentAttachment {
  return { id, name: id, socket: "secondaryGrip", materialId, imageSlot: "raw", size: [58, 62], pivot: [0.34, 0.97], rest: { translation: [0, 0, 0], rotation: IDENTITY_ROTATION, scale }, drawGroup: "weapon", drawOffset: 0 };
}

function equipment(id: string, attachments: EquipmentAttachment[]): EquipmentDefinition {
  return { schemaVersion: 1, id, name: id, tags: [], visualMode: "attached", primarySlot: "main-hand", occupiedSlots: ["main-hand"], conflictTags: [], replacesParts: [], hidesSlots: [], attachments };
}

/** 依 docs/her1/state.json 的 live 素材与 her1 附件 id 构造的最小 ECHO 工程。 */
export function her1Document(): SkeletalProjectDocument {
  const attachments: RegionAttachment[] = [
    region("att-upper_arm_far", "68a7242a-0000-4000-8000-000000000001"),
    region("att-forearm_far", "47d77217-0000-4000-8000-000000000002"),
    region("att-upper_arm_near", "1a614ab6-0000-4000-8000-000000000003"),
    region("att-p19x-upper_arm_far_c22c", "3dd07aff-0000-4000-8000-000000000004", HIDDEN),
    region("att-p19x-forearm_far_c21c", "de1c4516-0000-4000-8000-000000000005", HIDDEN),
    region("att-cap_far", "cafe0001-0000-4000-8000-000000000006"),
    region("att-shoulder_cap_near-redraw1", "cafe0002-0000-4000-8000-000000000007"),
    region("att-p19x-upper_arm_far_foreshrt_g1aim-her1", "35878b00-0000-4000-8000-000000000008", HIDDEN),
    region("att-p19x-forearm_far_foreshrt_g1aim-her1", "1475c51c-0000-4000-8000-000000000009", HIDDEN),
    region("att-p19x-elbow_far_foreshrt_g1aim-her1", "e329720b-0000-4000-8000-00000000000a", HIDDEN),
  ];
  const binding: CharacterBinding = {
    schemaVersion: 1,
    kind: "character-binding",
    id: "her1-binding",
    name: "her1",
    skeletonId: "humanoid",
    slots: attachments.map((item, index) => ({ id: `slot-${item.id}`, name: item.id, boneId: "forearm_far", attachmentId: item.id, drawOrder: 800 + index })),
    attachments,
  } as CharacterBinding;
  const g3Live = equipment("c34-g3-K02-p19v-p19y", [equipAttachment("c34-g3-K02-p19v-p19y:support-hand", "59fc3f63-0000-4000-8000-00000000000b")]);
  const g3Her1 = ["c34-g3-K02-p19v-p19y-her1", "c34-g3-K02-p19v-p19y-her1-hd"].map((id) => equipment(id, [
    equipAttachment("c34-g3-K02-p19v-p19y-her1:support-hand", "55fec0ec-0000-4000-8000-00000000000c"),
    equipAttachment("c34-g1-K05-p19y-her1:p15-idle-support", "1d1e5000-0000-4000-8000-00000000000d", HIDDEN),
  ]));
  const others = ["c34-g1-K05-p19y", "c34-g1-K05-p19y-her1", "c34-g1-K05-p19y-her1-hd", "c34-g4-K01-p19y", "c34-g4-K01-p19y-her1", "c34-g5-K07-p19y", "c34-g5-K07-p19y-her1"].map((id) => equipment(id, []));
  const animations = ([["G1", "c34-g1", "her1am_c21n"], ["G3", "c34-g3", "her1am3c"], ["G4", "c34-g4", "her1am4d"], ["G5", "c34-g5", "her1am5"]] as const).flatMap(([, prefix, tag]) =>
    ["idle", "prepare", "aim", "fire", "recover"].map((phase) => ({ id: `${prefix}:her1bt-${phase}`, name: `${prefix} her1 ${phase}`, motionClipId: `${prefix}:${phase}-clip-${tag}`, speed: 1, repeat: 1, loop: phase === "idle" })));
  animations.push({ id: "c34-g1:p16k10-aim", name: "live aim", motionClipId: "c34-g1:aim-clip-p16k10", speed: 1, repeat: 1, loop: false });
  return {
    schemaVersion: 2,
    projectId: PROJECT_ID,
    character: { binding },
    animations,
    activeAnimationId: null,
    equipment: [g3Live, ...g3Her1, ...others],
  };
}

/** c21n 风格基线：透视三件 STRIP（无 scale 轨），仅有骨骼旋转与一条 live 远臂 HIDE。 */
export function baseClip(id: string, schemaVersion: 1 | 2 = 1): MotionClip {
  if (schemaVersion === 2) {
    return {
      schemaVersion: 2, kind: "motion-clip", id, name: id, skeletonId: "humanoid", duration: 1.2, loop: false, events: [],
      tracks: [
        { targetId: "forearm_far", property: "rotation", keyframes: [{ time: 0, value: IDENTITY_ROTATION, outInterpolation: { type: "linear" } }, { time: 1.2, value: IDENTITY_ROTATION, outInterpolation: null }] },
        { targetId: "att:att-p19x-forearm_far_foreshrt_g1aim-her1", property: "translation", keyframes: [{ time: 0, value: [2, -1, 0], outInterpolation: null }] },
      ],
    };
  }
  return {
    schemaVersion: 1, kind: "motion-clip", id, name: id, skeletonId: "humanoid", duration: 1.2, loop: false, events: [],
    tracks: [
      { targetId: "forearm_far", property: "rotation", interpolation: "linear", keyframes: [{ time: 0, value: IDENTITY_ROTATION }, { time: 1.2, value: IDENTITY_ROTATION }] },
      { targetId: "att:att-upper_arm_far", property: "scale", interpolation: "step", keyframes: [{ time: 0, value: [0.001, 0.001, 1] }] },
      { targetId: "att:att-p19x-upper_arm_far_foreshrt_g1aim-her1", property: "scale", interpolation: "step", keyframes: [{ time: 0, value: [1, 1, 1] }] },
    ],
  };
}

/** 内存版 aic_apply_operations：只实现 her1 工具链会发出的四种操作。 */
export function applyOperations(document: SkeletalProjectDocument, clips: Map<string, MotionClip>, operations: AicOperation[]): SkeletalProjectDocument {
  const next = structuredClone(document);
  for (const operation of operations) {
    if (operation.type === "upsert-binding") next.character = { binding: operation.binding };
    else if (operation.type === "upsert-equipment") {
      const list = next.equipment ?? [];
      const index = list.findIndex((item) => item.id === operation.equipment.id);
      if (index >= 0) list[index] = operation.equipment; else list.push(operation.equipment);
      next.equipment = list;
    } else if (operation.type === "create-motion-clip") {
      if (clips.has(operation.asset.id)) throw new Error(`clip ${operation.asset.id} 已存在`);
      clips.set(operation.asset.id, operation.asset);
    } else {
      const index = next.animations.findIndex((item) => item.id === operation.action.id);
      if (index >= 0) next.animations[index] = { ...next.animations[index], ...operation.action }; else next.animations.push(operation.action);
    }
  }
  return next;
}

export function cloneState(state: Her1State): Her1State {
  return structuredClone(state);
}

/** 画一块合规像素：外露边为轮廓 RGB(9,5,9)，内部填色板色；`openLeft` 时左边中段留 open_edge 切口。 */
export function paintBlock(width: number, height: number, fill: [number, number, number], box: [number, number, number, number], openLeft = false): RgbaImage {
  const image = createImage(width, height);
  const [x0, y0, x1, y1] = box;
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) {
    const border = x === x0 || x === x1 || y === y0 || y === y1;
    const open = openLeft && x === x0 && y > y0 && y < y1;
    const rgb = border && !open ? [9, 5, 9] : fill;
    const o = (y * width + x) * 4;
    image.data[o] = rgb[0]; image.data[o + 1] = rgb[1]; image.data[o + 2] = rgb[2]; image.data[o + 3] = 255;
  }
  return image;
}

class Writer {
  private parts: number[] = [];
  u8(v: number) { this.parts.push(v & 255); return this; }
  u16(v: number) { return this.u8(v >> 8).u8(v); }
  i16(v: number) { return this.u16(v < 0 ? v + 65536 : v); }
  u32(v: number) { return this.u8(v >>> 24).u8(v >>> 16).u8(v >>> 8).u8(v); }
  i32(v: number) { return this.u32(v >>> 0); }
  ascii(s: string) { for (const c of s) this.u8(c.charCodeAt(0)); return this; }
  bytes(b: ArrayLike<number>) { for (let i = 0; i < b.length; i += 1) this.u8(b[i]); return this; }
  get length() { return this.parts.length; }
  done() { return Uint8Array.from(this.parts); }
}

function packBitsRow(row: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < row.length;) {
    let run = 1;
    while (i + run < row.length && run < 128 && row[i + run] === row[i]) run += 1;
    if (run >= 2) { out.push(257 - run, row[i]); i += run; continue; }
    const start = i;
    while (i < row.length && i - start < 128 && !(i + 1 < row.length && row[i + 1] === row[i])) i += 1;
    if (i === start) i += 1;
    out.push(i - start - 1, ...row.subarray(start, i));
  }
  return Uint8Array.from(out);
}

export interface SyntheticLayer { name: string; image: RgbaImage; left: number; top: number; opacity?: number; hidden?: boolean; asciiName?: string }

/** 合成最小 8 位 RGB PSD（layer + luni 名称），交替使用 raw 与 RLE 通道压缩。 */
export function writePsd(width: number, height: number, layers: SyntheticLayer[]): Uint8Array {
  const records = new Writer();
  const channelData = new Writer();
  records.i16(layers.length);
  layers.forEach((layer, index) => {
    const { image } = layer;
    const channels = [-1, 0, 1, 2].map((id) => {
      const plane = new Uint8Array(image.width * image.height);
      const c = id === -1 ? 3 : id;
      for (let i = 0; i < plane.length; i += 1) plane[i] = image.data[i * 4 + c];
      const w = new Writer();
      if (index % 2 === 0) {
        w.u16(0).bytes(plane);
      } else {
        const rows = Array.from({ length: image.height }, (_, y) => packBitsRow(plane.subarray(y * image.width, (y + 1) * image.width)));
        w.u16(1);
        for (const row of rows) w.u16(row.length);
        for (const row of rows) w.bytes(row);
      }
      return { id, data: w.done() };
    });
    records.i32(layer.top).i32(layer.left).i32(layer.top + image.height).i32(layer.left + image.width);
    records.u16(channels.length);
    for (const channel of channels) records.i16(channel.id).u32(channel.data.length);
    records.ascii("8BIM").ascii("norm").u8(layer.opacity ?? 255).u8(0).u8(layer.hidden ? 2 : 0).u8(0);
    const extra = new Writer();
    extra.u32(0).u32(0);
    const pascal = layer.asciiName ?? "layer";
    extra.u8(pascal.length).ascii(pascal);
    while ((extra.length - 8) % 4 !== 0) extra.u8(0);
    const luni = new Writer().u32(layer.name.length);
    for (const ch of layer.name) luni.u16(ch.charCodeAt(0));
    if (luni.length % 2) luni.u8(0);
    const luniBytes = luni.done();
    extra.ascii("8BIM").ascii("luni").u32(luniBytes.length).bytes(luniBytes);
    const extraBytes = extra.done();
    records.u32(extraBytes.length).bytes(extraBytes);
    for (const channel of channels) channelData.bytes(channel.data);
  });
  const layerInfo = new Writer().bytes(records.done()).bytes(channelData.done());
  if (layerInfo.length % 2) layerInfo.u8(0);
  const layerInfoBytes = layerInfo.done();
  const layerAndMask = new Writer().u32(layerInfoBytes.length).bytes(layerInfoBytes).u32(0).done();
  return new Writer()
    .ascii("8BPS").u16(1).bytes(new Uint8Array(6)).u16(3).u32(height).u32(width).u16(8).u16(3)
    .u32(0).u32(0)
    .u32(layerAndMask.length).bytes(layerAndMask)
    .u16(0)
    .done();
}
