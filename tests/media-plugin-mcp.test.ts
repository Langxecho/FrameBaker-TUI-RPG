import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "bun";
import { app } from "../apps/server/src/app";
import { db, STORAGE_ROOT, uid } from "../apps/server/src/db";
import { installMediaPluginArchive, deleteMediaPlugin } from "../apps/server/src/mediaPlugins/installer";
import { cancelJob } from "../apps/server/src/queue";
import { createZip } from "../apps/web/src/zip";

const BASE = "http://localhost:3997";
let server: ReturnType<typeof serve>;

const tempRoot = mkdtempSync(join(tmpdir(), "framebaker-media-mcp-"));
const pluginStorageRoot = resolve(tempRoot, "media-plugins");
const previousPluginRoot = process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT;
const createdMaterialIds: string[] = [];
const createdJobIds: string[] = [];

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const SECRET_VALUE = "mcp-super-secret-value-do-not-leak";

beforeAll(() => {
  process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT = pluginStorageRoot;
  mkdirSync(pluginStorageRoot, { recursive: true });
  server = serve({ port: 3997, fetch: app.handle });
});

async function waitForJobTerminal(id: string, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const row = db.query("SELECT status FROM jobs WHERE id = ?").get(id) as { status: string } | null;
    if (!row || (row.status !== "queued" && row.status !== "running")) return;
    await Bun.sleep(50);
  }
}

afterAll(async () => {
  const active = db
    .query(
      "SELECT id FROM jobs WHERE status IN ('queued', 'running') AND type IN ('media_plugin_image', 'media_plugin_video', 'media_plugin_audio')",
    )
    .all() as Array<{ id: string }>;
  const drainIds = new Set<string>([...createdJobIds, ...active.map((row) => row.id)]);
  for (const id of drainIds) {
    try {
      cancelJob(id);
    } catch {
      /* ignore */
    }
  }
  for (const id of drainIds) {
    try {
      await waitForJobTerminal(id);
    } catch {
      /* ignore */
    }
  }

  server.stop();
  if (previousPluginRoot === undefined) delete process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT;
  else process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT = previousPluginRoot;
  for (const id of createdJobIds) {
    try {
      db.query("DELETE FROM jobs WHERE id = ?").run(id);
    } catch {
      /* ignore */
    }
  }
  for (const id of createdMaterialIds) {
    try {
      db.query("DELETE FROM materials WHERE id = ?").run(id);
    } catch {
      /* ignore */
    }
    rmSync(join(STORAGE_ROOT, "materials", id), { recursive: true, force: true });
  }
  try {
    deleteMediaPlugin("image_api", "mcp_demo_img");
  } catch {
    /* ignore */
  }
  rmSync(tempRoot, { recursive: true, force: true });
});

function trackMaterial(id: string) {
  createdMaterialIds.push(id);
  return id;
}

function trackJobs(ids: string[]) {
  createdJobIds.push(...ids);
  return ids;
}

function parseSseJson(text: string): any {
  for (const line of text.split("\n")) {
    if (line.startsWith("data: ")) {
      return JSON.parse(line.slice(6));
    }
  }
  return null;
}

async function mcp(body: unknown): Promise<any> {
  const res = await fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
  const ct = res.headers.get("content-type") ?? "";
  let json: any = null;
  if (ct.includes("text/event-stream")) {
    json = parseSseJson(await res.text());
  } else if (ct.includes("application/json")) {
    try {
      json = await res.json();
    } catch {
      /* empty */
    }
  }
  return { status: res.status, json, headers: res.headers };
}

async function callTool(name: string, args: Record<string, unknown>, id = 1): Promise<any> {
  const { json } = await mcp({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return json;
}

function toolText(json: any): string {
  return String(json?.result?.content?.[0]?.text ?? "");
}

function toolData(json: any): any {
  return JSON.parse(toolText(json));
}

async function packPlugin(files: Record<string, string>, filename: string): Promise<Uint8Array> {
  const entries = Object.entries(files).map(([name, text]) => ({
    name,
    data: new TextEncoder().encode(text),
  }));
  const blob = await createZip(entries);
  return new Uint8Array(await blob.arrayBuffer());
}

function imageManifest(overrides: Record<string, unknown> = {}) {
  return {
    plugin_id: "mcp_demo_img",
    name: "MCP Demo Img",
    version: "1.0.0",
    kind: "image_api",
    capabilities: ["t2i", "i2i"],
    entry: { type: "python", module: "provider", function: "generate" },
    secrets: {
      api_key: { label: "API Key", required: true, secret: true, value: SECRET_VALUE },
    },
    params_schema: {
      size: { type: "string", label: "尺寸", default: "1024x1024", enum: ["1024x1024", "512x512"] },
      count: { type: "integer", label: "数量", default: 1 },
    },
    constraints: { max_reference_images: 2, supports_text2image: true, supports_image2image: true },
    ...overrides,
  };
}

const providerPy = `def generate(*, request, secrets, params, helpers):\n    return {'base64': '${TINY_PNG.toString("base64")}', 'metadata': {'providerTag': 'mcp-demo'}}\n`;

function insertImageMaterial(name = "mcp-ref-image"): string {
  const id = uid();
  const dir = join(STORAGE_ROOT, "materials", id);
  mkdirSync(dir, { recursive: true });
  const rawPath = join(dir, "raw.png");
  writeFileSync(rawPath, TINY_PNG);
  db.query(
    "INSERT INTO materials (id, name, raw_path, status, source, folder_id, metadata, created_at) VALUES (?, ?, ?, 'raw', 'upload', NULL, ?, ?)",
  ).run(id, name, rawPath, JSON.stringify({ mediaKind: "image" }), Date.now());
  return trackMaterial(id);
}

function insertAudioMaterial(name = "mcp-ref-audio"): string {
  const id = uid();
  const dir = join(STORAGE_ROOT, "materials", id);
  mkdirSync(dir, { recursive: true });
  const rawPath = join(dir, "raw.mp3");
  writeFileSync(rawPath, Buffer.from("ID3fake-audio-bytes-0123456789"));
  db.query(
    "INSERT INTO materials (id, name, raw_path, status, source, folder_id, metadata, created_at) VALUES (?, ?, ?, 'raw', 'upload', NULL, ?, ?)",
  ).run(id, name, rawPath, JSON.stringify({ mediaKind: "audio" }), Date.now());
  return trackMaterial(id);
}

describe("媒体插件 MCP 工具", () => {
  beforeAll(async () => {
    const bytes = await packPlugin(
      {
        "plugin.json": JSON.stringify(imageManifest()),
        "provider.py": providerPy,
      },
      "mcp_demo.iap",
    );
    installMediaPluginArchive(bytes, "mcp_demo.iap", true);
  });

  test("tools/list 包含三个媒体插件工具且不含安装/删除/密钥操作", async () => {
    const { json } = await mcp({ jsonrpc: "2.0", id: 10, method: "tools/list" });
    const names = json.result.tools.map((t: any) => t.name);
    expect(names).toContain("list_media_plugins");
    expect(names).toContain("get_media_plugin");
    expect(names).toContain("generate_with_media_plugin");
    expect(names).not.toContain("install_media_plugin");
    expect(names).not.toContain("delete_media_plugin");
    expect(names).not.toContain("update_media_plugin_secrets");
    expect(names).not.toContain("update_media_plugin_params");
  });

  test("list_media_plugins 可按 image|all 列出摘要与配置状态", async () => {
    const listed = await callTool("list_media_plugins", { kind: "image" }, 11);
    const data = toolData(listed);
    expect(Array.isArray(data.plugins)).toBe(true);
    const plugin = data.plugins.find((p: any) => p.id === "mcp_demo_img");
    expect(plugin).toBeTruthy();
    expect(plugin.kind).toBe("image_api");
    expect(plugin.configured).toBe(true);
    expect(plugin.runnable).toBe(true);
    expect(JSON.stringify(data)).not.toContain(SECRET_VALUE);

    const all = await callTool("list_media_plugins", { kind: "all" }, 12);
    const allData = toolData(all);
    expect(allData.plugins.some((p: any) => p.id === "mcp_demo_img")).toBe(true);
  });

  test("get_media_plugin 返回非敏感详情且不含密钥明文", async () => {
    const got = await callTool(
      "get_media_plugin",
      { kind: "image", pluginId: "mcp_demo_img" },
      13,
    );
    const data = toolData(got);
    expect(data.plugin.id).toBe("mcp_demo_img");
    expect(data.plugin.paramsSchema.size).toBeTruthy();
    expect(data.plugin.constraints.max_reference_images).toBe(2);
    expect(Array.isArray(data.plugin.secrets)).toBe(true);
    expect(data.plugin.secrets[0].configured).toBe(true);
    expect(data.plugin.secrets[0].value).toBeUndefined();
    const text = toolText(got);
    expect(text).not.toContain(SECRET_VALUE);
    expect(text).not.toMatch(/"value"\s*:\s*"/);
  });

  test("generate_with_media_plugin 创建任务并返回 jobId/jobIds", async () => {
    let jobIds: string[] = [];
    try {
      const created = await callTool(
        "generate_with_media_plugin",
        {
          kind: "image",
          pluginId: "mcp_demo_img",
          prompt: "a tiny red square",
          params: { size: "512x512" },
          count: 2,
          name: "mcp-gen",
        },
        14,
      );
      expect(created.result?.isError).toBeFalsy();
      const data = toolData(created);
      if (Array.isArray(data?.jobIds)) jobIds = trackJobs(data.jobIds as string[]);
      expect(data.jobId).toBeTruthy();
      expect(Array.isArray(data.jobIds)).toBe(true);
      expect(data.jobIds.length).toBe(2);
      expect(data.jobIds[0]).toBe(data.jobId);
      expect(JSON.stringify(data)).not.toContain(SECRET_VALUE);
    } finally {
      for (const id of jobIds) {
        try {
          cancelJob(id);
        } catch {
          /* ignore */
        }
      }
      for (const id of jobIds) {
        try {
          await waitForJobTerminal(id);
        } catch {
          /* ignore */
        }
      }
    }
  }, 30_000);

  test("拒绝任意本地路径作为 references", async () => {
    const res = await callTool(
      "generate_with_media_plugin",
      {
        kind: "image",
        pluginId: "mcp_demo_img",
        prompt: "path escape",
        references: ["C:\\\\Users\\\\evil\\\\secret.png"],
      },
      15,
    );
    expect(res.result?.isError).toBe(true);
    expect(toolText(res)).toMatch(/素材 ID|路径|reference/i);
  });

  test("拒绝类型不匹配的参考素材", async () => {
    const audioId = insertAudioMaterial();
    const res = await callTool(
      "generate_with_media_plugin",
      {
        kind: "image",
        pluginId: "mcp_demo_img",
        prompt: "mismatch ref",
        references: [audioId],
      },
      16,
    );
    expect(res.result?.isError).toBe(true);
    expect(toolText(res)).toMatch(/图片参考|audio|不匹配|仅接受/i);
  });

  test("拒绝未知参数", async () => {
    const res = await callTool(
      "generate_with_media_plugin",
      {
        kind: "image",
        pluginId: "mcp_demo_img",
        prompt: "unknown param",
        params: { not_a_real_param: "x" },
      },
      17,
    );
    expect(res.result?.isError).toBe(true);
    expect(toolText(res)).toMatch(/未知参数|not_a_real_param/i);
  });

  test("合法素材 ID 参考可通过校验并入队", async () => {
    const imageId = insertImageMaterial();
    let jobIds: string[] = [];
    try {
      const created = await callTool(
        "generate_with_media_plugin",
        {
          kind: "image",
          pluginId: "mcp_demo_img",
          prompt: "with image ref",
          references: [imageId],
          params: { size: "1024x1024" },
        },
        18,
      );
      expect(created.result?.isError).toBeFalsy();
      const data = toolData(created);
      if (Array.isArray(data?.jobIds)) jobIds = trackJobs(data.jobIds as string[]);
      expect(data.jobId).toBeTruthy();
    } finally {
      for (const id of jobIds) {
        try {
          cancelJob(id);
        } catch {
          /* ignore */
        }
      }
      for (const id of jobIds) {
        try {
          await waitForJobTerminal(id);
        } catch {
          /* ignore */
        }
      }
    }
  }, 30_000);
});
