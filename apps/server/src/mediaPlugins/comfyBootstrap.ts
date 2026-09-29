import { readManifestFile } from "./manifest";
import { mediaPluginDir } from "./paths";
import { cleanupComfyRuntime, normalizeComfyEndpoint } from "./comfyCleanup";
import { setMediaPluginRuntimeCleanup, setMediaPluginRuntimeKeyResolver, type PluginRef } from "./runtime";

function endpoint(ref: PluginRef): string | null {
  const manifest = readManifestFile(mediaPluginDir(ref.kind, ref.pluginId));
  const configured = manifest.secrets.comfyui_base_url?.value ?? manifest.constraints.comfyuiEndpoint;
  if (configured === undefined) return null;
  return normalizeComfyEndpoint(configured);
}

/** 使用同一租约覆盖图片/视频插件；普通远端 API 插件不占用 Comfy 显存。 */
export function configureComfyMediaRuntime(): void {
  setMediaPluginRuntimeKeyResolver((ref) => {
    const base = endpoint(ref);
    return base ? `comfyui:${base}` : null;
  });
  setMediaPluginRuntimeCleanup(async (previous, next) => {
    const nextEndpoint = endpoint(next);
    if (!nextEndpoint) return { ok: false, detail: "COMFY_ENDPOINT_MISSING" };
    // 若配置被编辑，仍先清理由持久租约记录的旧服务，不把新地址当作旧加载位置。
    const previousEndpoint = previous?.runtimeKey?.startsWith("comfyui:") ? previous.runtimeKey.slice(8) : previous ? endpoint(previous) : null;
    for (const base of new Set([previousEndpoint, nextEndpoint].filter((item): item is string => item !== null))) {
      const result = await cleanupComfyRuntime(base);
      if (!result.ok) return result;
    }
    return { ok: true };
  });
}

configureComfyMediaRuntime();
