import { describe, expect, test } from "bun:test";
import {
  MONSTER_ACTIONS,
  MONSTER_TRANSPARENT_BG,
  buildMonsterActionStillPrompt,
  buildMonsterH3I2vaPrompt,
  buildMonsterReferencePrompt,
  collectFilledMonsterJobs,
  ensureMonsterIdleJob,
  formatMonsterImageSize,
  normalizeMonsterImageBaseUrl,
  parseMonsterExtractFps,
} from "../packages/shared/src";

describe("怪物提示词", () => {
  test("参考图和外貌锁定朝左透明底，禁止品红", () => {
    const prompt = buildMonsterReferencePrompt("gray flyer");
    expect(prompt).toContain("gray flyer");
    expect(prompt).toContain("facing LEFT");
    expect(prompt).toContain("no magenta");
    expect(prompt).toContain("fully transparent background");
    expect(prompt).not.toMatch(/fallback #FF00FF|magenta background/i);
  });

  test("空动作槽跳过，已填动作写入关键帧约束", () => {
    expect(collectFilledMonsterJobs(["", "slash", null, "  ", ""])).toEqual([
      { id: "monster-02-attack", title: "平A", prompt: "slash" },
    ]);
    expect(collectFilledMonsterJobs(["", "", "", "", ""], ["", "custom i2va", "", "", ""])).toEqual([
      { id: "monster-02-attack", title: "平A", prompt: "", videoPrompt: "custom i2va" },
    ]);
    expect(ensureMonsterIdleJob([{ id: "monster-02-attack", title: "平A", prompt: "slash" }])[0]?.id).toBe("monster-01-idle");
    const still = buildMonsterActionStillPrompt({
      actionId: "monster-02-attack",
      actionPrompt: "slash",
      hasReference: true,
    });
    expect(still).toContain("slash");
    expect(still).toContain("monster-02-attack");
    expect(still).toContain(MONSTER_TRANSPARENT_BG);
    const stillFromRef = buildMonsterActionStillPrompt({
      actionId: "monster-02-attack",
      actionPrompt: "",
      hasReference: true,
    });
    expect(stillFromRef).toContain("keep the exact design from the attached reference");
  });

  test("H3 I2VA 以 Picture 1 为首帧，默认 4 秒并从待机起演", () => {
    const prompt = buildMonsterH3I2vaPrompt({ actionId: "monster-01-idle" });
    expect(prompt.startsWith("For the target video, at 0.00 seconds into the target video, <Picture 1>")).toBeTrue();
    expect(prompt).toContain("idle standing still");
    expect(prompt).toContain("Duration about 4.0 seconds");
    expect(prompt).toContain("integrated_multimodal_description:");
    expect(prompt).toContain("non_diegetic_music: N/A");
  });

  test("解析拆帧 fps 去重", () => {
    expect(parseMonsterExtractFps(["4", "24"], 4)).toEqual([4, 24]);
    expect(MONSTER_ACTIONS).toHaveLength(5);
  });

  test("按 provider 类型编码出图尺寸", () => {
    expect(formatMonsterImageSize(256, 256)).toBe("256x256");
    expect(formatMonsterImageSize(256, 256, "dashscope")).toBe("256*256");
    expect(formatMonsterImageSize(256, 256, "gemini")).toBe("1:1");
  });

  test("生图 Base 去掉完整 images 路径，避免拼成双重 generations", () => {
    expect(normalizeMonsterImageBaseUrl("https://euzhi.vip/v1/images/generations")).toBe("https://euzhi.vip/v1");
    expect(normalizeMonsterImageBaseUrl("https://euzhi.vip/v1/")).toBe("https://euzhi.vip/v1");
    expect(normalizeMonsterImageBaseUrl("https://euzhi.vip/v1/images/edits")).toBe("https://euzhi.vip/v1");
  });
});
