import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { isIP } from "node:net";
import dns from "node:dns/promises";
import { MediaPluginServiceError } from "./types";

/** 单次插件结果下载上限（防内存 DoS）。 */
export const MEDIA_PLUGIN_MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;

/** 手动跟随重定向的最大跳数（含初始请求）。 */
export const MEDIA_PLUGIN_MAX_REDIRECTS = 5;

export type DnsLookupResult = { address: string; family: number };
export type DnsLookupFn = (hostname: string) => Promise<DnsLookupResult[]>;

export type SafeDownloadOptions = {
  signal?: AbortSignal;
  maxBytes?: number;
  filename: string;
  outputDir: string;
  /** 可注入 DNS 解析（测试用）；默认 node:dns/promises.lookup({ all: true })。 */
  dnsLookup?: DnsLookupFn;
};

function normalizeHostname(hostname: string): string {
  let host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  // DNS absolute-form trailing dots (localhost. / foo.localhost.)
  while (host.endsWith(".")) host = host.slice(0, -1);
  return host;
}

function isUnsafeIpv4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/** Expand IPv4-mapped IPv6 literals (::ffff:x.x.x.x / ::ffff:7f00:1) to dotted-quad. */
function mappedIpv4FromIpv6(host: string): string | null {
  const lower = host.toLowerCase();
  // Dotted form: ::ffff:127.0.0.1 or 0:0:0:0:0:ffff:10.0.0.1
  const dotted = lower.match(/(?:^|:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1]!;
  // Bun/WHATWG may normalize ::ffff:127.0.0.1 → ::ffff:7f00:1
  const hexTail = lower.match(/(?:^|:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexTail) {
    const hi = Number.parseInt(hexTail[1]!, 16);
    const lo = Number.parseInt(hexTail[2]!, 16);
    if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isUnsafeIpv6(host: string): boolean {
  if (host === "::" || host === "::1" || host === "0:0:0:0:0:0:0:0" || host === "0:0:0:0:0:0:0:1") return true;
  const mapped = mappedIpv4FromIpv6(host);
  if (mapped) return isUnsafeIpv4(mapped);
  // ULA fc00::/7, link-local fe80::/10 — check after stripping leading zeros via hextet parse
  const first = host.split(":", 1)[0] || "";
  const n = Number.parseInt(first, 16);
  if (Number.isFinite(n)) {
    if ((n & 0xfe00) === 0xfc00) return true; // fc00::/7
    if ((n & 0xffc0) === 0xfe80) return true; // fe80::/10
  }
  // Also catch common textual prefixes without full parse
  if (host.startsWith("fc") || host.startsWith("fd")) return true;
  if (host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) return true;
  return false;
}

function isUnsafeIpAddress(address: string): boolean {
  const host = normalizeHostname(address);
  if (!host) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isUnsafeIpv4(host);
  if (ipVersion === 6) return isUnsafeIpv6(host);
  return true;
}

function isUnsafeSpecialHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  return false;
}

function isUnsafeHostname(hostname: string): boolean {
  const host = normalizeHostname(hostname);
  if (!host) return true;
  if (isUnsafeSpecialHostname(host)) return true;
  const ipVersion = isIP(host);
  if (ipVersion === 4) return isUnsafeIpv4(host);
  if (ipVersion === 6) return isUnsafeIpv6(host);
  return false;
}

function rejectDownload(message: string): never {
  throw new MediaPluginServiceError("PLUGIN_DOWNLOAD_REJECTED", message, 400);
}

async function defaultDnsLookup(hostname: string): Promise<DnsLookupResult[]> {
  const records = await dns.lookup(hostname, { all: true });
  return records.map((r) => ({ address: r.address, family: r.family }));
}

/** 校验插件结果下载 URL：仅 http(s)，并尽量拒绝回环/链路本地/私网字面量。 */
export function assertSafeMediaPluginDownloadUrl(urlText: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch {
    rejectDownload("插件结果 URL 无效");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    rejectDownload(`不允许的下载协议: ${parsed.protocol || "unknown"}（仅支持 http/https）`);
  }
  if (isUnsafeHostname(parsed.hostname)) {
    rejectDownload("拒绝下载到回环/链路本地/私网地址");
  }
  return parsed;
}

export type ResolvedSafeDownload = {
  /** 原始逻辑 URL（保留原始 hostname，用于重定向相对解析）。 */
  logicalUrl: URL;
  /** 连接用 URL：hostname 已替换为已校验的解析地址（防 DNS rebinding）。 */
  connectUrl: URL;
  /** 请求 Host 头应使用的原始主机名（含字面量 IP 时与连接地址一致）。 */
  requestHost: string;
  /** TLS SNI / serverName。 */
  serverName: string;
  selectedAddress: string;
};

/**
 * 解析 hostname 的 A/AAAA，校验全部地址后选取一个安全地址，并构造 pinned connect URL。
 * 解析失败 / 无地址 / 任一地址不安全 → fail closed。
 */
export async function resolveAndAssertSafeDownloadUrl(
  urlText: string,
  options?: { dnsLookup?: DnsLookupFn },
): Promise<ResolvedSafeDownload> {
  const logicalUrl = assertSafeMediaPluginDownloadUrl(urlText);
  const host = normalizeHostname(logicalUrl.hostname);
  const lookup = options?.dnsLookup ?? defaultDnsLookup;

  let selectedAddress: string;
  if (isIP(host)) {
    if (isUnsafeIpAddress(host)) {
      rejectDownload("拒绝下载到回环/链路本地/私网地址");
    }
    selectedAddress = host;
  } else {
    let records: DnsLookupResult[];
    try {
      records = await lookup(host);
    } catch {
      rejectDownload("DNS 解析失败，拒绝下载");
    }
    if (!records?.length) {
      rejectDownload("DNS 解析失败，拒绝下载");
    }
    for (const rec of records) {
      const addr = normalizeHostname(rec.address);
      if (!addr || !isIP(addr) || isUnsafeIpAddress(addr)) {
        rejectDownload("拒绝下载到回环/链路本地/私网地址");
      }
    }
    selectedAddress = normalizeHostname(records[0]!.address);
  }

  const connectUrl = new URL(logicalUrl.href);
  const ipVer = isIP(selectedAddress);
  connectUrl.hostname = ipVer === 6 ? `[${selectedAddress}]` : selectedAddress;

  return {
    logicalUrl,
    connectUrl,
    requestHost: logicalUrl.host,
    serverName: host,
    selectedAddress,
  };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function resolveRedirectUrl(currentLogicalUrl: string, locationHeader: string | null): string {
  const location = (locationHeader || "").trim();
  if (!location) {
    rejectDownload("下载重定向缺少 Location");
  }
  try {
    return new URL(location, currentLogicalUrl).href;
  } catch {
    rejectDownload("插件结果 URL 无效");
  }
}

async function pinnedFetch(
  resolved: ResolvedSafeDownload,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const headers: Record<string, string> = {
    Host: resolved.requestHost,
  };
  const init: RequestInit & { tls?: { serverName?: string } } = {
    signal,
    redirect: "manual",
    headers,
  };
  if (resolved.logicalUrl.protocol === "https:") {
    init.tls = { serverName: resolved.serverName };
  }
  return fetch(resolved.connectUrl.href, init);
}

/** 有界下载到 outputDir；拒绝 file: 与超大响应；每跳 DNS 解析并 pinned 连接，防 rebinding。 */
export async function downloadHttpUrlToFile(urlText: string, options: SafeDownloadOptions): Promise<string> {
  if (options.signal?.aborted) {
    const { JobCancelledError } = await import("../jobs/run");
    throw new JobCancelledError();
  }
  const maxBytes = options.maxBytes ?? MEDIA_PLUGIN_MAX_DOWNLOAD_BYTES;
  let currentLogicalUrl = assertSafeMediaPluginDownloadUrl(urlText).href;
  let res: Response | null = null;

  for (let hop = 0; hop <= MEDIA_PLUGIN_MAX_REDIRECTS; hop++) {
    if (options.signal?.aborted) {
      const { JobCancelledError } = await import("../jobs/run");
      throw new JobCancelledError();
    }
    const resolved = await resolveAndAssertSafeDownloadUrl(currentLogicalUrl, {
      dnsLookup: options.dnsLookup,
    });
    res = await pinnedFetch(resolved, options.signal);
    if (!isRedirectStatus(res.status)) break;
    if (hop === MEDIA_PLUGIN_MAX_REDIRECTS) {
      rejectDownload("下载重定向次数过多");
    }
    currentLogicalUrl = resolveRedirectUrl(resolved.logicalUrl.href, res.headers.get("location"));
    res = null;
  }

  if (!res) {
    rejectDownload("下载插件结果失败");
  }
  if (!res.ok) {
    rejectDownload(`下载插件结果失败: HTTP ${res.status}`);
  }
  const declared = Number(res.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    rejectDownload(`插件结果超过大小限制 (${maxBytes} bytes)`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    rejectDownload("下载的插件结果为空");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    if (options.signal?.aborted) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      const { JobCancelledError } = await import("../jobs/run");
      throw new JobCancelledError();
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      rejectDownload(`插件结果超过大小限制 (${maxBytes} bytes)`);
    }
    chunks.push(value);
  }
  if (!total) {
    rejectDownload("下载的插件结果为空");
  }
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const dest = join(options.outputDir, options.filename);
  writeFileSync(dest, buf);
  return dest;
}
