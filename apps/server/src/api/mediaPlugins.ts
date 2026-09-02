import { Elysia, t } from "elysia";
import { MEDIA_PLUGIN_KINDS, parseMediaPluginKind, type MediaPluginKind } from "@framebaker/shared";
import {
  deleteMediaPlugin,
  exportMediaPluginArchive,
  installMediaPluginArchiveAsync,
} from "../mediaPlugins/installer";
import { mediaPluginStorageRoot } from "../mediaPlugins/paths";
import { getMediaPlugin, listInstalledMediaPlugins } from "../mediaPlugins/registry";
import { updateMediaPluginParams, updateMediaPluginSecrets } from "../mediaPlugins/secrets";
import { testMediaPlugin } from "../mediaPlugins/service";
import { MediaPluginServiceError } from "../mediaPlugins/types";

function parseKindParam(kind: string): MediaPluginKind {
  return parseMediaPluginKind(kind);
}

function pluginErrorStatus(
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
  return status(500, "媒体插件操作失败");
}

function truthyFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
  }
  return false;
}

const mediaPluginKindSchema = t.Union([
  t.Literal("image_api"),
  t.Literal("video_api"),
  t.Literal("audio_api"),
]);

export const mediaPluginsApi = new Elysia({ prefix: "/api" })
  .get("/media-plugins", ({ query, status }) => {
    try {
      const kind = query.kind ? parseKindParam(query.kind) : undefined;
      return {
        plugins: listInstalledMediaPlugins(kind),
        installRoot: mediaPluginStorageRoot(),
      };
    } catch (error) {
      return pluginErrorStatus(status, error);
    }
  }, {
    query: t.Object({
      kind: t.Optional(mediaPluginKindSchema),
    }),
  })
  .get("/media-plugins/:kind", ({ params, status }) => {
    try {
      const kind = parseKindParam(params.kind);
      return {
        plugins: listInstalledMediaPlugins(kind),
        installRoot: mediaPluginStorageRoot(),
        kind,
      };
    } catch (error) {
      return pluginErrorStatus(status, error);
    }
  })
  .get("/media-plugins/:kind/:pluginId", ({ params, status }) => {
    try {
      const kind = parseKindParam(params.kind);
      const plugin = getMediaPlugin(kind, params.pluginId);
      if (!plugin) return status(404, `插件不存在: ${kind}/${params.pluginId}`);
      return { plugin };
    } catch (error) {
      return pluginErrorStatus(status, error);
    }
  })
  .post(
    "/media-plugins/import",
    async ({ body, status }) => {
      try {
        const filename = body.plugin.name || "plugin.iap";
        const plugin = await installMediaPluginArchiveAsync(
          body.plugin,
          filename,
          truthyFlag(body.confirm_replace),
        );
        return { plugin };
      } catch (error) {
        return pluginErrorStatus(status, error);
      }
    },
    {
      body: t.Object({
        plugin: t.File(),
        confirm_replace: t.Optional(t.Union([t.String(), t.Boolean(), t.Number()])),
      }),
    },
  )
  .patch(
    "/media-plugins/:kind/:pluginId/secrets",
    ({ params, body, status }) => {
      try {
        const kind = parseKindParam(params.kind);
        const values: Record<string, string> = {};
        for (const [key, value] of Object.entries(body.values ?? {})) {
          values[key] = String(value ?? "");
        }
        return { plugin: updateMediaPluginSecrets(kind, params.pluginId, values) };
      } catch (error) {
        return pluginErrorStatus(status, error);
      }
    },
    {
      body: t.Object({
        values: t.Record(t.String(), t.String()),
      }),
    },
  )
  .patch(
    "/media-plugins/:kind/:pluginId/params",
    ({ params, body, status }) => {
      try {
        const kind = parseKindParam(params.kind);
        return { plugin: updateMediaPluginParams(kind, params.pluginId, body.defaults ?? {}) };
      } catch (error) {
        return pluginErrorStatus(status, error);
      }
    },
    {
      body: t.Object({
        defaults: t.Record(t.String(), t.Any()),
      }),
    },
  )
  .delete("/media-plugins/:kind/:pluginId", ({ params, status }) => {
    try {
      const kind = parseKindParam(params.kind);
      deleteMediaPlugin(kind, params.pluginId);
      return { ok: true };
    } catch (error) {
      return pluginErrorStatus(status, error);
    }
  })
  .get("/media-plugins/:kind/:pluginId/export", async ({ params, status, set }) => {
    try {
      const kind = parseKindParam(params.kind);
      const archived = await exportMediaPluginArchive(kind, params.pluginId);
      set.headers["Content-Type"] = archived.contentType;
      set.headers["Content-Disposition"] = `attachment; filename="${archived.filename}"`;
      set.headers["X-FrameBaker-Secrets-Stripped"] = archived.secretsStripped ? "1" : "0";
      return new Response(archived.bytes, {
        headers: {
          "Content-Type": archived.contentType,
          "Content-Disposition": `attachment; filename="${archived.filename}"`,
          "X-FrameBaker-Secrets-Stripped": archived.secretsStripped ? "1" : "0",
        },
      });
    } catch (error) {
      return pluginErrorStatus(status, error);
    }
  })
  .post(
    "/media-plugins/:kind/:pluginId/test",
    async ({ params, body, status }) => {
      try {
        const kind = parseKindParam(params.kind);
        const result = await testMediaPlugin(kind, params.pluginId, {
          prompt: body?.prompt,
          params: body?.params,
          durationSeconds: body?.durationSeconds ?? null,
        });
        return { result };
      } catch (error) {
        return pluginErrorStatus(status, error);
      }
    },
    {
      body: t.Optional(
        t.Object({
          prompt: t.Optional(t.String()),
          params: t.Optional(t.Record(t.String(), t.Any())),
          durationSeconds: t.Optional(t.Union([t.Number({ minimum: 0.1, maximum: 600 }), t.Null()])),
        }),
      ),
    },
  );
