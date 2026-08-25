/**
 * Copy canonical fbanim-v3 fixture bytes into the terminal engine test tree.
 * Exact byte copy only — never regenerates or rewrites fixture content.
 *
 * Usage:
 *   bun scripts/sync_fbanim_fixtures.ts
 *   bun scripts/sync_fbanim_fixtures.ts --target F:/CodeProject/tui-rpg-terminal-engine
 *   FRAMEBAKER_TERMINAL_ENGINE_ROOT=... bun scripts/sync_fbanim_fixtures.ts
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const sourceRoot = join(repoRoot, "tests", "fixtures", "fbanim-v3");

function parseArgs(argv: string[]): { targetRoot: string; dryRun: boolean } {
  let target: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === "--target" || a === "-t") {
      target = argv[++i];
      continue;
    }
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--help" || a === "-h") {
      console.log(`Usage: bun scripts/sync_fbanim_fixtures.ts [--target <terminal-engine-root>] [--dry-run]`);
      process.exit(0);
    }
  }
  const fromEnv = process.env.FRAMEBAKER_TERMINAL_ENGINE_ROOT;
  const resolved = resolve(target ?? fromEnv ?? join(repoRoot, "..", "tui-rpg-terminal-engine"));
  return { targetRoot: resolved, dryRun };
}

function listFixtureDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => {
      if (name === "manifest.json") return false;
      const p = join(root, name);
      return statSync(p).isDirectory();
    })
    .sort();
}

function copyExact(src: string, dest: string, dryRun: boolean): void {
  if (dryRun) {
    console.log("copy", src, "->", dest);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
}

const { targetRoot, dryRun } = parseArgs(process.argv.slice(2));
const destRoot = join(targetRoot, "pixel-engine", "tests", "fixtures", "fbanim-v3");

if (!existsSync(sourceRoot)) {
  console.error("missing canonical source:", sourceRoot);
  process.exit(1);
}
if (!existsSync(join(targetRoot, "pixel-engine"))) {
  console.error("target does not look like tui-rpg-terminal-engine (no pixel-engine/):", targetRoot);
  process.exit(1);
}

const manifestPath = join(sourceRoot, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("missing manifest.json at", manifestPath);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  contractIds: string[];
  fixtures: Record<string, { status: string }>;
};

const available = Object.entries(manifest.fixtures)
  .filter(([, meta]) => meta.status === "available")
  .map(([id]) => id)
  .sort();

const presentDirs = listFixtureDirs(sourceRoot);
for (const id of available) {
  if (!presentDirs.includes(id)) {
    console.error(`manifest marks ${id} available but directory missing under ${sourceRoot}`);
    process.exit(1);
  }
}

if (!dryRun) {
  mkdirSync(destRoot, { recursive: true });
}

// Always sync manifest first.
copyExact(manifestPath, join(destRoot, "manifest.json"), dryRun);

// Sync only available fixture directories; remove stale dest dirs not in available set.
const destDirs = existsSync(destRoot) ? listFixtureDirs(destRoot) : [];
for (const stale of destDirs) {
  if (!available.includes(stale)) {
    const path = join(destRoot, stale);
    if (dryRun) {
      console.log("rm", path);
    } else {
      rmSync(path, { recursive: true, force: true });
      console.log("removed stale", stale);
    }
  }
}

for (const id of available) {
  const src = join(sourceRoot, id);
  const dest = join(destRoot, id);
  if (!dryRun && existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  copyExact(src, dest, dryRun);
  console.log(dryRun ? `would sync ${id}` : `synced ${id}`);
}

// Byte-verify available fixtures after copy.
if (!dryRun) {
  for (const id of available) {
    const srcDir = join(sourceRoot, id);
    const destDir = join(destRoot, id);
    for (const name of readdirSync(srcDir)) {
      const a = readFileSync(join(srcDir, name));
      const b = readFileSync(join(destDir, name));
      if (a.length !== b.length || !a.equals(b)) {
        console.error(`byte mismatch after sync: ${id}/${name}`);
        process.exit(1);
      }
    }
  }
  // Ensure missing contract IDs have no package on dest.
  for (const id of manifest.contractIds) {
    const status = manifest.fixtures[id]?.status;
    if (status === "missing") {
      const pkg = join(destRoot, id, "package.fbanim");
      if (existsSync(pkg)) {
        console.error(`missing fixture ${id} must not have package.fbanim at dest`);
        process.exit(1);
      }
    }
  }
  }

console.log("OK", dryRun ? "dry-run" : "synced", available.length, "fixture(s) ->", destRoot);
