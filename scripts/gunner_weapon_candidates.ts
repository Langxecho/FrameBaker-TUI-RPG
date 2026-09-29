/** Qwen 独立枪械候选生成；只走公开 MCP，按共享 Comfy 租约串行执行。 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const base = new URL(process.argv.find((arg) => arg.startsWith("--url="))?.slice(6) ?? "http://127.0.0.1:3025");
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password) throw new Error("仅允许本地制作服务");
const out = resolve(process.argv.find((arg) => arg.startsWith("--out="))?.slice(6) ?? "storage/aic-runs/gunner-weapons-20260929");
mkdirSync(out, { recursive: true });
const referenceMaterialId = "7d6a605c-585a-4366-85a5-5e0f954b79b6";
const referenceSha256 = "89f90c42fdd90ccbf40f519a5efaa2041ad254caadbe0fafd9ba1399cabcee58";
let requestId = 1;
async function mcp(name: string, args: Record<string, unknown>): Promise<any> {
  const response = await fetch(new URL("/mcp", base), {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: requestId++, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = await response.text();
  const line = body.split("\n").find((item) => item.startsWith("data: "));
  const envelope = JSON.parse(line ? line.slice(6) : body);
  if (envelope.error || envelope.result?.isError) throw new Error(`${name} failed`);
  const content = envelope.result?.content?.find((item: any) => item.type === "text")?.text;
  if (!content) throw new Error(`${name} returned no structured content`);
  return JSON.parse(content);
}
function sha(path: string): string | null {
  return existsSync(path) ? createHash("sha256").update(readFileSync(path)).digest("hex") : null;
}
const plugin = await mcp("get_media_plugin", { kind: "image", pluginId: "qwen_image_2_1" });
if (!plugin.plugin?.runnable) throw new Error("qwen_image_2_1 is not runnable");
const jobs = await mcp("list_jobs", {});
if (jobs.jobs?.some((job: any) => job.status === "queued" || job.status === "running")) throw new Error("已有 queued/running 任务，拒绝提交");
const candidates = [
  {
    id: "fission_projector",
    seed: 2609291,
    prompt: "Use case: stylized-concept. Asset type: standalone game weapon sprite candidate for a 320x180 pixel-art battle scene. Input image: Image 1 is a style reference only; do not copy its person, clothing, body, or silhouette. Subject: one complete fission projector weapon, shown alone in a clean side profile facing right. It is a broad ring-shaped segmented emitter with a heavy cyberpunk launcher body, clearly readable separated emitter segments, orange and violet energy windows, chunky industrial paneling, and a distinct muzzle. Composition: one centered full weapon with 20% clear margin on every side, no cropping. Style: rough bold black outline, cyberpunk pixel-art concept, crisp blocky color shapes, readable when downscaled to 320x180. Background: flat pure magenta #ff00ff for deterministic keying. No hands, no character, no text, no logo, no watermark, no extra weapons, no floating debris.",
  },
  {
    id: "phase_piercer",
    seed: 2609292,
    prompt: "Use case: stylized-concept. Asset type: standalone game weapon sprite candidate for a 320x180 pixel-art battle scene. Input image: Image 1 is a style reference only; do not copy its person, clothing, body, or silhouette. Subject: one complete phase piercer weapon, shown alone in a clean side profile facing right. It has a long axial rifle body, unmistakable straight linear guide rails, a precise piercing muzzle, restrained mechanical details, and a sharp white-cyan point light at the muzzle. Composition: one centered full weapon with 20% clear margin on every side, no cropping. Style: rough bold black outline, cyberpunk pixel-art concept, crisp blocky color shapes, readable when downscaled to 320x180. Background: flat pure magenta #ff00ff for deterministic keying. No hands, no character, no text, no logo, no watermark, no extra weapons, no floating debris.",
  },
];
const records: any[] = [];
for (const candidate of candidates) {
  const started = Date.now();
  const result = await mcp("generate_with_media_plugin", {
    kind: "image", pluginId: "qwen_image_2_1", prompt: candidate.prompt,
    references: [referenceMaterialId], count: 1, name: `gunner weapon candidate ${candidate.id}`,
    idempotencyKey: `gunner-weapon-${candidate.id}-20260929-seed${candidate.seed}`,
    params: { seed: candidate.seed, batch_size: 1, aspect_ratio: "1:1", transparent_alpha: false, preserve_reference_size: false, megapixels: 2.2, dimension_multiple: 32, steps: 40, cfg: 1, denoise: 1 },
  });
  const jobId = result.jobId;
  let job: any;
  for (;;) {
    job = (await mcp("get_job", { jobId })).job;
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (job.status !== "done") throw new Error(`${candidate.id} job ${jobId} ended ${job.status}`);
  const match = String(job.progress ?? "").match(/materialIds=\[\\?"([^"\\]+)"/);
  const materialId = match?.[1];
  const imagePath = materialId ? resolve("storage", "materials", materialId, "raw.png") : null;
  records.push({ ...candidate, model: "qwen_image_2_1", pluginId: "qwen_image_2_1", referenceMaterialId, referenceSha256, jobId, materialId, imagePath, imageSha256: imagePath ? sha(imagePath) : null, startedAt: new Date(started).toISOString(), finishedAt: new Date().toISOString(), elapsedMs: Date.now() - started, retryCount: job.run_attempt ?? 1, status: job.status });
  writeFileSync(join(out, `${candidate.id}.json`), JSON.stringify(records.at(-1), null, 2));
}
writeFileSync(join(out, "generation-record.json"), JSON.stringify({ model: "qwen_image_2_1", pluginId: "qwen_image_2_1", referenceMaterialId, referenceSha256, records }, null, 2));
console.log(JSON.stringify({ status: "done", out, records }, null, 2));
