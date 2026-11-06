---
name: rpg-content-production
description: 在 FrameBaker 侧按统一流水线制作和交接 RPG 角色、怪物、装备与道具内容，并把可编辑源工程交给 LIAF、客户端和后端。适用于需要从素材制作走到游戏准入的团队任务；纯动画姿态细节请转到 fb-character-authoring。
---

# RPG 内容生产总 SOP（FrameBaker 侧）

这里是制作人员的总入口。先判断内容类型，再读取对应章节；不要把四条线混成一个导出按钮。FrameBaker 负责素材与可编辑表现工程，LIAF 负责游戏表现包，后端负责机制、数值、奖励和最终权威。每条线都要保留源文件、版本、hash、诊断、截图和交接收据。

跨仓库规则与交付入口见后端总手册：FB 生产（后端仓库 `挂机game`：`docs/game-handbook/content/framebaker-production.md`）。制作 SOP 只在 本仓库（FrameBaker-TUI-RPG）`skill/` 维护唯一真源；使用时明确让代理读取本文件或 `fb-character-authoring/SKILL.md`，不宣称已全局安装或自动发现。交给客户端/后端前读[跨仓库交付与验收](references/production-handoff.md)，不复制后端总手册另立规则。

2026-10-03：角色制作转为 Codex + MCP 执行编辑、用户给目标与反馈。新的 工作台方案（ECHO 本机未入库：`docs/superpowers/specs/2026-10-03-ai-character-workbench-design.md`，见 `skill/README.md` 缺失清单） 取代旧教程的人工编辑分工；制作核心与单帧观察已接入，其余能力按 实施计划（ECHO 本机未入库：`docs/superpowers/plans/2026-10-03-ai-character-workbench.md`，见 `skill/README.md` 缺失清单） 核对，不把计划当成当前能力。

## 入口分流

| 内容 | FrameBaker 事实源 | 交给下游 | 禁止的快捷方式 |
| --- | --- | --- | --- |
| 玩家角色 | Skeleton + CharacterBinding + MotionClip + BodyProfile（当前 `gunner-combat-34` 2D 切件像素部件） | 与消费端资格一致的 `.fbanim v3/v4`，再由客户端制作 `.class` | 用 v2 ZIP 或逐帧 ZIP 当完整职业包；把职业称为 `.player`；用 3D 渲染或程序化肢体代理充当最终美术 |
| 怪物 | 逐帧 PNG 动作工程/拆帧包 | 客户端/后端流程形成 `.monster` | 用角色骨骼制作怪物；直接把 PNG ZIP 改名 `.monster` |
| 装备/武器 | 独立 PNG、装备绑定、挂点与动作覆盖 | `.equipment` 候选 + 后端装备模板/机制 | 在动画回调里决定伤害、命中、掉落 |
| 道具/材料 | 图标、单帧/多帧表现素材、说明图 | 后端 Game Content 的材料/货币与已有使用规则 | 臆造通用 `.item` 运行时包或在 FB 写经济规则 |

详细角色姿态、图片提示词、分件、Region“蒙皮”、双手握持和 MCP 操作，必须继续读 [`../fb-character-authoring/SKILL.md`](../fb-character-authoring/SKILL.md) 及其 references。使用已安装图片/视频插件与共享ComfyUI前，必读[MCP调用与生成](../fb-character-authoring/references/mcp-assistance.md)；当前HELLO WORLD服务地址、插件版本、调用例子及现成收据见本机接入交接（后端仓库 `挂机game`：`docs/animation-mcp-comfyui-handoff-20261014.md`，ECHO 本机环境交接）。

## 所有内容通用的六步

1. **任务卡**：写稳定 ID、显示名、内容类型、朝向、画布和目标尺寸、动作/状态列表、参考来源、负责人、版本和验收人。
2. **身份素材**：保留原图/原视频和 SHA；AI 生成记录 prompt、插件、模型、尺寸、seed、jobId。生成插件切换前清理共享 ComfyUI，确认队列为空和显存回收。
3. **编辑与检查**：在 FrameBaker 中编辑，不直接写数据库。透明素材在棋盘、深底、浅底和缩小尺寸检查；怪物逐帧检查首/中/末，角色检查关节和动作接触。
4. **构建候选**：输出与项目类型匹配的候选，保存 manifest、资源闭包、构建版本、SHA 和诊断。候选不等于发布。
5. **跨仓库交接**：把源工程、导出物、收据和失败项交给客户端 LIAF 组包；后端只接收可验证内容并注册权威机制。
6. **分门验收**：结构校验、制作端画面、客户端画面、后端准入和隔离战斗各自签收。任一门失败就保留候选，不覆盖旧版本。

## 角色（有骨骼）

读取 [`../fb-character-authoring/SKILL.md`](../fb-character-authoring/SKILL.md)，按“中性姿态 → 经能力确认的 Region/Mesh 绑定 → BodyProfile → 一把武器闭环 → 其他武器/动作”的顺序做。用户提供目标和偏好，AI 设计姿态、全身发力、重心、节奏、握枪与松手，通过关键帧及帧间函数、完整 1x 连续播放修正。已有认可绑定不全局替换；枪手视觉左臂对应 rig `right-*`，先核对实际工程。多代理使用离线独占配方，由单主代理串行集成，不并发写工程。

**2026-10-17 定稿的人物制作方法**（细则、提示词要点与当前工程状态以 [`fb-character-authoring` 的“已定稿的人物制作方法”节](../fb-character-authoring/SKILL.md) 为准）：

- 形态：手绘 2D 切件像素部件挂在 FB 骨骼上，BodyProfile `gunner-combat-34`（3/4 侧身战斗体、20 骨）；高像素密度，1 美术像素 = 2 rig 单位；基准为已认可站姿立绘 / r153。
- 流程：首帧姿态做到完美 → `minimax-h3-t8-i2v` 图生视频出参考动作 → 按视频显式 K 帧 + 插值，力线穿过掌指、枪托、双脚和重心，手不漂浮不拉伸 → 手/握把、透视前臂、肘等难绑部位从视频抽帧，裁切、对齐实际枪 sprite、按比例缩放、锁定 r153 肤色/描边色、补描边（切口不描），作隐藏附件（rest scale 0.001）用 `attachmentVisibility` scale 关键帧逐帧换图。
- 显隐：binding rest.scale 0.001 + clip `att:` scale 只写 SHOW；藏层用 STRIP，禁止 translate-far 与 HIDE-scale，细则只在 [Region 显隐与铁桶规范](../fb-character-authoring/references/region-visibility.md)。改完先按 [her1 自审再联络](../her1-fb-self-qc/SKILL.md) 自截图 QC。
- 规则：膝盖必须向前弯（核对小腿旋转符号与朝向；r153 曾全部反向，r168–r170 已修）；工程只做增量 revision、单一串行写入者、新幂等键、绝不删除；验收只在正式客户端 `liaf-preview`，Web 播放器仅调试。
- 已否决：刚性 LBS Mesh 肘部、全 Blender 3D 渲染角色、程序化球/管肢体代理作最终美术，不要重复尝试。

完成后通过实际支持的发布路径导出 `.fbanim v3/v4`。客户端严格接受两版本，published reference 的 manifest version 必须与包一致；Mesh/runtimeWarp 仅按该版本声明及消费端资格验收使用，不一律禁止，也不默认任意组合均支持。不得静默降级、改标版本或随意扩展 schema。版本入口见客户端手册（客户端仓库 `tui-rpg-terminal-engine`：`docs/liaf-development-handbook.md`），实际新交付的 revision、SHA、原生/在线证据保留在会话交接（ECHO 本机未入库：`docs/superpowers/plans/2026-10-06-animation-session-handoff.md`，见 `skill/README.md` 缺失清单），不把特定 revision 固定为永远最新。普通 v2 骨骼导出不含完整装备/BodyProfile，不能当正式角色包。枪口、主辅手 Socket 与 action override 按动作和武器逐项检查；后端技能、伤害、冷却不写入 MotionClip。

## 怪物（无骨骼）

怪物用逐帧工程。每个动作固定稳定 `actionId`、`loopMode`（`once`/`loop`/`hold`）、FPS、朝向和 origin；PNG 共享画布、自然文件顺序、无路径穿越。普通小怪、精英和 Boss 都按同一格式，差异在动作与后端注册机制。

自动视频抽帧或透明处理后，先做 alpha 统计，再做棋盘和连续帧检查。火焰、电光等特效不能因自动抠图被删；不要凭一个样本通过就批处理全部帧。FrameBaker 拆帧包（含 `sidecar.json`）仍是制作投递，不是最终 `.monster`；交给客户端/后端完成正式 manifest、digest、包级校验和准入。

## 装备与武器

武器图独立生成，不能把手画在枪上。角色绑定中配置装备 slot、socket、`primaryGrip`、双手武器的 `secondaryGrip`、`muzzleSocket`、占用槽和 action override；长枪/短枪分别检查。单件试穿后再测互斥组合，两个双手武器不能同时占用同一身体。

同类武器共用动作：共 5 种握持方式，枪械通过 `grip` / `support` / `stock` / `muzzle` socket 对接，不为单把枪复制整套动作。视频抽帧得到的换手图属于角色侧素材，经每把枪的测试装备槽绘制在枪的上层，不烘进武器图。当前试点为 G1：枪 `c34-g1-K05-p12v2` + 动作 `c34-g1-aim-p12v2` / `c34-g1-fire-p12v2`。

装备的视觉模式可以是 `none`、`attached`、`replacement` 或 `effect`。视觉效果只说明表现资源和挂点；实际属性、触发次数、抗性、掉落和叠加规则由后端装备模板决定。弹道、枪口闪光、斩击光、命中特效作为独立表现资源和 socket/event 交接，绝不由客户端或 FB 决定命中。

## 道具、材料与货币

在 FB 侧制作图标、容器、掉落视觉或使用时序素材，并以内容 ID、透明背景、尺寸和色板交接。单帧图标应避免把 UI 文字烘进图片；多帧使用明确 FPS/loop。后端通过 Game Content 注册材料、货币、消耗品和奖励，持久化使用 ledger/projection；FB 不创建数据库定义、不决定玩家余额、不设计经济公式。

## AI 与 MCP 的安全工作法

- 先执行 `tools/list`，再执行实际提供的 `aic_get_capabilities`、`aic_get_project_summary`、`aic_get_diagnostics`；按当前服务核对能力，不依赖早期 `shy` 或 AIC worktree 的状态判断。
- `split_material_parts` 是有界 row-major 网格、色键和裁边工具，不是人体语义分割；AI 必须查看并确认每个 cell 的部件身份，不明确时修正素材或询问用户。
- `aic_apply_operations` 必须携带当前 revision 和新幂等键，分批写入并重新读取；冲突时停止。`aic_sample_pose` 以秒采样多个骨骼/Socket；选择实际具备的版本发布工具，`aic_publish_v3` 不代表 v4 能力，任何候选摘要都不等于验收或激活。
- 图生视频使用 FB MCP `http://127.0.0.1:39127/mcp` 上的 `minimax-h3-t8-i2v`（仓库内命令入口 `bun scripts/her1/her1.ts call`）。ComfyUI 是用户自建远端、免费；预算不足时通过 FB workflow 暂停/重开提高预算，不另建生成入口。
- 生成 job 返回后只用 `get_job` 对账；未知状态不重提。共享 ComfyUI 切换图片/视频插件前请求已有 cleanup，确认 `/system_stats` 队列空和显存已回收。
- AI 不得直接改 SQLite、覆盖源素材、删除失败证据、编写后端机制或把结构诊断当作视觉通过。

## 最终交接包

```text
source/                 # 原图、部件、工程导出或逐帧源
candidate/              # 经资格确认的 .fbanim v3/v4 / 拆帧投递 / 独立装备素材
receipt.json             # ID、revision、SHA、插件、prompt、job、诊断、截图
screenshots/fb/         # 制作端关键动作与装备画面
notes/                   # 未解决问题、已知损失、下游操作说明
```

交接单必须明确“制作端通过/客户端待验/后端待准入/生产未部署”。不要把任一阶段的成功写成整条流水线完成。
