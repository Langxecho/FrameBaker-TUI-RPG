import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  assertSafeMediaPluginId,
  isPathInside,
  mediaPluginDir,
  mediaPluginKindRoot,
  mediaPluginRunsRoot,
  mediaPluginStorageRoot,
  resolveContainedPath,
} from "../apps/server/src/mediaPlugins/paths";

const tempRoot = mkdtempSync(join(tmpdir(), "framebaker-media-paths-"));
const pluginStorageRoot = resolve(tempRoot, "media-plugins");
const previousPluginRoot = process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT;

beforeAll(() => {
  process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT = pluginStorageRoot;
  mkdirSync(pluginStorageRoot, { recursive: true });
});

afterAll(() => {
  if (previousPluginRoot === undefined) delete process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT;
  else process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT = previousPluginRoot;
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("媒体插件路径安全", () => {
  test("FRAMEBAKER_MEDIA_PLUGIN_ROOT 覆盖默认 STORAGE_ROOT/media-plugins", () => {
    expect(mediaPluginStorageRoot()).toBe(pluginStorageRoot);
    expect(mediaPluginKindRoot("image_api")).toBe(join(pluginStorageRoot, "image_api"));
    expect(mediaPluginDir("video_api", "demo")).toBe(join(pluginStorageRoot, "video_api", "demo"));
    expect(mediaPluginRunsRoot().endsWith(join("storage", "media-plugin-runs")) || mediaPluginRunsRoot().includes("media-plugin-runs")).toBe(true);
    expect(join(mediaPluginStorageRoot(), ".staging").startsWith(pluginStorageRoot)).toBe(true);
  });

  test("拒绝不安全的 plugin id", () => {
    expect(() => assertSafeMediaPluginId("../evil")).toThrow(/plugin.?id/i);
    expect(() => assertSafeMediaPluginId("a/b")).toThrow(/plugin.?id/i);
    expect(() => assertSafeMediaPluginId("a\\b")).toThrow(/plugin.?id/i);
    expect(() => assertSafeMediaPluginId("")).toThrow(/plugin.?id/i);
    expect(() => assertSafeMediaPluginId(".hidden")).toThrow(/plugin.?id/i);
    expect(assertSafeMediaPluginId("demo_plugin-1.0")).toBe("demo_plugin-1.0");
  });

  test("路径包含检查阻止逃逸", () => {
    const root = join(pluginStorageRoot, "image_api");
    mkdirSync(root, { recursive: true });
    const inside = resolve(root, "demo", "plugin.json");
    expect(isPathInside(inside, root)).toBe(true);
    expect(isPathInside(resolve(root, "..", "escape.txt"), root)).toBe(false);
    expect(() => resolveContainedPath(root, "../escape.txt")).toThrow(/contain|escape|zip.?slip|path/i);
    expect(resolveContainedPath(root, "demo/plugin.json")).toBe(resolve(root, "demo", "plugin.json"));
  });
});
