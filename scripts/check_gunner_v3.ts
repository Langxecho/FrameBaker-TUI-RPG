/** Run the shared v3 builder for the GUN-05 draft without publishing a release. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const base = new URL(process.env.FRAMEBAKER_URL ?? "http://127.0.0.1:3025");
const statePath = resolve("storage/aic-runs/gunner-draft-20260928/recipe-state.json");
if (!existsSync(statePath)) throw new Error("枪手草稿检查点不存在");
const { projectId } = JSON.parse(readFileSync(statePath, "utf8")) as { projectId?: string };
if (!projectId) throw new Error("枪手草稿缺少 projectId");
const response = await fetch(new URL("/mcp", base), {
  method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "aic_publish_v3", arguments: { projectId } } }),
});
const body = await response.text();
const line = body.split("\n").find((item) => item.startsWith("data: "));
const envelope = JSON.parse(line ? line.slice(6) : body);
if (envelope.error || envelope.result?.isError) throw new Error(envelope.result?.content?.[0]?.text ?? envelope.error?.message ?? "aic_publish_v3 failed");
const content = envelope.result?.content?.find((item: any) => item.type === "text")?.text;
if (!content) throw new Error("aic_publish_v3 returned no structured content");
const artifact = JSON.parse(content);
writeFileSync(resolve("storage/aic-runs/gunner-weapons-20260929/v3-receipt.json"), JSON.stringify({ projectId, artifact, status: "built-not-released" }, null, 2));
console.log(JSON.stringify({ projectId, artifact, status: "built-not-released" }, null, 2));
