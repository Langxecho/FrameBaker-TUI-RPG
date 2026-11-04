# HELLO WORLD her1 状态页（单一真相源）

本页与同目录 [`state.json`](state.json) 一起构成 her1 角色项目的唯一状态记录。2026-11-03 起 ECHO 本机与 box 缓存会被清理，**不要在仓库外另留“最新状态”**；任何写入 ECHO 后，先更新这里再结束工作。

- 人读：本页（规则、指针、待办、下一步）。
- 机读：`state.json`（脚本 `scripts/her1/` 读取它做 live 核对、指针核对和接线闸门；写入成功后脚本会自动回写）。
- 执行：[`ECHO_RUNBOOK.md`](ECHO_RUNBOOK.md)（在 ECHO 上一条命令完成 check → rematerialize → 薄接线）。
- 历史证据：[`history/`](history/README.md)（交接时的原始 HAND/FIXED/REPORT 记录，只读）。
- 美术包合同：[`packs/T03c/`](packs/T03c/)、[`packs/T10b/`](packs/T10b/)（`_task.json` 与给画师的说明原件；PSD 本体只在 ECHO 包目录）。

两处不一致时以 `state.json` 为准，并在同一提交里修正本页。

## 1. 硬规则（违反即失败）

1. **live 只读**：不改 live 轨、live 装备、live 素材、live clip（`*-clip-p16k10`）及 art01/art02、r70–r76、8188/Comfy、prod deploy。所有改动只落在加性 `*-her1` 对象上（binding 附件、装备、clip、`her1bt` 动作）。ECHO 明确书面同意前不例外。
2. **显隐只用两层**：binding rest.scale（`[0.001,0.001,1]` 默认隐藏）+ clip `att:` scale SHOW（`[1000,1000,1]`）。**禁止 translate-far 藏层**（her1f 的 `[5000,5000,0]` 已作废）。完整规范：[`skill/fb-character-authoring/references/region-visibility.md`](../../skill/fb-character-authoring/references/region-visibility.md)。
3. **idle-support 用 STRIP，不用 HIDE-scale**：给 `p15-idle-support` 写 clip 0.001 会 `PREVIEW_RENDER_FAILED`（her1am_c21j 教训）。
4. **大关节用角度铁桶 sprite-swap**（p45/p65/p75/p90/p105/p120），小弯用 overlap + joint patch。描边 RGB(9,5,9)，open_edge 切口不算描边缺口。
5. **接线永远开新 tag**：从当前指针所在的基线 clip 派生 `*-clip-<新tag>`，只改本次涉及的 her1 附件 `att:` scale 轨，再把 `her1bt` 动作改指向新 clip；旧 clip 保留作回退。退役 tag（见 §3）不得复用。
6. **先自审再对接美术**：按 [`skill/her1-fb-self-qc`](../../skill/her1-fb-self-qc/SKILL.md) 自己渲染、看图（剪影、贴合/锚点、悬空、缺段、live 孪生件冒出）。只有确认素材本身必须重画时才联系美术对接师；接线类迭代不打扰对接师。check / audit / 渲染成功都不等于视觉通过。
7. **云端不能直连 ECHO**：云端 agent 只改仓库（文档、`state.json`、脚本、测试）。对 ECHO FrameBaker 的写入只能由 ECHO 执行 `ECHO_RUNBOOK.md` 中的命令完成；没有 ECHO 回执就不要写“已上线/已改”。

## 2. 环境（ECHO）

| 项 | 值 |
| --- | --- |
| 机器 | ECHO `b4abf5bf-…` |
| FB MCP | `http://127.0.0.1:39127/mcp`（Streamable HTTP；REST 同端口 `/api/*`） |
| 项目 | `90acc389-43ae-44de-bb7e-daed07f85472`，storage `storage-wqy-pilot` |
| 最后已知 revision | **1339**（2026-11-04 T03c 落地后，ECHO 回报 live 快照一致） |
| 编辑预算余量 | **未知**：rev 1335 时余 85，T03c 期间写入 4 次，ECHO 尚未回报新余量。下次 probe 时核实，填回 `state.json` |
| ECHO 工作目录 | `E:\CodexBuild\demo-final-20261015\phase15\p19\her1` |
| ECHO 美术包 | `01_待改/`（开包）→ 画师交 `02_已交/` → 预览 `03_效果预览/` |
| 美术对接师 agent | `f5dc4070-c855-4a83-8313-1b47c4828415`（对画师说话，不讲代码） |

ECHO 运行的 FB 服务比 GitHub 任一分支都新（例如 `aic_render_preview` 不在仓库里）。`aic_apply_operations` / `aic_get_project_summary` 的信封形状以 `origin/codex/aic-fb-pipeline` 的 `apps/server/src/aicCharacter.ts` 为参照；**每次在 ECHO 动手前先跑 `probe`**（见 runbook），以实际 `tools/list` 与 revision 为准。

## 3. 枪种映射与 clip 指针

动作 id = `c34-gN:her1bt-{phase}`，clip id = `c34-gN:{phase}-clip-{tag}`；phase ∈ idle / prepare / aim / fire / recover（部分枪另有 cancel / hit / enter）。

| 枪 | K 码 | 名称 | 当前 `her1bt` → tag | her1 装备（加性） | live 装备（只读） |
| --- | --- | --- | --- | --- | --- |
| **G1** | K05 | 手枪 | **`her1am_c21n`** | `c34-g1-K05-p19y-her1`、`-her1-hd` | `c34-g1-K05-p19y` |
| G2 | — | 左轮 | 未开工（只有膝铁桶 `att-p19x-knee_{far,near}_g2-her1` 入库） | — | — |
| **G3** | K02 | 冲锋枪 MP-9 | **`her1am3c`** | `c34-g3-K02-p19v-p19y-her1`、`-her1-hd` | `c34-g3-K02-p19v-p19y` |
| **G4** | K01 | 步枪 铁脉 AR-77 | **`her1am4d`** | `c34-g4-K01-p19y-her1` | `c34-g4-K01-p19y` |
| **G5** | K07 | 狙击 破晓 | **`her1am5`** | `c34-g5-K07-p19y-her1` | `c34-g5-K07-p19y` |

`her1` 与 `her1-hd` 两件装备共用同一附件 id 字符串（如 `c34-g3-K02-p19v-p19y-her1:support-hand`），rematerialize 时两件都要改。

### 3.1 G1 clip 链（只记关键节点）

| tag | rev | 结果 |
| --- | --- | --- |
| her1b | 333–334 | 首次加性入库；clip 里写 0.001 HIDE-scale → 渲染失败。**退役** |
| her1f | 447–449 | translate-far `[5000,5000,0]` 藏层。**禁止复用** |
| her1g | 456–458 | Region rest-hide + 只写 SHOW；铁桶肘 idle p105、aim/fire 近 p45/远 p65；膝 g1 SHOW |
| her1am_c21i | — | aim keepbase 远臂配方（G3 her1am3c 参照它） |
| her1am_c21j | 1256–1277 | 对 idle-support 写 HIDE-scale → `PREVIEW_RENDER_FAILED`。**退役** |
| her1am_c21k | 1287–1296 | T01b 待机远侧手：idle/prepare SHOW idle-support、HIDE p15；aim/fire/recover 相反 |
| her1am_c21l | 1297–1307 | T10 透视三件 SHOW 在躯干上层 → 悬空。**退役** |
| her1am_c21m | 1307–1335 之间 | 只 SHOW 透视小臂，仍悬空（试验；同期 1318–1325 做过平移扫参也无效）。**退役** |
| **her1am_c21n** | **1335** | 当前：aim/fire/recover STRIP 全部透视件 + StageC，HIDE 基础远臂，SHOW p15。悬空消失但“胸口托出前臂”缺失 → 开 T10b |

### 3.2 G3 clip 链

| tag | rev | 结果 |
| --- | --- | --- |
| her1am3 | — | T03 握枪手 + StageC `FAR_C21C`（只显 live 透视残肢）→ 断腕 |
| her1am3b | — | 额外 HIDE 轨 → `PREVIEW_RENDER_FAILED`。**退役** |
| **her1am3c** | **1268→1274** | 当前：去掉 `FAR_C21C`，远臂 keepbase；support-hand rest `[1,1,1]` 已显示。T03c（rev 1339）只换了素材，没有改这个 clip；T03c 后腕口明显接不上 |
| her1am3d | 未写 | 不再作为 clip 派生：G3 her1-hd 带双手 IK，clip 的远臂旋转被覆盖。`fix-wrist` 在 r1339 快照上搜过 her1 装备杠杆，自审 FAIL，结论**仍需画师新手**（§6 T03c）。tag 保留未用 |

### 3.3 铁桶接线（M2）现状

已入库但接线状态**未在交接中确认**：远膝弯角 `knee_far_bend_p{45…120}-her1`、膝 g2–g5 远/近八档、近肘六档 `her1ne`。her1g 时代只接了肘 p105/p45/p65 与膝 g1；c21l 起 G1 clip“自 k10 重建”，是否保留 her1g 的铁桶 SHOW 需在 ECHO 上用 `call aic_get_project_summary --args`（`actionId` 过滤）核实后记入本节。

## 4. live 只读清单（写入前后都核对）

`probe` / `t03c` / `t10b` / `wire` 每次连接都会比对以下素材前缀，不符即停止；写入后再比对一次 live 快照（非 her1 的 binding 附件、槽、装备、动作逐字节不变）。

| live 对象 | 素材前缀 |
| --- | --- |
| `att-upper_arm_far` | `68a7242a` |
| `att-forearm_far` | `47d77217` |
| `att-upper_arm_near` | `1a614ab6` |
| `att-p19x-upper_arm_far_c22c` | `3dd07aff` |
| `att-p19x-forearm_far_c21c` | `de1c4516` |
| `c34-g3-K02-p19v-p19y:support-hand` | `59fc3f63` |

另：live clip tag `p16k10`、art01/art02、r70–r76、8188/Comfy、prod deploy 均不碰。

## 5. 已落地（全部加性，live 未动）

| 任务 | rev | 内容 | 记录 |
| --- | --- | --- | --- |
| her1 入库 | 330→334 | 17 个 `*-her1` binding 附件（rest 隐藏）+ G1 her1 装备 + her1bt 动作 | `history/REPORT.md`、`MAPPING.md` |
| her1k 膝缝 | 334→335 | 6 个腿素材原地更新 | `KNEE_FIX.md` |
| her1m1 铁桶首开 | 335→336 | 肘六档 ADD、膝 g1 素材更新 | `M1_IRON.md` |
| her1kb | 336→337 | 远膝弯角六档 ADD | `KNEE_BEND_IRON.md` |
| her1ne | 337→338 | 近肘六档 ADD | `ELBOW_NEAR_IRON.md` |
| her1kg | 338→339 | 膝 g2–g5 远/近八档 ADD | `KNEE_G2G5_IRON.md` |
| T03 / T04 / T05 | 339→342 | G3/G4/G5 her1 装备（握枪手） | `HAND_T03/T04/T05_IRON.md` |
| her1f → her1g | 447→458 | 显隐改为 rest-hide + SHOW-only | `FIXED.md`（已作废做法）、`FIXED2.md` |
| T03b | 1252→1253 | G3 支撑手 rematerialize `55fec0ec`（29×31） | `HAND_T03b_IRON.md` |
| T01b | 1255→1296 | G1 待机远侧手 `p15-idle-support`（`56d4bc2e`），clip c21k | `HAND_T01b_IRON.md` |
| T03b-fix | 1268→1274 | G3 → her1am3c | `HAND_T03b_FIX.md` |
| T09 | 1296→1297 | 近侧大臂腋下残留清理（upsert-binding） | `HAND_T09_IRON.md` |
| T10 / T10-fix | 1297→1335 | 透视三件 ADD（`35878b00`/`1475c51c`/`e329720b`，rest 隐藏）；c21l 悬空 → c21n 全 STRIP | `HAND_T10_IRON.md`、`t10_fix/` |
| **T03c** | 1335→1339 | G3 两件 her1 装备 `:support-hand` 换为 `e53e3c92`（178×76，合同 pivot）；clip 仍是 her1am3c | 本页 §6、`state.json` 的 `packs.T03c.landed` |

## 6. 美术包（按优先级）

### T03c（优先级 1）— G3 冲锋枪更大画布支撑手 · **已入库，腕口 FAIL，仍需画师新手**（2026-11-04，rev 1339）

- 检查：v1、v2 FAIL（v1：103 半透明 / 47 描边断口；v2：77 / 48）。**v7 PASS_seam_exempt**：89×38，腕口豁免带 `intended_open_edge_band=[0,0,59,37]`，带外的外露半透明和描边断口都是 0。PSD md5 `4ffa0575…`。v3–v6 的检查结论没有回报。
- 写入：ECHO 在 worktree `F:\CodeProject\FB-her1-run`（`origin/cursor/her1-cloud-handoff-7321`）上执行 check → `t03c --apply`。rev 1335→1336 首次 rematerialize；之后做过 drawOffset / 旧 pivot 试验，又恢复合同 pivot。当前 rev **1339**，live 快照一致。
- 结果：`c34-g3-K02-p19v-p19y-her1` 与 `-her1-hd` 的 `:support-hand` 现为素材 **`e53e3c92`**（`hand_sup_g3_y-her1`），size **[178,76]**，pivot 为合同值 `[0.786517, 0.789474]`。live `59fc3f63` 未动。clip 仍是 her1am3c，没有接线。
- drawOffset 终值：r1339 快照里 `-her1-hd` 的 `:support-hand` 为 0（与 gun-rigid 同层组 `rifle-hold`，主握手 1），rest 为单位变换，挂 `rifle-support`；`:p15-support` rest 隐藏 0.001。
- 自审：**FAIL**。ECHO 复审 G3 五态，支撑手与远臂腕口明显接不上，不是残差级。早先“护木下支撑手在、接腕残差同 T03b”的结论作废。
- 已核实（代码与历史记录）：
  - 合同 pivot 换算正确：pivot_px `[70,8]`（自上）对应 FB 左下原点的 `[70/89, 30/38]`，手图内容与 T03b 同位，问题不在 support-hand 枢轴；
  - `drawOffset` 只影响层序、不移动位置，drawOffset 试验修不了腕口。
- 快照 r1339-g3 离线自渲（ECHO 只读快照，分支 `her1/snapshot-r1339-g3`，未并入 PR）：`render` 52 帧 FAIL 52，`fix-wrist --tag her1am3d` 修前、修后都是 FAIL 52/52。
- **更正**：早先写的“FB 预览不做双手 IK”是错的。`c34-g3-K02-p19v-p19y-her1-hd` 带 `secondaryHandConstraint` `c34-support-ik`（upper_arm_far → forearm_far → hand_far，目标 socket `rifle-support`，bend positive，mix 1，stretch forbid，alignEnd）。FB 预览把远臂解到 `secondaryGrip`，hand_far 的朝向跟枪走，clip 里远臂的旋转被整段覆盖，所以按 clip 派生 her1am3d 无效。离线渲染现已默认按同样的 IK 求解（`--ik weapon-align`）。
- 根因（素材几何，不是接线）：
  - IK 让前臂远端（hand_far 原点）停在指节 pivot 上（= `secondaryGrip` (140,−16)），每一帧都够得着；
  - T03c 的腕口切口离 pivot 约 82 世界单位，切口朝手内方向固定是手图坐标 54°；
  - 前臂进手方向（枪坐标系，0° = 沿枪管指向枪口）：idle 14°（13~15°），aim/fire 132°（130~143°），两组差 118°，一张刚性手图接不住；
  - 修前：aim/fire 切口外侧接上远臂 0%、透底缝 12~36 px，腕口残肢插进上臂/肩；idle 前臂只露 2%（在躯干后），开口腕口浮在躯干上，透底缝 9~14 px。
- 已排除的加性修法（不动 live）：
  - her1 装备杠杆：指节沿枪管 ±40、垂直 ±12、手转 ±20°、两种 bend，最佳仍有 77° 夹角，而且手离开护木；离开枪身的大范围扫描也 ≥51°；
  - 现有 p15 下托手：只有手不在枪上时角度才过关，不可用；
  - clip 派生（her1am3d 旋转轨）：被 IK 覆盖。
- 结论：**仍需画师新手**，两张刚性手图（规格见 `state.json` 的 `packs.T03c.wristFix.artSpec`）：
  - 瞄准手（aim/fire，prepare/recover 后段）：腕口切口中心放在 pivot（= 前臂远端），切口朝枪坐标 −48°（前臂从前下方 132° 进手），袖口宽与前臂图末端一致，约 56 世界单位（2× 下约 28 原生 px），并沿前臂方向盖过前臂图末端（末端在 pivot 后 11）至少 4；
  - 待机手（idle，prepare/recover 前段）：远臂前臂藏在躯干后，腕口不能开口，画收口袖口或把腕藏到枪身后（若要画延伸，方向 14°）；
  - 两张都挂 `rifle-support`，rest 隐藏 0.001，按 `att:` scale 换显：prepare 约 t=0.21、recover 约 t=0.13 换手。
- 自审：修前、修后的腕口特写与全身图都 FAIL，`plan.json` 判定 `needs-art`、无写入操作，没有推回 PR，也没有交 ECHO 写入。live 未动。
- **ECHO 真机复核（2026-11-04，rev 1339，只读）**：结论成立，仍需画师新手。
  - `probe` 一致：rev 1339，live 素材 6 项一致，G3 五态 → her1am3c。
  - 离线 IK 与真机一致：`aic_sample_pose` 五态 35 个时刻 × upper_arm_far / forearm_far / hand_far / hand_near，离线 `--ik weapon-align` 位置、角度误差都是 0。
  - 真机 `aic_render_preview`（1024，her1-hd）目视自审 FAIL：idle / recover 末段远臂在躯干后，开口腕口浮在胸前；prepare 后段 / aim / fire 肘甩到枪口一侧前下方，前臂从右下回折进手，手指指回肘部。证据 `evidenceId` 前 8 位：idle 1.5 `11117c2f`、prepare 0.315 `1dc3d0a2`、aim 1.2 `af3a9013`、fire 0.15 `33a24781`、recover 0.125 `106d88bd`、recover 0.5 `59ccff2e`。
  - 换手时刻细采样（前臂从腕指向肘，手图/枪坐标）：prepare 0~0.15 为 −166°~−141°，0.18 −104°，0.21 起 −52°；**0.24~0.36 过冲到 −37°~−6°**，0.39 回到 −46°。recover 0.06 前 −48°~−50°，0.09 −72°，0.12 −112°，0.15 起 −140°~−167°。瞄准手在 prepare 0.24~0.36 仍会有最多约 42° 的错位：要么接受这几帧，要么让对接师加一张过渡手，要么由 ECHO 决定是否平滑 prepare 的持枪轨迹（动作设计层面）。

### T10b（优先级 2）— G1 手枪瞄准远侧前臂胸口托出 · 等画师

- 状态：`waiting-artist`，包已经交给对接师。尚无回稿。
- 合同：必交 `att-p19x-forearm_far_foreshrt_g1aim`（**25×39** → 50×78，pivot `[0.298810, 0.823529]`）；可选手肘 `att-p19x-elbow_far_foreshrt_g1aim`（72×72 → 144×144，pivot 0.5/0.5）。大臂不在包里，继续被胸口挡住（STRIP）。目标剪影对照 `正确.jpg`：前臂从胸口后方托出到枪底。
- 目标：binding 附件 `att-p19x-forearm_far_foreshrt_g1aim-her1`（现 `1475c51c`）、可选 `att-p19x-elbow_far_foreshrt_g1aim-her1`（现 `e329720b`）；`att-p19x-upper_arm_far_foreshrt_g1aim-her1`（`35878b00`）保持 STRIP。
- 接线：以 `her1am_c21n` 为基线开新 tag **`her1am_c21o`**，aim/fire SHOW 前臂（交了手肘则一并 SHOW），大臂 STRIP；idle/prepare/recover 仍指 c21n。recover 是否也 SHOW 由自审决定（加 `--phases aim,fire,recover`）。
- 下一步：画师交回后，ECHO 先 `probe`（期望 rev 1339），再跑 runbook §4，然后对照 `正确.jpg` 自审（同枪、同动作、同时间），最后写回本节。

### 其余美术债（尚未开包）

腰缝旋转露缝；脸/颈洞；近肘缺比 p45 更直的一档（aim 约 30°）；膝 g1 接缝；握枪手↔前臂接缝。（G3 远臂接腕已转入 T03c 的腕口修正，见上。）开包前先自审确认属于素材问题，再按 skill 流程开 `01_待改/`。

## 7. 更新协议

1. 动 ECHO 前：`bun run her1 probe`。revision 不是 §2 记录值时先查明变化来源，更新 §2、§3 和 `state.json`。
2. 美术回稿：`bun run her1 check --pack <T03c|T10b> --input <psd> --record`。FAIL 直接退回，结论自动追加到 `state.json` 的 `checkHistory`，同时在 §6 补一句。
3. 写入：`t03c` / `t10b` / `wire` 先 dry-run，核对计划后再加 `--apply --expected-rev <probe 给的 revision>`。成功后脚本回写 `state.json`（素材、尺寸、状态、分相位 tag、revision），回执在 `storage/her1-runs/<run>/`。
4. 自审：按 `skill/her1-fb-self-qc`。把结论（PASS/FAIL、预览路径、问题）写进 §6 对应小节；PASS 后才把 GIF/关键帧发给 ECHO。
5. 指针变化：更新 §3 表格与链表；被替代且有问题的 tag 加入 `state.json` 的 `retiredClipTags`。
6. 提交：`docs/her1/README.md` 与 `docs/her1/state.json` 同一提交。预览图、PSD、运行回执不入库，只在本页记 ECHO 路径。
