import { describe, expect, test } from "bun:test";
import { contentDispositionAttachment } from "../apps/server/src/media";

describe("素材下载头", () => {
  test("中文文件名带 filename*，ASCII filename 不含非 ASCII", () => {
    const header = contentDispositionAttachment("怪物 拆帧包.zip");
    expect(header).toContain('filename="download.zip"');
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain(encodeURIComponent("怪物 拆帧包.zip"));
    expect(header).not.toMatch(/filename="[^"]*[\u4e00-\u9fff]/);
  });

  test("纯 ASCII 文件名保持原样", () => {
    expect(contentDispositionAttachment("pack.zip")).toBe(
      `attachment; filename="pack.zip"; filename*=UTF-8''pack.zip`,
    );
  });
});
