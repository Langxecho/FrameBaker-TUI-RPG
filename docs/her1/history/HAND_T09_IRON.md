# her1t09 · T09 手枪待机腋下残肉（近侧大臂内侧）rematerialize-only

更新时间：2026-10-31（Asia/Shanghai）

## 结论

- 源：美术 PASS `_check_手_T09_v1` — `T09_近侧大臂腋下_在这里画.png`（70×61，Δ114px vs 旧贴图，检查报告「通过」）
- **仅 rematerialize**：角色绑定 `att-upper_arm_near-her1`（character binding，**不是**枪装备附件）
- **未** 改 live `att-upper_arm_near`（mat `1a614ab6`，size `[112,200]` 仍异于 her1）
- **未** 改 rest.scale / translation / rotation / drawOrder / slots / clips / actions / her1bt / equipment / 其它附件
- **未** 导入 T10（大臂 FAIL / 小臂 0px）；**未** 动 T03c / G3

## 零件

| 角色 | PNG | native→rig | pivot | att |
|---|---|---|---|---|
| 近侧大臂（新） | `att-upper_arm_near-her1.png` | 70×61 → 140×122 | `[0.7169642857142858, 0.86]` | `att-upper_arm_near-her1` |
| live 近侧大臂（不动） | — | 112×200 | 同 pivot | `att-upper_arm_near` |

## 已写入（rev **1296→1297**）

| 操作 | id | materialId（短） |
|---|---|---|
| REMAT binding | `att-upper_arm_near-her1` | `ab320a40`（was `bdeb2555`） |
| LIVE | `att-upper_arm_near` | `1a614ab6` **未改** |

完整 UUID 见 `her1t09-update-meta.json`。bak：`parts_bak_pre_her1t09/`。

## 预览（G1 her1bt × her1-hd）

- `/workspace/art/pkg/03_效果预览/her1_t09_armpit/`
  - `g1_idle.png` / `g1_prepare.png` / `g1_idle_prepare.gif`
  - `g1_idle_armpit_crop.png`（+ tight / prepare crop）
  - optional: `g1_{aim,fire,recover}.png` / `g1_five_strip.png` / `g1_five_actions.gif`
  - `t09_sprite_bak_vs_new.png`（贴图对照，橙框=problem_box）
- phase15 mirror: `E:\CodexBuild\demo-final-20261015\phase15\p19\her1\render\her1_t09_armpit\`
- 对接师 handoff: `/workspace/uploads/art_handoff_v2/03_效果预览/her1_t09_armpit/`

## 脚本

```
cd E:\CodexBuild\demo-final-20261015\phase15
python p19/her1/stage_her1t09.py dry <rev>
python p19/her1/stage_her1t09.py apply <rev>
python p19/her1/render_her1t09_armpit.py
```

Budget：1 upload + 1 upsert-binding。

## Self-check

- idle / prepare：近肘后/腋下内侧无见大块橙框残肉色岛；近臂段完整未缺段
- 贴图像素：Δ114（problem_box 内 21）；多为离板肉色 → 色板 crease/deep_shadow/手套色（收薄/对齐），opaque 净变 +1
- live_untouched = **true**
- **不宣称 T10 done**；T03c 仍等美术

## Budget

- apply 前 left=**124**；apply 后 left=**123**（rev 1297）
