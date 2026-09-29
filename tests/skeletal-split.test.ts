import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { db, STORAGE_ROOT, getMaterial } from "../apps/server/src/db";
import { splitSkeletalMaterial } from "../apps/server/src/jobs/skeletalSplit";
import { resolveMediaPythonExecutable } from "../apps/server/src/mediaPlugins/pythonEnv";

const png = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
const fringePng = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAMElEQVR4nGP8z/D/PwMaYAIRgQGBDAs1pq8D0XBBEDjy7VwQikoQeGP0Bq6dEZuZAGV6DtkU7I5cAAAAAElFTkSuQmCC", "base64"));
const ids: string[] = [];

async function pixels(path: string): Promise<number[][]> {
  const proc = Bun.spawn([resolveMediaPythonExecutable(), "-c", "from PIL import Image; import json,sys; print(json.dumps(list(Image.open(sys.argv[1]).convert('RGBA').getdata())))", path], { stdout: "pipe", stderr: "pipe" });
  const output = await new Response(proc.stdout).text();
  expect(await proc.exited).toBe(0);
  return JSON.parse(output);
}

afterEach(() => {
  for (const id of ids.splice(0)) {
    db.query("DELETE FROM materials WHERE id=?").run(id);
    rmSync(join(STORAGE_ROOT, "materials", id), { recursive: true, force: true });
  }
});

describe("skeletal material splitter", () => {
  test("rejects duplicate or out-of-range cells before image processing", async () => {
    await expect(splitSkeletalMaterial({ materialId: "missing", rows: 1, cols: 1, parts: [{ name: "a", cell: 0 }, { name: "b", cell: 0 }] })).rejects.toThrow("unique");
    await expect(splitSkeletalMaterial({ materialId: "missing", rows: 1, cols: 1, parts: [{ name: "a", cell: 1 }] })).rejects.toThrow("unique");
  });

  test("splits a material by material id and records source closure", async () => {
    const id = crypto.randomUUID();
    ids.push(id);
    const dir = join(STORAGE_ROOT, "materials", id);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "raw.png");
    writeFileSync(path, png);
    db.query("INSERT INTO materials (id,name,raw_path,status,source,metadata,created_at) VALUES (?,?,?,'raw','upload','{}',?)").run(id, "reference", path, Date.now());
    const result = await splitSkeletalMaterial({ materialId: id, rows: 1, cols: 1, parts: [{ name: "body", cell: 0 }], idempotencyKey: "split-once" });
    expect(result.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.parts).toHaveLength(1);
    ids.push(result.parts[0]!.materialId);
    const child = getMaterial(result.parts[0]!.materialId)!;
    expect(child.source).toBe("skeletal-split");
    expect(JSON.parse(child.metadata).sourceMaterialId).toBe(id);
    expect((await splitSkeletalMaterial({ materialId: id, rows: 1, cols: 1, parts: [{ name: "body", cell: 0 }], idempotencyKey: "split-once" })).parts[0]!.materialId).toBe(result.parts[0]!.materialId);
  }, 20_000);

  test("despills keyed-edge magenta only while preserving alpha, bounds, and default output", async () => {
    const id = crypto.randomUUID();
    ids.push(id);
    const dir = join(STORAGE_ROOT, "materials", id);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "raw.png");
    writeFileSync(path, fringePng);
    db.query("INSERT INTO materials (id,name,raw_path,status,source,metadata,created_at) VALUES (?,?,?,'raw','upload','{}',?)").run(id, "fringe", path, Date.now());
    const base = { materialId: id, rows: 1, cols: 1, tolerance: 24, parts: [{ name: "body", cell: 0 }] };
    const original = await splitSkeletalMaterial({ ...base, idempotencyKey: "despill-option" });
    ids.push(original.parts[0]!.materialId);
    const unchanged = await splitSkeletalMaterial({ ...base, magentaDespill: 0, idempotencyKey: "despill-option" });
    expect(unchanged.parts[0]!.materialId).toBe(original.parts[0]!.materialId);
    await expect(splitSkeletalMaterial({ ...base, magentaDespill: 100, idempotencyKey: "despill-option" })).rejects.toThrow("幂等键");
    const corrected = await splitSkeletalMaterial({ ...base, magentaDespill: 100 });
    ids.push(corrected.parts[0]!.materialId);
    expect(corrected.parts[0]!.bounds).toEqual(original.parts[0]!.bounds);
    expect(corrected.parts[0]!.opaquePixels).toBe(original.parts[0]!.opaquePixels);
    const before = await pixels(getMaterial(original.parts[0]!.materialId)!.raw_path!);
    const after = await pixels(getMaterial(corrected.parts[0]!.materialId)!.raw_path!);
    expect(before[1]).toEqual([160, 40, 150, 173]);
    expect(after[1]).toEqual([50, 40, 40, 173]);
    expect(after[4]).toEqual(before[4]);
    expect(after.map((pixel) => pixel[3])).toEqual(before.map((pixel) => pixel[3]));
    expect(JSON.parse(getMaterial(corrected.parts[0]!.materialId)!.metadata).magentaDespill).toBe(100);
    expect(JSON.parse(getMaterial(original.parts[0]!.materialId)!.metadata).magentaDespill).toBeUndefined();
  }, 30_000);

  test("rejects invalid or non-magenta despill settings", async () => {
    const base = { materialId: "missing", rows: 1, cols: 1, parts: [{ name: "body", cell: 0 }] };
    await expect(splitSkeletalMaterial({ ...base, magentaDespill: 101 })).rejects.toThrow("0..100");
    await expect(splitSkeletalMaterial({ ...base, magentaDespill: 50, keyColor: [0, 255, 0] })).rejects.toThrow("requires keyColor");
  });
});
