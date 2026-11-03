# her1k 膝缝改稿定稿重切

更新时间：2026-10-25（Asia/Shanghai）

## 结论

- 源定稿：`拆分-恢复的_膝缝改5.psd`（过检 v5：远侧重叠 30px、膝覆盖 100%；近侧重叠 13px）
- 对齐同 her1：scale≈**0.47767145135566186**，placement=**[85, 221]**，画布 420×820；alpha 硬阈 &lt;128
- **原地更新**既有 `*-her1` 腿材料（不新开 clip / 不改 scale 轨 / 不改 live·art01·art02）
- 鞋未动（bbox 未要求更新）

## 新 native / canvas_offset / pivot

| att | native (旧→新) | offset (旧→新) | pivot (新) |
|---|---|---|---|
| att-thigh_far-her1 | 70×108 → **71×116** | [213,531]→[213,531] | [0.3944, 0.9231] |
| att-calf_far-her1 | 53×88 → **55×95** | [250,639]→[248,632] | [0.1476, 0.9203] |
| att-p19x-knee_far_g1-her1 | 43×46 → **43×58** | [240,593]→[240,590] | [0.5000, 0.4483] |
| att-thigh_near-her1 | 73×105 → **68×96** | [122,531]→[127,531] | [0.5068, 1.0000] |
| att-calf_near-her1 | 62×110 → **62×110** | [102,629]→[109,620] | [0.5157, 1.0000] |
| att-p19x-knee_near_g1-her1 | 54×32 → **54×32** | [122,604]→[122,604] | [0.5000, 0.5000] |

对齐画布上远侧大腿×小腿重叠约 **15 rows**（PSD 30px×scale），膝覆盖 ≈99%。

## 预览

- `/workspace/art/pkg/03_效果预览/her1k_far_knee_compare.png`
- `/workspace/art/pkg/03_效果预览/her1k_reassembled.png`
- `/workspace/art/pkg/03_效果预览/her1k_far_knee_bend.gif`

## FB 预览渲帧

- `/workspace/art/pkg/03_效果预览/her1k_fb_aim.png`（`c34-g1:her1bt-aim` + equip her1）
- `/workspace/art/pkg/03_效果预览/her1k_fb_idle.png`

## FB

- **rev 334→335**（her1k_legs）
- 脚本：`p19/her1/stage_her1k.py apply|dry <rev>`
- 回退：`revert-her1.json` → `her1k` 段；备份 PNG 在 `parts_bak_pre_her1k/`
