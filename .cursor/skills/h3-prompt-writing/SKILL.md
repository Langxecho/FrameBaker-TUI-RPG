---
name: h3-prompt-writing
description: 把用户的图生视频/文生视频需求改写成 MiniMax H3 提示词（T2VA、I2VA、FL2VA、L2VA、Ref2VA）。在 FrameBaker 生成中心用 MiniMax H3 T8 I2V 插件、或用户提到 Hailuo/H3 提示词时使用。
---

# MiniMax H3 提示词

官方完整 skill：https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills/h3-prompt-writing  
参考文件：`references/base-en.txt`（文/关键帧）、`references/ref-en.txt`（Ref2VA）。

本仓库 FrameBaker 插件 `minimax-h3-t8-i2v` 是 **I2VA 图生视频**：第一张素材图 = 首帧 `<Picture 1>`。

## 工作流

1. 判断模式：T2VA / I2VA / FL2VA / L2VA / Ref2VA。
2. 文案主体用英文；对白、歌词、画面上的字保持原文。
3. 时长必须与用户要求的 4–15 秒对齐。
4. 镜头运动写成「类型 + 幅度 + 速度」，例如 `pushes in with small amplitude at slow speed`。
5. 说话人用稳定 ID `(S1)`，台词放在 `<d>[Language] …</d>`。

## FrameBaker I2VA 输出顺序

第一行必须是首帧对齐，空一行后接三个字段：

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] …

overall_soundscape: …

non_diegetic_music: …
```

- `[Shot 1]` 从画面里已有的人物、服装、构图、场景锚点写起，再写后续动作。
- 后续分镜用递增时间：`[Shot 2] At 00:03.500, the camera cuts to...`
- `overall_soundscape`：环境声与动作声，不要重复对白。
- `non_diegetic_music`：仅观众能听到的配乐；没有则写 `N/A`。

## 安装官方 skill（可选）

```bash
npx skills add https://github.com/MiniMax-AI/MiniMax-H3 --skill h3-prompt-writing
```
