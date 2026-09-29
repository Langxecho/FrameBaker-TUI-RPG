import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { db } from "../../db";
import { cancelJob, recoverKnownMediaPluginJob } from "../../queue";
import { ok, err } from "../helpers";

export function register(server: McpServer) {
  server.registerTool(
    "list_jobs",
    {
      title: "List Jobs",
      description:
        "List recent jobs (up to 50, newest first). Each job has id, project_id, type (extract_frames/generate_frames/matting/image_layers), status (queued/running/done/error/cancelled), progress, error, and created_at.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      const jobs = db.query("SELECT id,project_id,type,status,progress,error,created_at,updated_at,run_attempt,execution_phase FROM jobs ORDER BY created_at DESC LIMIT 50").all();
      return ok({ jobs });
    }
  );

  server.registerTool(
    "get_job",
    {
      title: "Get Job",
      description: "Get the status of a single job by id. Use this to poll async jobs (generate, extract, matting, image layers).",
      inputSchema: z.object({
        jobId: z.string().describe("Job UUID"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ jobId }) => {
      const job = db.query("SELECT id,project_id,type,status,progress,error,created_at,updated_at,run_attempt,execution_phase FROM jobs WHERE id = ?").get(jobId);
      if (!job) return err("任务不存在");
      return ok({ job });
    }
  );

  server.registerTool(
    "cancel_job",
    {
      title: "Cancel Job",
      description:
        "Cancel a queued or running job. Queued jobs are removed immediately; running jobs receive an abort signal (kills subprocess/API polling). Returns error if job already finished.",
      inputSchema: z.object({
        jobId: z.string().describe("Job UUID"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ jobId }) => {
      const job = db.query("SELECT id, status FROM jobs WHERE id = ?").get(jobId) as
        | { id: string; status: string }
        | null;
      if (!job) return err("任务不存在");
      if (job.status !== "queued" && job.status !== "running") {
        return err(`任务状态为 ${job.status}，无法取消`);
      }
      if (!cancelJob(jobId)) return err("取消失败");
      return ok({ ok: true });
    }
  );

  server.registerTool(
    "recover_known_media_job",
    {
      title: "Recover Known Media Job",
      description:
        "Requeue the same failed media-plugin job only when its persisted Comfy journal proves a known submitted or completed prompt. This never creates a new job or submits a new prompt. The installed plugin must support FrameBaker's Comfy journal recovery protocol, and the media Python runtime must be available.",
      inputSchema: z.object({
        jobId: z.string().uuid().describe("UUID of the failed media-plugin job to reconcile"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ jobId }) => {
      const result = recoverKnownMediaPluginJob(jobId);
      if (!result.ok) return err(JSON.stringify({ code: result.code, message: result.message, status: result.status }));
      return ok(result);
    }
  );
}
