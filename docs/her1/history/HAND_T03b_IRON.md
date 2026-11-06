# her1t03b · T03b 冲锋枪支撑手重画入库（rematerialize-only）

更新时间：2026-10-31（Asia/Shanghai）

## 结论

- 源：美术 PASS `_check_手_T03b_v1` — 支撑手重画贴护木（29×31，552 opaque，Δ126px vs old）
- **仅 rematerialize**：既有加性装备 `c34-g3-K02-p19v-p19y-her1`（及 `-her1-hd`）上的 `:support-hand`
- **未** 从 live 再 clone；**未** 改 grip-hand / gun-rigid / p15-support
- **未** 改 live `c34-g3-K02-p19v-p19y` / live clips `*-clip-p16k10`
- Clip SHOW：已核实 her1 rest.scale support-hand=`[1,1,1]`、p15-support=`[0.001,0.001,1]`；her1bt→her1am3 无需改轨（rematerialize  alone 足够）

## 零件

| 角色 | PNG | native→rig | pivot | att |
|---|---|---|---|---|
| 支撑手 support（新） | `hand_sup_g3_y-her1.png` | 29×31 → 58×62 | ≈`[0.3448, 0.9677]` | `…-her1:support-hand` |
| 射击手（不动） | — | — | — | `…:grip-hand` mat `7c417ebc` |
| 枪体 / p15（不动） | — | — | — | gun-rigid / p15-support |

## 已写入（rev **1252→1253**）

| 操作 | id | materialId（短） |
|---|---|---|
| REMAT support-hand | `c34-g3-K02-p19v-p19y-her1` | `55fec0ec`（was `3593cf75`） |
| REMAT support-hand | `c34-g3-K02-p19v-p19y-her1-hd`（同 att id） | `55fec0ec` |
| LIVE | `c34-g3-K02-p19v-p19y:support-hand` | `59fc3f63` **未改** |

完整 UUID 见 `her1t03b-update-meta.json`。

## 预览（G3 her1bt × her1-hd）

- `/workspace/art/pkg/03_效果预览/her1_t03b_sup/g3_five_actions.gif`
- `/workspace/art/pkg/03_效果预览/her1_t03b_sup/g3_five_actions_large.gif`
- `/workspace/art/pkg/03_效果预览/her1_t03b_sup/g3_aim_fire.gif`
- stills: `g3_{idle,prepare,aim,fire,recover}.png` + `g3_five_strip.png`
- phase15 mirror: `E:\CodexBuild\demo-final-20261015\phase15\p19\her1\render\her1_t03b_sup\`
- 对接师 handoff: `/workspace/uploads/art_handoff_v2/03_效果预览/her1_t03b_sup/`

## 脚本

```
cd E:\CodexBuild\demo-final-20261015\phase15
python p19/her1/stage_her1t03b.py dry <rev>
python p19/her1/stage_her1t03b.py apply <rev>
```

## Self-check

- aim/fire：支撑手贴在护木/前握把上（可见手套手）；**不是**悬空旧料
- 已知无关问题（flag）：远侧小臂腕口与支撑手之间仍有空隙/flesh stump 观感（far-arm 接线/open_edge），非本 PASS 必改项
- Clip SHOW 未改（her1am3 已 SHOW support / HIDE p15 via rest）

## Budget

- apply 前 left≈168；apply 后 left≈167（upload+双 equip upsert 便宜）
