# her1ne · 近侧肘弯角铁桶六档入库

更新时间：2026-10-26（Asia/Shanghai）

## 结论

- 源：美术 PASS 近肘 v6（72×72 ×6）— `_check_肘_近_v6` / `elbow_near_verdict=PASS`
- **加性**写入 her1：ADD 6× `att-p19y-elbow_near-c21-p{45,65,75,90,105,120}-her1`
- bone=`forearm_near`；native 72→rig 144；pivot `[0.5,0.5]`；canvas_offset **[190, 369]**（由 `att-cap_near` abs pivot [226,405] 推导，**非** PSD 格偏移）
- rest.scale=`[0.001,0.001,1]`（HIDE）；模板拷自 `att-cap_near`（forearm_near 肘关节标记；rest translation/rotation 恒等，与远肘铁桶一致，**无需镜像**）
- **未改** live / art01 / art02 / 已有 scale 轨 / clips / actions / equip / prod
- **未改** 远肘 `att-p19y-elbow_far*` / 膝 / her1m1 / her1kb / 既有 p16c/p16d near-elbow
- 近肘 base `att-p19y-elbow_near-c21-p*` **本就不存在于 FB**（与远肘不同）→ 仅 ADD `*-her1`（her1kb 模式）
- **M2 跟进**：clip `attachmentVisibility`/scale 铁桶接线（本波只 bind+upload；离线 bend GIF 验收）

## 零件

| id | native→rig | pivot | drawOrder | 标签 |
|---|---|---|---|---|
| att-p19y-elbow_near-c21-p45-her1 | 72→144 | 0.5,0.5 | 2174 | 伸直一点 |
| …-p65-her1 | 72→144 | 0.5,0.5 | 2176 | 弯一点 |
| …-p75-her1 | 72→144 | 0.5,0.5 | 2177 | 中弯 |
| …-p90-her1 | 72→144 | 0.5,0.5 | 2178 | 直角 |
| …-p105-her1 | 72→144 | 0.5,0.5 | 2179 | 弯很深 |
| …-p120-her1 | 72→144 | 0.5,0.5 | 2181 | 最弯 |

（跳过已占用 do 2175 / 2180；簇靠近 `att-cap_near`=2150 / p16c near-elbow）

## 预览（离线）

- `/workspace/art/pkg/03_效果预览/her1ne_elbow_near_buckets.png`
- `/workspace/art/pkg/03_效果预览/her1ne_elbow_near_bend.gif`
- 副本：`/workspace/art/her1/work/her1ne/`

## 脚本

```
cd E:\CodexBuild\demo-final-20261015\phase15
python p19/her1/stage_her1ne.py dry 337
python p19/her1/stage_her1ne.py apply 337
```

## M2 跟进（明确未做）

1. her1b clips：为 6 近肘 `*-her1` 加 attachmentVisibility/scale 铁桶切换键
2. 邻档角度材料复用（若需要）

## 已写入（rev **337→338**）

| 操作 | attachment id | drawOrder | materialId（短） |
|---|---|---|---|
| ADD | att-p19y-elbow_near-c21-p45-her1 | 2174 | `6e1e888b` |
| ADD | att-p19y-elbow_near-c21-p65-her1 | 2176 | `5c789c82` |
| ADD | att-p19y-elbow_near-c21-p75-her1 | 2177 | `06e9cb66` |
| ADD | att-p19y-elbow_near-c21-p90-her1 | 2178 | `a5ac1740` |
| ADD | att-p19y-elbow_near-c21-p105-her1 | 2179 | `61fe82cf` |
| ADD | att-p19y-elbow_near-c21-p120-her1 | 2181 | `42d58db7` |

完整 UUID 见 `her1ne-update-meta.json`。

### 澄清
- live / 远肘 / 膝 / her1m1 / her1kb / clips / actions / equip **未改**
- rest.scale 全为 hide `[0.001,0.001,1]`；clips 未接线 → FB 渲不会切近肘弯角桶
- 验收看离线 `her1ne_elbow_near_bend.gif` / buckets strip
- 模板选型：`att-cap_near`（bone=`forearm_near`，rest 恒等置于肘关节原点；与远肘 iron-bucket rest 同形，无需镜像 far rest）
