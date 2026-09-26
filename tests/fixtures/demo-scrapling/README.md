# 废铁爬行者：首份 Demo 逐帧源包

`framebaker-r1a.zip` 是实际生成、离线处理后经 FrameBaker 公共
`POST /api/materials/monster-sprite-extract` 导出的 R1-A 资源包。
它不是 `.monster`，不包含服务端战斗实现，也不属于骨骼 fixture。

- 制作服务：本地 `FrameBaker-TUI-RPG-aic` 工作区的 3025 服务。该工作区有未合并实现，不能以本资源归档声称这些代码已进入 `shy`。
- 源素材 ID：`62e7e927-1927-484b-abd3-134c2ab71872`。
- projectId：`demo-scrapling-20260927`。
- exportId：`d78f437d-5023-40aa-a0e2-cf1906dca494`。
- exportedAt：`2026-09-26T18:49:30.630Z`，身份比较须保持精确字符串。
- SHA-256：`4ee69b73393bb38e50a13e54d8bccb099d798bfe6653fbc6d65582fb8aa1e17b`。
- 四动作：idle 48 帧 / 2000 ms / loop；attack 18 / 750 / once；hurt 12 / 500 / once；death 36 / 1500 / hold。
- 共 114 帧，24 Hz，共享 256×256 透明画布、朝左、原点 `(128,170)`。怪物没有骨骼。

图像来自用户指定的 Qwen 插件，动作来自 H3 视频插件；生成时串行使用共享 ComfyUI。
视频含背景漂移，经过调色键抠像、截取及变速处理。已检查抽样帧和接触表，
仍是首版视觉候选，未完成真实终端视觉验收。完整请求、取舍及门禁证据见后端
`mission/demo-2026-scrapling-production.md`。

在客户端仓库使用已提交的 `liaf/examples/demo-scrapling.definition.json` 重建：

```powershell
cargo run -p tui-rpg-liaf --bin liaf-export -- --framebaker-defined `
  --definition liaf/examples/demo-scrapling.definition.json `
  --source-zip ../FrameBaker-TUI-RPG/tests/fixtures/demo-scrapling/framebaker-r1a.zip `
  --expected-sha256 4ee69b73393bb38e50a13e54d8bccb099d798bfe6653fbc6d65582fb8aa1e17b `
  --version 0.1.0 --output target/demo-scrapling-export `
  --archive target/demo_scrapling-0.1.0.monster
```

客户端目录包位于 `liaf-preview/fixtures/packages/DemoScrapling.monster`。
原归档 SHA-256 为 `428ca333a5c999323d21f179a002ae48eb8c67865ed9af1b769371e984039c96`，
content SHA-256 为 `a392153481f1f9d20694180c7ec04762fc753ce0c93f0fb12668e96f261e89ce`。
重新导出的归档应重新计算摘要并通过后端准入，不以源 ZIP 摘要替代包摘要。

已通过后端真实 ZIP 准入与客户端四动作加载/播放回归；未据此宣称已激活、
完整正式战斗演出通过或生产部署完成。后续修改新增版本，不覆盖历史已交付源字节。
