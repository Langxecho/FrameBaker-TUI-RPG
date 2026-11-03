# her1kg · 膝 g2–g5 × 远近 八档入库

更新时间：2026-10-26（Asia/Shanghai）

## 结论

- 源：美术 PASS 膝 g2–g5 v1（120×120 ×8，远/近 × 左轮/冲锋枪/步枪/狙击）— `_check_膝_g2-g5_v1` / `knee_g2g5_verdict=PASS`
- **加性**写入 her1：ADD 8× `att-p19x-knee_{far|near}_g{2,3,4,5}-her1`
- bone=`calf_far` / `calf_near`；native 120→rig 240；pivot `[0.5,0.5]`；canvas_offset **far[202,556] / near[89,560]**（继承 g1-her1 abs-pivot，**非** PSD 格偏移）
- rest.scale=`[0.001,0.001,1]`（HIDE）；**模板拷自对应 live base** `att-p19x-knee_{far|near}_g{N}`（her1m1 肘风格：live 8/8 已存在）
- **未改** live / art01 / art02 / 已有 scale 轨 / clips / actions / equip / prod
- **未改** `att-p19x-knee_*_g1` / g1-her1 / bend 铁桶 / 肘铁桶 / her1m1 / her1kb / her1ne
- **M2 跟进**：clip `attachmentVisibility`/scale 铁桶接线（本波只 bind+upload；离线 GIF 验收）

## 零件

| id | native→rig | pivot | drawOrder | 标签 | 模板 |
|---|---|---|---|---|---|
| att-p19x-knee_far_g2-her1 | 120→240 | 0.5,0.5 | 832 | 远侧·左轮 | live far_g2 |
| …-far_g3-her1 | 120→240 | 0.5,0.5 | 833 | 远侧·冲锋枪 | live far_g3 |
| …-far_g4-her1 | 120→240 | 0.5,0.5 | 834 | 远侧·步枪 | live far_g4 |
| …-far_g5-her1 | 120→240 | 0.5,0.5 | 836 | 远侧·狙击 | live far_g5 |
| …-near_g2-her1 | 120→240 | 0.5,0.5 | 837 | 近侧·左轮 | live near_g2 |
| …-near_g3-her1 | 120→240 | 0.5,0.5 | 838 | 近侧·冲锋枪 | live near_g3 |
| …-near_g4-her1 | 120→240 | 0.5,0.5 | 839 | 近侧·步枪 | live near_g4 |
| …-near_g5-her1 | 120→240 | 0.5,0.5 | 841 | 近侧·狙击 | live near_g5 |

（跳过已占用 do 835 / 840；簇靠近 g1-her1 822/823 + bend 824–831）

## 预览（离线）

- `/workspace/art/pkg/03_效果预览/her1kg_knee_g2g5_buckets.png`
- `/workspace/art/pkg/03_效果预览/her1kg_knee_g2g5.gif`
- 副本：`/workspace/art/her1/work/her1kg/`

## 脚本

```
cd E:\CodexBuild\demo-final-20261015\phase15
python p19/her1/stage_her1kg.py dry 338
python p19/her1/stage_her1kg.py apply 338
```

## M2 跟进（明确未做）

1. her1b clips：为 8 膝 g2–g5 `*-her1` 加 attachmentVisibility/scale 铁桶切换键
2. 邻档材料复用（若需要）

## 已写入（rev **338→339**）

| 操作 | attachment id | drawOrder | materialId（短） |
|---|---|---|---|
| ADD | att-p19x-knee_far_g2-her1 | 832 | `cb59d38d` |
| ADD | att-p19x-knee_far_g3-her1 | 833 | `7ade57f1` |
| ADD | att-p19x-knee_far_g4-her1 | 834 | `7c6156ab` |
| ADD | att-p19x-knee_far_g5-her1 | 836 | `5f000e88` |
| ADD | att-p19x-knee_near_g2-her1 | 837 | `b8cb4799` |
| ADD | att-p19x-knee_near_g3-her1 | 838 | `8cbb8e7a` |
| ADD | att-p19x-knee_near_g4-her1 | 839 | `8d9f3656` |
| ADD | att-p19x-knee_near_g5-her1 | 841 | `90eba8c2` |

完整 UUID 见 `her1kg-update-meta.json`。

### 澄清
- live `att-p19x-knee_*_g*` / g1-her1 / bend / 肘 / clips / actions / equip **未改**
- rest.scale 全为 hide `[0.001,0.001,1]`；clips 未接线 → FB 渲不会切 g2–g5 桶
- 验收看离线 `her1kg_knee_g2g5.gif` / buckets sheet
- 模板选型：每侧每枪对应 **live base**（8/8 均已存在于 FB；her1m1 elbow 风格）
