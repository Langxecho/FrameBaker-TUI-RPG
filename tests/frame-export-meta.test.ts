import { describe, expect, test } from "bun:test";
import { buildFrameExportCell, frameDurationSeconds } from "../apps/web/src/frameExportMeta";

describe("逐帧导出时长", () => {
  test("格数除以 fps 得到秒，保留原 duration", () => {
    expect(frameDurationSeconds(12, 24)).toBe(0.5);
    expect(frameDurationSeconds(1, 4)).toBe(0.25);
    const cell = buildFrameExportCell(
      { file: "a.png", x: 0, y: 0, w: 8, h: 8, duration: 6, frameIds: [], effectIds: [] },
      12,
    );
    expect(cell.duration).toBe(6);
    expect(cell.durationSeconds).toBe(0.5);
  });
});
