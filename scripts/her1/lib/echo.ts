import type { MotionClip } from "../../../packages/shared/src/animation";
import type { SkeletalProjectDocument } from "../../../packages/shared/src/skeletalProject";

export interface ToolResult {
  isError: boolean;
  texts: string[];
  /** 第一段 text 若为 JSON 则解析；失败为 undefined。 */
  json: unknown;
  images: Array<{ mimeType: string; data: Uint8Array }>;
}

export interface ToolInfo { name: string; description?: string; inputSchema?: unknown }

/** 最小 Streamable HTTP MCP 客户端：initialize → notifications/initialized → tools/list / tools/call。 */
export class McpClient {
  private sessionId: string | null = null;
  private protocolVersion = "2025-06-18";
  private nextId = 1;
  private initialized = false;

  constructor(readonly url: string) {}

  private async post(body: unknown): Promise<Response> {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;
    if (this.initialized) headers["mcp-protocol-version"] = this.protocolVersion;
    const response = await fetch(this.url, { method: "POST", headers, body: JSON.stringify(body) });
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    return response;
  }

  private async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const response = await this.post({ jsonrpc: "2.0", id, method, params });
    if (!response.ok) throw new Error(`MCP ${method} HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
    const type = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const messages: Array<{ id?: number; result?: unknown; error?: { code: number; message: string } }> = [];
    if (type.includes("text/event-stream")) {
      for (const block of text.split(/\r?\n\r?\n/)) {
        const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
        if (data) messages.push(JSON.parse(data));
      }
    } else if (text.trim()) {
      const parsed = JSON.parse(text);
      messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    }
    const match = messages.find((message) => message.id === id);
    if (!match) throw new Error(`MCP ${method} 没有返回 id=${id} 的响应`);
    if (match.error) throw new Error(`MCP ${method} 错误 ${match.error.code}: ${match.error.message}`);
    return match.result;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const result = await this.request("initialize", { protocolVersion: this.protocolVersion, capabilities: {}, clientInfo: { name: "framebaker-her1-runner", version: "1" } }) as { protocolVersion?: string };
    if (result?.protocolVersion) this.protocolVersion = result.protocolVersion;
    this.initialized = true;
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async listTools(): Promise<ToolInfo[]> {
    await this.initialize();
    const result = await this.request("tools/list", {}) as { tools?: ToolInfo[] };
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    await this.initialize();
    const result = await this.request("tools/call", { name, arguments: args }) as { isError?: boolean; content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };
    const texts = (result?.content ?? []).filter((item) => item.type === "text").map((item) => item.text ?? "");
    const images = (result?.content ?? []).filter((item) => item.type === "image" && item.data).map((item) => ({ mimeType: item.mimeType ?? "image/png", data: Uint8Array.from(Buffer.from(item.data!, "base64")) }));
    let json: unknown;
    if (texts[0]) try { json = JSON.parse(texts[0]); } catch { json = undefined; }
    return { isError: !!result?.isError, texts, json, images };
  }

  /** 调用并要求成功，返回解析后的 JSON。 */
  async callJson<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await this.callTool(name, args);
    if (result.isError) throw new Error(`${name} 返回错误：${result.texts.join("\n").slice(0, 800)}`);
    return result.json as T;
  }
}

export function apiBaseFromMcp(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  return `${url.protocol}//${url.host}`;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`GET ${url} HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  return await response.json() as T;
}

export async function fetchDocument(apiBase: string, projectId: string): Promise<SkeletalProjectDocument> {
  const body = await getJson<{ document: SkeletalProjectDocument }>(`${apiBase}/api/projects/${encodeURIComponent(projectId)}/skeletal-document`);
  return body.document;
}

export async function fetchClip(apiBase: string, clipId: string): Promise<MotionClip> {
  const body = await getJson<{ animationAsset: { asset: MotionClip } }>(`${apiBase}/api/animation-assets/${encodeURIComponent(clipId)}`);
  if (body.animationAsset.asset.kind !== "motion-clip") throw new Error(`${clipId} 不是 MotionClip`);
  return body.animationAsset.asset;
}

export async function uploadMaterial(apiBase: string, png: Uint8Array, fileName: string, metadata: Record<string, unknown>): Promise<string> {
  const form = new FormData();
  form.append("file", new File([png], fileName, { type: "image/png" }));
  form.append("metadata", JSON.stringify(metadata));
  const response = await fetch(`${apiBase}/api/materials/upload`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`素材上传失败 HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);
  const body = await response.json() as { materialId?: string };
  if (!body.materialId) throw new Error("素材上传没有返回 materialId");
  return body.materialId;
}

/** 从 `aic_get_project_summary` 读取 revision；ECHO 服务与 GitHub 分支的摘要形状一致包含 revision。 */
export async function currentRevision(client: McpClient, projectId: string): Promise<number> {
  const summary = await client.callJson<{ revision?: number }>("aic_get_project_summary", { projectId, attachmentLimit: 1, boneLimit: 1 });
  if (typeof summary?.revision !== "number") throw new Error("aic_get_project_summary 没有返回 revision");
  return summary.revision;
}
