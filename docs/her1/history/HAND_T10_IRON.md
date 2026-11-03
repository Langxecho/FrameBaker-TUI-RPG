# her1t10 · T10 手枪瞄准靠里臂透视铁桶（远上臂+远肘+远前臂）加性入库

更新时间：2026-11-02（Asia/Shanghai）

## 结论

- 源：美术 PASS `_check_手_T10_v6` — 靠里大臂/小臂/手肘透视铁桶三件套
- **加性**角色绑定 3 附件+slots（`*-her1` 后缀，避免未来 live 撞 id；PNG 文件名保持 sprite_id 无后缀）
- **未** 改 live `att-upper_arm_far` / `att-forearm_far` / live StageC c21c/c22c
- **未** 改 G3/G4/G5 her1bt；**未** 动 T03c
- Clip tag：**`her1am_c21l`**（自 k10 重建 + c21k 手部配方 + aim/fire/recover foreshrt）

## 零件

| 角色 | PNG | native→rig | pivot | att | drawOrder |
|---|---|---|---|---|---|
| 靠里大臂透视 | `att-p19x-upper_arm_far_foreshrt_g1aim.png` | 61×84 → 122×168 | task pivot | `…foreshrt_g1aim-her1` | **842**（~811 被 c22c-her1 占用） |
| 靠里小臂透视 | `att-p19x-forearm_far_foreshrt_g1aim.png` | 25×39 → 50×78 | task pivot | `…foreshrt_g1aim-her1` | **843**（~812 被 c21c-her1 占用） |
| 靠里手肘透视 | `att-p19x-elbow_far_foreshrt_g1aim.png` | 72×72 → 144×144 | 0.5/0.5 | `…foreshrt_g1aim-her1` | **844**（~813 被 thigh_near-her1 占用） |

Rest scale 全员 HIDE `[0.001,0.001,1]`。Clone：c22c-her1 / c21c-her1 / elbow p90-her1。

## 已写入（rev **1297→1307**）

| 操作 | id | materialId（短） |
|---|---|---|
| ADD binding | `att-p19x-upper_arm_far_foreshrt_g1aim-her1` | `35878b00` |
| ADD binding | `att-p19x-forearm_far_foreshrt_g1aim-her1` | `1475c51c` |
| ADD binding | `att-p19x-elbow_far_foreshrt_g1aim-her1` | `e329720b` |
| clips+bind | `her1am_c21l` / G1 her1bt | — |
| LIVE upper/forearm | `att-upper_arm_far` / `att-forearm_far` | `68a7242a` / `47d77217` **未改** |

完整 UUID 见 `her1t10-update-meta.json`。bak：`parts_bak_pre_her1t10/` + `stage_her1t10.py.bak`。

## Recipe（c21l）

| phase | recipe |
|---|---|
| idle | c21k 手部：HIDE p15；SHOW idle-support；HIDE base far+cap_far；STRIP elbow_far-p78；**STRIP foreshrt/StageC**（rest HIDE） |
| prepare | HIDE p15；SHOW idle-support；keepbase 远臂；**不 SHOW foreshrt** |
| aim/fire/recover | SHOW p15 `[1,1,1]`；**STRIP** idle-support；HIDE base far；STRIP StageC c21c/c22c；**SHOW foreshrt trio `[1000,1000,1]`** |
| cancel/hit/enter | HIDE p15；STRIP idle-support；STRIP foreshrt |

禁止 translate-far；禁止对 idle-support upsert HIDE scale。

## 预览（G1 her1bt × her1-hd）

- `/workspace/art/pkg/03_效果预览/her1_t10_foreshrt/`
  - `g1_aim.png` / `g1_fire.png` / `g1_aim_fire.gif`
  - `g1_five_actions.gif` / `g1_five_strip.png`
  - `g1_aim_fararm_gunside.png` (+ shoulder / fire gunside)
  - `g1_aim_before_after.png`（左=c21k / 右=c21l）
  - `t10_sprite_c21c_vs_foreshrt.png`
- phase15：`E:\CodexBuild\demo-final-20261015\phase15\p19\her1\render\her1_t10_foreshrt\`
- 对接师 handoff：`/workspace/uploads/art_handoff_v2/03_效果预览/her1_t10_foreshrt/`

## 脚本

```
cd E:\CodexBuild\demo-final-20261015\phase15
python p19/her1/stage_her1t10.py dry <rev>
python p19/her1/stage_her1t10.py apply <rev>
python p19/her1/render_her1t10_foreshrt.py
```

Budget：3 upload + 1 upsert-binding + 8 create-clip + 1 upsert-action(batch 8) ≈ 10 steps（rev +10）。

## Self-check

- aim/fire：靠里臂透视铁桶三段可见；相对 c21k before，肘缝明显填上
- idle/prepare：未 SHOW foreshrt；idle 仍 HIDE 远臂（原 c21k 配方，非新引入 stump）
- live_untouched = **true**；G3/G4/G5 未指向 c21l

## Budget

- apply 前 left=**123**；apply 后 left=**113**（rev 1307）
