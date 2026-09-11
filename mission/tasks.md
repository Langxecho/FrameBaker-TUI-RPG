# FrameBaker 任务卡

负责人：素材编辑器组员；主开发分支 shy。
任务初始状态见 [handoff](handoff.md)，不得把设计中的能力当成已存在。

## FB-00 导出入口与运行时差异审计（可立即开始）

检查 packages/shared/src/monster.ts、apps/server/src/monsterExtractZip.ts、
apps/web/src/export.ts、skeletalExport.ts、publishDiagnostics.ts、
packages/shared/src/animationPackageV2.ts、animationPackageV3.ts、
equipment.ts、actionComposition.ts、frameGeometry.ts 及实际 UI 入口。
交付：mission/FB-00 审计报告；“制作可表达 → 当前导出保留 → 客户端可消费”
逐项矩阵。指出 PNG ZIP 缺失语义、v2/v3 入口差异、warp/mesh/附件偏移限制，
用真实工程与导出包复现，不仅引用设计文档。
提出素材最小 schema 增量、时间/坐标/标记方案、标准 Gunner 身份和烘焙代价。
验收：Q-01/02/06/07 有明确提案，C-00 能复核消费者结果。

## FB-01 面向 LIAF 的逐帧素材交付

依赖：FB-00；G0 素材/坐标/时间合同冻结。
在现有怪物导出上增量交付稳定 ID、动作/时长/循环/朝向、
统一原点/裁剪偏移、固定或逐帧挂点、语义标记、资源 digest/依赖。
保持 24 FPS 时间精度，镜像挂点和图像同步；导出离线可校验且内容确定。
交付：A1 实际素材包、schema/正负 fixtures、制作工程来源说明与教程。
若现有 A1 来源只有帧图，明确导入制作工程，不能伪称由新 AI 流水线生成。
验收：待机/攻击切换不跳位；FrameBaker 与客户端相同采样时刻挂点一致；
重导出稳定身份不破坏 C-01 绑定；资源不完整不产生假成功包。

## FB-02 A1 发射/命中素材与可用制作入口

依赖：FB-01、G0 的 A1 时间语义与 C-00 能力反馈。
提供编辑/预览原点、枪口、受击点、发射标记的实际入口，
并制作最小枪口闪光、弹道/曳光、金属命中火花的可复用素材。
动作标记只表达美术时刻；不在素材包中决定命中目标或伤害。
交付：与 C-02 支持能力匹配的素材和采样参考；
标明已有素材复用或新增来源，不要求自动调用收费生成服务。
验收：C-03 使用实际交付物完成 G1；挂点、裁剪、透明度与方向正确。
UI 按仓库 i18n/notice 规则；错误定位到具体动作/挂点，允许保存未完工程。

## FB-03 Gunner 目标运行时导出

依赖：G2；Q-01/06 的骨骼/装备合同冻结。
明确“导出到终端 RPG”入口，贯通标准 Gunner rig、BodyProfile、
rifle_two_hand、hold/aim/fire/recoil、muzzle 和一个装备关联效果。
核对普通 v2 导出、v3 发布、材质加载的真实工程路径；
仅实现确认可支持的转换，不能静默丢掉装备/事件/约束。
必需 warp/mesh 能力不支持时明确阻断或采用显式批准的烘焙模式，
说明动态换装等损失，不把整角色帧图当成完整骨骼兼容。
交付：可编辑来源工程、确定性 runtime 包、能力声明、
与客户端同步的 canonical fixtures 及双手持握采样参考。
验收：不是只让 minimal-region fixture 通过；
C-05 读取真实工程导出物，B-05 场景完成 G3。

## FB-04 一把传说武器专属动画与技能素材

依赖：G3、B-06/C-06 的实际能力合同。
制作适配标准 rig 的专属动作、武器自身动画或效果覆盖，
明确 action 覆盖、持握与 socket 依赖；技能素材按权威阶段需要制作。
交付：单一武器样例及一个技能案例的素材闭包、语义标记、适配声明和参考演出。
验收：客户端实际组合后姿态/时间正确，非法 rig/挂点失败可定位；
不扩展任意复杂装配或自动跨骨架适配，与两组完成 G4。

## Fixtures、验证和手册

FrameBaker 继续拥有 canonical .fbanim-v3 fixture 字节；
生产者提供 manifest/期望摘要/采样，消费者验证同字节而非重新生成近似样例。
先执行 `bun scripts/sync_fbanim_fixtures.ts --target F:/CodeProject/tui-rpg-terminal-engine --dry-run`；
实际同步前与客户端组核对目标差异，不覆盖已有修改。
新逐帧交付 fixture 的存放路径由 G0 冻结，不发明缺失文件。

按当前 package.json 使用 `bun run typecheck`、`bun run test`、
涉及版本记录时 `bun run version:check`；先跑改动相关 focused tests。
导出 UI 需实际操作与文件检查，单元测试不能替代。
更新必要的中英文架构/API、制作教程和运行时能力矩阵；
交接包不得包含生成服务密钥、storage 数据库或个人绝对路径依赖。
