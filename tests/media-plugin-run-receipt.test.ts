import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactMediaPluginRunDir } from "../apps/server/src/mediaPlugins/runner";

describe("media plugin terminal receipt", () => {
  test("keeps only bounded recovery receipt files", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-media-receipt-"));
    try {
      writeFileSync(join(root, "request.json"), JSON.stringify({
        prompt: "private prompt",
        params: { api_key: "secret", steps: 4 },
        imageUrls: ["file:///C:/private/reference.png"],
      }));
      writeFileSync(join(root, "result.json"), JSON.stringify({
        ok: true,
        result: { url: "https://example.invalid/result", metadata: { token: "secret" } },
      }));
      writeFileSync(join(root, "comfy-journal.json"), JSON.stringify({
        status: "completed",
        clientId: "client",
        requestId: "request",
        promptId: "prompt",
        output: { filename: "result.mp4", type: "output", subfolder: "safe" },
        api_key: "secret",
        prompt: "private prompt",
        localPath: "C:/private/result.mp4",
      }));
      writeFileSync(join(root, "result.mp4"), Buffer.alloc(1024 * 1024, 2));
      mkdirSync(join(root, "nested"));
      writeFileSync(join(root, "nested", "artifact.bin"), "artifact");

      compactMediaPluginRunDir(root, {
        jobId: "job-1",
        status: "done",
        materialIds: ["material-1"],
      });

      const request = JSON.parse(readFileSync(join(root, "request.json"), "utf8"));
      const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
      const journal = JSON.parse(readFileSync(join(root, "comfy-journal.json"), "utf8"));
      expect(request).toEqual({
        schema: "framebaker.media-plugin-terminal-request-v1",
        jobId: "job-1",
      });
      expect(result).toEqual({
        schema: "framebaker.media-plugin-terminal-result-v1",
        jobId: "job-1",
        status: "done",
        materialIds: ["material-1"],
      });
      expect(journal).toEqual({
        status: "completed",
        promptId: "prompt",
        output: { filename: "result.mp4", type: "output", subfolder: "safe" },
      });
      expect(JSON.stringify({ request, result, journal })).not.toMatch(/secret|private prompt|C:\/private|example\.invalid/i);
      expect(existsSync(join(root, "result.mp4"))).toBe(false);
      expect(existsSync(join(root, "nested"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps receipts below the recovery size limit and drops unsafe journal paths", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-media-receipt-bound-"));
    try {
      writeFileSync(join(root, "comfy-journal.json"), JSON.stringify({
        status: "completed",
        promptId: "prompt",
        output: { filename: "C:\\private\\result.mp4", type: "output", subfolder: "../private" },
      }));
      compactMediaPluginRunDir(root, {
        jobId: "job-bound",
        status: "done",
        materialIds: Array.from({ length: 1024 }, (_, index) => `material-${index}-${"x".repeat(100)}`),
      });

      const resultPath = join(root, "result.json");
      const result = JSON.parse(readFileSync(resultPath, "utf8"));
      const journal = JSON.parse(readFileSync(join(root, "comfy-journal.json"), "utf8"));
      expect(statSync(resultPath).size).toBeLessThanOrEqual(64 * 1024);
      expect(result.materialIds).toEqual([]);
      expect(journal).toEqual({ status: "completed", promptId: "prompt" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("never downgrades an existing successful terminal receipt", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-media-receipt-monotonic-"));
    try {
      writeFileSync(join(root, "request.json"), JSON.stringify({
        schema: "framebaker.media-plugin-terminal-request-v1", jobId: "job-success",
      }));
      writeFileSync(join(root, "result.json"), JSON.stringify({
        schema: "framebaker.media-plugin-terminal-result-v1",
        jobId: "job-success",
        status: "done",
        materialIds: ["material-success"],
      }));
      writeFileSync(join(root, "comfy-journal.json"), JSON.stringify({
        status: "completed", promptId: "known-success", output: { filename: "result.mp4" },
      }));

      expect(compactMediaPluginRunDir(root, { jobId: "job-success", status: "error" })).toBe(true);
      expect(JSON.parse(readFileSync(join(root, "result.json"), "utf8"))).toEqual({
        schema: "framebaker.media-plugin-terminal-result-v1",
        jobId: "job-success",
        status: "done",
        materialIds: ["material-success"],
      });
      expect(JSON.parse(readFileSync(join(root, "comfy-journal.json"), "utf8"))).toMatchObject({
        status: "completed", promptId: "known-success",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("preserves the known journal when terminal receipt creation fails", () => {
    const root = mkdtempSync(join(tmpdir(), "framebaker-media-receipt-failure-"));
    try {
      const journalPath = join(root, "comfy-journal.json");
      writeFileSync(journalPath, JSON.stringify({
        status: "completed", promptId: "known-before-failure", output: { filename: "result.mp4" },
      }));
      mkdirSync(join(root, "result.json.tmp"));

      expect(compactMediaPluginRunDir(root, { jobId: "job-failure", status: "done", materialIds: ["material"] })).toBe(false);
      expect(JSON.parse(readFileSync(journalPath, "utf8"))).toMatchObject({
        status: "completed", promptId: "known-before-failure",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
