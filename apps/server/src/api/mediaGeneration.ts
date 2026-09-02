import { Elysia, t } from "elysia";
import { MEDIA_PLUGIN_KINDS, type MediaPluginGenerationRequest } from "@framebaker/shared";
import { createMediaGenerationJobs } from "../mediaPlugins/service";
import { MediaPluginServiceError } from "../mediaPlugins/types";

function generationErrorStatus(
  status: (code: number, message: string) => unknown,
  error: unknown,
): unknown {
  if (error instanceof MediaPluginServiceError) {
    return status(error.status, error.message);
  }
  if (error instanceof Error) {
    if (/Invalid media plugin kind/i.test(error.message)) {
      return status(400, `kind 须为 ${MEDIA_PLUGIN_KINDS.join(" | ")}`);
    }
    return status(400, error.message);
  }
  return status(500, "媒体生成任务创建失败");
}

export const mediaGenerationApi = new Elysia({ prefix: "/api" }).post(
  "/media-generation",
  ({ body, status }) => {
    try {
      const request = body as MediaPluginGenerationRequest;
      const jobIds = createMediaGenerationJobs(request);
      if (!jobIds.length) return status(400, "未能创建生成任务");
      return { jobId: jobIds[0], jobIds };
    } catch (error) {
      return generationErrorStatus(status, error);
    }
  },
  {
    body: t.Object({
      kind: t.Union([t.Literal("image_api"), t.Literal("video_api"), t.Literal("audio_api")]),
      pluginId: t.String({ minLength: 1 }),
      prompt: t.String(),
      references: t.Optional(t.Array(t.String())),
      params: t.Optional(t.Record(t.String(), t.Any())),
      count: t.Optional(t.Integer({ minimum: 1, maximum: 16 })),
      durationSeconds: t.Optional(t.Number({ minimum: 0.1, maximum: 600 })),
      folderId: t.Optional(t.Union([t.String(), t.Null()])),
      projectId: t.Optional(t.Union([t.String(), t.Null()])),
      name: t.Optional(t.String({ maxLength: 200 })),
    }),
  },
);
