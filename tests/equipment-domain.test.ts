import { describe, expect, test } from "bun:test";
import {
  assembleLoadout,
  validateBodyProfile,
  validateEquipmentDefinition,
  validateLoadout,
  type BodyProfile,
  type CharacterLoadout,
  type CharacterBinding,
  type EquipmentDefinition,
  type Skeleton,
} from "../packages/shared/src";

const transform = { translation: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number], scale: [1, 1, 1] as [number, number, number] };
const skeleton: Skeleton = { schemaVersion: 1, kind: "skeleton", id: "hero", name: "Hero", coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "pixel" }, bones: [{ id: "root", name: "Root", parentId: null, rest: transform }] };
const body: BodyProfile = { schemaVersion: 1, id: "body", name: "Body", skeletonId: skeleton.id, mirrorAxis: "x", slots: [{ id: "head", semantic: "head", capacity: 1, accepts: ["helmet"] }, { id: "left", semantic: "hand_left", capacity: 1, accepts: ["weapon"] }, { id: "right", semantic: "hand_right", capacity: 1, accepts: ["weapon"] }], sockets: [{ id: "head-socket", semantic: "head", boneId: "root", rest: transform, accepts: ["helmet"] }, { id: "left-socket", semantic: "weapon_hand_left", boneId: "root", rest: transform, accepts: ["weapon"], mirrorSocketId: "right-socket" }, { id: "right-socket", semantic: "weapon_hand_right", boneId: "root", rest: transform, accepts: ["weapon"], mirrorSocketId: "left-socket" }] };
const binding: CharacterBinding = { schemaVersion: 1, kind: "character-binding", id: "binding", name: "Binding", skeletonId: skeleton.id, slots: [], attachments: [] };
const attachment = (id: string, socket: string): EquipmentDefinition["attachments"][number] => ({ id, name: id, socket, materialId: "mat", imageSlot: "raw", size: [1, 1], pivot: [0.5, 0.5], rest: transform, drawGroup: "equipment", drawOffset: 0 });
const equipment = (visualMode: EquipmentDefinition["visualMode"] = "attached"): EquipmentDefinition => ({ schemaVersion: 1, id: `item-${visualMode}`, name: visualMode, tags: [visualMode === "none" ? "chip" : "helmet"], visualMode, primarySlot: "head", occupiedSlots: ["head"], conflictTags: [], replacesParts: [], hidesSlots: [], attachments: visualMode === "none" || visualMode === "effect" ? [] : [attachment("part-a", "head-socket"), attachment("part-b", "head-socket")] });

describe("equipment domain", () => {
  test("validates standard and custom sockets and rejects duplicate or unknown references", () => {
    expect(validateBodyProfile(body, skeleton).ok).toBeTrue();
    expect(validateBodyProfile({ ...body, sockets: [{ ...body.sockets[0]!, id: "custom", semantic: "drone_mount" }, ...body.sockets] }, skeleton).ok).toBeFalse();
    expect(validateBodyProfile({ ...body, sockets: [{ ...body.sockets[0]!, boneId: "missing" }] }, skeleton).ok).toBeFalse();
  });

  test("accepts all four visual modes with their required attachment rules", () => {
    for (const mode of ["none", "attached", "replacement", "effect"] as const) expect(validateEquipmentDefinition(equipment(mode), body).ok).toBeTrue();
    expect(validateEquipmentDefinition({ ...equipment("none"), attachments: [attachment("bad", "head-socket")] }, body).ok).toBeFalse();
    expect(validateEquipmentDefinition({ ...equipment("attached"), attachments: [{ ...attachment("bad", "head-socket"), socket: "missing" }] }, body).ok).toBeFalse();
  });

  test("rejects invalid two-hand grip declarations and non-finite transforms", () => {
    const rifle = { ...equipment(), id: "rifle", tags: ["weapon"], primarySlot: "left", occupiedSlots: ["left", "right"], attachments: [attachment("rifle", "left-socket")], weapon: { holdMode: "two_hand" as const, preferredPrimaryHand: "left" as const, mirrorAllowed: true, primaryGrip: transform, stanceProfile: "rifle_two_hand" } };
    expect(validateEquipmentDefinition(rifle, body).ok).toBeFalse();
    expect(validateEquipmentDefinition({ ...equipment(), attachments: [{ ...attachment("bad", "head-socket"), rest: { ...transform, translation: [Number.NaN, 0, 0] as [number, number, number] } }] }, body).ok).toBeFalse();
  });

  test("rejects conflicting or over-capacity loadouts and assembles deterministically", () => {
    const first = { ...equipment(), id: "first" };
    const second = { ...equipment(), id: "second", conflictTags: ["first"] };
    const definitions = [first, second];
    const invalid: CharacterLoadout = { bodyProfileId: body.id, equipment: [{ equipmentId: first.id, primarySlot: "head" }, { equipmentId: second.id, primarySlot: "head" }] };
    expect(validateLoadout(body, definitions, invalid).ok).toBeFalse();
    const valid: CharacterLoadout = { bodyProfileId: body.id, equipment: [{ equipmentId: first.id, primarySlot: "head" }] };
    const assembled = assembleLoadout(body, binding, definitions, valid);
    expect(assembled.ok).toBeTrue();
    if (assembled.ok) expect(assembled.value.occupiedSlots).toEqual(["head"]);
  });
});
