import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import type { Material } from "@framebaker/shared";
import { db, getMaterial, STORAGE_ROOT, uid } from "../db";
import { resolveMediaPythonExecutable } from "../mediaPlugins/pythonEnv";

const SCRIPT = join(import.meta.dir, "..", "python", "skeletal_split.py");
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const MAX_PARTS = 64;
const IDEMPOTENCY_TABLE = "skeletal_split_idempotency";
db.exec(`CREATE TABLE IF NOT EXISTS ${IDEMPOTENCY_TABLE} (source_material_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, input_hash TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (source_material_id, idempotency_key))`);

export type SkeletalSplitPart = { name: string; cell: number };
export type SkeletalSplitInput = { materialId: string; rows: number; cols: number; keyColor?: [number, number, number]; tolerance?: number; magentaDespill?: number; parts: SkeletalSplitPart[]; idempotencyKey?: string };
export type SkeletalSplitResult = { parts: Array<SkeletalSplitPart & { materialId: string; width: number; height: number; bounds: { x: number; y: number; w: number; h: number }; opaquePixels: number }>; sourceSha256: string };

function fail(message: string): never { throw new Error(message); }
function hash(bytes: Uint8Array): string { return new Bun.CryptoHasher("sha256").update(bytes).digest("hex"); }
function canonicalInput(input: SkeletalSplitInput, sourceSha256: string): string { return JSON.stringify({ sourceSha256, rows: input.rows, cols: input.cols, keyColor: input.keyColor ?? [255, 0, 255], tolerance: input.tolerance ?? 24, ...((input.magentaDespill ?? 0) > 0 ? { magentaDespill: input.magentaDespill } : {}), parts: input.parts }); }
function validate(input: SkeletalSplitInput): void {
  if (!Number.isInteger(input.rows) || input.rows < 1 || input.rows > 8 || !Number.isInteger(input.cols) || input.cols < 1 || input.cols > 8) fail("rows/cols must be integers from 1 to 8");
  if (!Array.isArray(input.parts) || input.parts.length < 1 || input.parts.length > MAX_PARTS) fail("parts must contain 1..64 entries");
  const cells = new Set<number>();
  for (const part of input.parts) {
    if (!part || typeof part.name !== "string" || !part.name.trim() || part.name.length > 200) fail("part name is invalid");
    if (!Number.isInteger(part.cell) || part.cell < 0 || part.cell >= input.rows * input.cols || cells.has(part.cell)) fail("part cell must be unique and within the grid");
    cells.add(part.cell);
  }
  const color = input.keyColor ?? [255, 0, 255];
  if (!Array.isArray(color) || color.length !== 3 || color.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) fail("keyColor must be RGB bytes");
  if (!Number.isInteger(input.tolerance ?? 24) || (input.tolerance ?? 24) < 0 || (input.tolerance ?? 24) > 255) fail("tolerance must be 0..255");
  if (!Number.isInteger(input.magentaDespill ?? 0) || (input.magentaDespill ?? 0) < 0 || (input.magentaDespill ?? 0) > 100) fail("magentaDespill must be 0..100");
  if ((input.magentaDespill ?? 0) > 0 && (color[0] !== 255 || color[1] !== 0 || color[2] !== 255)) fail("magentaDespill requires keyColor [255,0,255]");
  if (input.idempotencyKey && (input.idempotencyKey.length < 1 || input.idempotencyKey.length > 200)) fail("idempotencyKey must be 1..200 characters");
}

async function runPython(sourcePath: string, requestPath: string, _outputDir: string): Promise<any> {
  const python = resolveMediaPythonExecutable();
  const proc = Bun.spawn([python, SCRIPT, "--input", sourcePath, "--request", requestPath], { cwd: resolve(import.meta.dir, "..", "..", ".."), stdout: "pipe", stderr: "pipe", env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" } });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`skeletal splitter failed: ${stderr.slice(-500)}`);
  const result = JSON.parse(stdout) as { ok?: boolean; error?: string; parts?: unknown[] };
  if (!result.ok) throw new Error(result.error || "skeletal splitter failed");
  return result;
}

export async function splitSkeletalMaterial(input: SkeletalSplitInput): Promise<SkeletalSplitResult> {
  validate(input);
  const material = getMaterial(input.materialId) as Material | null;
  if (!material) fail("素材不存在");
  const sourcePath = material.processed_path && existsSync(material.processed_path) ? material.processed_path : material.raw_path;
  if (!sourcePath || !existsSync(sourcePath) || !/\.(png|jpe?g|webp)$/i.test(sourcePath)) fail("只支持 PNG/JPEG/WebP 图片素材");
  const resolvedSource = resolve(sourcePath);
  if (!resolvedSource.startsWith(resolve(STORAGE_ROOT) + "\\") && !resolvedSource.startsWith(resolve(STORAGE_ROOT) + "/")) fail("素材路径不在存储根目录内");
  if (statSync(resolvedSource).size > MAX_SOURCE_BYTES) fail("源图片超过 50MB 限制");
  const sourceBytes = readFileSync(resolvedSource);
  const sourceSha256 = hash(sourceBytes);
  const inputHash = hash(new TextEncoder().encode(canonicalInput(input, sourceSha256)));
  const key = input.idempotencyKey?.trim();
  if (key) {
    const prior = db.query(`SELECT input_hash, result FROM ${IDEMPOTENCY_TABLE} WHERE source_material_id=? AND idempotency_key=?`).get(input.materialId, key) as { input_hash: string; result: string } | null;
    if (prior) {
      if (prior.input_hash !== inputHash) fail("幂等键已用于不同的分件请求");
      return JSON.parse(prior.result) as SkeletalSplitResult;
    }
  }
  const workDir = join(STORAGE_ROOT, "staging", `skeletal-split-${uid()}`);
  mkdirSync(workDir, { recursive: true });
  const requestPath = join(workDir, "request.json");
  writeFileSync(requestPath, JSON.stringify({ rows: input.rows, cols: input.cols, keyColor: input.keyColor ?? [255, 0, 255], tolerance: input.tolerance ?? 24, magentaDespill: input.magentaDespill ?? 0, parts: input.parts }), "utf8");
  const decoded = await runPython(resolvedSource, requestPath, workDir) as { parts: Array<{ cell: number; width: number; height: number; bounds: { x: number; y: number; w: number; h: number }; opaquePixels: number; pngBase64: string }> };
  const prepared: Array<{ id: string; path: string; bytes: Uint8Array; part: SkeletalSplitPart; decoded: typeof decoded.parts[number] }> = [];
  let totalBytes = 0;
  try {
    for (const [index, part] of input.parts.entries()) {
      const item = decoded.parts[index];
      if (!item || item.cell !== part.cell) fail("splitter returned mismatched cells");
      const bytes = Uint8Array.from(Buffer.from(item.pngBase64, "base64"));
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_OUTPUT_BYTES) fail("split output exceeds 32MB limit");
      const id = uid();
      const dir = join(STORAGE_ROOT, "materials", id);
      const path = join(dir, "raw.png");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, bytes);
      prepared.push({ id, path, bytes, part, decoded: item });
    }
    const insert = db.query("INSERT INTO materials (id,name,raw_path,status,source,folder_id,metadata,created_at) VALUES (?,?,?,'raw','skeletal-split',?,?,?)");
    const result: SkeletalSplitResult = { sourceSha256, parts: prepared.map(({ id, part, decoded }) => ({ ...part, materialId: id, width: decoded.width, height: decoded.height, bounds: decoded.bounds, opaquePixels: decoded.opaquePixels })) };
    db.transaction(() => {
      for (const item of prepared) insert.run(item.id, `${material.name || "角色"} · ${item.part.name}`, item.path, material.folder_id, JSON.stringify({ sourceMaterialId: input.materialId, sourceSha256, rows: input.rows, cols: input.cols, keyColor: input.keyColor ?? [255, 0, 255], tolerance: input.tolerance ?? 24, ...((input.magentaDespill ?? 0) > 0 ? { magentaDespill: input.magentaDespill } : {}), cell: item.part.cell, bounds: item.decoded.bounds, opaquePixels: item.decoded.opaquePixels }), Date.now());
      if (key) db.query(`INSERT INTO ${IDEMPOTENCY_TABLE} (source_material_id,idempotency_key,input_hash,result,created_at) VALUES (?,?,?,?,?)`).run(input.materialId, key, inputHash, JSON.stringify(result), Date.now());
    })();
    return result;
  } catch (error) {
    for (const item of prepared) { try { rmSync(join(STORAGE_ROOT, "materials", item.id), { recursive: true, force: true }); } catch {} }
    throw error;
  }
}
