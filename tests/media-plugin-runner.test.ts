import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  MEDIA_PLUGIN_RUNNER_DEFAULT_TIMEOUT_MS,
  MEDIA_PLUGIN_RUNNER_SCRIPT,
  invokeMediaPluginRunner,
  resolveMediaPythonExecutable,
} from "../apps/server/src/mediaPlugins/pythonEnv";

const tempRoot = mkdtempSync(join(tmpdir(), "framebaker-media-runner-"));
const pluginStorageRoot = resolve(tempRoot, "media-plugins");
const previousPluginRoot = process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT;

beforeAll(() => {
  process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT = pluginStorageRoot;
});

afterAll(() => {
  if (previousPluginRoot === undefined) delete process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT;
  else process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT = previousPluginRoot;
  rmSync(tempRoot, { recursive: true, force: true });
});

function writeImagePlugin(root: string): string {
  const pluginDir = join(root, "img_bridge");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, "plugin.json"),
    JSON.stringify({
      plugin_id: "img_bridge",
      name: "Bridge",
      version: "1.0.0",
      kind: "image_api",
      capabilities: ["t2i"],
      entry: { type: "python", module: "provider", function: "generate" },
      secrets: {},
      params_schema: {},
      constraints: { supports_text2image: true },
    }),
  );
  writeFileSync(
    join(pluginDir, "provider.py"),
    "def generate(*, request, secrets, params, helpers):\n    return {'url': 'https://example.invalid/bridge.png'}\n",
  );
  return resolve(root);
}

describe("媒体插件 Python runner 协议", () => {
  test(
    "成功时写出 ok/result JSON",
    async () => {
      const plugins = writeImagePlugin(join(pluginStorageRoot, "image_api"));
      const runDir = join(tempRoot, "run-ok");
      mkdirSync(runDir, { recursive: true });
      const result = await invokeMediaPluginRunner({
        kind: "image_api",
        pluginId: "img_bridge",
        pluginRoot: plugins,
        prompt: "bridge",
        imageUrls: [],
        audioUrls: [],
        durationSeconds: null,
        params: {},
        outputDir: runDir,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.url).toBe("https://example.invalid/bridge.png");
      }
    },
    30_000,
  );

  test(
    "插件运行失败时返回结构化错误且不含 traceback",
    async () => {
      const plugins = resolve(pluginStorageRoot, "image_api_bad");
      const pluginDir = join(plugins, "bad");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "plugin.json"),
        JSON.stringify({
          plugin_id: "bad",
          name: "Bad",
          version: "1.0.0",
          kind: "image_api",
          capabilities: ["t2i"],
          entry: { type: "python", module: "provider", function: "generate" },
          secrets: { api_key: { required: true, value: "" } },
          params_schema: {},
          constraints: { supports_text2image: true },
        }),
      );
      writeFileSync(
        join(pluginDir, "provider.py"),
        "def generate(*, request, secrets, params, helpers):\n    return {'url': 'https://x'}\n",
      );
      const runDir = join(tempRoot, "run-bad");
      mkdirSync(runDir, { recursive: true });
      const result = await invokeMediaPluginRunner({
        kind: "image_api",
        pluginId: "bad",
        pluginRoot: plugins,
        prompt: "x",
        imageUrls: [],
        audioUrls: [],
        durationSeconds: null,
        params: {},
        outputDir: runDir,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe("PLUGIN_RUNTIME_ERROR");
        expect(result.error.toLowerCase()).not.toContain("traceback");
        expect(result.error).toContain("missing required secret");
      }
    },
    30_000,
  );

  test(
    "拒绝逃逸配置插件根目录的 pluginRoot",
    async () => {
      const outside = resolve(tempRoot, "outside", "image_api");
      writeImagePlugin(outside);
      const runDir = join(tempRoot, "run-escape");
      mkdirSync(runDir, { recursive: true });
      const result = await invokeMediaPluginRunner({
        kind: "image_api",
        pluginId: "img_bridge",
        pluginRoot: outside,
        prompt: "x",
        imageUrls: [],
        audioUrls: [],
        durationSeconds: null,
        params: {},
        outputDir: runDir,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain("contained");
      }
    },
    30_000,
  );

  test("Python 不可用时返回 PYTHON_RUNTIME_UNAVAILABLE", async () => {
    const previous = process.env.FRAMEBAKER_MEDIA_PYTHON;
    process.env.FRAMEBAKER_MEDIA_PYTHON = join(tempRoot, "missing-python.exe");
    try {
      expect(() => resolveMediaPythonExecutable()).toThrow(/PYTHON_RUNTIME_UNAVAILABLE/);
      await expect(
        invokeMediaPluginRunner({
          kind: "image_api",
          pluginId: "img_bridge",
          pluginRoot: resolve(pluginStorageRoot, "image_api"),
          prompt: "x",
          imageUrls: [],
          audioUrls: [],
          durationSeconds: null,
          params: {},
          outputDir: join(tempRoot, "run-missing"),
        }),
      ).rejects.toThrow(/PYTHON_RUNTIME_UNAVAILABLE/);
    } finally {
      if (previous === undefined) delete process.env.FRAMEBAKER_MEDIA_PYTHON;
      else process.env.FRAMEBAKER_MEDIA_PYTHON = previous;
    }
  });

  test("runner 脚本路径存在且桥接默认超时有界", () => {
    expect(MEDIA_PLUGIN_RUNNER_SCRIPT.endsWith("media_plugin_runner.py")).toBe(true);
    expect(MEDIA_PLUGIN_RUNNER_DEFAULT_TIMEOUT_MS).toBe(600_000);
  });

  test(
    "bridgeTimeoutMs 超时会杀掉子进程并抛出 PLUGIN_RUNTIME_TIMEOUT",
    async () => {
      const plugins = resolve(pluginStorageRoot, "image_api_timeout");
      const pluginDir = join(plugins, "slow");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(
        join(pluginDir, "plugin.json"),
        JSON.stringify({
          plugin_id: "slow",
          name: "Slow",
          version: "1.0.0",
          kind: "image_api",
          capabilities: ["t2i"],
          entry: { type: "python", module: "provider", function: "generate" },
          secrets: {},
          params_schema: {},
          constraints: { supports_text2image: true },
        }),
      );
      writeFileSync(
        join(pluginDir, "provider.py"),
        "import time\n"
          + "def generate(*, request, secrets, params, helpers):\n"
          + "    time.sleep(30)\n"
          + "    return {'url': 'https://example.invalid/slow.png'}\n",
      );
      const runDir = join(tempRoot, "run-timeout");
      mkdirSync(runDir, { recursive: true });
      await expect(
        invokeMediaPluginRunner({
          kind: "image_api",
          pluginId: "slow",
          pluginRoot: plugins,
          prompt: "x",
          imageUrls: [],
          audioUrls: [],
          durationSeconds: null,
          params: {},
          outputDir: runDir,
          bridgeTimeoutMs: 500,
        }),
      ).rejects.toThrow(/PLUGIN_RUNTIME_TIMEOUT/);
    },
    15_000,
  );
});
