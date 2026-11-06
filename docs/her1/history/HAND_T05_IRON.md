# her1t05 · T05 狙击枪（破晓 / K07）握枪手入库

更新时间：2026-10-26（Asia/Shanghai）

## 结论

- 源：美术 PASS `_check_手_T05_v1` — 射击手 Δ9px；支撑手 Δ46px → **两只都导入**
- **加性**写入：clone live `c34-g5-K07-p19y` → **`c34-g5-K07-p19y-her1`**
- 只上传两张手 PNG；**gun-rigid / p15-support 材料保留自 clone**
- Live 核实：4 attachment，前缀 **`c34-g5-K07-p19y:`**（无 legacy；非 `_task.json` 较短 `c34-g5-K07:`）
- **未改** live / art01 / art02 / clips / actions / equip-pointer / scale 轨 / her1t03 / her1t04 / 关节 her1*
- **T03–T05 手零件串完成**

## 零件

| 角色 | PNG | native→rig | pivot | LIVE → NEW |
|---|---|---|---|---|
| 射击手 | `hand_fire_g5_y-her1.png` | 32×39 → 64×78 | `[0.3125, 1.0]` | `…p19y:grip-hand` → `…p19y-her1:grip-hand` |
| 支撑手 | `hand_sup_g5_y-her1.png` | 31×28 → 62×56 | ≈`[0.6774, 1.0]` | `…p19y:support-hand` → `…-her1:support-hand` |
| 枪体（保留） | — | live | live | `…:gun-rigid` → `…-her1:gun-rigid` |
| p15（保留） | — | live | live | `…:p15-support` → `…-her1:p15-support` |

## 预览（离线）

- `/workspace/art/pkg/03_效果预览/her1t05_hand_g5_buckets.png`
- `/workspace/art/pkg/03_效果预览/her1t05_hand_g5.gif`
- `/workspace/art/pkg/03_效果预览/her1t05_hand_g5_strip.png`
- 副本：`/workspace/art/her1/work/her1t05/`

## 脚本

```
cd E:\CodexBuild\demo-final-20261015\phase15
python p19/her1/stage_her1t05.py dry 341
python p19/her1/stage_her1t05.py apply 341
```

闸门：`assert rev()==341` 且 `NEW not in equipment`。

## 已写入（rev **341→342**）

（apply 后填）

| 操作 | id | materialId（短） |
|---|---|---|
| ADD equip | `c34-g5-K07-p19y-her1` | — |
| NEW mat | grip-hand (fire) | `39ce659b` |
| NEW mat | support-hand | `38b6ea32` |
| KEEP | gun-rigid | `e5a5436f` (clone) |
| KEEP | p15-support | `72b1b2d5` (clone, rest hide) |

完整 UUID 见 `her1t05-update-meta.json`。
