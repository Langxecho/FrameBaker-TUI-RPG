/**
 * Generate canonical minimal-region fixture under tests/fixtures/fbanim-v3.
 * Writes only into tests/fixtures — never storage/.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildMinimalRegionFixtureEntries } from "../apps/web/src/skeletalExport";

const outDir = join(import.meta.dir, "..", "tests", "fixtures", "fbanim-v3", "minimal-region");
mkdirSync(outDir, { recursive: true });

const entries = await buildMinimalRegionFixtureEntries();

for (const entry of entries) {
  writeFileSync(join(outDir, entry.name), entry.data);
  console.log("wrote", entry.name, entry.data.length);
}
console.log("OK", outDir);
