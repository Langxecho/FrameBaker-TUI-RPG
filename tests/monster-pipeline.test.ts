import { describe, expect, test } from "bun:test";
import { MAGENTA, fitSpriteNearest, keySpriteBackground, processSpritePixels, readPngSize } from "../apps/server/src/jobs/spriteKey";
import { applyMonsterPipelineProduct, listMonsterPipelineSteps, shouldPackMonsterExtractArchive } from "../apps/server/src/monsterPipeline";
import { monsterExtractZipEntryPath } from "../apps/server/src/monsterExtractZip";
import { isRetryableMediaPluginUploadError } from "../apps/server/src/jobs/mediaPlugin";
import type { MonsterPipelineRun } from "../apps/server/src/monsterPipelineTypes";

function rgba(width: number, height: number, fill: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  return data;
}

describe("精灵去背贴画", () => {
  test("四角白底连通抠掉，内部黑块保留，品红变透明", () => {
    const data = rgba(8, 8, [255, 255, 255, 255]);
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 6; x++) {
        const i = (y * 8 + x) * 4;
        data.set([0, 0, 0, 255], i);
      }
    }
    data.set([...MAGENTA, 255], (0 * 8 + 3) * 4);
    keySpriteBackground(data, 8, 8);
    expect(data[3]).toBe(0);
    expect(data[((3 * 8 + 3) * 4) + 3]).toBe(255);
    expect(data[3 * 4 + 3]).toBe(0);
  });

  test("等比 nearest 居中贴进 256 画布", () => {
    const data = rgba(8, 4, [10, 20, 30, 255]);
    const fitted = fitSpriteNearest(data, 8, 4, 256, 256);
    expect(fitted.width).toBe(256);
    expect(fitted.height).toBe(256);
    expect(fitted.data[3]).toBe(0);
    const cx = 128 * 256 + 128;
    expect(fitted.data[cx * 4 + 3]).toBe(255);
  });

  test("PNG IHDR 可读宽高，不必调用 ffprobe", () => {
    const png = Buffer.from(
      "89504E470D0A1A0A0000000D49484452000000080000000408060000008A6D3D050000000049454E44AE426082",
      "hex",
    );
    expect(readPngSize(png)).toEqual({ width: 8, height: 4 });
    expect(readPngSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  test("processSpritePixels 可只去品红不贴画", () => {
    const data = rgba(2, 2, [...MAGENTA, 255]);
    const out = processSpritePixels(data, 2, 2, { bgKey: "none" });
    expect(out.data[3]).toBe(0);
  });
});

describe("怪物流水线步骤", () => {
  const base = (): MonsterPipelineRun => ({
    pipelineId: "p1",
    appearance: "flyer",
    name: "flyer",
    folderId: "f1",
    videoPluginId: "minimax-h3-t8-i2v",
    durationSeconds: 4,
    extractFps: [4],
    autoMatting: true,
    bgKey: "flood",
    spriteFit: { width: 256, height: 256 },
    actions: [
      { id: "monster-01-idle", title: "待机", prompt: "hover" },
      { id: "monster-02-attack", title: "平A", prompt: "slash" },
    ],
    referenceMaterialId: "ref1",
    actionStillIds: {},
    actionVideoIds: {},
    extractFrameIds: {},
    cursor: 0,
  });

  test("先出全部静图，视频一律在待机静图之后", () => {
    expect(listMonsterPipelineSteps(base()).map((s) => s.type)).toEqual([
      "still",
      "still",
      "video",
      "extract",
      "video",
      "extract",
    ]);
  });

  test("待机静图完成后才进入其它动作静图，全部静图结束后才图生视频", () => {
    const run = base();
    expect(listMonsterPipelineSteps(run)[0]).toEqual({ type: "still", actionId: "monster-01-idle" });
    const afterIdle = applyMonsterPipelineProduct(run, ["idle1"]);
    expect(afterIdle.actionStillIds["monster-01-idle"]).toBe("idle1");
    expect(afterIdle.cursor).toBe(1);
    expect(listMonsterPipelineSteps(afterIdle)[afterIdle.cursor]).toEqual({ type: "still", actionId: "monster-02-attack" });
    const afterAttack = applyMonsterPipelineProduct(afterIdle, ["atk1"]);
    expect(listMonsterPipelineSteps(afterAttack)[afterAttack.cursor]).toEqual({ type: "video", actionId: "monster-01-idle" });
  });

  test("拆帧记录全部帧 ID，最后一次拆帧才打包", () => {
    const afterStills = applyMonsterPipelineProduct(applyMonsterPipelineProduct(base(), ["idle1"]), ["atk1"]);
    const afterIdleVideo = applyMonsterPipelineProduct(afterStills, ["vid-idle"]);
    const afterIdleExtract = applyMonsterPipelineProduct(afterIdleVideo, ["f1", "f2"]);
    expect(afterIdleExtract.extractFrameIds["monster-01-idle:4"]).toEqual(["f1", "f2"]);
    expect(shouldPackMonsterExtractArchive(afterIdleVideo, afterIdleExtract)).toBe(false);
    const afterAtkVideo = applyMonsterPipelineProduct(afterIdleExtract, ["vid-atk"]);
    const afterAtkExtract = applyMonsterPipelineProduct(afterAtkVideo, ["g1"]);
    expect(shouldPackMonsterExtractArchive(afterAtkVideo, afterAtkExtract)).toBe(true);
    expect(monsterExtractZipEntryPath({ monsterName: "刀刃守卫", actionTitle: "平A", fps: 4, frameIndex: 1 })).toBe(
      "刀刃守卫/平A/4fps/0001.png",
    );
    expect(isRetryableMediaPluginUploadError("PLUGIN_RUNTIME_ERROR: 上传参考图失败 HTTP 502")).toBe(true);
    expect(isRetryableMediaPluginUploadError("生成失败")).toBe(false);
  });
});
