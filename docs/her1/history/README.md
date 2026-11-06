# her1 历史记录（只读）

2026-11-03 从 ECHO / box 缓存原样迁入的执行记录，用来追溯“为什么现在是这样”。**当前状态只看 [`../README.md`](../README.md) 与 [`../state.json`](../state.json)**；这里的内容不再更新。

阅读时注意：

- 文中的 `/workspace/art/…`、`/workspace/uploads/…`（box）与 `E:\CodexBuild\…`、`p19/her1/stage_*.py`、`revert-her1.json`（ECHO）路径都**不在仓库里**，缓存清理后可能已不存在。仓库内等价工具是 `scripts/her1/`。
- `FIXED.md`（her1f）用的 translate-far `[5000,5000,0]` 藏层**已被禁止**，由 `FIXED2.md`（her1g，rest-hide + SHOW-only）取代。不要照它操作。
- `her1b`、`her1am_c21j`、`her1am3b`、`her1am_c21l`、`her1am_c21m` 都是退役 tag（原因见 `state.json` 的 `retiredClipTags`）。
- 规则冲突时以 [`skill/fb-character-authoring/references/region-visibility.md`](../../../skill/fb-character-authoring/references/region-visibility.md) 为准。

| 文件 | 内容 |
| --- | --- |
| `PROJECT_HANDOFF_20261103.md` | ECHO 的云端移交说明（本次迁移的输入） |
| `REPORT.md`、`MAPPING.md`、`bind-meta.json`、`equip-her1.json` | her1 首次入库（rev 330→334）与分件映射，以及之后各波次摘要 |
| `KNEE_FIX.md`、`M1_IRON.md`、`KNEE_BEND_IRON.md`、`ELBOW_NEAR_IRON.md`、`KNEE_G2G5_IRON.md` | 膝缝与肘/膝铁桶入库（M1；M2 接线未做） |
| `FIXED.md`、`FIXED2.md` | her1f（已作废）与 her1g 显隐修复 |
| `HAND_T03_IRON.md`、`HAND_T04_IRON.md`、`HAND_T05_IRON.md` | G3/G4/G5 her1 握枪手装备 |
| `HAND_T03b_IRON.md`、`HAND_T03b_FIX.md` | G3 支撑手 rematerialize 与 her1am3c |
| `HAND_T01b_IRON.md` | G1 待机远侧手 idle-support（c21k） |
| `HAND_T09_IRON.md` | 近侧大臂腋下清理 |
| `HAND_T10_IRON.md`、`t10_fix/` | T10 透视三件、c21l 悬空、c21n 全 STRIP |
| `HAND_T03c_OPEN.md`、`HAND_T10b_OPEN.md` | 两个待交美术包的开包记录 |
| `*-update-meta.json` | 各波次写入时的素材 id、rev 与操作摘要 |
