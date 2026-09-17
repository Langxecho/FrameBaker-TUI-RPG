import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildA1DroneFb02Fixture } from "../scripts/generate_a1_drone_fb02_fixture";
import { assembleMonsterSpriteExtract, parseMonsterSpriteImportSpec } from "../apps/server/src/monsterSpriteImport";

const SPEC_PATH = "mission/fixtures/fb-02/a1-drone-r1-import-spec.json";

describe("FB-02 real A1 Drone presentation fixture", () => {
  test("rebuilds all real source frames with measured presentation anchors and markers", async () => {
    const first = await buildA1DroneFb02Fixture();
    const second = await buildA1DroneFb02Fixture();
    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toBe("21dc0901578d4b237cf74f3104923f276b04de0cc5820f64b7f97e1a06946a25");
    const sidecar = JSON.parse(new TextDecoder().decode(first.files["sidecar.json"]!));
    expect(sidecar.format).toBe("framebaker.monster-sprite-extract");
    expect(sidecar.canvas).toEqual({ width: 160, height: 160 });
    expect(sidecar.actions.map((action: { frames: unknown[] }) => action.frames.length)).toEqual([107, 107, 107, 107, 107]);
    expect(sidecar.actions[1].frames[54].anchors).toEqual([{ id: "muzzle", x: 12, y: 94, directionDegrees: 180 }]);
    expect(sidecar.actions[1].markers).toEqual([{ id: "weapon.fire", atMs: 2268, presentationOnly: true }]);
    expect(sidecar.actions[2].frames[54].anchors).toEqual([{ id: "muzzle", x: 29, y: 94, directionDegrees: 180 }]);
    expect(sidecar.actions[2].markers).toEqual([{ id: "effect.trigger", atMs: 2268, presentationOnly: true }]);
    expect(sidecar.actions[3].frames[54].anchors).toEqual([{ id: "hit", x: 80, y: 95 }]);
    expect(JSON.stringify(sidecar)).not.toContain("combat.hitbox");
  });

  test("rejects an authoritative marker added to the delivery specification", () => {
    const spec = JSON.parse(readFileSync(SPEC_PATH, "utf8"));
    spec.actions[1].markers[0].id = "combat.hitbox.start";
    spec.actions = [spec.actions[1]];
    const parsed = parseMonsterSpriteImportSpec(spec);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = assembleMonsterSpriteExtract({
      pngs: [{
        relativePath: "attack/54.png",
        bytes: new Uint8Array(readFileSync("F:/CodeProject/tui-rpg-terminal-engine/liaf-preview/fixtures/packages/A1Drone.monster/assets/attack/54.png")),
      }],
      spec: parsed.spec,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("presentationOnly");
  });
});
