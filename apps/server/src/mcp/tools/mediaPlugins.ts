import * as z from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/server";
import type { MediaKind, MediaPluginKind } from "@framebaker/shared";
import { getMediaPlugin, listInstalledMediaPlugins } from "../../mediaPlugins/registry";
import { createMediaGenerationJobs } from "../../mediaPlugins/service";
import { MediaPluginServiceError } from "../../mediaPlugins/types";
import { ok, err } from "../helpers";

const mediaKindFilter = z.enum(["image", "video", "audio", "all"]);
const mediaKindRequired = z.enum(["image", "video", "audio"]);

function toPluginKind(kind: MediaKind): MediaPluginKind {
  if (kind === "image") return "image_api";
  if (kind === "video") return "video_api";
  return "audio_api";
}

function serviceErr(error: unknown) {
  if (error instanceof MediaPluginServiceError) {
    const message = /traceback|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|stderr=/i.test(error.message)
      ? `${error.code}: media plugin request failed`
      : error.message;
    return err(message);
  }
  if (error instanceof Error) {
    const message = /traceback|sk-[A-Za-z0-9_-]{8,}|Bearer\s+\S+|stderr=/i.test(error.message)
      ? "PLUGIN_RUNTIME_ERROR: media plugin request failed"
      : error.message;
    return err(message);
  }
  return err("媒体插件操作失败");
}

export function register(server: McpServer) {
  server.registerTool(
    "list_media_plugins",
    {
      title: "List Media Plugins",
      description:
        "List installed .iap/.vap/.aap media plugins (independent from GenProvider). Optional kind filter: image|video|audio|all. Returns id, name, version, kind, capabilities, configured, and runnable — never secret values.",
      inputSchema: z.object({
        kind: mediaKindFilter.describe("Filter by media kind; omit or all for every installed plugin").optional(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args) => {
      try {
        const filter = args.kind ?? "all";
        const plugins =
          filter === "all"
            ? listInstalledMediaPlugins()
            : listInstalledMediaPlugins(toPluginKind(filter));
        return ok({ plugins, kind: filter });
      } catch (error) {
        return serviceErr(error);
      }
    },
  );

  server.registerTool(
    "get_media_plugin",
    {
      title: "Get Media Plugin",
      description:
        "Get one installed media plugin detail: params schema, constraints, entry, and secret configuration status. Never returns secret plaintext. kind is image|video|audio.",
      inputSchema: z.object({
        kind: mediaKindRequired.describe("Media kind: image, video, or audio"),
        pluginId: z.string().min(1).describe("Installed plugin_id"),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ kind, pluginId }) => {
      try {
        const plugin = getMediaPlugin(toPluginKind(kind), pluginId);
        if (!plugin) return err(`插件不存在: ${kind}/${pluginId}`);
        return ok({ plugin });
      } catch (error) {
        return serviceErr(error);
      }
    },
  );

  server.registerTool(
    "generate_with_media_plugin",
    {
      title: "Generate With Media Plugin",
      description:
        "Create async media-plugin generation jobs (.iap/.vap/.aap). references must be FrameBaker material IDs only — never local paths. Returns jobId (first) and jobIds. Poll with get_job. Does not install plugins, update secrets/defaults, or run arbitrary Python.",
      inputSchema: z.object({
        kind: mediaKindRequired.describe("Media kind: image, video, or audio"),
        pluginId: z.string().min(1).describe("Installed plugin_id"),
        prompt: z.string().min(1).describe("Generation prompt"),
        references: z
          .array(z.string())
          .max(16)
          .describe("Ordered material UUIDs only; no local file paths")
          .optional(),
        params: z.record(z.string(), z.unknown()).describe("Dynamic params matching plugin params_schema").optional(),
        count: z.number().int().min(1).max(16).describe("Output count for image/audio (video is always 1)").optional(),
        durationSeconds: z.number().min(0.1).max(600).describe("Requested duration for video/audio plugins").optional(),
        folderId: z.string().describe("Target materials folder UUID").optional(),
        projectId: z.string().describe("Optional frame project UUID for image import after archive").optional(),
        name: z.string().max(200).describe("Material name base").optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      try {
        const jobIds = createMediaGenerationJobs({
          kind: toPluginKind(args.kind),
          pluginId: args.pluginId,
          prompt: args.prompt,
          references: args.references,
          params: args.params,
          count: args.count,
          durationSeconds: args.durationSeconds,
          folderId: args.folderId ?? null,
          projectId: args.projectId ?? null,
          name: args.name,
        });
        if (!jobIds.length) return err("未能创建生成任务");
        return ok({ jobId: jobIds[0], jobIds });
      } catch (error) {
        return serviceErr(error);
      }
    },
  );
}
