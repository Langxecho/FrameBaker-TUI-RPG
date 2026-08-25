import { describe, expect, test } from "bun:test";
import { validateEquipmentDefinition, validateLoadout } from "../packages/shared/src";
import { createEquipmentFixtureBody, createEquipmentSampleFixtures } from "../apps/web/src/equipmentFixtures";

describe("equipment fixtures", () => {
  test("sample assets cover required visual modes and validate against fixture body", () => {
    const body = createEquipmentFixtureBody();
    const fixtures = createEquipmentSampleFixtures();
    const byId = Object.fromEntries(fixtures.map((item) => [item.id, item]));
    expect(byId["fx-helmet"]!.visualMode).toBe("attached");
    expect(byId["fx-eye-mono"]!.visualMode).toBe("attached");
    expect(byId["fx-eye-binoc"]!.attachments).toHaveLength(2);
    expect(byId["fx-cyber-arm"]!.visualMode).toBe("replacement");
    expect(byId["fx-cyber-arm"]!.replacesParts).toEqual(["part-arm-l"]);
    expect(byId["fx-back-device"]!.tags).toContain("device");
    expect(byId["fx-chip"]!.visualMode).toBe("none");
    expect(byId["fx-chip"]!.attachments).toHaveLength(0);
    expect(byId["fx-effect"]!.visualMode).toBe("effect");
    expect(byId["fx-effect"]!.effectBindings?.[0]?.event).toBe("weapon.fire");

    for (const item of fixtures) {
      const result = validateEquipmentDefinition(item, body);
      expect(result.ok).toBeTrue();
    }

    const helmetLoadout = {
      bodyProfileId: body.id,
      equipment: [{ equipmentId: "fx-helmet", primarySlot: "slot-head" }],
    };
    expect(validateLoadout(body, fixtures, helmetLoadout).ok).toBeTrue();
  });
});
