# Region 显隐、铁桶与换图（唯一规范）

本页是 Region 切件角色“藏层 / 显示 / 铁桶 sprite-swap / 换手图”的唯一规范。其他 SOP、her1 记录和脚本只引用这里，不各自另写一套。证据来源见 `docs/her1/history/`（FIXED、FIXED2、HAND_T01b_IRON、HAND_T10_FIX）。

## 两层模型

部件是否可见只由两层决定，有效缩放 = **binding rest.scale × clip `att:<attachmentId>` scale**（渲染矩阵 `boneWorld × rest × offsetMatrix(t)`，见 `docs/pose-motion-system.md` §15）。

| 层 | 作用 | 写法 |
| --- | --- | --- |
| binding 层 attachmentVisibility | 部件默认是否可见 | `rest.scale=[0.001,0.001,1]` 默认隐藏；`[1,1,1]` 默认可见 |
| clip 层 `att:` scale 轨 | 某动作/时段临时显示 | 只写 SHOW（见下表），不写隐藏 |

当前 Region schema 没有独立的 `attachmentVisibility` 字段，“binding attachmentVisibility”就是 rest.scale。若运行中的服务以后提供独立字段，先 `tools/list` / `aic_get_capabilities` 确认，再在本页补规则。

## 操作字典

| 操作 | 含义 | 何时用 |
| --- | --- | --- |
| **SHOW** | 对 rest 0.001 的部件写 clip scale `[1000,1000,1]`（有效 1） | 该动作要显示的换图、铁桶档、透视件 |
| **STRIP** | 新 clip 里删除该部件全部 `att:` scale 轨，回落 rest | **默认隐藏手段**；rest 0.001 部件 STRIP 即隐藏 |
| **IDENT** | step 关键帧写 `[1,1,1]`，有效仍为 rest 0.001 | 同一动作内定时切换铁桶时，非活动段的键 |
| **KEEPBASE** | 保留基线 clip 中原有轨道不动 | 不属于本次改动的部件 |

禁止操作（违反即失败）：

1. **translate-far 藏层**：任何把部件平移到画外（如 `[5000,5000,0]`、|x|/|y|≥1000）的隐藏法。her1f 曾这样做，已被 her1g 取代，不能复用。
2. **HIDE-scale**：clip 中写 ≲0.1 的 scale 来隐藏。对 rest 已为 0.001 的部件、铁桶档、`p15-idle-support`、带动画的 live 孪生件、`att-shoulder_cap_near-redraw1` 会触发 `PREVIEW_RENDER_FAILED`。
   - 唯一例外：rest 为 `[1,1,1]`、无法 rest-hide 的肘/肩帽 `att-cap_near`、`att-cap_far`、`att-shoulder_cap_near`，her1f/her1g 已验证 clip `0.001` 安全。新增例外必须先有渲染证据并写入本页。
3. 近零缩小（如 0.18）或贴近画面边缘的“看不见”位移。
4. 用 drawOrder 假装遮挡：T10 实测把透视小臂 drawOrder 从 843 改到 228 并不会被躯干遮住。遮挡要靠重画像素或 STRIP。

## idle-support 等换手图

- 换手图（握持帧、待机手、托握拳）都是 rest 0.001 的隐藏附件，按动作 SHOW。
- **idle-support 用 STRIP，不要 HIDE-scale**：对 `p15-idle-support` upsert `[0.001,0.001,1]` 会导致渲染失败。aim/fire/recover 不需要它时，从新 clip 删掉它的轨道即可。
- 枪侧换手图经每把枪的测试装备槽绘制在枪上层，不烘进武器图。

## 铁桶（角度档 sprite-swap）

大角度肘弯、膝弯用多档铁桶：每档一个附件（如 `p45/p65/p75/p90/p105/p120`），全部 rest 0.001。小角度弯曲用 overlap + joint patch，不开铁桶。

- 恒定姿态的动作（idle、aim、fire）：只给当前档 SHOW 常量键；其余档**不写轨道**。
- 定时切换的动作（prepare、recover）：参与排程的档用 step 键，活动段 SHOW `[1000,1000,1]`，非活动段 IDENT `[1,1,1]`；从不参与的档不写轨道。
- 不在 clip 中给铁桶写 `0.001`。
- 新档入库时 binding 只 ADD（rest 隐藏）；接线另开新 clip，不在旧 clip 上补轨。

## 新 clip 与回退

- 接线永远是**加性新 tag**：从当前绑定的基线 clip 复制出 `*-clip-<新tag>`，只改本次涉及的 `att:` 轨，再把对应动作重新指向新 clip。旧 clip 保留为回退点，不原地改。
- 不改 live 轨、live 装备和 live 素材；只写 `*-her1` 这类加性对象，除非用户明确同意动 live。
- 写入走 `aic_apply_operations`，带当前 baseRevision 与新幂等键；写后重新读取并核对 live 未变。

## 自动检查

`bun scripts/her1/her1.ts audit-clip --clip <clip.json> --document <skeletal-document.json>` 会按本页检查 translate-far、HIDE-scale、SHOW 过量和例外名单；阈值与名单来自 `docs/her1/state.json` 的 `visibility` 段，改规则时本页与该段一起改。薄接线脚本（`t10b` / `wire`）在生成新 clip 后强制执行同一检查，有错误就不写入。检查通过只说明没有违反显隐规则，仍需按 [her1 自审](../../her1-fb-self-qc/SKILL.md) 看图。
