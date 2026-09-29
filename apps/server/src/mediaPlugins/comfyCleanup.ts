/** ComfyUI /free 只排队释放请求：必须等待队列空闲并观测显存回收，不能将 HTTP 200 当完成。 */
export type ComfyCleanupOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  pollMs?: number;
  maxReservedBytes?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export function normalizeComfyEndpoint(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("COMFY_ENDPOINT_MISSING");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("COMFY_ENDPOINT_INVALID");
  }
  return url.href.replace(/\/+$/, "");
}

function queueEmpty(value: unknown): boolean {
  const queue = value as { queue_running?: unknown; queue_pending?: unknown };
  if (!queue || !Array.isArray(queue.queue_running) || !Array.isArray(queue.queue_pending)) throw new Error("COMFY_QUEUE_UNOBSERVABLE");
  return queue.queue_running.length === 0 && queue.queue_pending.length === 0;
}

function released(value: unknown, maxBytes: number): boolean {
  const stats = value as { devices?: Array<{ torch_vram_total?: unknown; type?: string }> };
  if (!Array.isArray(stats?.devices) || !stats.devices.length) throw new Error("COMFY_MEMORY_UNOBSERVABLE");
  return stats.devices.every((device) => {
    if (typeof device.torch_vram_total !== "number" || !Number.isFinite(device.torch_vram_total) || device.torch_vram_total < 0) throw new Error("COMFY_MEMORY_UNOBSERVABLE");
    return device.torch_vram_total <= maxBytes;
  });
}

export async function cleanupComfyRuntime(endpoint: string, options: ComfyCleanupOptions = {}): Promise<{ ok: true; detail: string } | { ok: false; detail: string }> {
  const request = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeout = options.timeoutMs ?? 45_000;
  const maxBytes = options.maxReservedBytes ?? 64 * 1024 * 1024;
  try {
    const base = normalizeComfyEndpoint(endpoint);
    const deadline = now() + timeout;
    const json = async (path: string): Promise<unknown> => {
      const response = await request(`${base}${path}`, { signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - now()))), redirect: "error" });
      if (!response.ok) throw new Error(`COMFY_READ_HTTP_${response.status}`);
      return response.json();
    };
    // 不清队列、不 interrupt、不夺取外部任务；用户可待其结束后重试。
    if (!queueEmpty(await json("/queue"))) return { ok: false, detail: "COMFY_BUSY: 远端仍有运行或等待任务；未发送卸载" };
    const response = await request(`${base}/free`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }), signal: AbortSignal.timeout(Math.max(1, Math.min(5000, deadline - now()))), redirect: "error" });
    if (!response.ok) throw new Error(`COMFY_FREE_HTTP_${response.status}`);
    let observed = 0;
    while (now() < deadline) {
      if (!queueEmpty(await json("/queue"))) return { ok: false, detail: "COMFY_BUSY_DURING_CLEANUP: 未确认清理，阻止下一任务" };
      observed = released(await json("/system_stats"), maxBytes) ? observed + 1 : 0;
      if (observed >= 2) return { ok: true, detail: "队列持续空闲，连续两次确认 Comfy torch 显存缓存已释放" };
      await sleep(Math.min(options.pollMs ?? 500, Math.max(1, deadline - now())));
    }
    return { ok: false, detail: "COMFY_CLEANUP_UNCONFIRMED: 超时仍无法确认显存释放" };
  } catch (error) {
    // 不向 UI/MCP 泄露 endpoint、认证数据或远端响应正文。
    const code = error instanceof Error && /^COMFY_[A-Z_0-9]+$/.test(error.message) ? error.message : "COMFY_CLEANUP_UNOBSERVABLE";
    return { ok: false, detail: code };
  }
}
