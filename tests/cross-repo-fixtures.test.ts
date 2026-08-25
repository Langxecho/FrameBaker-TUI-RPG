import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { verifyFbanimV3Entries } from "../packages/shared/src";
import { buildMinimalRegionFixtureEntries } from "../apps/web/src/skeletalExport";
import { solidTexturePng } from "../scripts/lib/fixturePng";
import { readZip } from "../apps/web/src/zip";
import type { BodyProfile, CharacterBinding, MotionClip, Skeleton } from "../packages/shared/src";

const fixtureRoot = join(import.meta.dir, "fixtures", "fbanim-v3");
const manifestPath = join(fixtureRoot, "manifest.json");

interface FixtureManifest {
  schemaVersion: number;
  contractIds: string[];
  policies: {
    matrixEpsilon: number;
    socketEpsilon: number;
    pixelEquality: string;
  };
  layout: {
    requiredFilesWhenPresent: string[];
    optionalFiles: string[];
  };
  fixtures: Record<
    string,
    {
      status: "available" | "missing";
      reason?: string;
      checks?: string[];
      notes?: string;
    }
  >;
}

function loadManifest(): FixtureManifest {
  return JSON.parse(readFileSync(manifestPath, "utf8")) as FixtureManifest;
}

const transform = {
  translation: [0, 0, 0] as [number, number, number],
  rotation: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
};

describe("cross-repo fbanim-v3 fixture contract", () => {
  test("manifest lists all eleven contract IDs with explicit policies", () => {
    const m = loadManifest();
    expect(m.schemaVersion).toBe(1);
    expect(m.contractIds).toHaveLength(11);
    expect(new Set(m.contractIds).size).toBe(11);
    expect(m.policies.matrixEpsilon).toBeLessThanOrEqual(1e-4);
    expect(m.policies.socketEpsilon).toBeLessThanOrEqual(1e-4);
    expect(m.policies.pixelEquality).toBe("exact");
    expect(m.layout.requiredFilesWhenPresent).toContain("package.fbanim");
    expect(m.layout.requiredFilesWhenPresent).toContain("expected.json");

    for (const id of m.contractIds) {
      const entry = m.fixtures[id];
      expect(entry, `missing fixtures entry for ${id}`).toBeDefined();
      expect(["available", "missing"]).toContain(entry.status);
      if (entry.status === "missing") {
        expect(typeof entry.reason).toBe("string");
        expect(entry.reason!.length).toBeGreaterThan(8);
      }
    }

    const available = m.contractIds.filter((id) => m.fixtures[id]!.status === "available");
    expect(available).toContain("minimal-region");
    const missing = m.contractIds.filter((id) => m.fixtures[id]!.status === "missing");
    expect(missing.length).toBe(10);
  });

  test("available fixtures have required files; missing IDs report clean absence", () => {
    const m = loadManifest();
    const report: Array<{ id: string; status: string; detail: string }> = [];

    for (const id of m.contractIds) {
      const meta = m.fixtures[id]!;
      const dir = join(fixtureRoot, id);
      if (meta.status === "available") {
        expect(existsSync(dir), `${id} directory`).toBeTrue();
        for (const name of m.layout.requiredFilesWhenPresent) {
          const path = join(dir, name);
          expect(existsSync(path), `${id}/${name}`).toBeTrue();
          expect(statSync(path).size).toBeGreaterThan(0);
        }
        const metadata = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8")) as {
          fixtureId?: string;
        };
        expect(metadata.fixtureId).toBe(id);
        report.push({ id, status: "available", detail: "required files present" });
      } else {
        const pkg = join(dir, "package.fbanim");
        expect(existsSync(pkg), `${id} must not invent package.fbanim`).toBeFalse();
        report.push({
          id,
          status: "missing",
          detail: meta.reason ?? "no reason",
        });
      }
    }

    const missingIds = report.filter((r) => r.status === "missing").map((r) => r.id);
    expect(missingIds).toEqual([
      "eye-attachment",
      "binocular-eye-multislot",
      "cyber-arm-replacement",
      "internal-chip-none",
      "equipment-effect",
      "rifle-right-primary",
      "rifle-left-primary",
      "dual-pistol",
      "conflicting-loadout",
      "action-event-boundary",
    ]);
  });

  test("minimal-region package verifies and texture is a decodeable PNG signature+IHDR", async () => {
    const dir = join(fixtureRoot, "minimal-region");
    const packageBytes = readFileSync(join(dir, "package.fbanim"));
    const entries = await readZip(new Blob([packageBytes]));
    const verified = await verifyFbanimV3Entries(
      entries.map((e) => ({ path: e.name, bytes: e.data })),
    );
    expect(verified.ok).toBeTrue();
    if (!verified.ok) return;

    const tex = entries.find((e) => e.name.startsWith("textures/") && e.name.endsWith(".png"));
    expect(tex).toBeDefined();
    const bytes = tex!.data;
    expect(bytes.length).toBeGreaterThan(32);
    expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    // IHDR chunk must follow signature for a real PNG (not digest-only stub).
    expect(String.fromCharCode(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!)).toBe("IHDR");
  });

  test("minimal-region checked-in bytes match deterministic builder output", async () => {
    const skeleton: Skeleton = {
      schemaVersion: 1,
      kind: "skeleton",
      id: "minimal-skeleton",
      name: "Minimal",
      coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "pixel" },
      bones: [{ id: "root", name: "Root", parentId: null, rest: transform }],
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
          size: [16, 16],
          pivot: [0.5, 0.5],
          rest: transform,
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
          rest: transform,
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

    const built = await buildMinimalRegionFixtureEntries({
      skeleton,
      binding,
      body,
      clip,
      textureBytes: solidTexturePng(16, [200, 200, 200, 255]),
    });
    const dir = join(fixtureRoot, "minimal-region");
    for (const entry of built) {
      const onDisk = readFileSync(join(dir, entry.name));
      expect(Buffer.from(entry.data).equals(onDisk), `byte mismatch ${entry.name}`).toBeTrue();
    }
  });

  test("fixture root only contains manifest plus available directories", () => {
    const m = loadManifest();
    const available = new Set(
      m.contractIds.filter((id) => m.fixtures[id]!.status === "available"),
    );
    const names = readdirSync(fixtureRoot).filter((n) => n !== ".gitkeep");
    for (const name of names) {
      if (name === "manifest.json") continue;
      const path = join(fixtureRoot, name);
      if (statSync(path).isDirectory()) {
        expect(available.has(name), `unexpected fixture dir ${name}`).toBeTrue();
      }
    }
  });
});
