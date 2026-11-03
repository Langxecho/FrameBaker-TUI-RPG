# her1m1 · M1 铁桶首开入库（肘六档 + 膝 g1）

更新时间：2026-10-25（Asia/Shanghai）

## 结论

- 源：美术 PASS 肘 v9（72×72 ×6）+ 膝 v3（120×120 ×2，手枪瞄准 g1）
- **加性**写入 her1：ADD 6× `att-p19y-elbow_far-c21-p{45,65,75,90,105,120}-her1`；原地更新 2× 膝 `*-her1` 材料
- **未改** live / art01 / art02 / 已有 scale 轨 / clips / actions / equip / prod
- **M2 跟进**：把铁桶 `attachmentVisibility`/scale 键写入 her1b clips（本波只 bind+upload，离线 bend GIF 验收）

## 零件

| id | native→rig | pivot | drawOrder | 操作 |
|---|---|---|---|---|
| att-p19y-elbow_far-c21-p45-her1 | 72→144 | 0.5,0.5 | 577 | ADD |
| …-p65-her1 | 72→144 | 0.5,0.5 | 578 | ADD |
| …-p75-her1 | 72→144 | 0.5,0.5 | 579 | ADD |
| …-p90-her1 | 72→144 | 0.5,0.5 | 581 | ADD |
| …-p105-her1 | 72→144 | 0.5,0.5 | 582 | ADD |
| …-p120-her1 | 72→144 | 0.5,0.5 | 583 | ADD |
| att-p19x-knee_far_g1-her1 | 43×58→**120×120** (rig 240) | 0.448→**0.5,0.5** | 823 (unchanged) | material replace |
| att-p19x-knee_near_g1-her1 | 54×32→**120×120** (rig 240) | 0.5,0.5 | 822 (unchanged) | material replace |

### 膝 placement 校正

- 美术包是完整 120×120 格（非 her1k 内容裁切）
- 离线 canvas_offset 按「保留绝对骨枢轴」重算：
  - far：abs pivot (261.5, 616) → offset **[202, 556]**（旧 [240, 590]）
  - near：abs pivot (149, 620) → offset **[89, 560]**（旧 [122, 604]）
- FB 侧靠 bone + pivot(0.5,0.5) + size(240)；若实机偏移再在 M2 微调 pivot，不改 live

## FB 写入范围

**在 FB：**
- binding：6 新肘附件+槽（rest scale 0.001）；2 膝 materialId/size/pivot
- 回退：`revert-her1.json` → `her1m1`；膝 bak=`parts_bak_pre_her1m1/`

**不在 FB（离线 only / M2）：**
- her1b clip 里铁桶切换 scale / attachmentVisibility 键
- 邻档角度复用（p40/p50…）材料别名

## 预览

- `/workspace/art/pkg/03_效果预览/her1m1_elbow_buckets.png`
- `/workspace/art/pkg/03_效果预览/her1m1_elbow_bend.gif`
- `/workspace/art/pkg/03_效果预览/her1m1_knee_compare.png`
- `/workspace/art/pkg/03_效果预览/her1m1_reassembled_offline.png`（离线叠肘+膝；非 FB 渲）
- `/workspace/art/pkg/03_效果预览/her1m1_fb_aim.png` / `her1m1_fb_idle.png`（FB render，若管道可用）

## 脚本

```
cd E:\CodexBuild\demo-final-20261015\phase15
python p19/her1/stage_her1m1.py dry 335
python p19/her1/stage_her1m1.py apply 335
```

## 已写入（rev **335→336**）

| 操作 | attachment id | materialId（短） | 备注 |
|---|---|---|---|
| ADD | att-p19y-elbow_far-c21-p45-her1 | `75a70071` | do577 |
| ADD | att-p19y-elbow_far-c21-p65-her1 | `9d32713d` | do578 |
| ADD | att-p19y-elbow_far-c21-p75-her1 | `67dcda71` | do579 |
| ADD | att-p19y-elbow_far-c21-p90-her1 | `3039b867` | do581 |
| ADD | att-p19y-elbow_far-c21-p105-her1 | `6a919d1c` | do582 |
| ADD | att-p19y-elbow_far-c21-p120-her1 | `0d482f84` | do583 |
| UPD | att-p19x-knee_far_g1-her1 | `0127b742` | size 86×116→240×240；pivot→0.5,0.5 |
| UPD | att-p19x-knee_near_g1-her1 | `54f6a058` | size 108×64→240×240；pivot 0.5,0.5 |

完整 UUID 见 `her1m1-update-meta.json`。

### 澄清
- 任务描述写「已有 p65-her1 空占位」——**FB 侧实际不存在**（仅 box PNG 空图 + parts_map）。本波 **ADD 全部 6 档** `*-her1`（含 p65）。
- live `att-p19y-elbow_far-c21-p*` / redraw1 / art01/art02 / scale 轨 / clips / actions / equip **未改**。

### FB 预览 vs 离线
- `her1m1_fb_{aim,idle}.png`：her1bt + equip her1；**膝材料已生效**（her1b 原有膝 scale 轨）。肘铁桶 rest=0.001 且 **clips 未接线** → FB 渲里肘仍是旧 live/空缝，不以新铁桶切换。
- `her1m1_elbow_bend.gif` / `her1m1_elbow_buckets.png`：**离线 only**（M1 验收用）。
- 膝 full-cell 相对 her1k 内容裁切变大；若 aim 位姿下膝相对大腿/小腿仍偏，M2 再微调 pivot（不改 live）。

### M2 跟进（明确未做）
1. her1b clips：为 6 肘 `*-her1` 加 attachmentVisibility/scale 铁桶切换键（只 ADD 新轨）
2. 邻档角度材料复用（p40/p50…）
3. 膝 pivot 实机微调（若需要）
