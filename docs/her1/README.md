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
| **her1am3c** | **1268→1274** | 当前：去掉 `FAR_C21C`，远臂 keepbase；support-hand rest `[1,1,1]` 已显示。T03c（rev 1339）只换了素材，没有改这个 clip |

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

### T03c（优先级 1）— G3 冲锋枪更大画布支撑手 · **已落地**（2026-11-04，rev 1339）

- 检查：v1、v2 FAIL（v1：103 半透明 / 47 描边断口；v2：77 / 48）。**v7 PASS_seam_exempt**：89×38，腕口豁免带 `intended_open_edge_band=[0,0,59,37]`，带外的外露半透明和描边断口都是 0。PSD md5 `4ffa0575…`。v3–v6 的检查结论没有回报。
- 写入：ECHO 在 worktree `F:\CodeProject\FB-her1-run`（`origin/cursor/her1-cloud-handoff-7321`）上执行 check → `t03c --apply`。rev 1335→1336 首次 rematerialize；之后做过 drawOffset / 旧 pivot 试验，又恢复合同 pivot。当前 rev **1339**，live 快照一致。
- 结果：`c34-g3-K02-p19v-p19y-her1` 与 `-her1-hd` 的 `:support-hand` 现为素材 **`e53e3c92`**（`hand_sup_g3_y-her1`），size **[178,76]**，pivot 为合同值 `[0.786517, 0.789474]`。live `59fc3f63` 未动。clip 仍是 her1am3c，没有接线。
- 待核实：回报只确认 pivot 已恢复，support-hand 的 drawOffset 终值没有回报。下次 probe 时从工程文档核对，记入 `state.json` 的 `packs.T03c.landed.drawOffsetNote`。
- 自审（G3 idle/prepare/aim/fire/recover 自渲）：护木下的支撑手在。远臂接腕仍有已知残差，与 T03b 同类，默认不改 clip。
- 后续（可选）：要处理接腕残差时，先自审确定是接线问题还是素材问题。接线问题用 `wire` 以 her1am3c 为基线开 `her1am3d`，只动远臂相关 her1 `att:` 轨；素材问题再开新包。

### T10b（优先级 2，现为唯一待交包）— G1 手枪瞄准远侧前臂胸口托出 · 等画师

- 状态：`waiting-artist`，包已经交给对接师。尚无回稿。
- 合同：必交 `att-p19x-forearm_far_foreshrt_g1aim`（**25×39** → 50×78，pivot `[0.298810, 0.823529]`）；可选手肘 `att-p19x-elbow_far_foreshrt_g1aim`（72×72 → 144×144，pivot 0.5/0.5）。大臂不在包里，继续被胸口挡住（STRIP）。目标剪影对照 `正确.jpg`：前臂从胸口后方托出到枪底。
- 目标：binding 附件 `att-p19x-forearm_far_foreshrt_g1aim-her1`（现 `1475c51c`）、可选 `att-p19x-elbow_far_foreshrt_g1aim-her1`（现 `e329720b`）；`att-p19x-upper_arm_far_foreshrt_g1aim-her1`（`35878b00`）保持 STRIP。
- 接线：以 `her1am_c21n` 为基线开新 tag **`her1am_c21o`**，aim/fire SHOW 前臂（交了手肘则一并 SHOW），大臂 STRIP；idle/prepare/recover 仍指 c21n。recover 是否也 SHOW 由自审决定（加 `--phases aim,fire,recover`）。
- 下一步：画师交回后，ECHO 先 `probe`（期望 rev 1339），再跑 runbook §4，然后对照 `正确.jpg` 自审（同枪、同动作、同时间），最后写回本节。

### 其余美术债（尚未开包）

腰缝旋转露缝；脸/颈洞；近肘缺比 p45 更直的一档（aim 约 30°）；膝 g1 接缝；握枪手↔前臂接缝；G3 远臂接腕残差（T03c 后仍在）。开包前先自审确认属于素材问题，再按 skill 流程开 `01_待改/`。

## 7. 更新协议

1. 动 ECHO 前：`bun run her1 probe`。revision 不是 §2 记录值时先查明变化来源，更新 §2、§3 和 `state.json`。
2. 美术回稿：`bun run her1 check --pack <T03c|T10b> --input <psd> --record`。FAIL 直接退回，结论自动追加到 `state.json` 的 `checkHistory`，同时在 §6 补一句。
3. 写入：`t03c` / `t10b` / `wire` 先 dry-run，核对计划后再加 `--apply --expected-rev <probe 给的 revision>`。成功后脚本回写 `state.json`（素材、尺寸、状态、分相位 tag、revision），回执在 `storage/her1-runs/<run>/`。
4. 自审：按 `skill/her1-fb-self-qc`。把结论（PASS/FAIL、预览路径、问题）写进 §6 对应小节；PASS 后才把 GIF/关键帧发给 ECHO。
5. 指针变化：更新 §3 表格与链表；被替代且有问题的 tag 加入 `state.json` 的 `retiredClipTags`。
6. 提交：`docs/her1/README.md` 与 `docs/her1/state.json` 同一提交。预览图、PSD、运行回执不入库，只在本页记 ECHO 路径。
