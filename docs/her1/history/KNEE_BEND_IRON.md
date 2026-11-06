# her1kb · 远侧膝弯角铁桶六档入库

更新时间：2026-10-25（Asia/Shanghai）

## 结论

- 源：美术 PASS 膝弯角 v2（120×120 ×6，远侧）— `_check_膝_弯角_v2` / `knee_bend_verdict=PASS`
- **加性**写入 her1：ADD 6× `att-p19x-knee_far_bend_p{45,65,75,90,105,120}-her1`
- bone=`calf_far`；native 120→rig 240；pivot `[0.5,0.5]`；canvas_offset **[202, 556]**（继承 her1m1 far g1 abs-pivot，**非** PSD 格偏移）
- rest.scale=`[0.001,0.001,1]`（HIDE）；模板拷自 `att-p19x-knee_far_g1-her1`
- **未改** live / art01 / art02 / 已有 scale 轨 / clips / actions / equip / prod
- **未改** `att-p19x-knee_far_g*`（含 g1-her1）/ 肘铁桶 / her1m1
- **M2 跟进**：clip `attachmentVisibility`/scale 铁桶接线（本波只 bind+upload；离线 bend GIF 验收）

## 零件

| id | native→rig | pivot | drawOrder | 标签 |
|---|---|---|---|---|
| att-p19x-knee_far_bend_p45-her1 | 120→240 | 0.5,0.5 | 824 | 伸直 |
| …-p65-her1 | 120→240 | 0.5,0.5 | 826 | 弯一点 |
| …-p75-her1 | 120→240 | 0.5,0.5 | 827 | 弯到中间 |
| …-p90-her1 | 120→240 | 0.5,0.5 | 828 | 直角 |
| …-p105-her1 | 120→240 | 0.5,0.5 | 829 | 弯很深 |
| …-p120-her1 | 120→240 | 0.5,0.5 | 831 | 最弯 |

（跳过已占用 do 825 / 830）

## 预览（离线）

- `/workspace/art/pkg/03_效果预览/her1kb_knee_far_bend_buckets.png`
- `/workspace/art/pkg/03_效果预览/her1kb_knee_far_bend.gif`
- 副本：`/workspace/art/her1/work/her1kb/`

## 脚本

```
cd E:\CodexBuild\demo-final-20261015\phase15
python p19/her1/stage_her1kb.py dry 336
python p19/her1/stage_her1kb.py apply 336
```

## M2 跟进（明确未做）

1. her1b clips：为 6 膝弯角 `*-her1` 加 attachmentVisibility/scale 铁桶切换键
2. 邻档角度材料复用（若需要）

## 已写入（rev **336→337**）

| 操作 | attachment id | drawOrder | materialId（短） |
|---|---|---|---|
| ADD | att-p19x-knee_far_bend_p45-her1 | 824 | `bdb07e5c` |
| ADD | att-p19x-knee_far_bend_p65-her1 | 826 | `e1fb9cae` |
| ADD | att-p19x-knee_far_bend_p75-her1 | 827 | `3ce4434d` |
| ADD | att-p19x-knee_far_bend_p90-her1 | 828 | `80262e44` |
| ADD | att-p19x-knee_far_bend_p105-her1 | 829 | `983d7149` |
| ADD | att-p19x-knee_far_bend_p120-her1 | 831 | `195cce45` |

完整 UUID 见 `her1kb-update-meta.json`。

### 澄清
- live `att-p19x-knee_far_g*` / g1-her1 / 肘铁桶 / clips / actions / equip **未改**
- rest.scale 全为 hide `[0.001,0.001,1]`；clips 未接线 → FB 渲不会切弯角桶
- 验收看离线 `her1kb_knee_far_bend.gif` / buckets strip

