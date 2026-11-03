# HAND T10 FIX — her1 foreshrt far-arm (self-QC)

## Verdict: **FAIL** vs `正确.jpg`

Wiring/hide loops exhausted. Existing foreshrt art cannot be placed at the emerge-from-chest anchor. **Artist redraw / re-anchor required** for the foreshrt forearm (and likely elbow) mats. Parent decides whether to ping 美术对接师.

## What shipped on ECHO

| field | value |
|---|---|
| project | 90acc389 (ECHO) |
| revision | **1307 → 1335** |
| budget_left | **85** |
| G1 bind | `her1bt` → **`her1am_c21n`** |
| G3/G4/G5 | untouched (`her1am3c` / `her1am4d` / `her1am5`) |
| live mats | **untouched** `68a7242a` / `47d77217` |
| foreshrt mats | unchanged `35878b00` / `1475c51c` / `e329720b` |
| recipe (c21n) | aim/fire/recover: HIDE base far; **STRIP all foreshrt + StageC** (rest HIDE); SHOW p15 |

## Root cause (two layers)

1. **c21l (rev 1307, rejected):** SHOWed full foreshrt trio (upper+elbow+forearm) at DO 842–844 **above** torso (DO 804) → mid-torso floating flesh + shoulder/gun gaps.
2. **Geometry limit:** local translation trials (rev 1318–1325, tx/ty sweeps under `offset_trials/`) cannot move existing foreshrt forearm pixels to the `正确.jpg` emerge-from-chest point. Best mid_float still ≫ correct. Forearm-only SHOW (c21m) still floated; DO 843→228 did not create torso occlusion (nz unchanged).

## Attempts (wiring only — no liaison ping)

| clip | change | result |
|---|---|---|
| her1am_c21l | SHOW full trio | REJECTED — floating trio |
| her1am_c21m | forearm-only SHOW; upper/elbow HIDE | still mid-float; not emerge-from-chest |
| DO 228 trial | forearm behind torso DO | no visual occlusion change |
| offset_trials | tx±40, ty40/80, combos | cannot clear float / reach emerge |
| **her1am_c21n** | **STRIP all foreshrt** | floating trio **gone**; emerge-from-chest forearm **absent** |

## Self-QC vs `正确.jpg` (executor, Asia/Shanghai)

| check | c21n | target |
|---|---|---|
| far upper/elbow occluded | PASS (stripped) | occluded by torso |
| no mid-torso floating foreshrt trio | PASS (1842 px removed vs c21l; only_new=0) | no float |
| far forearm emerges from chest → supports gun | **FAIL** — supporting forearm missing; hand reads detached | emerge-from-chest continuous |
| silhouette / gap at chest | **FAIL** — gap where emerge should be | seamless |

Evidence boards:
- `qc_vs_correct_triptych.png` — OLD c21l | NEW c21n | 正确.jpg
- `qc_gunside_triptych.png`
- `g1_aim_before_after.png`
- `qc_diff_wrong_vs_c21n.png` (red = removed foreshrt)

## Why art must be redrawn

Region SOP (attachmentVisibility + scale) can only SHOW/HIDE/scale existing buckets. The foreshrt forearm sprite’s painted pixels and pivot do not sit at the chest emerge locus used in `正确.jpg`. Offsets move the whole bucket; they cannot invent occlusion or reshape the sprite. **Need new/re-anchored foreshrt forearm (optionally elbow) art** aligned to torso emerge, then a thin wiring pass to SHOW that mat only (upper stay HIDE).

## Preview paths

- Box deliverable: `/workspace/art/pkg/03_效果预览/her1_t10_foreshrt_fix/`
- Handoff twin: `/workspace/art/pkg/03_效果预览/handoff/her1_t10_foreshrt_fix/`
- ECHO render: `E:\CodexBuild\demo-final-20261015\phase15\p19\her1\render\her1_t10_foreshrt_fix\`

Key files: `g1_aim.png`, `g1_aim_before_after.png`, `g1_aim_fararm_gunside.png`, `g1_aim_fire.gif`, `g1_five_actions.gif`, `qc_vs_correct_triptych.png`, `her1t10_fix-update-meta.json`, `HAND_T10_FIX.md`

## Revert

Rebind `her1bt` → prior clip (`her1am_c21l` / `c21k`) if needed. Live mats never rewritten.
