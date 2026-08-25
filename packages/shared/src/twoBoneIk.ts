import type { Mat4, Transform, ValidationIssue } from "./animation";

const EPS = 1e-9;
const ANGLE_LIMIT_RAD = Math.PI * 0.98;

export interface IkDiagnostic {
  path: string;
  message: string;
  code: string;
}

export interface TwoBoneIkResult {
  upperAngle: number;
  lowerAngle: number;
  reached: boolean;
  stretched: boolean;
  upperLocal: Transform;
  lowerLocal: Transform;
  diagnostics: IkDiagnostic[];
}

export interface SolveTwoBoneIk2dInput {
  upperRest: Transform;
  lowerRest: Transform;
  endRest: Transform;
  targetLocalToUpperParent: readonly [number, number];
  bendPositive: boolean;
  stretch: "forbid" | "limited" | string;
  maxStretch?: number;
  mix: number;
}

export interface ValidateTwoHandIkSampleInput {
  upperRest: Transform;
  lowerRest: Transform;
  endRest: Transform;
  /** Column-major 4×4 world matrix of upper bone parent (identity if root). */
  upperParentWorld: readonly number[];
  /** Column-major 4×4 world matrix of primary-hand socket. */
  primaryHandWorld: readonly number[];
  primaryGrip: Transform;
  secondaryGrip: Transform;
  bendPositive: boolean;
  stretch: "forbid" | "limited" | string;
  maxStretch?: number;
  mix: number;
}

function cloneTransform(t: Transform): Transform {
  return {
    translation: [t.translation[0], t.translation[1], t.translation[2]],
    rotation: [t.rotation[0], t.rotation[1], t.rotation[2], t.rotation[3]],
    scale: [t.scale[0], t.scale[1], t.scale[2]],
  };
}

function isFiniteTransform(t: Transform): boolean {
  return (
    t.translation.every(Number.isFinite)
    && t.rotation.every(Number.isFinite)
    && t.scale.every(Number.isFinite)
  );
}

function length2(v: readonly [number, number]): number {
  return Math.hypot(v[0], v[1]);
}

function quatFromZAngle(angle: number): [number, number, number, number] {
  const half = angle * 0.5;
  return [0, 0, Math.sin(half), Math.cos(half)];
}

function zAngleFromQuat(q: readonly [number, number, number, number]): number {
  return 2 * Math.atan2(q[2], q[3]);
}

function transformToMatrix(t: Transform): Mat4 {
  const [x, y, z, w] = t.rotation;
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;
  const [sx, sy, sz] = t.scale;
  return [
    (1 - 2 * (yy + zz)) * sx,
    (2 * (xy + wz)) * sx,
    (2 * (xz - wy)) * sx,
    0,
    (2 * (xy - wz)) * sy,
    (1 - 2 * (xx + zz)) * sy,
    (2 * (yz + wx)) * sy,
    0,
    (2 * (xz + wy)) * sz,
    (2 * (yz - wx)) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    t.translation[0],
    t.translation[1],
    t.translation[2],
    1,
  ];
}

function multiplyMatrices(a: readonly number[], b: readonly number[]): Mat4 {
  const out = new Array(16).fill(0) as unknown as Mat4;
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row]! * b[col * 4]!
        + a[4 + row]! * b[col * 4 + 1]!
        + a[8 + row]! * b[col * 4 + 2]!
        + a[12 + row]! * b[col * 4 + 3]!;
    }
  }
  return out;
}

function matTranslation(m: readonly number[]): [number, number, number] {
  return [m[12]!, m[13]!, m[14]!];
}

function invertRigid2d(m: readonly number[]): Mat4 | null {
  const r00 = m[0]!;
  const r10 = m[1]!;
  const r01 = m[4]!;
  const r11 = m[5]!;
  const det = r00 * r11 - r10 * r01;
  if (!Number.isFinite(det) || Math.abs(det) < EPS) return null;
  const i00 = r11 / det;
  const i01 = -r01 / det;
  const i10 = -r10 / det;
  const i11 = r00 / det;
  const tx = m[12]!;
  const ty = m[13]!;
  return [
    i00, i10, 0, 0,
    i01, i11, 0, 0,
    0, 0, 1, 0,
    -(i00 * tx + i01 * ty),
    -(i10 * tx + i11 * ty),
    0,
    1,
  ];
}

function mulVec3Mat(m: readonly number[], v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2] + m[12]!,
    m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2] + m[13]!,
    m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2] + m[14]!,
  ];
}

function failResult(
  upperRest: Transform,
  lowerRest: Transform,
  diagnostics: IkDiagnostic[],
): TwoBoneIkResult {
  return {
    upperAngle: 0,
    lowerAngle: 0,
    reached: false,
    stretched: false,
    upperLocal: cloneTransform(upperRest),
    lowerLocal: cloneTransform(lowerRest),
    diagnostics,
  };
}

/** Classic 2D two-bone IK rotating around Z. Matches terminal skeletal_constraints.rs. */
export function solveTwoBoneIk2d(input: SolveTwoBoneIk2dInput): TwoBoneIkResult {
  const diagnostics: IkDiagnostic[] = [];
  const mix = Math.min(1, Math.max(0, input.mix));
  const { upperRest, lowerRest, endRest } = input;
  const targetIn: [number, number] = [input.targetLocalToUpperParent[0], input.targetLocalToUpperParent[1]];

  if (!Number.isFinite(targetIn[0]) || !Number.isFinite(targetIn[1])) {
    diagnostics.push({ path: "ik.target", message: "non-finite IK target", code: "nonfinite_target" });
    return failResult(upperRest, lowerRest, diagnostics);
  }
  if (!isFiniteTransform(upperRest) || !isFiniteTransform(lowerRest) || !isFiniteTransform(endRest)) {
    diagnostics.push({ path: "ik.rest", message: "non-finite rest transform", code: "nonfinite_rest" });
    return failResult(upperRest, lowerRest, diagnostics);
  }

  const l1 = length2([lowerRest.translation[0], lowerRest.translation[1]]);
  const l2 = length2([endRest.translation[0], endRest.translation[1]]);
  if (l1 < EPS || l2 < EPS) {
    diagnostics.push({ path: "ik.bone", message: "zero-length bone", code: "zero_length_bone" });
    return failResult(upperRest, lowerRest, diagnostics);
  }

  let target: [number, number] = [
    targetIn[0] - upperRest.translation[0],
    targetIn[1] - upperRest.translation[1],
  ];
  let dist = length2(target);
  let stretched = false;
  const maxReach = l1 + l2;
  const minReach = Math.abs(l1 - l2);

  if (dist < EPS) {
    diagnostics.push({ path: "ik.target", message: "target coincides with upper joint", code: "degenerate_target" });
    return failResult(upperRest, lowerRest, diagnostics);
  }

  if (dist > maxReach + EPS) {
    if (input.stretch === "limited") {
      const factor = Math.max(1, input.maxStretch ?? 1);
      const limited = maxReach * factor;
      if (dist > limited + EPS) {
        diagnostics.push({ path: "ik.reach", message: "target beyond limited stretch", code: "unreachable" });
        const scale = limited / dist;
        target = [target[0] * scale, target[1] * scale];
        dist = limited;
        stretched = true;
      } else {
        stretched = dist > maxReach + EPS;
      }
    } else {
      diagnostics.push({ path: "ik.reach", message: "target unreachable without stretch", code: "unreachable" });
      const scale = maxReach / dist;
      target = [target[0] * scale, target[1] * scale];
      dist = maxReach;
    }
  } else if (dist < minReach - EPS) {
    diagnostics.push({ path: "ik.reach", message: "target inside minimum reach", code: "unreachable" });
    const scale = dist < EPS ? 1 : minReach / dist;
    target = [target[0] * scale, target[1] * scale];
    dist = minReach;
  }

  const cosElbow = Math.min(1, Math.max(-1, (l1 * l1 + l2 * l2 - dist * dist) / (2 * l1 * l2)));
  const interior = Math.acos(cosElbow);
  const bendSign = input.bendPositive ? 1 : -1;
  const lowerAngle = bendSign * (interior - Math.PI);
  const cosShoulder = Math.min(1, Math.max(-1, (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist)));
  const shoulderOffset = Math.acos(cosShoulder);
  const targetAngle = Math.atan2(target[1], target[0]);
  const upperAngle = targetAngle - bendSign * shoulderOffset;

  if (!Number.isFinite(upperAngle) || !Number.isFinite(lowerAngle)) {
    diagnostics.push({ path: "ik.solve", message: "non-finite IK angles", code: "nonfinite_result" });
    return failResult(upperRest, lowerRest, diagnostics);
  }
  if (Math.abs(upperAngle) > ANGLE_LIMIT_RAD || Math.abs(lowerAngle) > ANGLE_LIMIT_RAD) {
    diagnostics.push({ path: "ik.limit", message: "joint angle exceeds limit", code: "angle_limit" });
  }

  const restUpperZ = zAngleFromQuat(upperRest.rotation);
  const restLowerZ = zAngleFromQuat(lowerRest.rotation);
  const solvedUpper = restUpperZ + upperAngle;
  const solvedLower = restLowerZ + lowerAngle;
  const finalUpper = restUpperZ + (solvedUpper - restUpperZ) * mix;
  const finalLower = restLowerZ + (solvedLower - restLowerZ) * mix;

  const upperLocal = cloneTransform(upperRest);
  upperLocal.rotation = quatFromZAngle(finalUpper);
  const lowerLocal = cloneTransform(lowerRest);
  lowerLocal.rotation = quatFromZAngle(finalLower);

  const reached = diagnostics.every((d) => d.code !== "unreachable");
  return {
    upperAngle: finalUpper,
    lowerAngle: finalLower,
    reached,
    stretched,
    upperLocal,
    lowerLocal,
    diagnostics,
  };
}

/**
 * Primary-grip alignment → secondary-grip world target → two-bone IK in upper-parent space.
 * Matches terminal apply_weapon_constraints order for secondary-hand reach validation.
 */
export function validateTwoHandIkSample(input: ValidateTwoHandIkSampleInput): TwoBoneIkResult {
  const diagnostics: IkDiagnostic[] = [];
  if (!isFiniteTransform(input.primaryGrip) || !isFiniteTransform(input.secondaryGrip)) {
    diagnostics.push({ path: "weapon.grip", message: "non-finite grip transform", code: "nonfinite_grip" });
    return failResult(input.upperRest, input.lowerRest, diagnostics);
  }
  if (input.primaryHandWorld.length !== 16 || input.upperParentWorld.length !== 16
    || !input.primaryHandWorld.every(Number.isFinite) || !input.upperParentWorld.every(Number.isFinite)) {
    diagnostics.push({ path: "ik.world", message: "non-finite world matrix", code: "nonfinite_world" });
    return failResult(input.upperRest, input.lowerRest, diagnostics);
  }

  const gripM = transformToMatrix(input.primaryGrip);
  const invGrip = invertRigid2d(gripM);
  if (!invGrip) {
    diagnostics.push({ path: "weapon.primaryGrip", message: "non-invertible primary grip", code: "singular_grip" });
    return failResult(input.upperRest, input.lowerRest, diagnostics);
  }
  // weapon_world * grip = hand_world => weapon_world = hand_world * inv(grip)
  const weaponWorld = multiplyMatrices(input.primaryHandWorld, invGrip);
  const secondaryWorld = multiplyMatrices(weaponWorld, transformToMatrix(input.secondaryGrip));
  const targetPos = matTranslation(secondaryWorld);

  const invParent = invertRigid2d(input.upperParentWorld);
  if (!invParent) {
    diagnostics.push({ path: "ik.parent", message: "non-invertible upper parent", code: "singular_parent" });
    return failResult(input.upperRest, input.lowerRest, diagnostics);
  }
  const targetParent = mulVec3Mat(invParent, targetPos);
  const result = solveTwoBoneIk2d({
    upperRest: input.upperRest,
    lowerRest: input.lowerRest,
    endRest: input.endRest,
    targetLocalToUpperParent: [targetParent[0], targetParent[1]],
    bendPositive: input.bendPositive,
    stretch: input.stretch,
    maxStretch: input.maxStretch,
    mix: input.mix,
  });
  return {
    ...result,
    diagnostics: [...diagnostics, ...result.diagnostics],
  };
}

export function ikDiagnosticsToIssues(
  diagnostics: readonly IkDiagnostic[],
  pathPrefix: string,
  timeLabel?: string,
): ValidationIssue[] {
  const t = timeLabel ? `t=${timeLabel} ` : "";
  return diagnostics.map((d) => ({
    path: pathPrefix,
    message: `${t}${d.message}${d.code ? ` (${d.code})` : ""}`,
  }));
}
