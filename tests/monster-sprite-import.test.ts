import { describe, expect, test } from "bun:test";
import { createStoreZip } from "../apps/server/src/mediaPlugins/zipArchive";
import { sha256Hex } from "../apps/server/src/monsterExtractZip";
import {
  A1_FOLDER_PRESET,
  assembleMonsterSpriteExtract,
  assembleMonsterSpriteExtractFromZip,
  attachMonsterExtractSidecarFiles,
  listPngFolders,
  parseMonsterSpriteImportSpec,
} from "../apps/server/src/monsterSpriteImport";

const PNG_8X4 = Buffer.from(
  "89504E470D0A1A0A0000000D49484452000000080000000408060000008A6D3D050000000049454E44AE426082",
  "hex",
);
const PNG_1X1 = Buffer.from(
  "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C63000100000500010D0A2DB40000000049454E44AE426082",
  "hex",
);

function a1Spec() {
  return {
    displayName: "A1Drone",
    projectId: "a1-drone",
    sampleRateHz: 24,
        defaultFacing: "left" as const,
    objectOriginPx: { x: 4, y: 4 },
    actions: A1_FOLDER_PRESET,
  };
}

describe("怪物 PNG/ZIP → R1-A", () => {
  test("按文件所在文件夹分组，文件名自然序号，不按字典序", () => {
    const pngs = [
      { relativePath: "assets/idle/frame-10.png", bytes: PNG_8X4 },
      { relativePath: "assets/idle/frame-2.png", bytes: PNG_8X4 },
      { relativePath: "assets/attack/frame-1.png", bytes: PNG_8X4 },
    ];
    expect(listPngFolders(pngs.map((p) => p.relativePath))).toEqual(["attack", "idle"]);
    expect(listPngFolders(["怪物/待机/24fps/frame-2.png", "怪物/平A/24fps/frame-1.png"])).toEqual(["平A", "待机"]);
    const result = assembleMonsterSpriteExtract({
      pngs,
      spec: {
        displayName: "tester",
        projectId: "p1",
        sampleRateHz: 24,
        defaultFacing: "right",
        objectOriginPx: { x: 4, y: 4 },
        actions: [
          { folder: "idle", actionId: "monster-01-idle", displayName: "待机", loopMode: "loop" },
          { folder: "attack", actionId: "monster-02-attack", displayName: "平A", loopMode: "once" },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sidecar.actions[0]!.frames.map((f) => f.relativePath)).toEqual([
      "frames/monster-01-idle/0001.png",
      "frames/monster-01-idle/0002.png",
    ]);
    expect(sha256Hex(result.files["frames/monster-01-idle/0001.png"]!)).toBe(sha256Hex(PNG_8X4));
    expect(result.sidecar.actions[0]!.frames[0]!.sha256).toBe(sha256Hex(PNG_8X4));
  });

  test("electric_loop 必须显式 loopMode，不能按 special 动作 ID 猜成 once", () => {
    const pngs = [
      { relativePath: "electric_loop/01.png", bytes: PNG_8X4 },
      { relativePath: "electric_loop/02.png", bytes: PNG_8X4 },
    ];
    const missing = assembleMonsterSpriteExtract({
      pngs,
      spec: {
        displayName: "A1",
        projectId: "a1",
        sampleRateHz: 24,
        defaultFacing: "left",
        objectOriginPx: { x: 4, y: 4 },
        actions: [{ folder: "electric_loop", actionId: "monster-03-special", displayName: "特殊攻击" } as never],
      },
    });
    expect(missing.ok).toBe(false);

    const ok = assembleMonsterSpriteExtract({
      pngs,
      spec: {
        displayName: "A1",
        projectId: "a1",
        sampleRateHz: 24,
        defaultFacing: "left",
        objectOriginPx: { x: 4, y: 4 },
        actions: [
          { folder: "electric_loop", actionId: "monster-03-special", displayName: "特殊攻击", loopMode: "loop" },
        ],
      },
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.sidecar.actions[0]!.loopMode).toBe("loop");
    expect(ok.sidecar.actions[0]!.actionId).toBe("monster-03-special");
    expect(ok.sidecar.actions[0]!.sampleRateHz).toBe(24);
    expect(ok.sidecar.defaultFacing).toBe("left");
    expect(ok.sidecar.objectOriginPx).toEqual({ x: 4, y: 4 });
    expect(ok.sidecar.actions[0]!.frames[0]!.durationMs + ok.sidecar.actions[0]!.frames[1]!.durationMs).toBe(83);
  });

  test("画布不一致或 Zip Slip 拒绝", () => {
    const mixed = assembleMonsterSpriteExtract({
      pngs: [
        { relativePath: "idle/1.png", bytes: PNG_8X4 },
        { relativePath: "idle/2.png", bytes: PNG_1X1 },
      ],
      spec: {
        displayName: "bad",
        projectId: "p",
        sampleRateHz: 24,
        defaultFacing: "left",
        objectOriginPx: { x: 4, y: 4 },
        actions: [{ folder: "idle", actionId: "monster-01-idle", displayName: "待机", loopMode: "loop" }],
      },
    });
    expect(mixed.ok).toBe(false);

    const slip = assembleMonsterSpriteExtract({
      pngs: [{ relativePath: "../idle/1.png", bytes: PNG_8X4 }],
      spec: {
        displayName: "bad",
        projectId: "p",
        sampleRateHz: 24,
        defaultFacing: "left",
        objectOriginPx: { x: 4, y: 4 },
        actions: [{ folder: "idle", actionId: "monster-01-idle", displayName: "待机", loopMode: "loop" }],
      },
    });
    expect(slip.ok).toBe(false);
  });

  test("A1 预设五文件夹可打成 sidecar.zip 条目", async () => {
    const files: Record<string, Uint8Array> = {};
    for (const row of A1_FOLDER_PRESET) {
      files[`${row.folder}/frame-1.png`] = PNG_8X4;
      files[`${row.folder}/frame-2.png`] = PNG_8X4;
    }
    const zip = createStoreZip(files);
    const parsed = parseMonsterSpriteImportSpec(JSON.stringify(a1Spec()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const result = await assembleMonsterSpriteExtractFromZip(zip, parsed.spec);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sidecar.format).toBe("framebaker.monster-sprite-extract");
    expect(result.sidecar.actions.map((a) => a.actionId)).toEqual([
      "monster-01-idle",
      "monster-02-attack",
      "monster-03-special",
      "monster-04-hurt",
      "monster-05-death",
    ]);
    expect(result.sidecar.actions.map((a) => a.loopMode)).toEqual(["loop", "once", "loop", "once", "hold"]);
    expect(result.files["sidecar.json"]).toBeUndefined();
    const packed = attachMonsterExtractSidecarFiles(result, {
      exportId: "exp1",
      toolVersion: "0.4.0",
      exportedAt: "2026-09-16T00:00:00Z",
    });
    expect(JSON.parse(new TextDecoder().decode(packed["sidecar.json"]!)).actions[2].loopMode).toBe("loop");
    expect(packed["frames/monster-03-special/0001.png"]).toEqual(PNG_8X4);
  });

  test("带 data descriptor 的 ZIP 和旧拆帧 24fps 目录可导入", async () => {
    const { inflateRawSync, deflateRawSync } = await import("node:zlib");
    const png = PNG_8X4;
    const name = "待机/24fps/0001.png";
    const nameBytes = new TextEncoder().encode(name);
    const compressed = new Uint8Array(deflateRawSync(png));
    const crcTable = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })();
    let crc = 0xffffffff;
    for (let i = 0; i < png.length; i++) crc = crcTable[(crc ^ png[i]!) & 0xff]! ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0808, true);
    local.setUint16(8, 8, true);
    local.setUint32(14, 0, true);
    local.setUint32(18, 0, true);
    local.setUint32(22, 0, true);
    local.setUint16(26, nameBytes.length, true);
    const desc = new DataView(new ArrayBuffer(16));
    desc.setUint32(0, 0x08074b50, true);
    desc.setUint32(4, crc, true);
    desc.setUint32(8, compressed.length, true);
    desc.setUint32(12, png.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0808, true);
    central.setUint16(10, 8, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, compressed.length, true);
    central.setUint32(24, png.length, true);
    central.setUint16(28, nameBytes.length, true);
    const localLen = 30 + nameBytes.length + compressed.length + 16;
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, 1, true);
    eocd.setUint16(10, 1, true);
    eocd.setUint32(12, 46 + nameBytes.length, true);
    eocd.setUint32(16, localLen, true);
    const out = new Uint8Array(localLen + 46 + nameBytes.length + 22);
    let o = 0;
    out.set(new Uint8Array(local.buffer), o); o += 30;
    out.set(nameBytes, o); o += nameBytes.length;
    out.set(compressed, o); o += compressed.length;
    out.set(new Uint8Array(desc.buffer), o); o += 16;
    out.set(new Uint8Array(central.buffer), o); o += 46;
    out.set(nameBytes, o); o += nameBytes.length;
    out.set(new Uint8Array(eocd.buffer), o);
    expect(new Uint8Array(inflateRawSync(compressed))).toEqual(png);
    const listed = await assembleMonsterSpriteExtractFromZip(out, {
      displayName: "刀刃机器人",
      projectId: "blade",
      sampleRateHz: 24,
      defaultFacing: "left",
      objectOriginPx: { x: 4, y: 4 },
      actions: [{ folder: "待机", actionId: "monster-01-idle", displayName: "待机", loopMode: "loop" }],
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) throw new Error(listed.error);
    expect(listed.sidecar.actions[0]!.actionId).toBe("monster-01-idle");
  });
});
