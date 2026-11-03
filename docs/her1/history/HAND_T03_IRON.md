# her1t03 · T03 冲锋枪（MP-9 / K02）握枪手入库

更新时间：2026-10-26（Asia/Shanghai）

## 结论

- 源：美术 PASS `_check_手_T03_v1` — 射击手 ~20px 改动；支撑手 0px 改动（open_edge 袖口豁免仍 PASS）→ **两只都导入**
- **加性**写入：clone live `c34-g3-K02-p19v-p19y` → **`c34-g3-K02-p19v-p19y-her1`**
- 只上传两张手 PNG 为新材料；**gun-rigid / p15-support 材料保留自 clone**（不发明新枪）
- Live attachment 前缀核实为 **`c34-g3-K02-p19v-p19y:`**（完整装备 id；非 `_task.json` 里较短的 `c34-g3-K02-p19v:`）
- **未改** live / art01 / art02 / clips / actions / equip-pointer / scale 轨
- **未改** her1m1 / her1kb / her1ne / her1kg / her1k / 已有 her1 binding / g1-her1 装备

## 零件

| 角色 | PNG | native→rig | pivot | LIVE att → NEW att |
|---|---|---|---|---|
| 射击手 fire | `hand_fire_g3_y-her1.png` | 32×39 → 64×78 | `[0.34375, 1.0]` | `…p19v-p19y:grip-hand` → `…p19v-p19y-her1:grip-hand` |
| 支撑手 support | `hand_sup_g3_y-her1.png` | 29×31 → 58×62 | ≈`[0.3448, 0.9677]` | `…p19v-p19y:support-hand` → `…p19v-p19y-her1:support-hand` |
| 枪体（保留） | — | live | live | `…:gun-rigid` → `…-her1:gun-rigid`（材料不动） |
| p15 支撑（保留） | — | live | live | `…:p15-support` → `…-her1:p15-support`（材料不动，rest hide） |

Live 上 g3 装备仅 4 个 attachment（无 g1 那种 p13g1-grip-* 帧）；无需额外 grip*→fire 共享。

## 预览（离线）

- `/workspace/art/pkg/03_效果预览/her1t03_hand_g3_buckets.png`
- `/workspace/art/pkg/03_效果预览/her1t03_hand_g3.gif`
- `/workspace/art/pkg/03_效果预览/her1t03_hand_g3_strip.png`
- `/workspace/art/pkg/03_效果预览/her1t03_hand_g3_composite_ref.png`（离线 aim/idle 衬底 + 手 inset；未写 FB live）
- 副本：`/workspace/art/her1/work/her1t03/`

## 脚本

```
cd E:\CodexBuild\demo-final-20261015\phase15
python p19/her1/stage_her1t03.py dry 339
python p19/her1/stage_her1t03.py apply 339
```

闸门：`assert rev()==339` 且 `NEW not in equipment`。rev 若已移动则停、重断言。

## 已写入（rev **339→340**）

（apply 后填）

| 操作 | id | materialId（短） |
|---|---|---|
| ADD equip | `c34-g3-K02-p19v-p19y-her1` | — |
| NEW mat | grip-hand (fire) | `7c417ebc` |
| NEW mat | support-hand | `3593cf75` |
| KEEP | gun-rigid | `149134cb` (clone) |
| KEEP | p15-support | `72b1b2d5` (clone, rest hide) |

完整 UUID 见 `her1t03-update-meta.json`。

### 澄清

- live `c34-g3-K02-p19v-p19y` **未原地改**
- 未改 clips / actions / 装备指针；要看到新手需在 FB 里选新装备 `…-her1`
- 支撑手 0px delta 仍按对接师 PASS 导入
