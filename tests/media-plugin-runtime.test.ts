import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(source: string, envOverrides: Record<string, string> = {}): any {
  const root = mkdtempSync(join(tmpdir(), "framebaker-runtime-test-"));
  roots.push(root);
  const proc = Bun.spawnSync([process.execPath, "-e", source], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, FRAMEBAKER_STORAGE_ROOT: root, ...envOverrides },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(`${proc.stderr.toString()}\n${proc.stdout.toString()}`);
  return JSON.parse(proc.stdout.toString().trim().split(/\r?\n/).at(-1) ?? "null");
}

describe("media plugin runtime lease", () => {
  test("serializes jobs and waits before switching plugins", () => {
    const result = run(`
      import { getMediaPluginRuntimeState, setMediaPluginRuntimeCleanup, withMediaPluginRuntime } from "./apps/server/src/mediaPlugins/runtime.ts";
      const events = [];
      setMediaPluginRuntimeCleanup(async (previous) => {
        events.push('cleanup:' + (previous ? previous.pluginId : 'none'));
        return { ok: true };
      });
      let release;
      const first = withMediaPluginRuntime({ kind: "image_api", pluginId: "one", runtimeKey: "comfy:test" }, async () => {
        events.push("start:one");
        await new Promise((resolve) => { release = resolve; });
        events.push("end:one");
        return "one";
      });
      const second = withMediaPluginRuntime({ kind: "video_api", pluginId: "two", runtimeKey: "comfy:test" }, async () => {
        events.push("start:two");
        return "two";
      });
      await Bun.sleep(0);
      release();
      const values = await Promise.all([first, second]);
      console.log(JSON.stringify({ events, values, state: getMediaPluginRuntimeState() }));
    `);
    expect(result.events.slice(1)).toEqual(["start:one", "end:one", "cleanup:one", "start:two"]);
    expect(result.values).toEqual(["one", "two"]);
    expect(result.state.active_run_id).toBeNull();
  }, 30_000);

  test("fails closed without confirmed cleanup and can be explicitly cleared", () => {
    const result = run(`
      import { clearMediaPluginRuntimeFailure, getMediaPluginRuntimeState, setMediaPluginRuntimeCleanup, withMediaPluginRuntime } from "./apps/server/src/mediaPlugins/runtime.ts";
      setMediaPluginRuntimeCleanup(async () => ({ ok: true }));
      await withMediaPluginRuntime({ kind: "image_api", pluginId: "one", runtimeKey: "comfy:test" }, async () => "ok");
      setMediaPluginRuntimeCleanup(null);
      let switchError = "";
      try {
        await withMediaPluginRuntime({ kind: "video_api", pluginId: "two", runtimeKey: "comfy:test" }, async () => "never");
      } catch (error) { switchError = String(error); }
      const blocked = getMediaPluginRuntimeState();
      clearMediaPluginRuntimeFailure();
      setMediaPluginRuntimeCleanup(async () => ({ ok: true }));
      const recovered = await withMediaPluginRuntime({ kind: "video_api", pluginId: "two", runtimeKey: "comfy:test" }, async () => "recovered");
      console.log(JSON.stringify({ switchError, blocked, recovered }));
    `);
    expect(result.switchError).toContain("缺少可观测清理能力");
    expect(result.blocked).toMatchObject({ status: "blocked", blocked: 1 });
    expect(result.recovered).toBe("recovered");
  }, 30_000);

  test("cleanup failure blocks later submissions", () => {
    const result = run(`
      import { getMediaPluginRuntimeState, setMediaPluginRuntimeCleanup, withMediaPluginRuntime } from "./apps/server/src/mediaPlugins/runtime.ts";
      setMediaPluginRuntimeCleanup(async () => ({ ok: true }));
      await withMediaPluginRuntime({ kind: "image_api", pluginId: "one", runtimeKey: "comfy:test" }, async () => "ok");
      setMediaPluginRuntimeCleanup(async () => ({ ok: false, detail: "Comfy queue drain not confirmed" }));
      let error = "";
      try {
        await withMediaPluginRuntime({ kind: "video_api", pluginId: "two", runtimeKey: "comfy:test" }, async () => "never");
      } catch (caught) { error = String(caught); }
      console.log(JSON.stringify({ error, state: getMediaPluginRuntimeState() }));
    `);
    expect(result.error).toContain("Comfy queue drain not confirmed");
    expect(result.state.status).toBe("blocked");
  }, 30_000);

  test("busy release retries exhaust once and stop", () => {
    const result = run(`
      import { Database } from "bun:sqlite";
      import { join } from "node:path";
      import { STORAGE_ROOT, db } from "./apps/server/src/db.ts";
      import { getMediaPluginRuntimeState, releaseMediaPluginRuntimeRun } from "./apps/server/src/mediaPlugins/runtime.ts";
      const runId = "job:busy-exhaustion";
      db.query("UPDATE media_plugin_runtime SET active_run_id=?, status='running', updated_at=? WHERE id=1").run(runId, Date.now());
      const locker = new Database(join(STORAGE_ROOT, "framebaker.db"));
      locker.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE;");
      const first = releaseMediaPluginRuntimeRun(runId);
      await Bun.sleep(150);
      const whileLocked = getMediaPluginRuntimeState();
      locker.exec("ROLLBACK;");
      locker.close();
      await Bun.sleep(150);
      const afterUnlock = getMediaPluginRuntimeState();
      console.log(JSON.stringify({ first, whileLocked, afterUnlock }));
    `, {
      FRAMEBAKER_SQLITE_BUSY_TIMEOUT_MS: "1",
      FRAMEBAKER_RUNTIME_RELEASE_RETRY_MAX: "2",
      FRAMEBAKER_RUNTIME_RELEASE_RETRY_BASE_MS: "10",
    });
    expect(result.first).toBe(false);
    expect(result.whileLocked).toMatchObject({ active_run_id: "job:busy-exhaustion", status: "running" });
    expect(result.afterUnlock).toMatchObject({ active_run_id: "job:busy-exhaustion", status: "running" });
  }, 30_000);

  test("non-busy release errors never schedule retries", () => {
    const result = run(`
      import { db } from "./apps/server/src/db.ts";
      import { getMediaPluginRuntimeState, releaseMediaPluginRuntimeRun } from "./apps/server/src/mediaPlugins/runtime.ts";
      const runId = "job:non-busy";
      db.query("UPDATE media_plugin_runtime SET active_run_id=?, status='running', updated_at=? WHERE id=1").run(runId, Date.now());
      db.exec("ALTER TABLE media_plugin_runtime RENAME TO media_plugin_runtime_saved");
      const first = releaseMediaPluginRuntimeRun(runId);
      db.exec("ALTER TABLE media_plugin_runtime_saved RENAME TO media_plugin_runtime");
      await Bun.sleep(100);
      console.log(JSON.stringify({ first, state: getMediaPluginRuntimeState() }));
    `, {
      FRAMEBAKER_RUNTIME_RELEASE_RETRY_MAX: "5",
      FRAMEBAKER_RUNTIME_RELEASE_RETRY_BASE_MS: "5",
    });
    expect(result.first).toBe(false);
    expect(result.state).toMatchObject({ active_run_id: "job:non-busy", status: "running" });
  }, 30_000);
});
