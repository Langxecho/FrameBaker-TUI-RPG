import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { checkSprite, findSprite, renderCheckOverlay, type ArtTask } from "../scripts/her1/lib/checkArt";
import { createImage, decodePng, encodePng } from "../scripts/her1/lib/png";
import { findLayer, layerToCanvas, readPsd } from "../scripts/her1/lib/psd";
import { loadState, loadTask } from "../scripts/her1/lib/state";
import { paintBlock, writePsd } from "./her1-fixture";

const SKIN: [number, number, number] = [200, 150, 120];
const task: ArtTask = {
  task_id: "TX",
  palette: [{ name: "肤", key: "skin", rgb: SKIN }],
  sprites: [{ sprite_id: "s", sprite_png: "s.png", native_size: [6, 5], rig_size: [12, 10], pivot: [0.5, 0.4], pivot_px: [3, 3], problem_box: [0, 0, 2, 4] }],
};
const sprite = task.sprites[0];

function setPixel(image: ReturnType<typeof createImage>, x: number, y: number, rgba: [number, number, number, number]) {
  image.data.set(rgba, (y * image.width + x) * 4);
}

describe("her1 PNG 编解码", () => {
  test("RGBA 往返保持逐像素一致", () => {
    const image = createImage(7, 3);
    for (let i = 0; i < image.data.length; i += 1) image.data[i] = (i * 37) % 256;
    const decoded = decodePng(encodePng(image));
    expect(decoded.width).toBe(7);
    expect(decoded.height).toBe(3);
    expect([...decoded.data]).toEqual([...image.data]);
  });

  test("解码 RGB + sub/paeth 过滤器", () => {
    const width = 3, height = 2;
    const rows = [[1, 10, 20, 30, 5, 5, 5, 1, 1, 1], [4, 1, 2, 3, 0, 0, 0, 9, 9, 9]];
    const raw = Uint8Array.from(rows.flat());
    const ihdr = Uint8Array.from([0, 0, 0, width, 0, 0, 0, height, 8, 2, 0, 0, 0]);
    const chunk = (type: string, body: Uint8Array) => {
      const out = new Uint8Array(12 + body.length);
      new DataView(out.buffer).setUint32(0, body.length);
      out.set([...type].map((c) => c.charCodeAt(0)), 4);
      out.set(body, 8);
      return out;
    };
    const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", ihdr), ...chunk("IDAT", new Uint8Array(deflateSync(raw))), ...chunk("IEND", new Uint8Array(0))]);
    const decoded = decodePng(png);
    expect([...decoded.data.subarray(0, 12)]).toEqual([10, 20, 30, 255, 15, 25, 35, 255, 16, 26, 36, 255]);
    expect([...decoded.data.subarray(12, 16)]).toEqual([11, 22, 33, 255]);
  });
});

describe("her1 PSD 读取", () => {
  test("按 luni 名称取图层，raw 与 RLE 通道、偏移与不透明度都正确", () => {
    const art = paintBlock(4, 3, SKIN, [0, 0, 3, 2]);
    const guide = createImage(2, 2);
    guide.data.fill(255);
    const psd = writePsd(10, 8, [
      { name: "参考（勿画）", image: guide, left: 0, top: 0, asciiName: "ref" },
      { name: "在这里画", image: art, left: 5, top: 4, asciiName: "draw" },
      { name: "半透明层", image: art, left: 0, top: 0, opacity: 128, hidden: true },
    ]);
    const document = readPsd(psd);
    expect(document.width).toBe(10);
    expect(document.layers.map((layer) => layer.name)).toEqual(["参考（勿画）", "在这里画", "半透明层"]);
    const canvas = layerToCanvas(document, findLayer(document, "在这里画"));
    expect(canvas.width).toBe(10);
    const at = (x: number, y: number) => [...canvas.data.subarray((y * 10 + x) * 4, (y * 10 + x) * 4 + 4)];
    expect(at(5, 4)).toEqual([9, 5, 9, 255]);
    expect(at(6, 5)).toEqual([...SKIN, 255]);
    expect(at(4, 4)[3]).toBe(0);
    const faded = document.layers[2];
    expect(faded.hidden).toBe(true);
    expect(layerToCanvas(document, faded).data[3]).toBe(128);
  });

  test("缺图层时报出现有图层名", () => {
    const document = readPsd(writePsd(4, 4, [{ name: "背景", image: createImage(1, 1), left: 0, top: 0 }]));
    expect(() => findLayer(document, "在这里画")).toThrow("现有图层：背景");
  });
});

describe("her1 check_art", () => {
  test("合规像素 PASS", () => {
    const report = checkSprite(paintBlock(6, 5, SKIN, [1, 1, 4, 3]), task, sprite);
    expect(report.verdict).toBe("PASS");
    expect(report.pivot.consistent).toBe(true);
    expect(report.bbox).toEqual([1, 1, 4, 3]);
  });

  test("半透明、色板外、轮廓断口与尺寸各自计数", () => {
    const image = paintBlock(6, 5, SKIN, [1, 1, 4, 3]);
    setPixel(image, 1, 2, [...SKIN, 255]);
    setPixel(image, 2, 2, [1, 2, 3, 255]);
    setPixel(image, 0, 0, [9, 5, 9, 128]);
    const report = checkSprite(image, task, sprite);
    expect(report.verdict).toBe("FAIL");
    expect(report.outlineBreaks).toEqual([[1, 2]]);
    expect(report.offPalette.map(({ x, y }) => [x, y])).toEqual([[2, 2]]);
    expect(report.semiTransparent).toEqual([[0, 0]]);
    expect(checkSprite(paintBlock(7, 5, SKIN, [1, 1, 4, 3]), task, sprite).failures[0]).toContain("尺寸");
  });

  test("open_edge 带：带内描边缺口不分朝向一律豁免，带外照常计断口", () => {
    const image = paintBlock(6, 5, SKIN, [0, 1, 4, 3], true);
    const plain = checkSprite(image, task, sprite);
    expect(plain.outlineBreaks).toEqual([[0, 2]]);
    expect(plain.label).toBe("FAIL");
    const report = checkSprite(image, task, sprite, { openEdgeBand: { band: [0, 0, 1, 4], side: "left" } });
    expect(report.label).toBe("PASS_seam_exempt");
    expect(report.openEdgeExempt).toBe(1);
    expect(checkSprite(image, task, sprite, { openEdgeBand: { band: [0, 0, 1, 4], side: "right" } }).verdict).toBe("PASS");
    expect(checkSprite(image, task, sprite, { openEdgeBand: { band: [0, 0, 1, 4] } }).verdict).toBe("PASS");
    setPixel(image, 2, 1, [...SKIN, 255]);
    expect(checkSprite(image, task, sprite, { openEdgeBand: { band: [0, 0, 1, 4] } }).outlineBreaks).toEqual([[2, 1]]);
    expect(checkSprite(paintBlock(6, 5, SKIN, [0, 1, 4, 3], true), task, sprite, { extraOpenEdge: [[0, 2]] }).verdict).toBe("PASS");
  });

  test("open_edge 带：带内半透明豁免并计数，带外半透明仍 FAIL", () => {
    const image = paintBlock(6, 5, SKIN, [1, 1, 4, 3]);
    setPixel(image, 0, 2, [...SKIN, 90]);
    setPixel(image, 0, 1, [9, 5, 9, 200]);
    const band = { band: [0, 0, 1, 4] as [number, number, number, number] };
    const report = checkSprite(image, task, sprite, { openEdgeBand: band });
    expect(report.semiTransparent).toEqual([]);
    expect(report.seamSemiExempt).toBe(2);
    expect(report.label).toBe("PASS_seam_exempt");
    setPixel(image, 5, 2, [9, 5, 9, 128]);
    const outside = checkSprite(image, task, sprite, { openEdgeBand: band });
    expect(outside.semiTransparent).toEqual([[5, 2]]);
    expect(outside.verdict).toBe("FAIL");
  });

  test("未显式给豁免带时回落到任务的 intended_open_edge_band；完全不用豁免时标 PASS", () => {
    const banded = { ...task, sprites: [{ ...sprite, intended_open_edge_band: [0, 0, 1, 4] as [number, number, number, number] }] };
    const image = paintBlock(6, 5, SKIN, [0, 1, 4, 3], true);
    expect(checkSprite(image, task, task.sprites[0]).verdict).toBe("FAIL");
    const report = checkSprite(image, banded, banded.sprites[0]);
    expect(report.label).toBe("PASS_seam_exempt");
    expect(report.openEdgeBand).toEqual([0, 0, 1, 4]);
    expect(checkSprite(paintBlock(6, 5, SKIN, [1, 1, 4, 3]), task, sprite).label).toBe("PASS");
  });

  test("T03c 合同：腕口带内半透明与无描边切口 → PASS_seam_exempt；带外半透明 → FAIL", () => {
    const state = loadState();
    const t03c = loadTask(state, "T03c");
    const hand = findSprite(t03c, "hand_sup_g3_y");
    const [w, h] = hand.native_size;
    const image = paintBlock(w, h, t03c.palette[0].rgb, [0, 4, 85, 33], true);
    for (let y = 10; y < 28; y += 3) setPixel(image, 1, y, [...t03c.palette[0].rgb, 140] as [number, number, number, number]);
    setPixel(image, 59, 4, [...t03c.palette[0].rgb, 255] as [number, number, number, number]);
    const options = { openEdgeBand: state.packs.T03c.sprites[0].openEdge };
    const report = checkSprite(image, t03c, hand, options);
    expect(report.label).toBe("PASS_seam_exempt");
    expect(report.semiTransparent).toEqual([]);
    expect(report.outlineBreaks).toEqual([]);
    expect(report.seamSemiExempt).toBe(6);
    expect(checkSprite(image, t03c, hand).label).toBe("PASS_seam_exempt");
    setPixel(image, 70, 20, [...t03c.palette[0].rgb, 140] as [number, number, number, number]);
    expect(checkSprite(image, t03c, hand, options).verdict).toBe("FAIL");
  });

  test("相对起点图统计 problem_box 内外改动，叠加图按倍率放大", () => {
    const starter = paintBlock(6, 5, SKIN, [1, 1, 4, 3]);
    const image = paintBlock(6, 5, SKIN, [1, 1, 4, 3]);
    setPixel(image, 0, 2, [9, 5, 9, 255]);
    setPixel(image, 5, 2, [9, 5, 9, 255]);
    const report = checkSprite(image, task, sprite, { starter });
    expect(report.starterDelta).toEqual({ changed: 2, insideProblemBox: 1, outsideProblemBox: 1 });
    const overlay = renderCheckOverlay(image, report, sprite, 4);
    expect([overlay.width, overlay.height]).toEqual([24, 20]);
  });

  test("仓库内 T03c/T10b 任务文件的 pivot 与 pivot_px 一致，起点帧尺寸匹配", () => {
    const state = loadState();
    for (const packId of ["T03c", "T10b"]) {
      const packTask = loadTask(state, packId);
      for (const item of state.packs[packId].sprites) {
        const taskSprite = findSprite(packTask, item.spriteId);
        expect(taskSprite.psd).toBe(item.psd);
        const blank = createImage(...taskSprite.native_size);
        const report = checkSprite(blank, packTask, taskSprite);
        expect(report.pivot.consistent).toBe(true);
        expect(report.size.ok).toBe(true);
        expect(report.failures).toEqual(["图层为空"]);
      }
    }
  });
});
