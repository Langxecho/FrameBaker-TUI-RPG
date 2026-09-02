import {
  cpSync as fsCpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync as fsRenameSync,
  rmSync as fsRmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  mediaPluginArchiveExtension,
  type MediaPluginDetail,
  type MediaPluginKind,
} from "@framebaker/shared";
import {
  archiveExtensionForFilename,
  kindFromArchiveExtension,
  parseMediaPluginManifest,
  sanitizePluginJsonBytesForExport,
  toMediaPluginDetail,
  validateInstalledPluginDir,
} from "./manifest";
import {
  assertExistingPluginDir,
  assertSafeMediaPluginId,
  ensureMediaPluginRoots,
  isPathInside,
  mediaPluginDir,
  mediaPluginKindRoot,
  mediaPluginStorageRoot,
  resolveContainedPath,
} from "./paths";
import { MediaPluginServiceError } from "./types";
import { createStoreZip, findZipEntry } from "./zipArchive";

type InstallerFs = {
  renameSync: typeof fsRenameSync;
  cpSync: typeof fsCpSync;
  rmSync: typeof fsRmSync;
};

const defaultInstallerFs: InstallerFs = {
  renameSync: fsRenameSync,
  cpSync: fsCpSync,
  rmSync: fsRmSync,
};

let installerFs: InstallerFs = { ...defaultInstallerFs };

/** 测试钩子：注入 rename/cp/rm，便于模拟 EXDEV 与回滚失败。 */
export function setMediaPluginInstallerFsForTests(partial: Partial<InstallerFs>) {
  installerFs = { ...installerFs, ...partial };
}

export function resetMediaPluginInstallerFsForTests() {
  installerFs = { ...defaultInstallerFs };
}

function toBytes(file: Blob | Uint8Array | ArrayBuffer): Uint8Array {
  if (file instanceof Uint8Array) return file;
  if (file instanceof ArrayBuffer) return new Uint8Array(file);
  throw new MediaPluginServiceError(
    "PLUGIN_PACKAGE_INVALID",
    "同步安装请传入 Uint8Array；Blob 请使用 installMediaPluginArchiveAsync",
  );
}

function cleanupDir(path: string | null | undefined) {
  if (!path) return;
  try {
    installerFs.rmSync(path, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

/** 同卷优先 rename；跨卷 EXDEV 时退化为 copy + 删除源（源清理失败不影响已成功的复制）。 */
export function relocateDir(src: string, dest: string) {
  try {
    installerFs.renameSync(src, dest);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "EXDEV") throw error;
    installerFs.cpSync(src, dest, { recursive: true, force: true });
    try {
      installerFs.rmSync(src, { recursive: true, force: true });
    } catch {
      // best-effort：复制已成功，源残留不得把重定位变成失败
    }
  }
}

function mediaPluginInstallStagingRoot(): string {
  const root = join(mediaPluginStorageRoot(), ".staging");
  mkdirSync(root, { recursive: true });
  return root;
}

/** 插件归档默认体积预算：压缩总量 / 解压总量。 */
export const MEDIA_PLUGIN_ZIP_DEFAULT_MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
export const MEDIA_PLUGIN_ZIP_DEFAULT_MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

export type ListZipEntriesOptions = {
  maxCompressedBytes?: number;
  maxUncompressedBytes?: number;
  maxEntries?: number;
};

/** 同步解析 ZIP（store / deflate-raw），供安装校验使用；强制压缩/解压体积预算。 */
export function listZipEntriesSync(
  bytes: Uint8Array,
  options: ListZipEntriesOptions = {},
): { name: string; data: Uint8Array }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: { name: string; data: Uint8Array }[] = [];
  const decoder = new TextDecoder();
  let offset = 0;
  const maxEntries = options.maxEntries ?? 1024;
  const maxCompressed = options.maxCompressedBytes ?? MEDIA_PLUGIN_ZIP_DEFAULT_MAX_COMPRESSED_BYTES;
  const maxUncompressed = options.maxUncompressedBytes ?? MEDIA_PLUGIN_ZIP_DEFAULT_MAX_UNCOMPRESSED_BYTES;
  if (bytes.byteLength > maxCompressed) {
    throw new MediaPluginServiceError(
      "PLUGIN_PACKAGE_INVALID",
      `ZIP 压缩体积超过预算 (${maxCompressed} bytes)`,
    );
  }
  let totalCompressed = 0;
  let totalUncompressed = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    if (entries.length >= maxEntries) {
      throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", "ZIP 文件数超限");
    }
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const uncompressedSize = view.getUint32(offset + 22, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    if (dataStart + compressedSize > bytes.length) {
      throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", "ZIP 文件已截断");
    }
    totalCompressed += compressedSize;
    if (totalCompressed > maxCompressed) {
      throw new MediaPluginServiceError(
        "PLUGIN_PACKAGE_INVALID",
        `ZIP 压缩体积超过预算 (${maxCompressed} bytes)`,
      );
    }
    if (uncompressedSize > maxUncompressed || totalUncompressed + uncompressedSize > maxUncompressed) {
      throw new MediaPluginServiceError(
        "PLUGIN_PACKAGE_INVALID",
        `ZIP 解压体积超过预算 (${maxUncompressed} bytes)`,
      );
    }
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength)).replace(/\\/g, "/");
    const compressed = bytes.slice(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    if (method === 0) data = compressed;
    else if (method === 8) data = new Uint8Array(inflateRawSync(compressed));
    else throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", "ZIP 使用了不支持的压缩方式");
    totalUncompressed += data.byteLength;
    if (totalUncompressed > maxUncompressed) {
      throw new MediaPluginServiceError(
        "PLUGIN_PACKAGE_INVALID",
        `ZIP 解压体积超过预算 (${maxUncompressed} bytes)`,
      );
    }
    if (name && !name.endsWith("/")) entries.push({ name, data });
    offset = dataStart + compressedSize;
  }
  if (!entries.length) {
    throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", "invalid zip archive");
  }
  return entries;
}

function installFromEntries(
  entries: { name: string; data: Uint8Array }[],
  expectedKind: MediaPluginKind,
  replace: boolean,
): MediaPluginDetail {
  const pluginJson = findZipEntry(entries, "plugin.json");
  if (!pluginJson) {
    throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", "plugin.json is missing in archive");
  }
  const provider = findZipEntry(entries, "provider.py");
  if (!provider) {
    throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", "provider.py is missing in archive");
  }

  let manifest;
  try {
    manifest = parseMediaPluginManifest(JSON.parse(new TextDecoder().decode(pluginJson.data)), expectedKind);
  } catch (error) {
    if (error instanceof MediaPluginServiceError) throw error;
    throw new MediaPluginServiceError(
      "PLUGIN_PACKAGE_INVALID",
      `plugin.json is not valid JSON: ${(error as Error).message}`,
    );
  }
  assertSafeMediaPluginId(manifest.plugin_id);

  const kindRoot = mediaPluginKindRoot(expectedKind);
  mkdirSync(kindRoot, { recursive: true });
  const dest = mediaPluginDir(expectedKind, manifest.plugin_id);
  if (existsSync(dest) && !replace) {
    throw new MediaPluginServiceError(
      "PLUGIN_REPLACE_REQUIRED",
      `插件 ${manifest.plugin_id} 已存在，确认后将覆盖`,
      409,
      { needs_confirmation: true, plugin_id: manifest.plugin_id, kind: expectedKind },
    );
  }

  // 暂存在插件根同卷，避免 os.tmpdir() 与 STORAGE_ROOT 跨盘 rename 失败。
  const stageParent = mkdtempSync(join(mediaPluginInstallStagingRoot(), "install-"));
  const stageDir = join(stageParent, "extract");
  const candidate = join(stageParent, "candidate");
  const backup = join(stageParent, "backup");
  mkdirSync(stageDir, { recursive: true });
  let destMovedToBackup = false;
  let preserveBackupPath: string | null = null;
  try {
    for (const entry of entries) {
      const target = resolveContainedPath(stageDir, entry.name);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, entry.data);
    }

    const report = validateInstalledPluginDir(stageDir, expectedKind);
    if (!report.ok || !report.manifest) {
      throw new MediaPluginServiceError(
        "PLUGIN_PACKAGE_INVALID",
        "invalid plugin package: " + report.errors.join("; "),
      );
    }
    if (report.manifest.plugin_id !== manifest.plugin_id || report.manifest.kind !== expectedKind) {
      throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", "解压后的 manifest 与归档声明不一致");
    }

    relocateDir(stageDir, candidate);

    // 先备份旧插件，再放入新目录；失败则回滚，避免先删后装导致空窗。
    if (existsSync(dest)) {
      relocateDir(dest, backup);
      destMovedToBackup = true;
    }
    try {
      relocateDir(candidate, dest);
    } catch (error) {
      cleanupDir(dest);
      if (destMovedToBackup && existsSync(backup)) {
        try {
          relocateDir(backup, dest);
          destMovedToBackup = false;
        } catch (restoreError) {
          // 备份可能是唯一可恢复的旧插件：不得继续清理 stageParent。
          preserveBackupPath = backup;
          throw new MediaPluginServiceError(
            "PLUGIN_INSTALL_FAILED",
            `插件替换失败且回滚失败，旧插件备份已保留: ${backup}`,
            500,
            {
              backup_path: backup,
              plugin_id: manifest.plugin_id,
              kind: expectedKind,
              install_error: (error as Error).message,
              restore_error: (restoreError as Error).message,
            },
          );
        }
      }
      throw error;
    }

    return toMediaPluginDetail(report.manifest);
  } finally {
    if (!preserveBackupPath) cleanupDir(stageParent);
  }
}

/** 安装 `.iap/.vap/.aap`；`replace=false` 且 ID 已存在时抛出 409 PLUGIN_REPLACE_REQUIRED。 */
export function installMediaPluginArchive(
  file: Blob | Uint8Array | ArrayBuffer,
  filename: string,
  replace: boolean,
): MediaPluginDetail {
  ensureMediaPluginRoots();
  const bytes = toBytes(file);
  const ext = archiveExtensionForFilename(filename);
  const expectedKind = kindFromArchiveExtension(ext);
  const entries = listZipEntriesSync(bytes);
  return installFromEntries(entries, expectedKind, replace);
}

export async function installMediaPluginArchiveAsync(
  file: Blob | Uint8Array | ArrayBuffer,
  filename: string,
  replace: boolean,
): Promise<MediaPluginDetail> {
  ensureMediaPluginRoots();
  const bytes =
    file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : toBytes(file);
  const ext = archiveExtensionForFilename(filename);
  const expectedKind = kindFromArchiveExtension(ext);
  const entries = listZipEntriesSync(bytes);
  return installFromEntries(entries, expectedKind, replace);
}

export function deleteMediaPlugin(kind: MediaPluginKind, pluginId: string): void {
  const dir = mediaPluginDir(kind, pluginId);
  if (!existsSync(dir)) {
    throw new MediaPluginServiceError("PLUGIN_NOT_FOUND", `插件不存在: ${kind}/${pluginId}`, 404);
  }
  installerFs.rmSync(dir, { recursive: true, force: true });
}

function collectPluginFiles(root: string, current: string, out: Record<string, Uint8Array>) {
  for (const name of readdirSync(current)) {
    const abs = join(current, name);
    if (!isPathInside(abs, root)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) {
      collectPluginFiles(root, abs, out);
      continue;
    }
    if (!st.isFile()) continue;
    const rel = relative(root, abs).replace(/\\/g, "/");
    if (!rel || rel.startsWith("..")) continue;
    out[rel] = new Uint8Array(readFileSync(abs));
  }
}

/** 将已安装插件目录重新打包为 `.iap/.vap/.aap`（ZIP）字节，供设置页导出下载。导出包始终剥离密钥明文。 */
export async function exportMediaPluginArchive(
  kind: MediaPluginKind,
  pluginId: string,
): Promise<{ filename: string; bytes: Uint8Array; contentType: string; secretsStripped: boolean }> {
  const dir = assertExistingPluginDir(kind, pluginId);
  const report = validateInstalledPluginDir(dir, kind);
  if (!report.ok) {
    throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", report.errors.join("; ") || "插件包无效");
  }
  const files: Record<string, Uint8Array> = {};
  collectPluginFiles(dir, dir, files);
  if (!Object.keys(files).length) {
    throw new MediaPluginServiceError("PLUGIN_PACKAGE_INVALID", "插件目录为空，无法导出");
  }
  let secretsStripped = false;
  for (const [rel, data] of Object.entries(files)) {
    if (rel.replace(/\\/g, "/").split("/").pop() !== "plugin.json") continue;
    const sanitized = sanitizePluginJsonBytesForExport(data);
    files[rel] = sanitized.bytes;
    secretsStripped = secretsStripped || sanitized.stripped;
  }
  const bytes = createStoreZip(files);
  const ext = mediaPluginArchiveExtension(kind);
  return {
    filename: `${assertSafeMediaPluginId(pluginId)}${ext}`,
    bytes,
    contentType: "application/zip",
    secretsStripped,
  };
}
