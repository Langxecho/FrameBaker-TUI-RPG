import { describe, expect, test } from "bun:test";
import type { MotionClip, MotionTrack } from "../packages/shared/src";
import {
  STANDARD_ACTION_EVENTS,
  compileActionSet,
  validateReloadEventOrder,
  type ActionCompositionRequest,
} from "../packages/shared/src/actionComposition";

const transform = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};

function track(targetId: string, property: MotionTrack["property"], value: number[]): MotionTrack {
  return {
    targetId,
    property,
    keys: [{ time: 0, value: property === "rotation" ? [0, 0, 0, 1] : value as [number, number, number], interpolation: "step" }],
  };
}

function clip(id: string, tracks: MotionTrack[], events: MotionClip["events"] = [], loop = false): MotionClip {
  return {
    schemaVersion: 1,
    kind: "motion-clip",
    id,
    name: id,
    skeletonId: "hero",
    duration: 1,
    loop,
    tracks,
    events,
    provenance: { source: "manual" },
  };
}

describe("compileActionSet", () => {
  test("applies base → stance → equipment override → correction order", () => {
    const base = clip("base-aim", [track("arm", "translation", [1, 0, 0])]);
    const stance = clip("stance-aim", [track("arm", "translation", [2, 0, 0]), track("spine", "translation", [0, 1, 0])]);
    const override = clip("eq-aim", [track("arm", "translation", [3, 0, 0])]);
    const correction = clip("corr-aim", [track("hand", "translation", [0, 0, 1])]);
    const request: ActionCompositionRequest = {
      actionIds: ["aim", "idle"],
      clips: {
        "base-aim": base,
        "stance-aim": stance,
        "eq-aim": override,
        "corr-aim": correction,
        "base-idle": clip("base-idle", [track("root", "translation", [0, 0, 0])]),
      },
      baseActions: { aim: "base-aim", idle: "base-idle" },
      stanceActions: { aim: "stance-aim" },
      equipmentOverrides: { aim: "eq-aim" },
      equipmentCorrections: { aim: "corr-aim" },
      templates: [
        {
          id: "aim",
          loop: false,
          requiredTracks: [],
          requiredEvents: [],
          allowedEvents: [...STANDARD_ACTION_EVENTS],
          contactRules: [],
          constraintRules: [],
          defaultInterrupt: "immediate",
          defaultBlendMs: 0,
        },
      ],
    };
    const result = compileActionSet(request);
    expect(result.ok).toBeTrue();
    const aim = result.actions.find((item) => item.actionId === "aim")!;
    expect(aim.clip.tracks.find((item) => item.targetId === "arm")!.keys[0]!.value[0]).toBe(3);
    expect(aim.clip.tracks.find((item) => item.targetId === "spine")).toBeUndefined();
    expect(aim.clip.tracks.find((item) => item.targetId === "hand")!.keys[0]!.value[2]).toBe(1);
    expect(aim.layers.map((layer) => layer.source)).toEqual([
      "base",
      "stance",
      "equipment",
      "correction",
      "composed",
    ]);
    const idle = result.actions.find((item) => item.actionId === "idle")!;
    expect(idle.clip.id).toContain("idle");
    expect(idle.clip.tracks[0]!.targetId).toBe("root");
  });

  test("narrow equipment overrides inherit unresolved actions from stance/base", () => {
    const request: ActionCompositionRequest = {
      actionIds: ["aim", "reload"],
      clips: {
        "base-aim": clip("base-aim", [track("arm", "translation", [1, 0, 0])]),
        "stance-aim": clip("stance-aim", [track("arm", "translation", [2, 0, 0])]),
        "base-reload": clip("base-reload", [track("hand", "translation", [0, 0, 0])]),
        "eq-reload": clip("eq-reload", [track("hand", "translation", [9, 0, 0])]),
      },
      baseActions: { aim: "base-aim", reload: "base-reload" },
      stanceActions: { aim: "stance-aim" },
      equipmentOverrides: { reload: "eq-reload" },
    };
    const result = compileActionSet(request);
    expect(result.ok).toBeTrue();
    expect(result.actions.find((item) => item.actionId === "aim")!.clip.tracks[0]!.keys[0]!.value[0]).toBe(2);
    expect(result.actions.find((item) => item.actionId === "reload")!.clip.tracks[0]!.keys[0]!.value[0]).toBe(9);
  });

  test("merges events in time order and keeps same-time stable order", () => {
    const base = clip("base-fire", [track("root", "translation", [0, 0, 0])], [
      { time: 0.5, type: "weapon.fire", name: "fire" },
      { time: 0.2, type: "effect.trigger", name: "charge" },
    ]);
    const override = clip("eq-fire", [track("root", "translation", [1, 0, 0])], [
      { time: 0.5, type: "weapon.eject", name: "eject" },
      { time: 0.8, type: "effect.trigger", name: "smoke" },
    ]);
    const result = compileActionSet({
      actionIds: ["fire"],
      clips: { "base-fire": base, "eq-fire": override },
      baseActions: { fire: "base-fire" },
      equipmentOverrides: { fire: "eq-fire" },
    });
    const events = result.actions[0]!.clip.events;
    expect(events.map((event) => event.name)).toEqual(["charge", "fire", "eject", "smoke"]);
  });

  test("looping clips drop events at the duration boundary so one-shots do not repeat", () => {
    const looping = clip("base-idle", [track("root", "translation", [0, 0, 0])], [
      { time: 0, type: "movement.footstep.left", name: "L" },
      { time: 0.5, type: "movement.footstep.right", name: "R" },
      { time: 1, type: "movement.footstep.left", name: "boundary" },
    ], true);
    const result = compileActionSet({
      actionIds: ["idle"],
      clips: { "base-idle": looping },
      baseActions: { idle: "base-idle" },
    });
    expect(result.actions[0]!.clip.events.map((event) => event.name)).toEqual(["L", "R"]);
    expect(result.actions[0]!.diagnostics.some((issue) => issue.path.includes("events"))).toBeTrue();
  });

  test("missing action uses declared fallback and reports diagnostic", () => {
    const result = compileActionSet({
      actionIds: ["skill"],
      clips: { "base-idle": clip("base-idle", [track("root", "translation", [0, 0, 0])]) },
      baseActions: { idle: "base-idle" },
      templates: [{
        id: "skill",
        loop: false,
        requiredTracks: [],
        requiredEvents: [],
        allowedEvents: [],
        contactRules: [],
        constraintRules: [],
        fallbackAction: "idle",
        defaultInterrupt: "immediate",
        defaultBlendMs: 0,
      }],
    });
    expect(result.ok).toBeTrue();
    const skill = result.actions[0]!;
    expect(skill.usedFallback).toBe("idle");
    expect(skill.clip.tracks[0]!.targetId).toBe("root");
    expect(skill.diagnostics.some((issue) => issue.message.includes("fallback") || issue.message.includes("回退"))).toBeTrue();
  });

  test("missing action without fallback fails", () => {
    const result = compileActionSet({
      actionIds: ["skill"],
      clips: {},
      baseActions: {},
    });
    expect(result.ok).toBeFalse();
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  test("layer ownership exposes owned editable layer only", () => {
    const result = compileActionSet({
      actionIds: ["aim"],
      clips: {
        "base-aim": clip("base-aim", [track("arm", "translation", [1, 0, 0])]),
        "stance-aim": clip("stance-aim", [track("arm", "translation", [2, 0, 0])]),
      },
      baseActions: { aim: "base-aim" },
      stanceActions: { aim: "stance-aim" },
      ownedLayer: "stance",
    });
    const aim = result.actions[0]!;
    expect(aim.editableLayer).toBe("stance");
    expect(aim.layers.find((layer) => layer.source === "base")!.readOnly).toBeTrue();
    expect(aim.layers.find((layer) => layer.source === "stance")!.readOnly).toBeFalse();
  });
});

describe("validateReloadEventOrder", () => {
  test("requires detach → attach → complete ordering", () => {
    expect(validateReloadEventOrder([
      { time: 0.1, type: "weapon.reload.detach", name: "d" },
      { time: 0.4, type: "weapon.reload.attach", name: "a" },
      { time: 0.7, type: "weapon.reload.complete", name: "c" },
    ]).ok).toBeTrue();
    expect(validateReloadEventOrder([
      { time: 0.1, type: "weapon.reload.attach", name: "a" },
      { time: 0.4, type: "weapon.reload.detach", name: "d" },
      { time: 0.7, type: "weapon.reload.complete", name: "c" },
    ]).ok).toBeFalse();
  });
});
