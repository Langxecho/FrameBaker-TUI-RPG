import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import { db } from "../../db";
import { createGenerationJobs } from "../../queue";
import { startMonsterPipeline, startMonsterReferenceJob } from "../../monsterPipeline";
import { checkVideoSupport, resolveReferencePaths } from "../../providerAdapter";
import { ok, err } from "../helpers";

export function register(server: McpServer) {
  server.registerTool(
    "generate_frames",
    {
      title: "Generate Frames",
      description:
        "Generate frames for a project using an AI generation provider (CLI/API/DashScope/Gemini/MiniMax). Each requested image becomes an independently scheduled job; returns jobId (first job) and jobIds (all jobs). Poll with get_job or listen for completion. Supports up to 10 ordered reference images, provider selection, model, size, and video mode.",
      inputSchema: z.object({
        projectId: z.string().describe("Target project UUID"),
        prompt: z.string().describe("Generation prompt (English recommended)"),
        count: z.number().int().min(1).max(16).describe("Number of frames to generate (default 1)").optional(),
        autoMatting: z.boolean().describe("Auto-run background removal after generation").optional(),
        providerId: z.string().describe("Provider UUID (omit to use first configured provider)").optional(),
        model: z.string().describe("Model name (omit to use provider's first model)").optional(),
        size: z.string().describe("Output size (format varies by provider type)").optional(),
        mediaKind: z.enum(["image", "video"]).describe("image (default) or video mode").optional(),
        fps: z.number().int().min(1).max(60).describe("Video extraction fps (video mode)").optional(),
        referenceMaterialId: z.string().describe("Reference material UUID for image-to-image").optional(),
        referenceFrameId: z.string().describe("Reference frame UUID for image-to-image").optional(),
        references: z.array(z.object({
          kind: z.enum(["material", "frame"]),
          id: z.string(),
        })).max(10).describe("Ordered reference images; do not combine with legacy single-reference fields").optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const { projectId, prompt, count, autoMatting, providerId, model, size, mediaKind, fps, referenceMaterialId, referenceFrameId, references } = args;
      const project = db.query("SELECT id FROM projects WHERE id = ?").get(projectId);
      if (!project) return err("项目不存在");
      const body = {
        projectId,
        prompt,
        count: count ?? 1,
        autoMatting: autoMatting ?? false,
        providerId,
        model,
        size,
        mediaKind,
        fps,
        referenceMaterialId,
        referenceFrameId,
        references,
      };
      const ref = resolveReferencePaths(body);
      if (ref.error) return err(ref.error);
      const videoErr = checkVideoSupport(body);
      if (videoErr) return err(videoErr);
      const jobIds = createGenerationJobs(projectId, {
        prompt,
        count: body.count,
        autoMatting: body.autoMatting,
        target: { kind: "project", projectId },
        referencePaths: ref.referencePaths,
        providerId,
        model,
        size,
        mediaKind,
        fps,
      });
      return ok({ jobId: jobIds[0], jobIds });
    }
  );

  server.registerTool(
    "generate_materials",
    {
      title: "Generate Materials",
      description:
        "Generate materials (not project frames) using an AI generation provider. Each requested image becomes an independently scheduled job; returns jobId (first job) and jobIds (all jobs). Materials go to the material library as each job completes. Same provider/reference options as generate_frames. Optional name sets the material name base (defaults to prompt prefix).",
      inputSchema: z.object({
        prompt: z.string().describe("Generation prompt (English recommended)"),
        count: z.number().int().min(1).max(16).describe("Number of materials to generate (default 1)").optional(),
        autoMatting: z.boolean().describe("Auto-run background removal after generation").optional(),
        name: z.string().describe("Material name base (defaults to prompt prefix)").optional(),
        providerId: z.string().describe("Provider UUID").optional(),
        model: z.string().describe("Model name").optional(),
        size: z.string().describe("Output size").optional(),
        mediaKind: z.enum(["image", "video"]).describe("image or video mode").optional(),
        fps: z.number().int().min(1).max(60).describe("Video extraction fps").optional(),
        referenceMaterialId: z.string().describe("Reference material UUID").optional(),
        referenceFrameId: z.string().describe("Reference frame UUID").optional(),
        references: z.array(z.object({
          kind: z.enum(["material", "frame"]),
          id: z.string(),
        })).max(10).describe("Ordered reference images; do not combine with legacy single-reference fields").optional(),
        folderId: z.string().describe("Target folder UUID for generated materials").optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const { prompt, count, autoMatting, name, providerId, model, size, mediaKind, fps, referenceMaterialId, referenceFrameId, references, folderId } = args;
      const body = {
        prompt,
        count: count ?? 1,
        autoMatting: autoMatting ?? false,
        name,
        providerId,
        model,
        size,
        mediaKind,
        fps,
        referenceMaterialId,
        referenceFrameId,
        references,
        folderId: folderId ?? null,
      };
      const ref = resolveReferencePaths(body);
      if (ref.error) return err(ref.error);
      const videoErr = checkVideoSupport(body);
      if (videoErr) return err(videoErr);
      const jobIds = createGenerationJobs("", {
        prompt,
        count: body.count,
        autoMatting: body.autoMatting,
        target: { kind: "materials" },
        name,
        referencePaths: ref.referencePaths,
        providerId,
        model,
        size,
        mediaKind,
        fps,
        folderId: body.folderId,
      });
      return ok({ jobId: jobIds[0], jobIds });
    }
  );

  server.registerTool(
    "generate_monster_reference",
    {
      title: "Generate Monster Reference",
      description:
        "Generate a single full-body monster identity still (transparent background). Uses the Monster tab image connection (settings.monsterImage / Euzhi GPT Image 2 plugin key), not the skeleton GenProvider list. Does not start action video or extract. Returns jobId. Pick the resulting material as referenceMaterialId for generate_monster_pipeline. Does not accept local filesystem paths.",
      inputSchema: z.object({
        appearance: z.string().describe("Monster appearance"),
        name: z.string().optional(),
        providerId: z.string().optional(),
        model: z.string().optional(),
        size: z.string().optional(),
        width: z.number().int().min(64).max(2048).optional(),
        height: z.number().int().min(64).max(2048).optional(),
        autoMatting: z.boolean().optional(),
        folderId: z.string().optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        return ok(startMonsterReferenceJob(args));
      } catch (e) {
        return err(e instanceof Error ? e.message : "怪物参考图生成失败");
      }
    }
  );

  server.registerTool(
    "generate_monster_pipeline",
    {
      title: "Generate Monster Pipeline",
      description:
        "Start action stills → image-to-video → extract from an existing image material used as identity lock. Image jobs use the Monster tab connection (settings.monsterImage), not skeleton GenProviders. Does not generate the identity still; call generate_monster_reference or upload first. referenceMaterialId is required. Optional action prompts skip empty slots unless a matching *Video prompt is set. With video on, idle still is generated first and every I2VA clip uses it as Picture 1. durationSeconds defaults to 4. width/height default to 256 (API stills request 1024 then sprite-fit). Video uses an installed .vap plugin (default MiniMax H3 I2V). Returns pipelineId, first jobId, and material folderId. Does not accept local filesystem paths.",
      inputSchema: z.object({
        appearance: z.string().describe("Optional extra appearance lock text").optional(),
        name: z.string().optional(),
        referenceMaterialId: z.string().describe("Required image material UUID used as identity keyframe"),
        idle: z.string().optional(),
        attack: z.string().optional(),
        special: z.string().optional(),
        hurt: z.string().optional(),
        death: z.string().optional(),
        providerId: z.string().optional(),
        model: z.string().optional(),
        size: z.string().optional(),
        width: z.number().int().min(64).max(2048).describe("Still output width in pixels (default 256)").optional(),
        height: z.number().int().min(64).max(2048).describe("Still output height in pixels (default 256)").optional(),
        idleVideo: z.string().optional(),
        attackVideo: z.string().optional(),
        specialVideo: z.string().optional(),
        hurtVideo: z.string().optional(),
        deathVideo: z.string().optional(),
        videoPluginId: z.string().describe("Installed video plugin id; omit for default H3 I2V; empty string skips video").optional(),
        durationSeconds: z.number().min(4).max(15).describe("Video duration in seconds (default 4)").optional(),
        extractFps: z.array(z.number().int().min(1).max(60)).optional(),
        autoMatting: z.boolean().optional(),
        folderId: z.string().optional(),
        importProjectId: z.string().describe("Optional frame project UUID to import extracted frames").optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const result = startMonsterPipeline({
          appearance: args.appearance,
          name: args.name,
          referenceMaterialId: args.referenceMaterialId,
          actions: {
            "monster-01-idle": args.idle,
            "monster-02-attack": args.attack,
            "monster-03-special": args.special,
            "monster-04-hurt": args.hurt,
            "monster-05-death": args.death,
          },
          videoPrompts: {
            "monster-01-idle": args.idleVideo,
            "monster-02-attack": args.attackVideo,
            "monster-03-special": args.specialVideo,
            "monster-04-hurt": args.hurtVideo,
            "monster-05-death": args.deathVideo,
          },
          providerId: args.providerId,
          model: args.model,
          size: args.size,
          width: args.width,
          height: args.height,
          videoPluginId: args.videoPluginId,
          durationSeconds: args.durationSeconds,
          extractFps: args.extractFps,
          autoMatting: args.autoMatting,
          folderId: args.folderId ?? null,
          importProjectId: args.importProjectId ?? null,
        });
        return ok(result);
      } catch (e) {
        return err(e instanceof Error ? e.message : "怪物流水线启动失败");
      }
    }
  );
}
