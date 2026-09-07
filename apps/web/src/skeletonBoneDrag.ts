import type { Mat4 } from "@framebaker/shared";

export type SkeletonBoneEditTool = "translate" | "rotate" | "scale";

export const IDENTITY_MAT4: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function worldDeltaToLocal(basis: Mat4, worldX: number, worldY: number): [number, number] {
  const det = basis[0] * basis[5] - basis[1] * basis[4];
  if (Math.abs(det) < 1e-8) return [0, 0];
  return [
    (basis[5] * worldX - basis[4] * worldY) / det,
    (-basis[1] * worldX + basis[0] * worldY) / det,
  ];
}

export function skeletonBoneDragPatch(input: {
  tool: SkeletonBoneEditTool;
  root: boolean;
  restTranslation: [number, number, number];
  restRotationZ: number;
  restScale: [number, number, number];
  parentWorld: Mat4;
  originWorld: [number, number];
  startPointer: [number, number];
  pointer: [number, number];
}): { tx?: number; ty?: number; rz?: number; sx?: number; sy?: number } {
  const { tool, root, restTranslation, restRotationZ, restScale, parentWorld, originWorld, startPointer, pointer } = input;
  if (tool === "translate") {
    const [dx, dy] = worldDeltaToLocal(parentWorld, pointer[0] - startPointer[0], pointer[1] - startPointer[1]);
    return { tx: restTranslation[0] + dx, ty: restTranslation[1] + dy };
  }
  if (tool === "rotate") {
    const startAngle = Math.atan2(startPointer[1] - originWorld[1], startPointer[0] - originWorld[0]);
    const nextAngle = Math.atan2(pointer[1] - originWorld[1], pointer[0] - originWorld[0]);
    const angle = restRotationZ + nextAngle - startAngle;
    return { rz: Math.atan2(Math.sin(angle), Math.cos(angle)) * 180 / Math.PI };
  }
  const startDist = Math.hypot(startPointer[0] - originWorld[0], startPointer[1] - originWorld[1]);
  const nextDist = Math.hypot(pointer[0] - originWorld[0], pointer[1] - originWorld[1]);
  const factor = startDist < 1e-8 ? 1 : Math.max(.05, Math.min(8, nextDist / startDist));
  if (root) return { sx: restScale[0] * factor, sy: restScale[1] * factor };
  const length = Math.hypot(restTranslation[0], restTranslation[1]);
  const heading = Math.atan2(restTranslation[1], restTranslation[0]);
  const nextLength = Math.max(.05, length * factor);
  return { tx: Math.cos(heading) * nextLength, ty: Math.sin(heading) * nextLength };
}
