import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve } from "bun";
import { readZip } from "../apps/web/src/zip";
import { verifyFbanimV3Entries } from "../packages/shared/src/animationPackageV3";
import { registerAicTestDatabase } from "./aic-test-storage";

const { app } = await import("../apps/server/src/app");
const { db } = await import("../apps/server/src/db");
registerAicTestDatabase(db);

const BASE = "http://localhost:4017";
let server: ReturnType<typeof serve>;
let projectId = "";
const skeletonId = `aic-http-skeleton-${crypto.randomUUID()}`;
const clipId = `aic-http-clip-${crypto.randomUUID()}`;

const skeleton = {
  schemaVersion: 1,
  kind: "skeleton",
  id: skeletonId,
  name: "AIC HTTP humanoid",
  coordinateSystem: { handedness: "right", upAxis: "y", forwardAxis: "+z", unit: "normalized" },
  bones: [{ id: "root", name: "Root", parentId: null, rest: { translation: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] } }],
};

beforeAll(() => { server = serve({ port: 4017, fetch: app.handle }); });
afterAll(() => {
  server.stop();
  if (projectId) {
    db.query("DELETE FROM animation_assets WHERE id IN (?, ?)").run(skeletonId, clipId);
    db.query("DELETE FROM aic_operations WHERE project_id = ?").run(projectId);
    db.query("DELETE FROM skeletal_projects WHERE project_id = ?").run(projectId);
    db.query("DELETE FROM projects WHERE id = ?").run(projectId);
  }
});

async function http(path: string, init?: RequestInit) {
  const response = await fetch(`${BASE}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  return { response, body: await response.json().catch(() => null) };
}

async function mcpCall(name: string, args: Record<string, unknown>, id: number) {
  const response = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) });
  const text = await response.text();
  const line = text.split("\n").find((item) => item.startsWith("data: "));
  const json = line ? JSON.parse(line.slice(6)) : JSON.parse(text);
  return { response, json, value: json.result?.content?.[0]?.text ? JSON.parse(json.result.content[0].text) : null };
}

describe("AIC HTTP/MCP authoring contract", () => {
  test("creates a skeletal project and applies an atomic staged pipeline", async () => {
    const created = await mcpCall("create_project", { name: `AIC HTTP ${crypto.randomUUID()}`, kind: "skeletal" }, 1);
    projectId = created.value.id;
    expect(created.value.kind).toBe("skeletal");

    const initial = await http(`/api/projects/${projectId}/aic-summary`);
    expect(initial.response.status).toBe(200);
    expect(initial.body.summary.revision).toBe(0);

    const first = await http(`/api/projects/${projectId}/aic-operations`, { method: "POST", body: JSON.stringify({ baseRevision: 0, idempotencyKey: "http-create-assets", operations: [
      { type: "create-skeleton", asset: skeleton },
      { type: "create-motion-clip", asset: { schemaVersion: 1, kind: "motion-clip", id: clipId, name: "Idle", skeletonId, duration: 1, loop: true, events: [], tracks: [] } },
    ] }) });
    expect(first.response.status).toBe(200);
    expect(first.body.revision).toBe(1);

    const binding = { schemaVersion: 1, kind: "character-binding", id: `binding-${crypto.randomUUID()}`, name: "AIC test binding", skeletonId, slots: [], attachments: [] };
    const second = await mcpCall("aic_apply_operations", { projectId, baseRevision: 1, idempotencyKey: "mcp-bind-action", operations: [
      { type: "upsert-binding", binding },
      { type: "upsert-action", action: { id: "idle", name: "Idle", motionClipId: clipId, speed: 1, repeat: 1, loop: true } },
    ] }, 2);
    expect(second.value.revision).toBe(2);

    const retry = await http(`/api/projects/${projectId}/aic-operations`, { method: "POST", body: JSON.stringify({ baseRevision: 1, idempotencyKey: "mcp-bind-action", operations: [
      { type: "upsert-binding", binding },
      { type: "upsert-action", action: { id: "idle", name: "Idle", motionClipId: clipId, speed: 1, repeat: 1, loop: true } },
    ] }) });
    expect(retry.response.status).toBe(200);
    expect(retry.body).toEqual(second.value);

    const stale = await http(`/api/projects/${projectId}/aic-operations`, { method: "POST", body: JSON.stringify({ baseRevision: 1, idempotencyKey: "stale", operations: [{ type: "set-runtime-capabilities", requiredCapabilities: {} }] }) });
    expect(stale.response.status).toBe(409);

    const summary = await mcpCall("aic_get_project_summary", { projectId }, 3);
    expect(summary.value.revision).toBe(2);
    expect(summary.value.actions[0].trackCount).toBe(0);
    expect(summary.value.actions[0].tracks).toBeUndefined();
    const diagnostics = await mcpCall("aic_get_diagnostics", { projectId }, 4);
    expect(diagnostics.value.revision).toBe(2);

    const published = await http(`/api/projects/${projectId}/aic-publish-v3`, { method: "POST", body: "{}" });
    expect(published.response.status).toBe(200);
    expect(published.body.artifactId).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(published.body.revision).toBe(2);
    const artifactResponse = await fetch(`${BASE}${published.body.downloadPath}`);
    const artifactBytes = new Uint8Array(await artifactResponse.arrayBuffer());
    expect(artifactResponse.status).toBe(200);
    expect(artifactBytes.length).toBe(published.body.byteLength);
    const entries = await readZip(new Blob([artifactBytes]));
    const verified = await verifyFbanimV3Entries(entries.map((entry) => ({ path: entry.name, bytes: entry.data })));
    expect(verified.ok).toBe(true);
  });
});
