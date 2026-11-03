# her1 报告：恢复拆分 PSD → FB 零件包（加性暂存）

更新时间：2026-10-24 22:29（Asia/Shanghai）

## 结论（先看这个）

- 源：分层 PSD「拆分-恢复的.psd」19 层（5400×7200）→ 对齐 420×820。
- scale≈**0.477671**，placement=**[85, 221]**（高度对齐 redraw1 content≈599px；水平居中）。
- 硬阈值 alpha&lt;128→0（原生分辨率先硬切再缩放）；手套/皮肤→r153；衣服/枪/发保留青绿橙。
- 手套裁切：**成功**（`ask_artist_glove_only=False`）。不需要对接师再交「手层只留手套」。
- FB **已加性写入**（rev 330→334）。请用 **her1b**；未改 live、未碰 art01/art02、未改已有 scale 轨。

## 映射摘要

详见 `MAPPING.md` / `parts_map.json`。入库 17 binding + 枪/开火手/支撑手装备材料。

| 她的层 | FB | native | 备注 |
|---|---|---|---|
| 头 | att-head-her1 | [126, 117] | cheek=拷贝 |
| 腰以上 | att-torso_upper-her1 | [105, 124] | |
| 裙子胯 | torso_lower + pelvis | [113, 36] / [135, 68] | split_y=471 overlap=8 bbox=(131, 435, 266, 531) |
| 近处大臂/小臂 | upper_arm_near / forearm_near | [70, 61] / [46, 34] | 小臂=去手套皮肤 |
| 近侧射击手 | grip-hand (equip) | [72, 44] | thick-dark 手套裁 |
| 枪 | gun-rigid (equip) | [73, 50] | |
| 远处大臂/小臂 | p19x upper/forearm far | [61, 84] / [25, 39] | 小臂=去手套皮肤 |
| 远处支撑手 | p15-support (equip) | [54, 52] | thick-dark 手套裁 |
| 近/远腿脚膝 | thigh/calf/shoe/knee ×2 | 见 map | 有膝层 |
| 身体 | — | backup only | 不入库 |
| 肩罩/肘帽/远肘桶 | 空占位 | — | 可沿用旧小件 |

## 空缺 / 弱件 / 虚边残留

| 类型 | 项 |
|---|---|
| 空占位 | att-shoulder_cap_near, cap_near, cap_far, att-p19y-elbow_far-c21-p65 |
| 弱件 | （前臂皮肤残段覆盖一般，已入库） |
| 虚边 | 原生硬阈值后 LANCZOS RGB+NEAREST alpha；对比 `work/cmp_alpha_hard_head.png` |
| 叠层 | 远侧臂/cheek/thigh_far 等**可能仍露旧图**（安全策略：不改已有 scale 轨，与 redraw1 同坑） |
| 前臂 | 去手套后仅皮肤；与手互斥 |

## FrameBaker（加性）

- 机器：ECHO `b4abf5bf-…`，PORT 39127，project `90acc389-…`，`storage-wqy-pilot`
- 工作目录：`E:\CodexBuild\demo-final-20261015\phase15\p19\her1\`

| 步骤 | rev | 内容 |
|---|---|---|
| before | 330 | redraw1b 之后 |
| bind | 331 | 17× `*-her1` binding 附件+槽（rest scale 0.001） |
| equip | 332 | `c34-g1-K05-p19y-her1`（枪+开火手+支撑手；grip 帧共用开火手） |
| clips | 333 | `c34-g1:*-clip-her1b`（**只 ADD scale 轨**；skipped_existing=10） |
| actions | 334 | `c34-g1:her1bt-{idle,prepare,aim,fire,recover}` |
| current | **334** | |

**请测：** `c34-g1:her1bt-{idle,prepare,aim,fire,recover}` + 装备 `c34-g1-K05-p19y-her1`

回退：`p19/revert-her1.json`（box 副本 `/workspace/art/her1/revert-her1.json`）

未改：live 指针、art01/art02、r75/r70–r76、8188/Comfy、prod deploy。

## 手/臂决策（是否还要对接师）

- 近侧开火手：从「近侧射击手」thick-dark 裁手套 → **成功**
- 远侧支撑手：从「远处支撑手」thick-dark 裁手套 → **成功**
- 对比小图：`pkg/03_效果预览/her1_cmp_hand_fire.png` / `her1_cmp_hand_sup.png`
- **是否还需要对接师让她「手层只留手套」：否**

## 预览

- `/workspace/art/pkg/03_效果预览/her1_aligned_source.png`
- `/workspace/art/pkg/03_效果预览/her1_reassembled.png`
- `/workspace/art/pkg/03_效果预览/her1_parts_sheet.png`
- `/workspace/art/pkg/03_效果预览/her1_compare_redraw1.png`
- `/workspace/art/pkg/03_效果预览/her1_cmp_hand_fire.png`
- `/workspace/art/pkg/03_效果预览/her1_cmp_hand_sup.png`

## 文件索引

```
/workspace/art/her1/parts/           # 零件 PNG
/workspace/art/her1/stage/           # FB 上传用（含 spec.json）
/workspace/art/her1/parts_map.json
/workspace/art/her1/MAPPING.md
/workspace/art/her1/REPORT.md
/workspace/art/her1/revert-her1.json
/workspace/art/her1/work/            # 对齐、对比、备份身体
ECHO: p19/her1/stage_her1.py, stage_her1b.py
ECHO: p19/revert-her1.json
```


## her1k 膝缝改（2026-10-25）

- 源：`拆分-恢复的_膝缝改5.psd`（v5 PASS：远侧重叠30 / 膝覆盖100%；近侧13）
- **原地更新** 6 个 `*-her1` 腿材料（rev **334→335**）；未改 live/art01/art02/scale 轨/clips/actions/equip
- 详见 `KNEE_FIX.md`；回退见 `revert-her1.json` → `her1k`
- 预览：`pkg/03_效果预览/her1k_{far_knee_compare.png,reassembled.png,far_knee_bend.gif}`

## her1m1 铁桶首开（2026-10-25）

- 肘六档 PASS v9 + 膝 g1 PASS v3 → **rev 335→336**
- ADD 6× elbow `*-her1`；UPD 2× knee materials（120 cell）
- clip 铁桶接线 **未做**（M2）；详见 `M1_IRON.md` / `revert-her1.json`→`her1m1`
- 预览：`pkg/03_效果预览/her1m1_{elbow_buckets.png,elbow_bend.gif,knee_compare.png,fb_aim.png,fb_idle.png,reassembled_offline.png}`


## her1kb 远膝弯角铁桶（2026-10-25）

- 源：`_check_膝_弯角_v2` PASS ×6（120×120）→ **rev 336→337**
- ADD 6× `att-p19x-knee_far_bend_p{45,65,75,90,105,120}-her1` on `calf_far`（rest hide）
- clip 铁桶接线 **未做**（M2）；live/g1/肘/equip **未改**
- 详见 `KNEE_BEND_IRON.md` / `revert-her1.json`→`her1kb`
- 预览：`pkg/03_效果预览/her1kb_{knee_far_bend_buckets.png,knee_far_bend.gif}`

## her1ne（2026-10-26）近肘六档铁桶 ADD

- rev **337→338**；模板 `att-cap_near`；do 2174/2176/2177/2178/2179/2181
- 预览：`pkg/03_效果预览/her1ne_{elbow_near_buckets.png,elbow_near_bend.gif}`
- 详见 `ELBOW_NEAR_IRON.md` / `her1ne-update-meta.json`

## her1kg（2026-10-26）膝 g2–g5 × 远近 八档 ADD

- rev **338→339**；模板=各 live `att-p19x-knee_{far|near}_g{N}`（8/8 已存在）
- do far 832/833/834/836 · near 837/838/839/841
- 预览：`pkg/03_效果预览/her1kg_{knee_g2g5_buckets.png,knee_g2g5.gif}`
- 详见 `KNEE_G2G5_IRON.md` / `her1kg-update-meta.json`

## her1t03（2026-10-26）T03 SMG K02 握枪手 ADD equip

- 源：`_check_手_T03_v1` PASS（fire ~20px / support 0px 仍 PASS）→ **rev 339→340**
- ADD `c34-g3-K02-p19v-p19y-her1`（clone live；只上传两手材料）
- live / clips / actions / art01 / art02 / 既有 her1* **未改**
- 预览：`pkg/03_效果预览/her1t03_hand_g3_{buckets.png,gif,strip.png,composite_ref.png}`
- 详见 `HAND_T03_IRON.md` / `her1t03-update-meta.json` / `revert-her1.json`→`her1t03`

## her1t04（2026-10-26）T04 rifle K01 握枪手 ADD equip

- 源：`_check_手_T04_v1` PASS（fire Δ21 / support Δ42）→ **rev 340→341**
- ADD `c34-g4-K01-p19y-her1`（clone live；只上传两手；legacy-support 共用支撑手材料）
- live / clips / actions / art01 / art02 / her1t03 / 既有 her1* **未改**
- 预览：`pkg/03_效果预览/her1t04_hand_g4_{buckets.png,gif,strip.png}`
- 详见 `HAND_T04_IRON.md` / `her1t04-update-meta.json` / `revert-her1.json`→`her1t04`

## her1t05（2026-10-26）T05 sniper K07 握枪手 ADD equip — T03–T05 完成

- 源：`_check_手_T05_v1` PASS（fire Δ9 / support Δ46）→ **rev 341→342**
- ADD `c34-g5-K07-p19y-her1`（clone live；只上传两手）
- live / clips / actions / art01 / art02 / her1t03 / her1t04 / 关节 her1* **未改**
- 预览：`pkg/03_效果预览/her1t05_hand_g5_{buckets.png,gif,strip.png}`
- 详见 `HAND_T05_IRON.md` / `her1t05-update-meta.json` / `revert-her1.json`→`her1t05`

