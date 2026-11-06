---
name: fb-character-authoring
description: 通过 Codex 与 FrameBaker MCP 制作和审查 RPG 角色分件、骨骼/网格绑定、动画及换装。用户提供目标和反馈，AI 执行编辑与画面复核；按运行服务及客户端的实际能力选择 Region 或 v4 Mesh，怪物逐帧制作另行分流。玩家角色按 2026-10-17 定稿方法：手绘 2D 切件像素部件 + gunner-combat-34 骨骼 + MiniMax 图生视频参考 K 帧 + 难绑部位视频抽帧换图。
---

# FrameBaker 人机协作角色制作 SOP

制作者从这里开始。目标是交付**可继续编辑的制作工程、与消费端能力匹配的资源包和真实画面验收记录**。只生成一张好看的图，或只通过数据校验，都不算角色做完。

跨仓库规则与交付入口是后端总手册：FB 生产（后端仓库 `挂机game`：`docs/game-handbook/content/framebaker-production.md`）。制作 SOP 的唯一维护真源在 本仓库（FrameBaker-TUI-RPG）`skill/`，总手册引用这里；本目录不代表已全局安装或可自动发现。

## 已定稿的人物制作方法（2026-10-17，用户认可）

玩家角色一律按本节制作。下方 2026-10-03 方向及 references 中与本节冲突的旧做法，以本节为准；格式、坐标、工具与验收规则仍有效。

### 美术形态

- 人物 = **手绘 2D 切件像素部件挂在 FB 骨骼上**（cutout）。BodyProfile `gunner-combat-34`：3/4 侧身战斗体，20 根骨骼。
- 高像素密度风格，**1 美术像素 = 2 rig 单位**；补件、换手图、新装备一律按此比例缩放，不混用比例。
- 基准姿态 = 已认可的站姿立绘 / r153 的部件与色板；新部件对齐此基准，不重画整人。
- 交付经消费端资格确认的 `.fbanim v3/v4`；逐帧 PNG ZIP 只用于怪物，不用于玩家角色。

### 制作流程

1. **先把第一个姿态做到完美**：首帧/站姿的部件、层级、轴心、色板和膝肘方向先确认，再做动作。首帧不过关，不进入视频与 K 帧。
2. **MiniMax 图生视频出参考动作**：插件 `minimax-h3-t8-i2v`，经 FB MCP `http://127.0.0.1:39127/mcp`（仓库内命令入口 `bun scripts/her1/her1.ts call`）调用 `generate_with_media_plugin`；参数、job 对账与显存门禁见 [MCP 辅助制作](references/mcp-assistance.md) 和本机接入交接（后端仓库 `挂机game`：`docs/animation-mcp-comfyui-handoff-20261014.md`，ECHO 本机环境交接）。ComfyUI 是用户自建的远端服务，不产生费用；生成预算不够时通过 FB workflow 暂停/重开提高预算，不另找生成入口。
3. **按视频 K 帧**：视频只作动作参考。在骨骼上显式打关键帧并用插值连接（帧间函数规则见下方“关键帧与帧间函数同样重要”）；力线必须穿过掌心/手指、枪托、双脚和重心（COG）。禁止手漂浮、手臂拉伸或手与枪脱离。
4. **难绑部位用视频抽帧换图（sprite swap）**：手/握把、透视缩短的前臂、肘部等骨骼难以表现的部位：从视频抽帧 → 裁切 → 对齐实际枪械 sprite → 缩放到 1 美术像素 = 2 rig 单位 → 色板锁定到 r153 的肤色与描边色 → 补描边（切口边不描边）→ 作为隐藏附件加入（rest 时 scale 0.001）→ 用 `attachmentVisibility` 的 scale 关键帧逐帧切换。换手图通过每把枪的测试装备槽绘制在枪的上层。显隐写法（SHOW / STRIP / IDENT、禁止 translate-far 与 HIDE-scale、idle-support 用 STRIP）只以 [Region 显隐与铁桶规范](references/region-visibility.md) 为准。
5. **大关节弯用角度铁桶**：大肘弯、膝弯用多档角度铁桶 sprite-swap（rest 隐藏 + 当前档 SHOW）；小弯用 overlap + joint patch。描边 RGB(9,5,9)，open_edge（被遮挡或接骨的切口）不算描边缺口。

### 图生视频提示词要点

- 首帧用该姿态的近景特写；提示词写明 `arms locked, bare hands, one shot`；时长短（约 3 s）；同一提示多试几个 seed 再挑。
- 模型倾向把弯曲的手臂拉直：视频里只裁手部使用，手臂姿态以骨骼 K 帧为准。

### 已确认规则

- **膝盖必须向前弯**：逐帧检查小腿旋转符号与朝向是否一致。r153 全部膝盖反向，r168–r170 通过把膝盖沿髋—踝连线镜像修正；新动作必须复查。
- 同类武器共用动作，共 5 种握持方式；枪械通过 `grip` / `support` / `stock` / `muzzle` 四个 socket 接入，不为单把枪复制整套动作。
- 工程只做增量 revision：单一串行写入者、每次新的幂等键、绝不删除旧 revision 或素材。
- 验收只在正式客户端 `liaf-preview` 中进行；Web 播放器仅用于调试，不作签收依据。

### 已否决做法（不要重复）

- 刚性 LBS Mesh 肘部蒙皮。
- 全 Blender 3D 渲染角色（失去 2D 设计的女性美感）。
- 程序化球体/管状肢体代理作为最终美术。

### 当前状态（2026-10-17 写入时）

- FB 工程 `90acc389-43ae-44de-bb7e-daed07f85472`，最新 r173。
- c34 各动作指向 `-clip-p12` 膝盖修正版 clip。
- G1 视频换手试点：枪 `c34-g1-K05-p12v2` + 动作 `c34-g1-aim-p12v2` / `c34-g1-fire-p12v2`。
- 以上是写入时状态，开工前用 `aic_get_project_summary` 重新确认最新 revision，不当成永久最新。
- 之后的 HELLO WORLD her1 加性重切（`*-her1`、clip 指针、待交美术包 T03c/T10b）只记录在 [`docs/her1/README.md`](../../docs/her1/README.md)，它是 her1 的单一真相源。

## 当前方向（2026-10-03）

用户已选择 **Codex + MCP 执行全部编辑，FB 提供人物/骨骼效果与动画时间轴预览**。先读 设计方案（ECHO 本机未入库：`docs/superpowers/specs/2026-10-03-ai-character-workbench-design.md`，见 `skill/README.md` 缺失清单）；实施进度见 计划（ECHO 本机未入库：`docs/superpowers/plans/2026-10-03-ai-character-workbench.md`，见 `skill/README.md` 缺失清单）。制作核心与单帧观察已接入，方案中其余接口不能当成已实现；使用前查实际能力。以下 references 中旧的“人工负责编辑”是历史分工，不再是当前制作前提；格式、坐标和工具限制仍有效。

## 先分清由谁做什么

| 工作 | 人负责 | AI 执行 |
| --- | --- | --- |
| 外形与分件 | 提供参考与外观偏好 | 生图、分件、补遮挡、修透明边和关节覆盖，实际查看再调整 |
| 骨骼与绑定 | 提出效果反馈 | 建骨骼、Region 绑定、坐标换算、层级/轴心调整及弯曲检查 |
| 动画 | 提出动作意图和节奏要求 | 设计姿态、关键帧、握枪与松手，检查连续运动并修正 |
| 换装 | 提出装备需求 | 配置槽位、挂点、替换隐藏、动作覆盖，检查装配画面 |
| 交付 | 选择候选或预先授权验收标准 | 构建、复现、视觉复核、差异报告；未验证部分明确保留 |

v3 Region 是每张部件图片跟随一根骨骼，不能承担大幅关节弯曲与隐藏面补全。客户端现严格接受 v3/v4，published reference 的 manifest version 必须与实际包一致；Mesh/runtimeWarp 只按目标版本声明且消费端已资格验收的能力使用。核对客户端手册（客户端仓库 `tui-rpg-terminal-engine`：`docs/liaf-development-handbook.md`）和会话交接（ECHO 本机未入库：`docs/superpowers/plans/2026-10-06-animation-session-handoff.md`，见 `skill/README.md` 缺失清单）的日期、构建与证据，不把旧 Region-only 拒绝或某个 revision 当作永久状态。不得降级、改版本标签或随意扩展 schema；技术样例、包校验和自动权重候选不等于美术通过。

## 按任务阅读

当前执行入口先读 [Codex + MCP 制作闭环](references/ai-loop.md)：目标/预算 → 生图与分件 → 结构化编辑 → 冻结候选 → 实际观察 → 定向修复 → 评审/采用 → 冻结导出与恢复。

1. 第一次制作：先按上述设计建立目标和预算；[原人工操作教程](references/human-workflow.md) 仅用于理解制作步骤与历史 UI，不要求用户动手编辑。
2. 生图、分图、蒙皮遇到困难：读 [提示词与制作方法](references/art-methods.md)。含实际枪手案例的成功方法和失败原因。
3. 让 AI 操作 FB 或使用 ComfyUI：必读 [MCP 辅助制作](references/mcp-assistance.md)，包含连接/JSON-RPC/SSE、插件发现、参考素材登记、生成/任务对账与显存门禁。当前HELLO WORLD服务/插件和已产收据见本机接入交接（后端仓库 `挂机game`：`docs/animation-mcp-comfyui-handoff-20261014.md`，ECHO 本机环境交接）。先查实际能力，不自行搭另一套生图入口。
4. 验收与交接：读 [检查表与交接单](references/acceptance.md)。同包、同动作、同装备、同时间对比，区分制作问题和消费端问题。
5. 怪物、道具及进入游戏的全过程：读 FB [`../rpg-content-production/SKILL.md`](../rpg-content-production/SKILL.md)。客户端接入、插值保留与真实输入证据见其[跨仓库交付参考](../rpg-content-production/references/production-handoff.md)；后端总手册维护跨仓库规则与交付入口。
6. 用视频参考制作角色动画：先按上方“已定稿的人物制作方法”，再读 H3 视频参考到骨骼关键帧（ECHO 本机未入库：`skill/fb-character-authoring/references/video-reference-keyframes.md`，见 `skill/README.md` 缺失清单）。先确认空手外观和视线，再生成、拆帧、标注、K 帧和实际播放复查；保留角色本体贴图，不把生成视频当成骨骼成品。
7. 呼吸、眨眼和义眼换装：读 独立眼皮与义眼（ECHO 本机未入库：`skill/fb-character-authoring/references/eyes-and-blinking.md`，见 `skill/README.md` 缺失清单），眼皮属于角色，装备只替换眼内；必须检查闭眼遮挡和卸装还原。
8. 使用 v4 Mesh 制作可换装角色动画：读 v4 动画与补充素材清单（ECHO 本机未入库：`docs/superpowers/plans/2026-10-04-v4-character-animation-readiness.md`，见 `skill/README.md` 缺失清单）。先处理肩肘、腋下、腰摆等真实遮挡缺口，再做呼吸、瞄准、后坐和换装；刚性武器不蒙皮拉伸。该清单是待办，不是现成枪手素材。
9. 分工制作完整动作库：读 [多代理动作制作流水线](references/subagent-animation-pipeline.md)。独占离线配方、主代理串行集成、同候选画面及连续播放审查，避免并发写工程和把数值通过误当成品。
10. 已有角色的局部补画、掌面/抓握/松指、僵硬动作或游戏内打击感：读 局部补画与连续表演（ECHO 本机未入库：`skill/fb-character-authoring/references/local-repair-and-performance.md`，见 `skill/README.md` 缺失清单）。使用新素材、显式蒙版、SHA 和 revision 形成可回退候选；区分素材、动作、坐标和权威事件问题。
11. 藏层、换手图、角度铁桶、idle-support：只按 [Region 显隐与铁桶规范](references/region-visibility.md)。改完先按 [her1 自审再联络](../her1-fb-self-qc/SKILL.md) 自截图 QC，再决定是否需要美术。
12. 继续 her1（T03c / T10b 等美术包的 check → rematerialize → 薄接线 → 自审）：读 [`docs/her1/README.md`](../../docs/her1/README.md) 与 [ECHO 执行手册](../../docs/her1/ECHO_RUNBOOK.md)。

## 关键帧与帧间函数同样重要

关键帧定义动作的姿态、时点和接触关系；帧间函数定义运动路径、速度与加减速。两者必须一起设计。姿态正确、采样很密、逐帧无翻面，都不能证明动作流畅。

- 先标清蓄势、经过、反向、出手、承接和停留节点。经过型节点要传递速度，只有有意停顿或真正反向才把速度降到零。
- 不要给每个相邻关键帧都套独立 ease-in-out / smoothstep。它们在段首段尾归零，增加中间帧会增加假停顿。跨节点采用连续切线的曲线，按需要限制过冲；起止和明确停留可单独缓动。
- 腿、腰、胸肩、肘、腕分别安排相位与速度峰值，检查力量传递和弧线。接触锁定、手形切换、道具显隐属于独立约束，重做曲线时须显式继承，不能只保留骨骼轨道。
- 从脚底、重心、骨盆到胸肩、双臂安排全身发力和承接，避免只摆手臂。已有认可的绑定与动作只定向修复，不全局替换；枪手当前视角的视觉左臂对应 rig `right-*`，编辑前核对骨骼与截图，不按屏幕左右猜 ID。
- 修卡顿时同时区分动作曲线的停走和播放器掉帧。记录同候选、动作、装配、1x速率及帧间隔；数值采样用来定位速度断点，实际连续播放决定观感。
- 每轮看完整1x动作与收势，再对问题节点前后慢放。静态接触表只验姿态与遮挡；加密关键帧或截图成功不能作为流畅验收。

## 开工时先确认环境

- 读本仓库 `AGENTS.md`、`README.md`，核对所用工程与服务的实际仓库，保留已有素材与工作区改动。
- 本 SOP 位于主 FB 仓库根目录 **`skill/`**，不是现有插件打包工具的 `skills/`。手动告诉 AI“读取 `skill/fb-character-authoring/SKILL.md`”即可使用；不要假定任意 AI 客户端会自动扫描这个自定义目录。
- 2026-10-03 的 Region 试点能力与拒绝项仅是历史基线；当前能力以运行服务、导出器和消费端资格验收为准。候选保存贴图和动作资源闭包，评审绑定同候选实际证据；恢复复制资源并推进 revision。截图成功不表示视觉审核完成。
- 新机器不要依赖本机 UUID；先在素材库、项目列表查到实际对象。已有枪手 revision 15 是候选，不是合格成品；本次 SOP 不会自动修改它。
- FB 默认端口 3000，容易与游戏后端冲突。已有服务优先复用；新启动示例为在所选 FB 仓库执行 `$env:PORT='3025'` 后 `bun dev`。先确认端口未被占用，不同时打开两个进程写同一制作库。

## 三个不能混淆的产物

- FB 的 `.fbanim v3` 是 Region/现有运行时能力交付；v4 `meshSkinning:1` 是独立版本，只能在导出、客户端和后端门禁均支持时交付。不能把 v4 改标 v3 或失败后静默退回 Region。
- 客户端 LIAF `.class` / `.equipment` / `.monster`：绑定游戏身份、后端已注册机制与表现资源的内容包。当前不要把职业包叫成受支持的 `.player`。
- 后端导入及运营应用：决定游戏可用的内容和权威计算；FB 不计算伤害、掉落或技能效果。

普通「导出骨骼包」是 v2 路径，会遗漏 v3 的装备等内容；不要用改后缀的方式交付。数值校验、视觉签收、服务端准入、运营应用、生产部署分别记录。

## AI 执行原则

先读取有界摘要，再修改指定对象；沿用稳定 ID、当前 revision 和幂等键。保留原图和修改前工程快照，不直接写 SQLite，不把示例脚本中的旧 project/material ID 当成当前项目。生成任务超时先按 jobId 对账，不能盲目重新提交。共用 ComfyUI 时先卸载上一个插件加载的模型并确认显存回收，再切下一个，详见 MCP 指南。

用户决定目标与反馈，AI 负责执行；按任务授权连续迭代。先取有界数值摘要，再取真实合成图/关键帧图，必要时查看连续运动；数值正确不能代替视觉通过。每轮反馈关联确定候选，预算耗尽或连续无改进时保留最佳候选并说明原因。工具建设任务不自动等于生成素材或发布候选的任务。
