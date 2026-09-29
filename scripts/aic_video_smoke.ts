/** Real plugin-switch smoke using an existing material; never blindly retries. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const materialId = process.argv[2];
if (!materialId || /[\\/:]/.test(materialId)) throw new Error("Pass one existing FrameBaker material ID");
const attempt = process.argv[3] ?? "v1";
if (!/^[a-z0-9-]{1,40}$/.test(attempt)) throw new Error("Attempt must be a safe identifier");
const dir = `storage/aic-runs/video-smoke-${attempt}`;
mkdirSync(dir, { recursive: true });
const file = join(dir, "job.json");
const prior = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
if (prior && prior.materialId !== materialId) throw new Error("Existing smoke belongs to a different reference");
const prompt = `For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Pixel-art production reference, a static orthographic view preserves the sixteen separated character parts in the exact four-by-four grid shown in Picture 1. Each part remains in its own cell against the flat magenta background; preserve the teal clothing, dark trousers, brown boots, short brown hair and silver short sword. From 0.00 to 1.00 seconds hold the grid still. From 1.00 to 3.00 seconds the sword in the top-right cell rotates five degrees clockwise then back, keeping its grip point and staying fully inside its cell; all other parts stay fixed. From 3.00 to 4.00 seconds hold the original arrangement. The camera remains entirely static, with no zoom, perspective change, cuts, added text or new objects.

overall_soundscape: Quiet room tone with one very faint metallic swish synchronized to the sword movement; no speech.

non_diegetic_music: N/A`;
const args = prior ? { jobId: prior.jobId } : { kind: "video", pluginId: "minimax-h3-t8-i2v", prompt, references: [materialId], params: { seed: 260926, steps: 4, durationSeconds: 4 }, durationSeconds: 4, name: "AIC D1 plugin residency smoke", idempotencyKey: `aic-h3-plugin-switch-smoke-${attempt}` };
const response = await fetch("http://127.0.0.1:3025/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: prior ? "get_job" : "generate_with_media_plugin", arguments: args } }), signal: AbortSignal.timeout(30_000) });
const text = await response.text();
const line = text.split("\n").find((s) => s.startsWith("data: "));
const result = JSON.parse(line ? line.slice(6) : text);
if (!response.ok || result.error || result.result?.isError) throw new Error(JSON.stringify(result));
const value = JSON.parse(result.result.content[0].text);
if (!prior) {
  writeFileSync(`${file}.tmp`, JSON.stringify({ materialId, jobId: value.jobId, createdAt: new Date().toISOString(), prompt, parameters: args.params, claim: "plugin integration only, not skeletal animation acceptance" }, null, 2));
  renameSync(`${file}.tmp`, file);
}
console.log(JSON.stringify(value));
