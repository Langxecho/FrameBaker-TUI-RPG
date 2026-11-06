# her1t01b · T01b 手枪待机远侧手（放松低持）加性入库

更新时间：2026-10-31（Asia/Shanghai）

## 结论

- 源：美术 PASS `_check_手_T01b_v1` — 待机远侧手放松低持（30×27，423 opaque，Δ164px）
- **加性**附件：`c34-g1-K05-p19y-her1:p15-idle-support`（及 `-her1-hd` 同 att id）
- **未** rematerialize / 覆盖既有 aim 拳 `…:p15-support`（mat `2143d7ba` 保留）
- **未** 改 live `c34-g1-K05-p19y` / live clips `*-clip-p16k10`
- **未** 改 G3 her1bt / `her1am3c`
- Clip tag：**`her1am_c21k`**（`her1am_c21j` 因 idle-support 的 HIDE scale 轨会 PREVIEW_RENDER_FAILED，已 superseded）

## 零件

| 角色 | PNG | native→rig | pivot | att |
|---|---|---|---|---|
| 待机远侧手 idle（新） | `hand_sup_g1_idle_y-her1.png` | 30×27 → 60×54 | ≈`[0.2667, 0.7037]` | `…-her1:p15-idle-support` |
| 瞄准托握拳（不动） | — | [108,104] | 同上 | `…-her1:p15-support` mat `2143d7ba` |
| 旧 parts `hand_sup_g1_y-her1.png` | 54×52 | — | — | **未覆盖**（另一资产） |

## 已写入

| 阶段 | rev | 操作 |
|---|---|---|
| equip ADD idle-support | **1255→1256** | mat **`56d4bc2e`** size [60,54] rest HIDE `[0.001,0.001,1]`；p15 保留 |
| clips c21j 部分 | 1256→1262 | idle/prepare/aim/fire/recover/cancel（后 superseded） |
| resume hit/enter+bind c21j | 1274→1277 | 曾 bind c21j；aim 光栅失败 |
| **clips+bind c21k** | **1287→1296** | 全相位 + her1bt→`her1am_c21k` |

完整 UUID 见 `her1t01b-update-meta.json`。

## Recipe（c21k）

| phase | recipe |
|---|---|
| idle | HIDE p15；SHOW idle-support `[1000,1000,1]`；HIDE forearm_far+upper_arm_far+cap_far；STRIP elbow_far-p78（c21i far-arm） |
| prepare | HIDE p15；SHOW idle-support；keepbase 远臂 |
| aim/fire/recover | SHOW p15 用 scale **`[1,1,1]`**（match rest）；**STRIP** idle-support（靠 rest HIDE）— **禁止** 对 idle-support upsert HIDE scale |
| cancel/hit/enter | HIDE p15；STRIP idle-support |

### Raster 教训

对 `p15-idle-support` upsert `scale=[0.001,0.001,1]` 会触发 `PREVIEW_RENDER_FAILED`。隐藏用 rest.scale HIDE + clip **STRIP**；显示用 SHOW 轨 OK。

## 预览（G1 her1bt × her1-hd）

- `/workspace/art/pkg/03_效果预览/her1_t01b_idle/g1_five_actions.gif`（+ `_large`）
- `g1_idle_prepare.gif` / `g1_aim_fire.gif` / `g1_five_strip.png`
- stills: `g1_{idle,prepare,aim,fire,recover}.png`
- idle vs aim 手对比: `g1_idle_vs_aim_handcrop.png`
- phase15: `E:\CodexBuild\demo-final-20261015\phase15\p19\her1\render\her1_t01b_idle\`
- 对接师 handoff: `/workspace/uploads/art_handoff_v2/03_效果预览/her1_t01b_idle/`

## 脚本

```
cd E:\CodexBuild\demo-final-20261015\phase15
python p19/her1/stage_her1t01b.py dry <rev>    # 初版（含 c21j；equip 段仍可用）
python p19/her1/stage_her1t01b_resume.py ...   # 续跑 hit/enter+bind
# c21k 以 apply 日志 / update-meta 为准（HIDE→STRIP 修复）
```

## Self-check

- idle：腰侧可见放松远侧手（handcrop）；**不是**瞄准拳；远臂 HIDE 配方保留
- aim/fire：可见 p15 托握拳；idle-support 不可见
- live / G3：未动

## Budget

- 初 apply 前 left≈165；resume@1274 left≈146；c21k 后 left≈**124** / 1392
