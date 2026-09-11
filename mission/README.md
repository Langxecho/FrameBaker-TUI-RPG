# LIAF 流水线任务中心：素材编辑器组

负责人：FrameBaker 组员。主开发分支 shy（用户指定），不是 main。
本目录 R0 为任务和契约草案，不代表导出已与游戏运行时兼容。

阅读 [共享契约](contracts.md) → [素材编辑器任务](tasks.md) → [状态与交接](handoff.md)。
总体路线由后端仓库 挂机game/mission/program.md 维护。
先执行 FB-00。无需等待客户端 UI 完成即可审计导出路径和准备样例。

## 所有权

负责怪物逐帧、角色骨骼、装备/武器与特效素材制作及目标运行时导出。
LIAF 游戏定义、机制绑定与交互编排由客户端组负责。
后端决定所有真实命中/伤害/时序；制作端动作标记不能驱动权威结算。

## 当前入口

参考 [架构](../docs/architecture.zh-CN.md)、
[怪物制作练习](../docs/monster-blade-guard-test.zh-CN.md)、
[已有装备与武器设计](../docs/superpowers/specs/2026-08-25-equipment-weapon-animation-runtime-design.md)。
shy 的怪物流水线导出 PNG ZIP，不自动等于 .monster。
普通角色导出 export.ts 仍走 v2；v3 发布/fixtures 路径需分别核对。
不能把 fixture 可用写成任意用户工程都能导出。

## 执行规则

先遵守 AGENTS.md 并核对本地状态；保留 .superpowers/、skills/ 等已有内容。
任务文档的提交不代表产品任务已实施；初始化时未修改导出器、运行服务或生成付费素材。
后续按任务所需更新中文 UI/i18n、必要的中英文 API/架构文档和版本记录；
代码测试命令以当前 package.json 为准，已有 bun test。
跨仓库 fixtures 同步先 dry-run，核对客户端已有文件后由双方交接。
