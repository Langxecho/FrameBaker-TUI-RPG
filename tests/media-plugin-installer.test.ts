import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  installMediaPluginArchive,
  relocateDir,
  resetMediaPluginInstallerFsForTests,
  setMediaPluginInstallerFsForTests,
} from "../apps/server/src/mediaPlugins/installer";
import { MediaPluginServiceError } from "../apps/server/src/mediaPlugins/types";
import { createZip } from "../apps/web/src/zip";

const tempRoot = mkdtempSync(join(tmpdir(), "framebaker-media-installer-"));
const pluginStorageRoot = resolve(tempRoot, "media-plugins");
const previousPluginRoot = process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT;

beforeAll(() => {
  process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT = pluginStorageRoot;
  mkdirSync(pluginStorageRoot, { recursive: true });
});

afterEach(() => {
  resetMediaPluginInstallerFsForTests();
});

afterAll(() => {
  resetMediaPluginInstallerFsForTests();
  if (previousPluginRoot === undefined) delete process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT;
  else process.env.FRAMEBAKER_MEDIA_PLUGIN_ROOT = previousPluginRoot;
  rmSync(tempRoot, { recursive: true, force: true });
});

async function packPlugin(files: Record<string, string>, filename: string): Promise<Uint8Array> {
  const entries = Object.entries(files).map(([name, text]) => ({
    name,
    data: new TextEncoder().encode(text),
  }));
  const blob = await createZip(entries);
  return new Uint8Array(await blob.arrayBuffer());
}

function imageManifest(pluginId: string, version = "1.0.0") {
  return {
    plugin_id: pluginId,
    name: pluginId,
    version,
    kind: "image_api",
    capabilities: ["t2i"],
    entry: { type: "python", module: "provider", function: "generate" },
    secrets: {
      api_key: { label: "API Key", required: true, secret: true, value: "old-secret" },
    },
    params_schema: {
      size: { type: "string", label: "尺寸", default: "1024x1024" },
    },
    constraints: { max_reference_images: 1, supports_text2image: true },
  };
}

const providerPy = "def generate(*, request, secrets, params, helpers):\n    return {'url': 'https://example.invalid/x.png'}\n";

describe("媒体插件 installer 重定位与回滚安全", () => {
  test("EXDEV 复制成功后源清理失败仍视为重定位成功", () => {
    const root = mkdtempSync(join(tempRoot, "exdev-"));
    const src = join(root, "src");
    const dest = join(root, "dest");
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, "marker.txt"), "ok");

    setMediaPluginInstallerFsForTests({
      renameSync: () => {
        const err = new Error("cross-device link") as NodeJS.ErrnoException;
        err.code = "EXDEV";
        throw err;
      },
      cpSync: (from, to, opts) => cpSync(from, to, opts),
      rmSync: () => {
        throw new Error("simulated source cleanup failure");
      },
    });

    expect(() => relocateDir(src, dest)).not.toThrow();
    expect(existsSync(join(dest, "marker.txt"))).toBe(true);
    expect(readFileSync(join(dest, "marker.txt"), "utf8")).toBe("ok");
  });

  test("替换安装回滚失败时不得删除唯一旧插件备份", async () => {
    const pluginId = "rollback_keep";
    const dest = join(pluginStorageRoot, "image_api", pluginId);
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "plugin.json"), JSON.stringify(imageManifest(pluginId, "1.0.0"), null, 2));
    writeFileSync(join(dest, "provider.py"), providerPy);
    writeFileSync(join(dest, "old-marker.txt"), "preserve-me");

    const replacement = await packPlugin(
      {
        "plugin.json": JSON.stringify(imageManifest(pluginId, "2.0.0")),
        "provider.py": providerPy,
      },
      "rollback_keep.iap",
    );

    let candidateToDestAttempts = 0;
    let backupRestoreAttempts = 0;
    setMediaPluginInstallerFsForTests({
      renameSync: (from, to) => {
        const fromNorm = String(from).replace(/\\/g, "/");
        const toNorm = String(to).replace(/\\/g, "/");
        if (fromNorm.includes("/candidate") && toNorm.endsWith(`/image_api/${pluginId}`)) {
          candidateToDestAttempts += 1;
          throw new Error("simulated candidate install failure");
        }
        if (fromNorm.includes("/backup") && toNorm.endsWith(`/image_api/${pluginId}`)) {
          backupRestoreAttempts += 1;
          throw new Error("simulated restore failure");
        }
        return renameSync(from, to);
      },
    });

    let thrown: unknown;
    try {
      installMediaPluginArchive(replacement, "rollback_keep.iap", true);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(MediaPluginServiceError);
    const err = thrown as MediaPluginServiceError;
    expect(err.code).toBe("PLUGIN_INSTALL_FAILED");
    expect(String(err.message)).toMatch(/备份|backup|回滚|restore/i);
    expect(candidateToDestAttempts).toBe(1);
    expect(backupRestoreAttempts).toBe(1);

    const backupPath = typeof err.details?.backup_path === "string" ? err.details.backup_path : "";
    expect(backupPath.length).toBeGreaterThan(0);
    expect(existsSync(backupPath)).toBe(true);
    expect(existsSync(join(backupPath, "old-marker.txt"))).toBe(true);
    expect(readFileSync(join(backupPath, "old-marker.txt"), "utf8")).toBe("preserve-me");
    expect(existsSync(join(dest, "old-marker.txt"))).toBe(false);
  });
});
