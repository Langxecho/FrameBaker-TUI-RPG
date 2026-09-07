import { describe, expect, test } from "bun:test";
import { IDENTITY_MAT4, skeletonBoneDragPatch, worldDeltaToLocal } from "../apps/web/src/skeletonBoneDrag";

describe("skeletonBoneDragPatch", () => {
  test("translate converts world delta into parent space", () => {
    expect(worldDeltaToLocal(IDENTITY_MAT4, 10, -4)).toEqual([10, -4]);
    const patch = skeletonBoneDragPatch({
      tool: "translate",
      root: false,
      restTranslation: [20, 0, 0],
      restRotationZ: 0,
      restScale: [1, 1, 1],
      parentWorld: IDENTITY_MAT4,
      originWorld: [0, 0],
      startPointer: [20, 0],
      pointer: [30, 5],
    });
    expect(patch.tx).toBe(30);
    expect(patch.ty).toBe(5);
  });

  test("scale lengthens a child bone along its rest axis", () => {
    const patch = skeletonBoneDragPatch({
      tool: "scale",
      root: false,
      restTranslation: [40, 0, 0],
      restRotationZ: 0,
      restScale: [1, 1, 1],
      parentWorld: IDENTITY_MAT4,
      originWorld: [0, 0],
      startPointer: [40, 0],
      pointer: [80, 0],
    });
    expect(patch.tx).toBeCloseTo(80);
    expect(patch.ty).toBeCloseTo(0);
  });
});
