/**
 * Generate canonical contract fixtures under tests/fixtures/fbanim-v3.
 * Writes only into tests/fixtures — never storage/.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTRACT_FIXTURE_IDS,
  buildContractFixtureEntries,
  type ContractFixtureId,
} from "../apps/web/src/contractFixtures";

const fixtureRoot = join(import.meta.dir, "..", "tests", "fixtures", "fbanim-v3");
const manifestPath = join(fixtureRoot, "manifest.json");

const only = process.argv.slice(2).filter((a) => !a.startsWith("-")) as ContractFixtureId[];
const ids = only.length > 0 ? only : [...CONTRACT_FIXTURE_IDS];

for (const id of ids) {
  if (!(CONTRACT_FIXTURE_IDS as readonly string[]).includes(id)) {
    console.error("unknown fixture id", id);
    process.exit(1);
  }
  const outDir = join(fixtureRoot, id);
  mkdirSync(outDir, { recursive: true });
  const entries = await buildContractFixtureEntries(id);
  for (const entry of entries) {
    writeFileSync(join(outDir, entry.name), entry.data);
    console.log("wrote", id, entry.name, entry.data.length);
  }
}

// Mark generated IDs available in manifest.
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  fixtures: Record<string, { status: string; reason?: string; checks?: string[]; notes?: string }>;
};
const checks = [
  "package_load",
  "metadata_id",
  "decodeable_texture",
  "expected_matrices",
  "expected_sockets",
  "expected_slots",
  "expected_events",
  "expected_pixel_samples",
  "expected_pixel_checksum",
];
for (const id of ids) {
  const prev = manifest.fixtures[id] ?? {};
  manifest.fixtures[id] = {
    status: "available",
    checks,
    notes: prev.notes ?? `Canonical contract fixture ${id} from pure FrameBaker builders.`,
  };
  delete manifest.fixtures[id].reason;
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log("OK updated manifest for", ids.join(", "));
