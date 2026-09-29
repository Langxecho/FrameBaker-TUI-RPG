---
name: rpg-content-production
description: 在 FrameBaker 侧按统一流水线制作和交接 RPG 角色、怪物、装备与道具内容，并把可编辑源工程交给 LIAF、客户端和后端。适用于需要从素材制作走到游戏准入的团队任务；纯动画姿态细节请转到 fb-character-authoring。
---

# RPG 内容生产总 SOP（FrameBaker 侧）

这里是制作人员的总入口。先判断内容类型，再读取对应章节；不要把四条线混成一个导出按钮。FrameBaker 负责素材与可编辑表现工程，LIAF 负责游戏表现包，后端负责机制、数值、奖励和最终权威。每条线都要保留源文件、版本、hash、诊断、截图和交接收据。

## 入口分流

| 内容 | FrameBaker 事实源 | 交给下游 | 禁止的快捷方式 |
| --- | --- | --- | --- |
| 玩家角色 | Skeleton + CharacterBinding + MotionClip + BodyProfile | 第 6 步发布的 `.fbanim v3`，再由客户端制作 `.class` | 用 v2 ZIP 当完整职业包；把职业称为 `.player` |
| 怪物 | 逐帧 PNG 动作工程/拆帧包 | 客户端/后端流程形成 `.monster` | 用角色骨骼制作怪物；直接把 PNG ZIP 改名 `.monster` |
| 装备/武器 | 独立 PNG、装备绑定、挂点与动作覆盖 | `.equipment` 候选 + 后端装备模板/机制 | 在动画回调里决定伤害、命中、掉落 |
| 道具/材料 | 图标、单帧/多帧表现素材、说明图 | 后端 Game Content 的 material/currency/item 定义 | 臆造通用 `.item` 运行时包或在 FB 写经济规则 |

详细角色姿态、图片提示词、分件、Region“蒙皮”、双手握持和 MCP 操作，必须继续读 [`../fb-character-authoring/SKILL.md`](../fb-character-authoring/SKILL.md) 及其 references。

## 所有内容通用的六步

1. **任务卡**：写稳定 ID、显示名、内容类型、朝向、画布和目标尺寸、动作/状态列表、参考来源、负责人、版本和验收人。
2. **身份素材**：保留原图/原视频和 SHA；AI 生成记录 prompt、插件、模型、尺寸、seed、jobId。生成插件切换前清理共享 ComfyUI，确认队列为空和显存回收。
3. **编辑与检查**：在 FrameBaker 中编辑，不直接写数据库。透明素材在棋盘、深底、浅底和缩小尺寸检查；怪物逐帧检查首/中/末，角色检查关节和动作接触。
4. **构建候选**：输出与项目类型匹配的候选，保存 manifest、资源闭包、构建版本、SHA 和诊断。候选不等于发布。
5. **跨仓库交接**：把源工程、导出物、收据和失败项交给客户端 LIAF 组包；后端只接收可验证内容并注册权威机制。
6. **分门验收**：结构校验、制作端画面、客户端画面、后端准入和隔离战斗各自签收。任一门失败就保留候选，不覆盖旧版本。

## 角色（有骨骼）

读取 `fb-character-authoring/references/human-workflow.md`，按“中性姿态 → Region 绑定 → BodyProfile → 一把武器闭环 → 其他武器/动作”的顺序做。人工决定关键姿态、重心、动作节奏、握枪和松手；AI 只负责结构化分件、坐标换算、采样、批量诊断和可编辑草稿。当前 Region 绑定不是 Mesh 顶点权重蒙皮，`meshSkinning`/`runtimeWarp` 不得伪装成终端兼容。

完成后必须从发布页导出 `.fbanim v3`。普通「导出骨骼包」的 v2 不含完整装备/BodyProfile，不能交给 LIAF 当正式角色包。枪口、主手、辅手 Socket 与装备 action override 要按动作和武器逐项目视检查；后端技能、伤害、冷却不写入 MotionClip。

## 怪物（无骨骼）

怪物用逐帧工程。每个动作固定稳定 `actionId`、`loopMode`（`once`/`loop`/`hold`）、FPS、朝向和 origin；PNG 共享画布、自然文件顺序、无路径穿越。普通小怪、精英和 Boss 都按同一格式，差异在动作与后端注册机制。

自动视频抽帧或透明处理后，先做 alpha 统计，再做棋盘和连续帧检查。火焰、电光等特效不能因自动抠图被删；不要凭一个样本通过就批处理全部帧。FrameBaker 拆帧包（含 `sidecar.json`）仍是制作投递，不是最终 `.monster`；交给客户端/后端完成正式 manifest、digest、包级校验和准入。

## 装备与武器

武器图独立生成，不能把手画在枪上。角色绑定中配置装备 slot、socket、`primaryGrip`、双手武器的 `secondaryGrip`、`muzzleSocket`、占用槽和 action override；长枪/短枪分别检查。单件试穿后再测互斥组合，两个双手武器不能同时占用同一身体。

装备的视觉模式可以是 `none`、`attached`、`replacement` 或 `effect`。视觉效果只说明表现资源和挂点；实际属性、触发次数、抗性、掉落和叠加规则由后端装备模板决定。弹道、枪口闪光、斩击光、命中特效作为独立表现资源和 socket/event 交接，绝不由客户端或 FB 决定命中。

## 道具、材料与货币

在 FB 侧制作图标、容器、掉落视觉或使用时序素材，并以内容 ID、透明背景、尺寸和色板交接。单帧图标应避免把 UI 文字烘进图片；多帧使用明确 FPS/loop。后端通过 Game Content 注册材料、货币、消耗品和奖励，持久化使用 ledger/projection；FB 不创建数据库定义、不决定玩家余额、不设计经济公式。

## AI 与 MCP 的安全工作法

- 先执行 `tools/list`，再执行 `aic_get_capabilities`、`aic_get_project_summary`、`aic_get_diagnostics`；当前 AIC 工作树才可能有骨骼写入 MCP，主 `shy` 是否具备以实际工具列表为准。
- `split_material_parts` 是有界 row-major 网格、色键和裁边工具，不是人体语义分割；人工确认每个 cell 的部件身份。
- `aic_apply_operations` 必须携带当前 revision 和新幂等键，分批写入并重新读取；冲突时停止。`aic_sample_pose` 以秒采样多个骨骼/Socket；`aic_publish_v3` 只生成候选摘要。
- 生成 job 返回后只用 `get_job` 对账；未知状态不重提。共享 ComfyUI 切换图片/视频插件前请求已有 cleanup，确认 `/system_stats` 队列空和显存已回收。
- AI 不得直接改 SQLite、覆盖源素材、删除失败证据、编写后端机制或把结构诊断当作视觉通过。

## 最终交接包

```text
source/                 # 原图、部件、工程导出或逐帧源
candidate/              # .fbanim v3 / 拆帧投递 / 独立装备素材
receipt.json             # ID、revision、SHA、插件、prompt、job、诊断、截图
screenshots/fb/         # 制作端关键动作与装备画面
notes/                   # 未解决问题、已知损失、下游操作说明
```

交接单必须明确“制作端通过/客户端待验/后端待准入/生产未部署”。不要把任一阶段的成功写成整条流水线完成。
