import { describe, expect, test } from "bun:test";
import {
  solveTwoBoneIk2d,
  validateTwoHandIkSample,
  type Transform,
} from "../packages/shared/src";

const identity = (): Transform => ({
  translation: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

const tf = (x: number, y: number): Transform => ({
  translation: [x, y, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

describe("solveTwoBoneIk2d", () => {
  test("reachable target bends with opposite signs", () => {
    const upper = identity();
    const lower = tf(10, 0);
    const end = tf(10, 0);
    const pos = solveTwoBoneIk2d({
      upperRest: upper,
      lowerRest: lower,
      endRest: end,
      targetLocalToUpperParent: [10, 10],
      bendPositive: true,
      stretch: "forbid",
      mix: 1,
    });
    const neg = solveTwoBoneIk2d({
      upperRest: upper,
      lowerRest: lower,
      endRest: end,
      targetLocalToUpperParent: [10, 10],
      bendPositive: false,
      stretch: "forbid",
      mix: 1,
    });
    expect(pos.reached).toBeTrue();
    expect(neg.reached).toBeTrue();
    expect(Math.abs(pos.lowerAngle - neg.lowerAngle)).toBeGreaterThan(0.1);
  });

  test("forbid stretch diagnoses unreachable beyond max reach", () => {
    const result = solveTwoBoneIk2d({
      upperRest: identity(),
      lowerRest: tf(10, 0),
      endRest: tf(10, 0),
      targetLocalToUpperParent: [100, 0],
      bendPositive: true,
      stretch: "forbid",
      mix: 1,
    });
    expect(result.reached).toBeFalse();
    expect(result.diagnostics.some((d) => d.code === "unreachable")).toBeTrue();
  });

  test("limited stretch allows within maxStretch and rejects beyond", () => {
    const within = solveTwoBoneIk2d({
      upperRest: identity(),
      lowerRest: tf(10, 0),
      endRest: tf(10, 0),
      targetLocalToUpperParent: [22, 0],
      bendPositive: true,
      stretch: "limited",
      maxStretch: 1.2,
      mix: 1,
    });
    expect(within.reached || within.stretched).toBeTrue();

    const beyond = solveTwoBoneIk2d({
      upperRest: identity(),
      lowerRest: tf(10, 0),
      endRest: tf(10, 0),
      targetLocalToUpperParent: [40, 0],
      bendPositive: true,
      stretch: "limited",
      maxStretch: 1.1,
      mix: 1,
    });
    expect(beyond.reached).toBeFalse();
    expect(beyond.diagnostics.some((d) => d.code === "unreachable")).toBeTrue();
  });

  test("zero-length bone and non-finite target emit diagnostics", () => {
    const zero = solveTwoBoneIk2d({
      upperRest: identity(),
      lowerRest: identity(),
      endRest: tf(5, 0),
      targetLocalToUpperParent: [3, 0],
      bendPositive: true,
      stretch: "forbid",
      mix: 1,
    });
    expect(zero.reached).toBeFalse();
    expect(zero.diagnostics.some((d) => d.code === "zero_length_bone")).toBeTrue();

    const nonfinite = solveTwoBoneIk2d({
      upperRest: identity(),
      lowerRest: tf(5, 0),
      endRest: tf(5, 0),
      targetLocalToUpperParent: [Number.NaN, 0],
      bendPositive: true,
      stretch: "forbid",
      mix: 1,
    });
    expect(nonfinite.reached).toBeFalse();
    expect(nonfinite.diagnostics.some((d) => d.code === "nonfinite_target")).toBeTrue();
  });
});

describe("validateTwoHandIkSample", () => {
  test("uses primary-grip alignment and secondary target rather than coarse end-bone distance", () => {
    // Rest chain is reachable if secondary grip is near the secondary hand,
    // but coarse upper→end tip distance can be large while still solvable.
    const skeletonBones = {
      upper: { rest: identity(), parentId: null as string | null },
      lower: { rest: tf(10, 0), parentId: "upper" },
      end: { rest: tf(10, 0), parentId: "lower" },
    };
    const primaryGrip = identity();
    const secondaryGrip = tf(8, 2);
    const primaryHandWorld = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ] as const;
    const ok = validateTwoHandIkSample({
      upperRest: skeletonBones.upper.rest,
      lowerRest: skeletonBones.lower.rest,
      endRest: skeletonBones.end.rest,
      upperParentWorld: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      primaryHandWorld: [...primaryHandWorld],
      primaryGrip,
      secondaryGrip,
      bendPositive: true,
      stretch: "forbid",
      mix: 1,
    });
    expect(ok.reached).toBeTrue();
    expect(ok.diagnostics.some((d) => d.code === "unreachable")).toBeFalse();

    const far = validateTwoHandIkSample({
      upperRest: skeletonBones.upper.rest,
      lowerRest: skeletonBones.lower.rest,
      endRest: skeletonBones.end.rest,
      upperParentWorld: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      primaryHandWorld: [...primaryHandWorld],
      primaryGrip,
      secondaryGrip: tf(200, 0),
      bendPositive: true,
      stretch: "forbid",
      mix: 1,
    });
    expect(far.reached).toBeFalse();
    expect(far.diagnostics.some((d) => d.code === "unreachable")).toBeTrue();
  });
});
