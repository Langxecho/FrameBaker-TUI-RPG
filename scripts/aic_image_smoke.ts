/** 用户指定 Qwen 插件的本地复验；固定幂等键，不盲目重发生成。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const directory = "storage/aic-runs/image-return-smoke-v1";
mkdirSync(directory, { recursive: true });
const receipt = join(directory, "job.json");
const prior = existsSync(receipt) ? JSON.parse(readFileSync(receipt, "utf8")) : null;
const request = {
  kind: "image", pluginId: "qwen_image_2_1",
  prompt: "One small silver short sword with a dark brown grip, side view, strict pixel art, centered upright in a square image with generous empty margins and a completely flat magenta background. No character, hands, text, shadow, labels, grid or extra objects. This is an isolated equipment appearance test, not a gameplay definition.",
  params: { aspect_ratio: "1:1", megapixels: 0.3, steps: 4, seed: 260926, batch_size: 1,
    enhancer_max_tokens: 1024, enhancer_retry_count: 1, enhancer_timeout: 90 },
  name: "AIC D1 Comfy video-to-image return smoke",
  idempotencyKey: "aic-d1-qwen-return-after-h3-v1",
};
const response = await fetch("http://127.0.0.1:3025/mcp", {
  method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
    name: prior ? "get_job" : "generate_with_media_plugin", arguments: prior ? { jobId: prior.jobId } : request,
  } }), signal: AbortSignal.timeout(30_000),
});
const body = await response.text();
const line = body.split("\n").find((item) => item.startsWith("data: "));
const envelope = JSON.parse(line ? line.slice(6) : body);
if (!response.ok || envelope.error || envelope.result?.isError) throw new Error(JSON.stringify(envelope));
const value = JSON.parse(envelope.result.content[0].text);
if (!prior) writeFileSync(receipt, JSON.stringify({ jobId: value.jobId, createdAt: new Date().toISOString(),
  request, claim: "shared-runtime switch integration; not character or equipment combat qualification" }, null, 2), { flag: "wx" });
console.log(JSON.stringify(value));
