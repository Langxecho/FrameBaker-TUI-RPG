import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import {
  downloadUrlToOutput,
  materializeRunnerOutputs,
} from "../apps/server/src/mediaPlugins/service";
import {
  assertSafeMediaPluginDownloadUrl,
  downloadHttpUrlToFile,
  resolveAndAssertSafeDownloadUrl,
  type DnsLookupFn,
} from "../apps/server/src/mediaPlugins/safeDownload";
import { listZipEntriesSync } from "../apps/server/src/mediaPlugins/installer";
import { createStoreZip } from "../apps/server/src/mediaPlugins/zipArchive";
import { MediaPluginServiceError } from "../apps/server/src/mediaPlugins/types";
import { sanitizeMediaPluginDiagnostic } from "../apps/server/src/mediaPlugins/diagnostics";
import { terminateSpawnedProcessTree } from "../apps/server/src/mediaPlugins/processKill";

const tempRoot = mkdtempSync(join(tmpdir(), "framebaker-media-security-"));
const previousPluginRoot = process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT;

beforeAll(() => {
  process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT = resolve(tempRoot, "media-plugins");
  mkdirSync(process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT, { recursive: true });
});

afterAll(() => {
  if (previousPluginRoot === undefined) delete process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT;
  else process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT = previousPluginRoot;
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("媒体插件安全回归", () => {
  test("拒绝 file: 结果 URL，防止本地文件外泄", async () => {
    const secret = join(tempRoot, "secret.txt");
    writeFileSync(secret, "top-secret-bytes");
    const outputDir = join(tempRoot, "run-file-url");
    mkdirSync(outputDir, { recursive: true });
    const fileUrl = pathToFileURL(secret).href;
    await expect(downloadUrlToOutput(fileUrl, outputDir, "stolen.txt")).rejects.toThrow(
      /PLUGIN_DOWNLOAD_REJECTED|file:|不允许|unsupported/i,
    );
  });

  test("拒绝把 outputDir 外的绝对路径当作视频/音频产出复制进来", () => {
    const outputDir = join(tempRoot, "run-escape-av");
    mkdirSync(outputDir, { recursive: true });
    const outside = join(tempRoot, "outside-secret.mp4");
    writeFileSync(outside, Buffer.from("ftypISOM\0\0\0\0outside"));

    expect(() =>
      materializeRunnerOutputs({
        kind: "video_api",
        pluginId: "sec_vid",
        result: { video_path: outside },
        outputDir,
      }),
    ).toThrow(/contain|逃逸|outside|路径|PLUGIN_OUTPUT_INVALID/i);

    const outsideAudio = join(tempRoot, "outside-secret.mp3");
    writeFileSync(outsideAudio, Buffer.from("ID3outside-audio"));
    expect(() =>
      materializeRunnerOutputs({
        kind: "audio_api",
        pluginId: "sec_aud",
        result: { audio_path: outsideAudio },
        outputDir,
      }),
    ).toThrow(/contain|逃逸|outside|路径|PLUGIN_OUTPUT_INVALID/i);
  });

  test("视频/音频结果 URL 交由 Bun 有界下载路径（url: 标记）", () => {
    const outputDir = join(tempRoot, "run-av-url");
    mkdirSync(outputDir, { recursive: true });

    const video = materializeRunnerOutputs({
      kind: "video_api",
      pluginId: "sec_vid_url",
      result: { url: "https://cdn.example/result.mp4", metadata: { n: 1 } },
      outputDir,
    });
    expect(video.paths).toEqual(["url:https://cdn.example/result.mp4"]);
    expect(video.mediaKind).toBe("video");

    const audio = materializeRunnerOutputs({
      kind: "audio_api",
      pluginId: "sec_aud_url",
      result: { url: "https://cdn.example/result.wav", metadata: { n: 1 } },
      outputDir,
    });
    expect(audio.paths).toEqual(["url:https://cdn.example/result.wav"]);
    expect(audio.mediaKind).toBe("audio");
  });

  test("image_path / image_paths 仅接受已位于 outputDir 内的本地文件", () => {
    const outputDir = join(tempRoot, "run-img-local");
    mkdirSync(outputDir, { recursive: true });
    const ok = join(outputDir, "ok.png");
    writeFileSync(
      ok,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const outside = join(tempRoot, "escape.png");
    writeFileSync(outside, Buffer.from("not-under-output"));

    const okMaterialized = materializeRunnerOutputs({
      kind: "image_api",
      pluginId: "sec_img",
      result: { image_path: ok },
      outputDir,
    });
    expect(okMaterialized.paths).toEqual([resolve(ok)]);

    expect(() =>
      materializeRunnerOutputs({
        kind: "image_api",
        pluginId: "sec_img",
        result: { image_path: outside },
        outputDir,
      }),
    ).toThrow(/contain|逃逸|outside|路径|PLUGIN_OUTPUT_INVALID/i);
  });

  test("下载仅允许 http(s)，并限制响应体积", async () => {
    const outputDir = join(tempRoot, "run-dl");
    mkdirSync(outputDir, { recursive: true });
    await expect(downloadUrlToOutput("ftp://example.invalid/x.bin", outputDir, "x.bin")).rejects.toThrow(
      /PLUGIN_DOWNLOAD_REJECTED|http/i,
    );
    await expect(downloadUrlToOutput("http://127.0.0.1/secret", outputDir, "x.bin")).rejects.toThrow(
      /PLUGIN_DOWNLOAD_REJECTED|link-local|loopback|unsafe|拒绝/i,
    );
  });

  test("拒绝 IPv4-mapped IPv6 / trailing-dot localhost，并允许公网字面量与 FQDN", () => {
    const rejected = [
      "http://[::ffff:127.0.0.1]/secret",
      "http://[::ffff:7f00:1]/secret",
      "http://[0:0:0:0:0:ffff:127.0.0.1]/secret",
      "http://[::ffff:10.0.0.1]/secret",
      "http://[::ffff:192.168.1.20]/secret",
      "http://[::ffff:169.254.169.254]/meta",
      "http://[::ffff:172.16.0.1]/secret",
      "http://[::ffff:100.64.0.1]/cgnat",
      "http://[::ffff:0.0.0.0]/zero",
      "http://localhost./secret",
      "http://foo.localhost./secret",
      "http://LOCALHOST./secret",
    ];
    for (const url of rejected) {
      expect(() => assertSafeMediaPluginDownloadUrl(url)).toThrow(
        /PLUGIN_DOWNLOAD_REJECTED|loopback|私网|拒绝|unsafe/i,
      );
    }

    expect(assertSafeMediaPluginDownloadUrl("https://cdn.example/ok.bin").href).toContain("cdn.example");
    expect(assertSafeMediaPluginDownloadUrl("https://example.com./ok.bin").hostname).toMatch(/example\.com\.?/i);
    expect(assertSafeMediaPluginDownloadUrl("http://8.8.8.8/ok.bin").hostname).toBe("8.8.8.8");
    expect(assertSafeMediaPluginDownloadUrl("http://[2001:4860:4860::8888]/ok.bin").hostname).toContain("2001:4860");
  });

  test("拒绝公网 URL 经 302 跳转到 loopback/私网目标（防 SSRF）", async () => {
    const outputDir = join(tempRoot, "run-redir-ssrf");
    mkdirSync(outputDir, { recursive: true });
    const lookup: DnsLookupFn = async (hostname) => {
      if (hostname === "cdn.example") return [{ address: "203.0.113.10", family: 4 }];
      throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    };
    const originalFetch = globalThis.fetch;
    const fetched: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      fetched.push(url);
      if (url === "https://203.0.113.10/start.bin") {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://127.0.0.1/secret.bin" },
        });
      }
      return new Response("should-not-fetch-private", { status: 200 });
    }) as typeof fetch;
    try {
      await expect(
        downloadHttpUrlToFile("https://cdn.example/start.bin", {
          outputDir,
          filename: "x.bin",
          dnsLookup: lookup,
        }),
      ).rejects.toThrow(/PLUGIN_DOWNLOAD_REJECTED|loopback|私网|拒绝|unsafe/i);
      expect(fetched).toEqual(["https://203.0.113.10/start.bin"]);
      expect(fetched.some((u) => u.includes("127.0.0.1"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("拒绝公网 URL 经 302 跳转到 IPv4-mapped / trailing-dot localhost", async () => {
    const outputDir = join(tempRoot, "run-redir-mapped");
    mkdirSync(outputDir, { recursive: true });
    const lookup: DnsLookupFn = async (hostname) => {
      if (hostname === "cdn.example") return [{ address: "203.0.113.10", family: 4 }];
      throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    };
    const cases: Array<{ start: string; location: string; pinnedStart: string }> = [
      {
        start: "https://cdn.example/mapped.bin",
        pinnedStart: "https://203.0.113.10/mapped.bin",
        location: "http://[::ffff:127.0.0.1]/secret.bin",
      },
      {
        start: "https://cdn.example/dot-localhost.bin",
        pinnedStart: "https://203.0.113.10/dot-localhost.bin",
        location: "http://localhost./secret.bin",
      },
      {
        start: "https://cdn.example/sub-localhost.bin",
        pinnedStart: "https://203.0.113.10/sub-localhost.bin",
        location: "http://evil.localhost./secret.bin",
      },
    ];
    for (const item of cases) {
      const originalFetch = globalThis.fetch;
      const fetched: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        fetched.push(url);
        if (url === item.pinnedStart) {
          return new Response(null, {
            status: 302,
            headers: { Location: item.location },
          });
        }
        return new Response("should-not-fetch-private", { status: 200 });
      }) as typeof fetch;
      try {
        await expect(
          downloadHttpUrlToFile(item.start, {
            outputDir,
            filename: "x.bin",
            dnsLookup: lookup,
          }),
        ).rejects.toThrow(/PLUGIN_DOWNLOAD_REJECTED|loopback|私网|拒绝|unsafe/i);
        expect(fetched).toEqual([item.pinnedStart]);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  });

  test("允许公网 URL 经有界校验后跳转到另一个公网目标", async () => {
    const outputDir = join(tempRoot, "run-redir-ok");
    mkdirSync(outputDir, { recursive: true });
    const originalFetch = globalThis.fetch;
    const fetched: string[] = [];
    const payload = "public-redirect-ok";
    const lookup: DnsLookupFn = async (hostname) => {
      if (hostname === "cdn.example") return [{ address: "203.0.113.10", family: 4 }];
      throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetched.push(url);
      expect(init?.redirect).toBe("manual");
      expect((init?.headers as Record<string, string> | undefined)?.Host || (init?.headers as any)?.host).toBe(
        "cdn.example",
      );
      if (url === "https://203.0.113.10/start.bin") {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://cdn.example/final.bin" },
        });
      }
      if (url === "https://203.0.113.10/final.bin") {
        return new Response(payload, {
          status: 200,
          headers: { "content-length": String(payload.length) },
        });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    try {
      const dest = await downloadHttpUrlToFile("https://cdn.example/start.bin", {
        outputDir,
        filename: "ok.bin",
        dnsLookup: lookup,
      });
      expect(fetched).toEqual(["https://203.0.113.10/start.bin", "https://203.0.113.10/final.bin"]);
      expect(await Bun.file(dest).text()).toBe(payload);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("DNS 解析到 loopback（如 localtest.me）时拒绝下载，防 DNS rebinding", async () => {
    const outputDir = join(tempRoot, "run-dns-loopback");
    mkdirSync(outputDir, { recursive: true });
    const lookup: DnsLookupFn = async (hostname) => {
      if (hostname === "localtest.me") return [{ address: "127.0.0.1", family: 4 }];
      throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    };
    const originalFetch = globalThis.fetch;
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched += 1;
      return new Response("should-not-fetch", { status: 200 });
    }) as typeof fetch;
    try {
      await expect(
        downloadHttpUrlToFile("https://localtest.me/secret.bin", {
          outputDir,
          filename: "x.bin",
          dnsLookup: lookup,
        }),
      ).rejects.toThrow(/PLUGIN_DOWNLOAD_REJECTED|loopback|私网|拒绝|unsafe/i);
      expect(fetched).toBe(0);
      await expect(resolveAndAssertSafeDownloadUrl("https://localtest.me/secret.bin", { dnsLookup: lookup })).rejects.toThrow(
        /PLUGIN_DOWNLOAD_REJECTED|loopback|私网|拒绝|unsafe/i,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("DNS 解析失败时 fail-closed 拒绝下载", async () => {
    const outputDir = join(tempRoot, "run-dns-fail");
    mkdirSync(outputDir, { recursive: true });
    const lookup: DnsLookupFn = async () => {
      throw Object.assign(new Error("ENOTFOUND nowhere.invalid"), { code: "ENOTFOUND" });
    };
    await expect(
      downloadHttpUrlToFile("https://nowhere.invalid/x.bin", {
        outputDir,
        filename: "x.bin",
        dnsLookup: lookup,
      }),
    ).rejects.toThrow(/PLUGIN_DOWNLOAD_REJECTED|resolve|DNS|解析|拒绝/i);
  });

  test("允许解析到公网地址的主机名，并按已校验 IP 发起请求（保留 Host）", async () => {
    const outputDir = join(tempRoot, "run-dns-public");
    mkdirSync(outputDir, { recursive: true });
    const lookup: DnsLookupFn = async (hostname) => {
      if (hostname === "cdn.example") return [{ address: "198.51.100.20", family: 4 }];
      throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
    };
    const originalFetch = globalThis.fetch;
    const fetched: Array<{ url: string; host?: string }> = [];
    const payload = "pinned-public-ok";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      fetched.push({ url: String(input), host: headers?.Host || headers?.host });
      return new Response(payload, {
        status: 200,
        headers: { "content-length": String(payload.length) },
      });
    }) as typeof fetch;
    try {
      const dest = await downloadHttpUrlToFile("https://cdn.example/ok.bin", {
        outputDir,
        filename: "ok.bin",
        dnsLookup: lookup,
      });
      expect(fetched).toEqual([{ url: "https://198.51.100.20/ok.bin", host: "cdn.example" }]);
      expect(await Bun.file(dest).text()).toBe(payload);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("诊断净化：stderr/traceback 不得进入对外错误文本", () => {
    const raw = [
      "Traceback (most recent call last):",
      '  File "provider.py", line 12, in generate',
      "KeyError: 'api_key'",
      "SECRET=sk-live-ABCDEFG",
    ].join("\n");
    const safe = sanitizeMediaPluginDiagnostic(raw, { exitCode: 1, code: "PLUGIN_RUNTIME_ERROR" });
    expect(safe.publicMessage.toLowerCase()).not.toContain("traceback");
    expect(safe.publicMessage).not.toContain("sk-live");
    expect(safe.publicMessage).toMatch(/PLUGIN_RUNTIME_ERROR/);
    expect(safe.serverLog.length).toBeGreaterThan(0);
    expect(safe.serverLog.length).toBeLessThanOrEqual(800);
  });

  test("ZIP 安装强制压缩/解压体积预算", () => {
    const hugeUncompressed = new Uint8Array(2 * 1024 * 1024);
    hugeUncompressed.fill(1);
    const bytes = createStoreZip({
      "plugin.json": new TextEncoder().encode("{}"),
      "provider.py": new TextEncoder().encode("def generate(**kwargs): return {}\n"),
      "blob.bin": hugeUncompressed,
    });
    expect(() => listZipEntriesSync(bytes, { maxCompressedBytes: 1024, maxUncompressedBytes: 4096 })).toThrow(
      /PLUGIN_PACKAGE_INVALID|预算|budget|过大|size/i,
    );
  });

  test("Windows 取消尽量 taskkill 进程树（best-effort）", () => {
    let killed = false;
    const calls: string[][] = [];
    const originalSpawn = Bun.spawn;
    // stub only when asserting call shape; restore immediately
    (Bun as any).spawn = (cmd: string[]) => {
      calls.push(cmd);
      return { exited: Promise.resolve(0), kill() {}, pid: 0 } as any;
    };
    try {
      terminateSpawnedProcessTree({
        pid: 424242,
        kill: () => {
          killed = true;
        },
      });
    } finally {
      (Bun as any).spawn = originalSpawn;
    }
    expect(killed).toBe(true);
    if (process.platform === "win32") {
      expect(calls.some((c) => c[0] === "taskkill" && c.includes("/T") && c.includes("424242"))).toBe(true);
    } else {
      expect(calls.length).toBe(0);
    }
  });
});
