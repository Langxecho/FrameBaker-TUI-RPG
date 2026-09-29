import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const state = globalThis as typeof globalThis & {
  __framebakerAicTestStorage?: { root: string; db?: { close(): void }; cleanupRegistered: boolean };
};

const shared = state.__framebakerAicTestStorage ??= {
  root: mkdtempSync(join(tmpdir(), "framebaker-aic-tests-")),
  cleanupRegistered: false,
};

process.env.FRAMEBAKER_STORAGE_ROOT = shared.root;

export const aicTestStorageRoot = shared.root;

export function registerAicTestDatabase(db: { close(): void }): void {
  shared.db = db;
  if (shared.cleanupRegistered) return;
  shared.cleanupRegistered = true;
  process.on("exit", () => {
    try { shared.db?.close(); } catch {}
    rmSync(shared.root, { recursive: true, force: true });
  });
}
