/** 将本地插件制作成可审阅源码和无凭据归档；不安装插件，不运行 provider。 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { parseMediaPluginManifest, sanitizePluginJsonBytesForExport } from "../apps/server/src/mediaPlugins/manifest";
import { createStoreZip, listZipPayloadEntries } from "../apps/server/src/mediaPlugins/zipArchive";

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg || process.argv.length !== 4) {
  throw new Error("用法：bun scripts/archive-media-plugin-resource.ts <插件源目录> <新输出目录>");
}
const source = resolve(sourceArg), output = resolve(outputArg);
if (existsSync(output)) throw new Error("输出目录必须不存在，不覆盖既有资源");
const rawManifest = readFileSync(join(source, "plugin.json"));
const original = JSON.parse(rawManifest.toString("utf8"));
const knownSecrets = Object.values(original.secrets ?? {}).flatMap((meta: any) =>
  meta.secret !== false && typeof meta.value === "string" && meta.value.length > 0 && !/^https?:\/\//.test(meta.value) ? [meta.value] : []);
const files: Record<string, Uint8Array> = {};
// 本次已知插件资源闭包；有新依赖时显式扩充，不递归携带安装数据库/缓存。
for (const name of ["plugin.json", "provider.py", "comfy_workflow_provider.py", "workflow.json", "README.md", "requirements.txt"]) {
  const path = join(source, name);
  if (!existsSync(path)) continue;
  const bytes = name === "plugin.json" ? sanitizePluginJsonBytesForExport(rawManifest).bytes : readFileSync(path);
  const text = new TextDecoder().decode(bytes);
  if (knownSecrets.some((secret) => text.includes(secret)) || /\bsk-[A-Za-z0-9_-]{16,}/.test(text) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) {
    throw new Error(`资源含疑似凭据，拒绝导出：${name}`);
  }
  files[name] = bytes;
}
if (!files["provider.py"]) throw new Error("缺少 provider.py");
const manifest = parseMediaPluginManifest(JSON.parse(new TextDecoder().decode(files["plugin.json"])));
const extension = manifest.kind === "image_api" ? "iap" : manifest.kind === "video_api" ? "vap" : "aap";
const archive = createStoreZip(files);
const unpacked = listZipPayloadEntries(archive);
if (unpacked.length !== Object.keys(files).length || unpacked.some((entry) => !Buffer.from(entry.data).equals(Buffer.from(files[entry.name] ?? [])))) {
  throw new Error("归档往返校验失败");
}
mkdirSync(join(output, "source"), { recursive: true });
for (const [name, bytes] of Object.entries(files)) writeFileSync(join(output, "source", name), bytes, { flag: "wx" });
const filename = `${manifest.plugin_id}.${extension}`;
writeFileSync(join(output, filename), archive, { flag: "wx" });
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const receipt = {
  pluginId: manifest.plugin_id, version: manifest.version, archive: filename,
  sha256: digest(archive), credentialsIncluded: false,
  files: Object.entries(files).map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: digest(bytes) })),
  validation: "manifest-and-archive-roundtrip-only", generationTested: false,
};
writeFileSync(join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ pluginId: receipt.pluginId, archive: filename, sha256: receipt.sha256, files: receipt.files.length }));
