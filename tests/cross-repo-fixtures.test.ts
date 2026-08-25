import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { verifyFbanimV3Entries } from "../packages/shared/src";
import { buildMinimalRegionFixtureEntries } from "../apps/web/src/skeletalExport";
import { readZip } from "../apps/web/src/zip";

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

  test("available fixture expected.json must be non-empty semantic truth", () => {
    const m = loadManifest();
    for (const id of m.contractIds) {
      if (m.fixtures[id]!.status !== "available") continue;
      const expected = JSON.parse(readFileSync(join(fixtureRoot, id, "expected.json"), "utf8")) as {
        matrices?: unknown[];
        sockets?: unknown[];
        slots?: unknown[];
        events?: unknown[];
        pixels?: { checksum?: string; samples?: unknown[] };
      };
      expect(Array.isArray(expected.matrices) && expected.matrices.length > 0, `${id} matrices`).toBeTrue();
      expect(Array.isArray(expected.sockets) && expected.sockets.length > 0, `${id} sockets`).toBeTrue();
      expect(Array.isArray(expected.slots) && expected.slots.length > 0, `${id} slots`).toBeTrue();
      expect(Array.isArray(expected.events), `${id} events array`).toBeTrue();
      expect(typeof expected.pixels?.checksum).toBe("string");
      expect(expected.pixels!.checksum!.startsWith("sha256:")).toBeTrue();
      expect(Array.isArray(expected.pixels?.samples) && expected.pixels!.samples!.length > 0, `${id} pixel samples`).toBeTrue();
    }
  });

  test("minimal-region expected.json matches pure builder semantics", async () => {
    const { buildMinimalRegionDomain, buildMinimalRegionExpected } = await import(
      "../apps/web/src/minimalRegionFixture"
    );
    const domain = buildMinimalRegionDomain();
    const expected = await buildMinimalRegionExpected(domain);
    expect(expected.matrices.length).toBeGreaterThan(0);
    expect(expected.sockets.length).toBeGreaterThan(0);
    expect(expected.slots.length).toBeGreaterThan(0);
    expect(expected.pixels.samples.length).toBeGreaterThan(0);
    expect(expected.pixels.checksum.startsWith("sha256:")).toBeTrue();

    const onDisk = JSON.parse(readFileSync(join(fixtureRoot, "minimal-region", "expected.json"), "utf8"));
    expect(onDisk).toEqual(JSON.parse(new TextDecoder().decode(
      (await import("../packages/shared/src")).canonicalizeJson(expected as never),
    )));
  });

  test("minimal-region checked-in bytes match deterministic builder output", async () => {
    const { buildMinimalRegionDomain } = await import("../apps/web/src/minimalRegionFixture");
    const domain = buildMinimalRegionDomain();

    const built = await buildMinimalRegionFixtureEntries({
      skeleton: domain.skeleton,
      binding: domain.binding,
      body: domain.body,
      clip: domain.clip,
      textureBytes: domain.textureBytes,
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
