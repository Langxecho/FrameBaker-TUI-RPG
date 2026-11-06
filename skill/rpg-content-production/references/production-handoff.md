# 跨仓库交付与验收

本参考承接原后端重复 skill 中有用的接入经验。跨仓库规则、后端发布和交付入口以后端总手册（后端仓库 `挂机game`：`docs/game-handbook/content/framebaker-production.md`）为准；制作 SOP 唯一真源在 FB `skill/`。客户端当前合同查开发手册（客户端仓库 `tui-rpg-terminal-engine`：`docs/liaf-development-handbook.md`），具体 revision、导出 SHA、证据范围与未完成项查FB 会话交接（ECHO 本机未入库：`docs/superpowers/plans/2026-10-06-animation-session-handoff.md`，见 `skill/README.md` 缺失清单），不从历史案例推定新候选已通过。

## 合同与资源闭包

- 内容卡冻结稳定 ID/version、类型、负责人、已注册的 class/code package、能力/behavior template、动作事件、装备槽和依赖。新协议、规则或能力先由对应仓库确认；`CombatWorker -> CombatKernel` 决定命中、伤害、时序和奖励，动画不补偿数值。
- `.class`、`.monster`、`.equipment` 是游戏表现包；没有通用 `.item` 或职业 `.player` 合同。怪物按动作 PNG + sidecar 交付，客户端按已确认 definition canonical export，不能改 ZIP 后缀充当正式包。
- fbanim 严格接受版本一致且通过消费端资格验收的 v3/v4；保留实际 version、BodyProfile、动作映射、附件/override 和资源摘要闭包。离线 exporter 支持某个映射不等于后端已注册该动作。Mesh/runtimeWarp 按已有合同使用，不降级、不随意加 schema 字段，也不假设独立骨架自动合并。
- 交付 manifest/content/assets/checksums 与 archive SHA-256；包仅含声明式数据和声明的受控资源，无外部 URL、任意路径、`..` 或代码。摘要、路径、能力和 owner 归属错误修 source/export，不能删 checksums 或临时扩 allowlist。

## 握持、装配与插值

- BodyProfile、骨骼、binding 的主/辅手 socket 一致；武器声明 primary grip，双手武器还需 secondary grip 与二骨 IK。检查握点、肘腕可达、枪口/抛壳 socket、左右朝向及每个动作 override。求解顺序是 FK → 主手对齐 → 副握把 → 二骨 IK → 重算 world/socket。
- `weapon_two_hand_incomplete`、`body_profile_mismatch`、不可达 IK 回 FB 修 profile/socket/骨段/约束；slot/tag/conflict 问题修模板与 binding。保留上一合法姿态/loadout 是保护行为，不证明新组合通过。
- 职业依赖不代表玩家已穿戴；运行时核对 `game.equipped` 中 `equipped=true` 的实例、template ID 与冻结来源。内容资产逻辑 owner 独占，物理 blob 可按 SHA 去重；实例、模板与表现包分别交接。
- 装备稀有度使用 `white < green < blue < purple < gold < red < prismatic`，condition/`floatValue` 独立，不能输出旧四档值或外推高档公式。材料图标按对象 owner 建内容资产版本，`assetVersionId` 对应版本须有 default frame；材料/货币 ledger 与 projection 由后端管理，内容观察页不是发放入口。
- 关键帧与帧间函数共同验收。`step` 只用于明确离散交接；linear 可能在节点变速，逐段 ease-in-out 可能在每段边界归零。检查节点两侧速度、轨道相位、全身发力和承接，重烘焙继承手形、显隐、接触、事件及装备轨道；加密帧不能替代完整 1x 播放。
- 核对加载器和实际绘制宿主保留每段 `outInterpolation`、空值/缺字段语义及采样函数。v2 动作非末帧显式提供 `outInterpolation`，末帧显式 `null`；旧 v1 默认兼容单独处理，不借用别的 clip 曲线。历史宿主曾把 cubic 降成 linear，不能以网页曲线或仅重建客户端发令程序证明修复；要重新构建并确认实际运行的 WezTerm 图形宿主，普通 PTY 输出 OSC 不算原生显示。

## 分层证据与真实输入闭环

局部补画与手形制作使用角色修复 SOP（ECHO 本机未入库：`skill/fb-character-authoring/references/local-repair-and-performance.md`，见 `skill/README.md` 缺失清单）。怪物色底问题要沿 raw→processed→动作 PNG→打包资源→校验后的客户端缓存追溯，保存源帧和实际合成对照。不要对所有紫色像素运行全局删色，避免删除合法紫色角色/技能；抠图 job done、PNG 含 alpha 或少量透明像素都不能证明背景已清除。

攻击 Socket、受击锚点与脚底原点分别交付。检查飞行开始/离手/权威命中三个时点；若当前协议在 effect time 才选择目标，先补充信息设计并确认职责，不能用客户端延迟伤害或自行选敌弥补。重连只恢复当前状态。

1. FB：同候选、动作、装备、时间与 1x 速率，查看整身、关节/握点、完整动作与收势、循环和切换；留数值诊断、连续播放和关键帧证据。相邻段速度与播放器帧间隔分别定位，采样间隔中位数不等于稳定显示 FPS。
2. 客户端：完成 LIAF 组包与资格检查，在正式 `client liaf-preview` 或原生隔离预览消费同包，记录客户端与宿主构建。常用验证为 `cargo test -p liaf`、`cargo test -p tui-rpg-client`；工作台相关再运行 `client liaf-preview`。Vite 网页预览不能替代正式终端。
3. 真实输入：在实际工作台/游戏窗口执行动作选择、播放、刷新、换装等目标输入，记录输入、时点和装配；取得输入后的宿主合成窗口截图及原始时间序列，再实际连续播放复核。对照预期动作/装备/digest 与 diagnostics，不以直接采样或一张截图代替输入闭环。有截图服务时核对 `X-Capture-Scope: game_window/post-composition`，记录截图与原始帧路径。
4. 后端：`validate_liaf_package.ps1` 与正式 monster archive admission 做准入，默认 registry 失败闭合；fixture/local candidate registry 仅用于对应隔离范围，CLI 不创建 draft 或激活。隔离 preview 只验本地未激活资源，Worker 收据不替代在线战斗；在线验收另记录普通账号、实际配装、权威事件与窗口连续播放证据。
5. 发布：按总手册的 Admin draft → validate → preview → publish → prepare → activate 流程，保留原因、resource version、diagnostics、publication job/release ID。失败修 draft 后 retry/cancel，不改库绕过。激活与生产部署分别记录，部署遵循后端运维流程与已有授权。

## 最小交接收据与恢复

收据包含内容卡、可编辑 source/受控 ZIP、project/revision/candidate、实际包版本与 archive SHA、依赖/资源闭包、构建、执行命令、诊断、FB/客户端截图、原始帧与播放观察范围、后端 admission/draft/job/release ID，以及未过项。分别标明 local preview、import validated、activated、deployed，未执行项明确写未执行。

握持或外观错位回 FB 修绑定；消费端丢插值、版本/轴心差异保留同包两边证据交客户端，不能改姿态掩盖；怪物动画正确而战斗错误回 Worker/Kernel 的确定性诊断；prepare 失败保留草稿审计补资源或兼容性。失败候选不覆盖旧合格包，不删除源工程或失败证据。
