/**
 * Canonical minimal-region fixture domain + expected semantic truth.
 * Pure builder: no storage/ writes; used by generator and parity tests.
 */
import {
  assembleLoadout,
  multiplyMatrices,
  sampleMotionClip,
  sha256Digest,
  transformToMatrix,
  type BodyProfile,
  type CharacterBinding,
  type CharacterLoadout,
  type MotionClip,
  type Skeleton,
  type Transform,
} from "@framebaker/shared";
import { solidTexturePng } from "./fixturePng";

const IDENTITY: Transform = {
  translation: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

export interface MinimalRegionDomain {
  skeleton: Skeleton;
  binding: CharacterBinding;
  body: BodyProfile;
  clip: MotionClip;
  loadout: CharacterLoadout;
  actionSteps: Array<{ actionId: string; time: number }>;
  textureBytes: Uint8Array;
  textureRgba: Uint8Array;
  textureSize: number;
  textureRgbaColor: [number, number, number, number];
}

export interface FixtureExpectedMatrix {
  boneId: string;
  time: number;
  world: number[];
}

export interface FixtureExpectedSocket {
  id: string;
  semantic: string;
  boneId: string;
  time: number;
  position: [number, number, number];
  world: number[];
}

export interface FixtureExpectedSlot {
  id: string;
  attachmentId: string;
  boneId: string;
  drawOrder: number;
}

export interface FixtureExpectedPixelSample {
  x: number;
  y: number;
  rgba: [number, number, number, number];
}

export interface FixtureExpectedPixels {
  attachmentId: string;
  width: number;
  height: number;
  checksum: string;
  samples: FixtureExpectedPixelSample[];
}

export interface FixtureExpected {
  matrices: FixtureExpectedMatrix[];
  sockets: FixtureExpectedSocket[];
  slots: FixtureExpectedSlot[];
  events: Array<{ time: number; type: string; name: string }>;
  pixels: FixtureExpectedPixels;
}

function decodeSolidRgba(size: number, rgba: [number, number, number, number]): Uint8Array {
  const buf = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    buf[i * 4] = rgba[0];
    buf[i * 4 + 1] = rgba[1];
    buf[i * 4 + 2] = rgba[2];
    buf[i * 4 + 3] = rgba[3];
  }
  return buf;
}

/** Shared canonical domain for minimal-region package + expected truth. */
export function buildMinimalRegionDomain(): MinimalRegionDomain {
  const textureSize = 16;
  const textureRgbaColor: [number, number, number, number] = [200, 200, 200, 255];
  const textureRgba = decodeSolidRgba(textureSize, textureRgbaColor);
  const textureBytes = solidTexturePng(textureSize, textureRgbaColor);

  const skeleton: Skeleton = {
    schemaVersion: 1,
    kind: "skeleton",
    id: "minimal-skeleton",
    name: "Minimal",
    coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "pixel" },
    bones: [{ id: "root", name: "Root", parentId: null, rest: { ...IDENTITY, translation: [...IDENTITY.translation], rotation: [...IDENTITY.rotation], scale: [...IDENTITY.scale] } }],
  };

  const binding: CharacterBinding = {
    schemaVersion: 1,
    kind: "character-binding",
    id: "minimal-binding",
    name: "Minimal",
    skeletonId: skeleton.id,
    attachments: [
      {
        id: "body-region",
        name: "Body",
        type: "region",
        materialId: "mat-body",
        imageSlot: "raw",
        size: [textureSize, textureSize],
        pivot: [0.5, 0.5],
        rest: { ...IDENTITY, translation: [...IDENTITY.translation], rotation: [...IDENTITY.rotation], scale: [...IDENTITY.scale] },
      },
    ],
    slots: [
      {
        id: "body-slot",
        name: "Body",
        boneId: "root",
        attachmentId: "body-region",
        drawOrder: 0,
      },
    ],
  };

  const body: BodyProfile = {
    schemaVersion: 1,
    id: "body",
    name: "Body",
    skeletonId: skeleton.id,
    mirrorAxis: "x",
    slots: [{ id: "head", semantic: "head", capacity: 1, accepts: ["helmet"] }],
    sockets: [
      {
        id: "head-socket",
        semantic: "head",
        boneId: "root",
        rest: { ...IDENTITY, translation: [...IDENTITY.translation], rotation: [...IDENTITY.rotation], scale: [...IDENTITY.scale] },
        accepts: ["helmet"],
      },
    ],
  };

  const clip: MotionClip = {
    schemaVersion: 1,
    kind: "motion-clip",
    id: "idle",
    name: "Idle",
    skeletonId: skeleton.id,
    duration: 1,
    loop: true,
    tracks: [],
    events: [],
  };

  return {
    skeleton,
    binding,
    body,
    clip,
    loadout: { bodyProfileId: body.id, equipment: [] },
    actionSteps: [{ actionId: "idle", time: 0 }],
    textureBytes,
    textureRgba,
    textureSize,
    textureRgbaColor,
  };
}

function socketWorld(
  boneWorld: number[],
  socketRest: Transform,
): { world: number[]; position: [number, number, number] } {
  const world = multiplyMatrices(boneWorld as never, transformToMatrix(socketRest));
  return {
    world: [...world],
    position: [world[12]!, world[13]!, world[14]!],
  };
}

/**
 * Deterministic expected.json semantics for minimal-region from package domain.
 * Matrices/sockets follow sampleMotionClip + FK + socket rest attach (facing right).
 */
export async function buildMinimalRegionExpected(domain: MinimalRegionDomain = buildMinimalRegionDomain()): Promise<FixtureExpected> {
  const matrices: FixtureExpectedMatrix[] = [];
  const sockets: FixtureExpectedSocket[] = [];
  const events: Array<{ time: number; type: string; name: string }> = [];

  for (const step of domain.actionSteps) {
    const pose = sampleMotionClip(domain.clip, domain.skeleton, step.time);
    for (const bone of domain.skeleton.bones) {
      const world = pose.worldMatrices[bone.id];
      if (!world) continue;
      matrices.push({ boneId: bone.id, time: step.time, world: [...world] });
    }
    for (const sock of domain.body.sockets) {
      const boneM = pose.worldMatrices[sock.boneId];
      if (!boneM) continue;
      const resolved = socketWorld(boneM, sock.rest);
      sockets.push({
        id: sock.id,
        semantic: sock.semantic,
        boneId: sock.boneId,
        time: step.time,
        position: resolved.position,
        world: resolved.world,
      });
    }
    for (const ev of domain.clip.events) {
      if (Math.abs(ev.time - step.time) < 1e-12) {
        events.push({ time: ev.time, type: ev.type, name: ev.name });
      }
    }
  }

  const assembled = assembleLoadout(domain.body, domain.binding, [], domain.loadout);
  if (!assembled.ok) {
    throw new Error(`minimal-region assemble failed: ${assembled.issues.map((i) => i.message).join("; ")}`);
  }

  const slots: FixtureExpectedSlot[] = domain.binding.slots
    .filter((slot) => assembled.value.visibleParts.includes(slot.id))
    .map((slot) => ({
      id: slot.id,
      attachmentId: slot.attachmentId,
      boneId: slot.boneId,
      drawOrder: slot.drawOrder,
    }))
    .sort((a, b) => a.drawOrder - b.drawOrder || a.id.localeCompare(b.id));

  const w = domain.textureSize;
  const h = domain.textureSize;
  const attachmentId = domain.binding.attachments[0]!.id;
  const samples: FixtureExpectedPixelSample[] = [
    { x: 0, y: 0, rgba: [...domain.textureRgbaColor] as [number, number, number, number] },
    { x: w - 1, y: 0, rgba: [...domain.textureRgbaColor] as [number, number, number, number] },
    { x: 0, y: h - 1, rgba: [...domain.textureRgbaColor] as [number, number, number, number] },
    { x: w - 1, y: h - 1, rgba: [...domain.textureRgbaColor] as [number, number, number, number] },
    {
      x: Math.floor(w / 2),
      y: Math.floor(h / 2),
      rgba: [...domain.textureRgbaColor] as [number, number, number, number],
    },
  ];

  // Verify samples against RGBA buffer used for PNG encode.
  for (const sample of samples) {
    const idx = (sample.y * w + sample.x) * 4;
    const got = [
      domain.textureRgba[idx]!,
      domain.textureRgba[idx + 1]!,
      domain.textureRgba[idx + 2]!,
      domain.textureRgba[idx + 3]!,
    ];
    if (got.some((v, i) => v !== sample.rgba[i])) {
      throw new Error(`pixel sample mismatch at (${sample.x},${sample.y})`);
    }
  }

  const checksum = await sha256Digest(domain.textureRgba);

  matrices.sort((a, b) => a.time - b.time || a.boneId.localeCompare(b.boneId));
  sockets.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  events.sort((a, b) => a.time - b.time || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  return {
    matrices,
    sockets,
    slots,
    events,
    pixels: {
      attachmentId,
      width: w,
      height: h,
      checksum,
      samples,
    },
  };
}
