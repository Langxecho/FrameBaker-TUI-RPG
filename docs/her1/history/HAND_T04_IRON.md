# her1t04 · T04 步枪（铁脉 AR-77 / K01）握枪手入库

更新时间：2026-10-26（Asia/Shanghai）

## 结论

- 源：美术 PASS `_check_手_T04_v1` — 射击手 Δ21px；支撑手 Δ42px（open_edge 袖口豁免）→ **两只都导入**
- **加性**写入：clone live `c34-g4-K01-p19y` → **`c34-g4-K01-p19y-her1`**
- 只上传两张手 PNG；**gun-rigid / p15-support / p13g4-support-*** 材料保留自 clone
- Live 核实：SRC 前缀 **`c34-g4-K01-p19y:`** + 共享 **`c34-g4:legacy-support-hand`**（与 support 同材料）+ 9× `c34-g4:p13g4-support-f*`（异材料，保留）
- `_task.json` 较短前缀 `c34-g4-K01:` **未用**（跟 LIVE）
- **未改** live / art01 / art02 / clips / actions / equip-pointer / scale 轨 / her1t03 / 既有 her1*

## 零件

| 角色 | PNG | native→rig | pivot | LIVE → NEW |
|---|---|---|---|---|
| 射击手 | `hand_fire_g4_y-her1.png` | 33×39 → 66×78 | `[1/3, 1.0]` | `…p19y:grip-hand` → `…p19y-her1:grip-hand` |
| 支撑手 | `hand_sup_g4_y-her1.png` | 31×32 → 62×64 | ≈`[0.6774, 1.0]` | `…p19y:support-hand` → `…-her1:support-hand` |
| 支撑手 legacy | （同上材料） | 同上 | 同上 | `c34-g4:legacy-support-hand` → `…-her1` |
| 枪体（保留） | — | live | live | `…:gun-rigid` → `…-her1:gun-rigid` |
| p15 / p13g4（保留） | — | live | live | rename only；材料不动 |

## 预览（离线）

- `/workspace/art/pkg/03_效果预览/her1t04_hand_g4_buckets.png`
- `/workspace/art/pkg/03_效果预览/her1t04_hand_g4.gif`
- `/workspace/art/pkg/03_效果预览/her1t04_hand_g4_strip.png`
- 副本：`/workspace/art/her1/work/her1t04/`

## 脚本

```
cd E:\CodexBuild\demo-final-20261015\phase15
python p19/her1/stage_her1t04.py dry 340
python p19/her1/stage_her1t04.py apply 340
```

闸门：`assert rev()==340` 且 `NEW not in equipment`。

## 已写入（rev **340→341**）

（apply 后填）

| 操作 | id | materialId（短） |
|---|---|---|
| ADD equip | `c34-g4-K01-p19y-her1` | — |
| NEW mat | grip-hand (fire) | `6f35f19e` |
| NEW mat | support-hand + legacy-support | `b6e68e55` |
| KEEP | gun-rigid | `8dccb3a6` (clone) |
| KEEP | p15-support | `72b1b2d5` (clone) |
| KEEP | p13g4-support-f* ×9 | `ff62b44b` (clone) |

完整 UUID 见 `her1t04-update-meta.json`。
