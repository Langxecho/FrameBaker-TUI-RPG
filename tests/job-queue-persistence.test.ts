import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const roots: string[] = [];
const testPython = process.env.FRAMEBAKER_MEDIA_PYTHON?.trim() || Bun.which("python") || Bun.which("python3");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function run(root: string, source: string, envOverrides: Record<string, string> = {}): string {
  if (!testPython) throw new Error("Python is required for media-plugin persistence tests");
  const proc = Bun.spawnSync([process.execPath, "-e", source], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      FRAMEBAKER_STORAGE_ROOT: root,
      FRAMEBAKER_MEDIA_PLUGIN_ROOT: join(root, "media-plugins"),
      FRAMEBAKER_MEDIA_PYTHON: testPython,
      ...envOverrides,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = proc.stderr.toString();
  if (proc.exitCode !== 0) throw new Error(`${stderr}\n${proc.stdout.toString()}`);
  return proc.stdout.toString().trim().split(/\r?\n/).at(-1) ?? "";
}

describe("persistent job queue", () => {
  test("configures a bounded SQLite busy timeout", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-busy-timeout-"));
    roots.push(root);
    const result = JSON.parse(run(root, `
      import { db } from "./apps/server/src/db.ts";
      console.log(JSON.stringify(db.query("PRAGMA busy_timeout").get()));
    `));
    expect(result.timeout).toBe(10_000);
  });

  test("persists payload, reuses identical idempotency keys, and rejects conflicts", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-queue-"));
    roots.push(root);
    const result = JSON.parse(run(root, `
      import { createJob } from "./apps/server/src/queue.ts";
      import { db } from "./apps/server/src/db.ts";
      const payload = { matting: { target: "material", id: "missing-a" } };
      const first = createJob("", "matting", payload, { idempotencyKey: "same-request" });
      const second = createJob("", "matting", payload, { idempotencyKey: "same-request" });
      let conflict = "";
      try { createJob("", "matting", { matting: { target: "material", id: "missing-b" } }, { idempotencyKey: "same-request" }); }
      catch (error) { conflict = String(error); }
      const row = db.query("SELECT payload,payload_hash,idempotency_key FROM jobs WHERE id=?").get(first);
      console.log(JSON.stringify({ first, second, conflict, row }));
    `));
    expect(result.first).toBe(result.second);
    expect(result.conflict).toContain("IDEMPOTENCY_KEY_CONFLICT");
    expect(JSON.parse(result.row.payload).matting.id).toBe("missing-a");
    expect(result.row.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("does not touch another live owner and blocks expired unknown generation", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-recovery-"));
    roots.push(root);
    const result = JSON.parse(run(root, `
      import { db } from "./apps/server/src/db.ts";
      const now = Date.now();
      db.query("INSERT INTO jobs (id,project_id,type,status,payload,payload_hash,run_owner,lease_expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run("live-owner", "", "generate_frames", "running", JSON.stringify({generate:{prompt:"x"}}), "x", "other", now + 60000, now, now);
      db.query("INSERT INTO jobs (id,project_id,type,status,payload,payload_hash,run_owner,lease_expires_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run("expired-owner", "", "generate_frames", "running", JSON.stringify({generate:{prompt:"x"}}), "x", "dead", now - 1, now, now);
      await import("./apps/server/src/queue.ts");
      await Bun.sleep(50);
      console.log(JSON.stringify(db.query("SELECT id,status,error,run_owner FROM jobs ORDER BY id").all()));
    `));
    const live = result.find((row: any) => row.id === "live-owner");
    const expired = result.find((row: any) => row.id === "expired-owner");
    expect(live).toMatchObject({ status: "running", run_owner: "other", error: null });
    expect(expired.status).toBe("error");
    expect(expired.error).toContain("避免重复生成");
  });

  test("clears stale errors from already successful real-world shaped rows", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-success-"));
    roots.push(root);
    run(root, `
      import { db } from "./apps/server/src/db.ts";
      db.query("INSERT INTO jobs (id,project_id,type,status,progress,error,created_at) VALUES (?,?,?,?,?,?,?)")
        .run("70ed991b-d323-46db-a4a0-0cc3225aeab9", "", "media_plugin_image", "done", '完成 materialIds=["ecfeb992-399e-46a1-bd73-88799c8f1b45"]', "服务重启，任务中断", Date.now());
      console.log("seeded");
    `);
    const row = JSON.parse(run(root, `
      import { db } from "./apps/server/src/db.ts";
      console.log(JSON.stringify(db.query("SELECT id,status,progress,error FROM jobs WHERE id=?").get("70ed991b-d323-46db-a4a0-0cc3225aeab9")));
    `));
    expect(row.status).toBe("done");
    expect(row.progress).toContain("ecfeb992-399e-46a1-bd73-88799c8f1b45");
    expect(row.error).toBeNull();
  });

  test("terminal media job keeps bounded recovery receipts, completes phase, and releases only its lease", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-media-receipt-"));
    roots.push(root);
    const result = JSON.parse(run(root, `
      import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { createJob } from "./apps/server/src/queue.ts";
      import { db } from "./apps/server/src/db.ts";
      const pluginDir = join(${JSON.stringify(root)}, "media-plugins", "video_api", "receipt-video");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({
        plugin_id: "receipt-video", name: "receipt-video", version: "1.0.0", kind: "video_api",
        capabilities: ["t2v"], entry: { type: "python", module: "provider", function: "generate" },
        secrets: {}, params_schema: {}, constraints: { supports_text2video: true, output_extensions: [".mp4"] }
      }));
      writeFileSync(join(pluginDir, "provider.py"), [
        "import json, time",
        "from pathlib import Path",
        "def generate(*, request, secrets, params, helpers):",
        "    time.sleep(0.2)",
        "    out = Path(request.output_dir)",
        "    (out / 'result.mp4').write_bytes(b'ftypISOM' + b'x' * 1048576)",
        "    (out / 'comfy-journal.json').write_text(json.dumps({'status':'completed','promptId':'known','output':{'filename':'result.mp4'}}), encoding='utf-8')",
        "    return {'video_path': str(out / 'result.mp4'), 'metadata': {'promptId':'known'}}",
        ""
      ].join("\\n"));
      const id = createJob("", "media_plugin_video", { mediaPlugin: {
        kind: "video_api", pluginId: "receipt-video", prompt: "local receipt test", references: [],
        params: {}, durationSeconds: 4, folderId: null, projectId: null, name: "receipt-video",
        batchCount: 1, batchIndex: 0, bridgeTimeoutMs: 10000
      }});
      db.query("UPDATE media_plugin_runtime SET active_run_id=?, status='running', updated_at=? WHERE id=1")
        .run('job:' + id, Date.now());
      let row;
      for (let i = 0; i < 200; i++) {
        row = db.query("SELECT status,execution_phase,error FROM jobs WHERE id=?").get(id);
        if (row.status === "done" || row.status === "error") break;
        await Bun.sleep(25);
      }
      const runDir = join(${JSON.stringify(root)}, "media-plugin-runs", 'job_' + id);
      const runtime = db.query("SELECT active_run_id,status FROM media_plugin_runtime WHERE id=1").get();
      console.log(JSON.stringify({ row, files: readdirSync(runDir).sort(), runtime }));
    `));
    expect(result.row).toMatchObject({ status: "done", execution_phase: "completed", error: null });
    expect(result.files).toEqual(["comfy-journal.json", "request.json", "result.json"]);
    expect(result.runtime).toMatchObject({ active_run_id: null, status: "idle" });
  }, 30_000);

  test("completed journal recovery archives without resubmission and releases its matching lease", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-media-reconcile-"));
    roots.push(root);
    const result = JSON.parse(run(root, `
      import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { db } from "./apps/server/src/db.ts";
      const id = "recover-known";
      const pluginDir = join(${JSON.stringify(root)}, "media-plugins", "video_api", "recover-video");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({
        plugin_id: "recover-video", name: "recover-video", version: "1.0.0", kind: "video_api",
        capabilities: ["t2v"], entry: { type: "python", module: "provider", function: "generate" },
        secrets: {}, params_schema: {}, constraints: { supports_text2video: true, output_extensions: [".mp4"] }
      }));
      writeFileSync(join(pluginDir, "provider.py"), [
        "import json",
        "from pathlib import Path",
        "def generate(*, request, secrets, params, helpers):",
        "    out = Path(request.output_dir)",
        "    journal = json.loads((out / 'comfy-journal.json').read_text(encoding='utf-8'))",
        "    if journal.get('status') != 'completed' or journal.get('promptId') != 'known-prompt':",
        "        (out / 'resubmitted.marker').write_text('unexpected')",
        "        raise RuntimeError('expected completed recovery journal')",
        "    return {'video_path': str(out / 'result.mp4'), 'metadata': {'promptId':'known-prompt'}}",
        ""
      ].join("\\n"));
      const runDir = join(${JSON.stringify(root)}, "media-plugin-runs", 'job_' + id);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "result.mp4"), Buffer.concat([Buffer.from('ftypISOM'), Buffer.alloc(1048576, 120)]));
      writeFileSync(join(runDir, "comfy-journal.json"), JSON.stringify({
        status: "completed", promptId: "known-prompt", output: { filename: "result.mp4", type: "output", subfolder: "" }
      }));
      const now = Date.now();
      const existingMaterialId = "already-archived";
      const materialDir = join(${JSON.stringify(root)}, "materials", existingMaterialId);
      mkdirSync(materialDir, { recursive: true });
      const materialRaw = join(materialDir, "raw.mp4");
      writeFileSync(materialRaw, Buffer.concat([Buffer.from('ftypISOM'), Buffer.alloc(128, 121)]));
      db.query("INSERT INTO materials (id,name,raw_path,status,source,folder_id,metadata,created_at) VALUES (?,?,?,'raw',?,NULL,?,?)")
        .run(existingMaterialId, "already archived", materialRaw, "media-plugin:recover-video", JSON.stringify({
          mediaKind: "video", pluginId: "recover-video", mediaPluginJobId: id, mediaPluginOutputIndex: 0
        }), now);
      const mediaPlugin = {
        kind: "video_api", pluginId: "recover-video", prompt: "recover only", references: [], params: {},
        durationSeconds: 4, folderId: null, projectId: null, name: "recovered-video",
        batchCount: 1, batchIndex: 0, bridgeTimeoutMs: 10000
      };
      const beforeCount = db.query("SELECT COUNT(*) AS n FROM materials").get().n;
      db.query("INSERT INTO jobs (id,project_id,type,status,payload,payload_hash,run_owner,lease_expires_at,execution_phase,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, "", "media_plugin_video", "running", JSON.stringify({ mediaPlugin }), "hash", "dead-owner", now - 1, "running", now, now);
      await import("./apps/server/src/mediaPlugins/runtime.ts");
      db.query("UPDATE media_plugin_runtime SET active_run_id=?, status='running', updated_at=? WHERE id=1")
        .run('job:' + id, now);
      await import("./apps/server/src/queue.ts");
      let row;
      for (let i = 0; i < 200; i++) {
        row = db.query("SELECT status,execution_phase,error,run_attempt FROM jobs WHERE id=?").get(id);
        if (row.status === "done" || row.status === "error") break;
        await Bun.sleep(25);
      }
      const runtime = db.query("SELECT active_run_id,status FROM media_plugin_runtime WHERE id=1").get();
      const afterCount = db.query("SELECT COUNT(*) AS n FROM materials").get().n;
      const receipt = JSON.parse(readFileSync(join(runDir, "result.json"), "utf8"));
      console.log(JSON.stringify({
        row,
        files: readdirSync(runDir).sort(),
        runtime,
        resubmitted: existsSync(join(runDir, "resubmitted.marker")),
        beforeCount,
        afterCount,
        receipt
      }));
    `));
    expect(result.row).toMatchObject({ status: "done", execution_phase: "completed", error: null });
    expect(result.row.run_attempt).toBe(1);
    expect(result.files).toEqual(["comfy-journal.json", "request.json", "result.json"]);
    expect(result.runtime).toMatchObject({ active_run_id: null, status: "idle" });
    expect(result.resubmitted).toBe(false);
    expect(result.afterCount).toBe(result.beforeCount);
    expect(result.receipt).toMatchObject({
      jobId: "recover-known",
      status: "done",
      materialIds: ["already-archived"],
    });
  }, 30_000);

  test("terminal receipt completes an expired job without loading the plugin again", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-terminal-receipt-recovery-"));
    roots.push(root);
    const result = JSON.parse(run(root, `
      import { mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { db } from "./apps/server/src/db.ts";
      const id = "terminal-receipt-job";
      const materialId = "terminal-receipt-material";
      const materialDir = join(${JSON.stringify(root)}, "materials", materialId);
      mkdirSync(materialDir, { recursive: true });
      const rawPath = join(materialDir, "raw.mp4");
      writeFileSync(rawPath, Buffer.concat([Buffer.from('ftypISOM'), Buffer.alloc(128, 122)]));
      db.query("INSERT INTO materials (id,name,raw_path,status,source,folder_id,metadata,created_at) VALUES (?,?,?,'raw',?,NULL,?,?)")
        .run(materialId, "receipt material", rawPath, "media-plugin:missing-plugin-must-not-load", JSON.stringify({
          mediaKind: "video", pluginId: "missing-plugin-must-not-load", mediaPluginJobId: id, mediaPluginOutputIndex: 0
        }), Date.now());
      const runDir = join(${JSON.stringify(root)}, "media-plugin-runs", 'job_' + id);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "request.json"), JSON.stringify({
        schema: "framebaker.media-plugin-terminal-request-v1", jobId: id
      }));
      writeFileSync(join(runDir, "result.json"), JSON.stringify({
        schema: "framebaker.media-plugin-terminal-result-v1", jobId: id, status: "done", materialIds: [materialId]
      }));
      const payload = { mediaPlugin: {
        kind: "video_api", pluginId: "missing-plugin-must-not-load", prompt: "must not run", references: [], params: {},
        durationSeconds: 4, folderId: null, projectId: null, name: "must not run",
        batchCount: 1, batchIndex: 0, bridgeTimeoutMs: 10000
      }};
      const now = Date.now();
      db.query("INSERT INTO jobs (id,project_id,type,status,payload,payload_hash,run_owner,lease_expires_at,execution_phase,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, "", "media_plugin_video", "running", JSON.stringify(payload), "hash", "dead-owner", now - 1, "running", now, now);
      await import("./apps/server/src/mediaPlugins/runtime.ts");
      db.query("UPDATE media_plugin_runtime SET active_run_id=?, status='running', updated_at=? WHERE id=1")
        .run('job:' + id, now);
      await import("./apps/server/src/queue.ts");
      await Bun.sleep(50);
      const row = db.query("SELECT status,execution_phase,progress,error,run_attempt FROM jobs WHERE id=?").get(id);
      const runtime = db.query("SELECT active_run_id,status FROM media_plugin_runtime WHERE id=1").get();
      console.log(JSON.stringify({ row, runtime }));
    `));
    expect(result.row).toMatchObject({
      status: "done",
      execution_phase: "completed",
      error: null,
      run_attempt: 0,
    });
    expect(result.row.progress).toContain("terminal-receipt-material");
    expect(result.runtime).toMatchObject({ active_run_id: null, status: "idle" });
  }, 30_000);

  test("runtime release never clears another job lease", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-runtime-release-"));
    roots.push(root);
    const result = JSON.parse(run(root, `
      import { db } from "./apps/server/src/db.ts";
      import { getMediaPluginRuntimeState, releaseMediaPluginRuntimeRun } from "./apps/server/src/mediaPlugins/runtime.ts";
      db.query("UPDATE media_plugin_runtime SET active_run_id=?, status='running', updated_at=? WHERE id=1")
        .run("job:owned", Date.now());
      const otherReleased = releaseMediaPluginRuntimeRun("job:other");
      const afterOther = getMediaPluginRuntimeState();
      const ownedReleased = releaseMediaPluginRuntimeRun("job:owned");
      const afterOwned = getMediaPluginRuntimeState();
      console.log(JSON.stringify({ otherReleased, afterOther, ownedReleased, afterOwned }));
    `));
    expect(result.otherReleased).toBe(false);
    expect(result.afterOther).toMatchObject({ active_run_id: "job:owned", status: "running" });
    expect(result.ownedReleased).toBe(true);
    expect(result.afterOwned).toMatchObject({ active_run_id: null, status: "idle" });
  });

  test("SQLite writer contention defers pump and runtime release without exiting", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-sqlite-contention-"));
    roots.push(root);
    const result = JSON.parse(run(root, `
      import { Database } from "bun:sqlite";
      import { join } from "node:path";
      import { db } from "./apps/server/src/db.ts";
      import { recoverPersistedJobs } from "./apps/server/src/queue.ts";
      import { releaseMediaPluginRuntimeRun } from "./apps/server/src/mediaPlugins/runtime.ts";
      const now = Date.now();
      db.query("INSERT INTO jobs (id,project_id,type,status,payload,payload_hash,execution_phase,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run("contended-job", "", "matting", "queued", JSON.stringify({ matting: { target: "material", id: "missing" } }), "hash", "queued", now, now);
      db.query("UPDATE media_plugin_runtime SET active_run_id=?, status='running', updated_at=? WHERE id=1")
        .run("job:contended-job", now);
      const locker = new Database(join(${JSON.stringify(root)}, "framebaker.db"));
      locker.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE;");
      const recovered = recoverPersistedJobs();
      const releasedWhileLocked = releaseMediaPluginRuntimeRun("job:contended-job");
      locker.exec("ROLLBACK;");
      locker.close();
      await Bun.sleep(750);
      const row = db.query("SELECT status,error FROM jobs WHERE id=?").get("contended-job");
      const runtime = db.query("SELECT active_run_id,status FROM media_plugin_runtime WHERE id=1").get();
      console.log(JSON.stringify({ recovered, releasedWhileLocked, row, runtime, alive: true }));
    `, { FRAMEBAKER_SQLITE_BUSY_TIMEOUT_MS: "25" }));
    expect(result.alive).toBe(true);
    expect(result.recovered).toBe(1);
    expect(result.releasedWhileLocked).toBe(false);
    expect(result.row.status).toBe("error");
    expect(result.runtime).toMatchObject({ active_run_id: null, status: "idle" });
  }, 30_000);

  test("terminal receipt write failure leaves a completed journal recoverable", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-receipt-write-failure-"));
    roots.push(root);
    const result = JSON.parse(run(root, `
      import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { createJob } from "./apps/server/src/queue.ts";
      import { db } from "./apps/server/src/db.ts";
      const pluginDir = join(${JSON.stringify(root)}, "media-plugins", "video_api", "receipt-failure-video");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({
        plugin_id: "receipt-failure-video", name: "receipt-failure-video", version: "1.0.0", kind: "video_api",
        capabilities: ["t2v"], entry: { type: "python", module: "provider", function: "generate" },
        secrets: {}, params_schema: {}, constraints: { supports_text2video: true, output_extensions: [".mp4"] }
      }));
      writeFileSync(join(pluginDir, "provider.py"), [
        "import json",
        "from pathlib import Path",
        "def generate(*, request, secrets, params, helpers):",
        "    out = Path(request.output_dir)",
        "    (out / 'result.mp4').write_bytes(b'ftypISOM' + b'x' * 1048576)",
        "    (out / 'comfy-journal.json').write_text(json.dumps({'status':'completed','promptId':'known-write-failure','output':{'filename':'result.mp4'}}), encoding='utf-8')",
        "    (out / 'result.json.tmp').mkdir(exist_ok=True)",
        "    return {'video_path': str(out / 'result.mp4'), 'metadata': {'promptId':'known-write-failure'}}",
        ""
      ].join("\\n"));
      const id = createJob("", "media_plugin_video", { mediaPlugin: {
        kind: "video_api", pluginId: "receipt-failure-video", prompt: "no resubmit", references: [], params: {},
        durationSeconds: 4, folderId: null, projectId: null, name: "receipt-failure-video",
        batchCount: 1, batchIndex: 0, bridgeTimeoutMs: 10000
      }});
      let row;
      const runDir = join(${JSON.stringify(root)}, "media-plugin-runs", 'job_' + id);
      for (let i = 0; i < 200; i++) {
        row = db.query("SELECT status,execution_phase,error FROM jobs WHERE id=?").get(id);
        const material = db.query("SELECT id FROM materials WHERE json_extract(metadata, '$.mediaPluginJobId')=?").get(id);
        if (row.status === "running" && material && existsSync(join(runDir, "comfy-journal.json"))) break;
        await Bun.sleep(25);
      }
      const journal = JSON.parse(readFileSync(join(runDir, "comfy-journal.json"), "utf8"));
      const material = db.query("SELECT id FROM materials WHERE json_extract(metadata, '$.mediaPluginJobId')=?").get(id);
      console.log(JSON.stringify({ row, journal, material, alive: true }));
    `));
    expect(result.alive).toBe(true);
    expect(result.row).toMatchObject({ status: "running", execution_phase: "running", error: null });
    expect(result.journal).toMatchObject({ status: "completed", promptId: "known-write-failure" });
    expect(result.material.id).toBeTruthy();
  }, 30_000);

  test("explicit recovery only requeues a supported known completed journal", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-explicit-known-recovery-"));
    roots.push(root);
    const result = JSON.parse(run(root, `
      import { mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { db } from "./apps/server/src/db.ts";
      import { recoverKnownMediaPluginJob } from "./apps/server/src/queue.ts";
      const id = "explicit-known-job";
      const pluginDir = join(${JSON.stringify(root)}, "media-plugins", "video_api", "known-recovery-video");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({
        plugin_id: "known-recovery-video", name: "known-recovery-video", version: "1.0.0", kind: "video_api",
        capabilities: ["t2v"], entry: { type: "python", module: "provider", function: "generate" },
        secrets: {}, params_schema: {}, constraints: { supports_text2video: true, output_extensions: [".mp4"] }
      }));
      writeFileSync(join(pluginDir, "provider.py"), [
        "from pathlib import Path",
        "# comfy_workflow_provider.py / generate_comfy_video",
        "def generate(*, request, secrets, params, helpers):",
        "    out = Path(request.output_dir)",
        "    journal = __import__('json').loads((out / 'comfy-journal.json').read_text(encoding='utf-8'))",
        "    if journal.get('status') != 'completed': raise RuntimeError('must reconcile completed')",
        "    (out / 'result.mp4').write_bytes(b'ftypISOM' + b'x' * 1048576)",
        "    return {'video_path': str(out / 'result.mp4'), 'metadata': {'promptId': journal.get('promptId')}}",
        ""
      ].join("\\n"));
      writeFileSync(join(pluginDir, "comfy_workflow_provider.py"), [
        "def generate_comfy_video(): pass",
        "# if status == \\\"completed\\\"",
        "# COMFY_SUBMISSION_STATE_UNKNOWN_RECONCILE_ONLY",
        ""
      ].join("\\n"));
      const runDir = join(${JSON.stringify(root)}, "media-plugin-runs", 'job_' + id);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "comfy-journal.json"), JSON.stringify({
        status: "completed", promptId: "known-explicit-prompt", output: { filename: "known.mp4", type: "output", subfolder: "" }
      }));
      const mediaPlugin = {
        kind: "video_api", pluginId: "known-recovery-video", prompt: "recover only", references: [], params: {},
        durationSeconds: 4, folderId: null, projectId: null, name: "known recovery",
        batchCount: 1, batchIndex: 0, bridgeTimeoutMs: 10000
      };
      const now = Date.now();
      db.query("INSERT INTO jobs (id,project_id,type,status,payload,payload_hash,run_attempt,execution_phase,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(id, "", "media_plugin_video", "error", JSON.stringify({ mediaPlugin }), "hash", 2, "failed", now, now);
      const recovery = recoverKnownMediaPluginJob(id);
      let row;
      for (let i = 0; i < 200; i++) {
        row = db.query("SELECT status,execution_phase,error,run_attempt FROM jobs WHERE id=?").get(id);
        if (row.status === "done" || row.status === "error") break;
        await Bun.sleep(25);
      }
      const materials = db.query("SELECT id FROM materials WHERE json_extract(metadata, '$.mediaPluginJobId')=?").all(id);
      console.log(JSON.stringify({ recovery, row, materials }));
    `));
    expect(result.recovery).toMatchObject({
      ok: true,
      jobId: "explicit-known-job",
      phase: "reconcile_completed",
      promptId: "known-explicit-prompt",
    });
    expect(result.row).toMatchObject({ status: "done", execution_phase: "completed", error: null, run_attempt: 3 });
    expect(result.materials).toHaveLength(1);
  }, 30_000);

  test("explicit recovery leaves the job unchanged when Python is unavailable", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-explicit-recovery-python-"));
    roots.push(root);
    const missingPython = join(root, "missing-python.exe");
    const result = JSON.parse(run(root, `
      import { mkdirSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { db } from "./apps/server/src/db.ts";
      import { recoverKnownMediaPluginJob } from "./apps/server/src/queue.ts";
      const id = "explicit-python-missing";
      const pluginDir = join(${JSON.stringify(root)}, "media-plugins", "video_api", "known-recovery-video");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "plugin.json"), JSON.stringify({
        plugin_id: "known-recovery-video", name: "known-recovery-video", version: "1.0.0", kind: "video_api",
        capabilities: ["t2v"], entry: { type: "python", module: "provider", function: "generate" },
        secrets: {}, params_schema: {}, constraints: { supports_text2video: true, output_extensions: [".mp4"] }
      }));
      writeFileSync(join(pluginDir, "provider.py"), "# comfy_workflow_provider.py generate_comfy_video\\ndef generate(**kwargs): pass\\n");
      writeFileSync(join(pluginDir, "comfy_workflow_provider.py"), "def generate_comfy_video(): pass\\n# if status == \\\"completed\\\"\\n# COMFY_SUBMISSION_STATE_UNKNOWN_RECONCILE_ONLY\\n");
      const runDir = join(${JSON.stringify(root)}, "media-plugin-runs", 'job_' + id);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "comfy-journal.json"), JSON.stringify({ status: "completed", promptId: "known", output: { filename: "known.mp4" } }));
      const payload = { mediaPlugin: {
        kind: "video_api", pluginId: "known-recovery-video", prompt: "recover only", references: [], params: {},
        durationSeconds: 4, folderId: null, projectId: null, name: "known recovery", batchCount: 1, batchIndex: 0
      }};
      const now = Date.now();
      db.query("INSERT INTO jobs (id,project_id,type,status,payload,payload_hash,run_attempt,execution_phase,error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
        .run(id, "", "media_plugin_video", "error", JSON.stringify(payload), "hash", 2, "failed", "old error", now, now);
      const before = db.query("SELECT status,execution_phase,error,run_attempt,updated_at FROM jobs WHERE id=?").get(id);
      const recovery = recoverKnownMediaPluginJob(id);
      const after = db.query("SELECT status,execution_phase,error,run_attempt,updated_at FROM jobs WHERE id=?").get(id);
      console.log(JSON.stringify({ recovery, before, after }));
    `, { FRAMEBAKER_MEDIA_PYTHON: missingPython }));
    expect(result.recovery).toMatchObject({ ok: false, status: 503, code: "PYTHON_RUNTIME_UNAVAILABLE" });
    expect(result.after).toEqual(result.before);
  }, 30_000);
});
