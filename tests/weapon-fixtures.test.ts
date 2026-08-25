import { describe, expect, test } from "bun:test";
import { validateEquipmentDefinition, validateLoadout } from "../packages/shared/src";
import { createWeaponFixtureBody, createWeaponSampleFixtures } from "../apps/web/src/weaponFixtures";

describe("weapon fixtures", () => {
  test("rifle, left/right pistols, dual-wield and conflict samples validate", () => {
    const body = createWeaponFixtureBody();
    const fixtures = createWeaponSampleFixtures();
    const byId = Object.fromEntries(fixtures.map((item) => [item.id, item]));

    expect(byId["fx-rifle"]!.weapon?.holdMode).toBe("two_hand");
    expect(byId["fx-rifle"]!.weapon?.preferredPrimaryHand).toBe("right");
    expect(byId["fx-rifle"]!.weapon?.secondaryGrip).toBeDefined();
    expect(byId["fx-rifle"]!.weapon?.muzzleSocket).toBeDefined();
    expect(byId["fx-rifle"]!.weapon?.secondaryHandConstraint?.id).toBe("ik-rifle-secondary");

    expect(byId["fx-pistol-r"]!.weapon?.holdMode).toBe("one_hand");
    expect(byId["fx-pistol-r"]!.primarySlot).toBe("slot-hand-r");
    expect(byId["fx-pistol-l"]!.weapon?.preferredPrimaryHand).toBe("left");
    expect(byId["fx-pistol-l"]!.primarySlot).toBe("slot-hand-l");

    expect(byId["fx-weapon-conflict"]!.conflictTags).toContain("weapon");

    for (const item of fixtures) {
      expect(validateEquipmentDefinition(item, body).ok).toBeTrue();
    }

    const dual = {
      bodyProfileId: body.id,
      equipment: [
        { equipmentId: "fx-pistol-r", primarySlot: "slot-hand-r" },
        { equipmentId: "fx-pistol-l", primarySlot: "slot-hand-l" },
      ],
    };
    expect(validateLoadout(body, fixtures, dual).ok).toBeTrue();

    const conflict = {
      bodyProfileId: body.id,
      equipment: [
        { equipmentId: "fx-pistol-r", primarySlot: "slot-hand-r" },
        { equipmentId: "fx-weapon-conflict", primarySlot: "slot-hand-l" },
      ],
    };
    expect(validateLoadout(body, fixtures, conflict).ok).toBeFalse();
  });
});
