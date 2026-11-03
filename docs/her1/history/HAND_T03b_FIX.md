# T03b support-hand fix — her1 only

Updated: 2026-10-31 (Asia/Shanghai)  
Rev: **1268 → 1274** (apply). Budget left: **146**.  
Live: **untouched** (`support-hand` mat `59fc3f63` verified post-apply).

## Root cause (Phase 1)

See `ROOT_CAUSE.md`. **Primary = H1**: `her1am3` StageC `FAR_C21C` HIDEs long `forearm_far`/`upper_arm_far` and SHOWs only live foreshort stump `forearm_far_c21c`. Support-hand stays on `rifle-support` via IK → stump never meets hand (断腕) + inner/far arm looks wrong. T03b rematerialize only made the floating hand more obvious.

Ruled out: H3 (rest.scale identity), H4 (p15 hidden), H5 (secondaryGrip identical). H2 secondary (silhouette only).

## Change shipped (Phase 2 — one hypothesis)

| item | value |
|---|---|
| New clip tag | **`her1am3c`** |
| Failed attempt | `her1am3b` — extra HIDE tracks on c21c/p15-equip → `PREVIEW_RENDER_FAILED` |
| Recipe | her1am3 head/her1 wiring **minus `FAR_C21C` only** (keepbase far arms, same idea as G1 `her1am_c21i` aim) |
| Actions retargeted | `c34-g3:her1bt-{idle,prepare,aim,fire,recover}` → `*-clip-her1am3c` |
| Equip / mats | **no mutate** — her1 support stays T03b `55fec0ec` [58,62]; live `59fc3f63` |
| SHOW tracks | not rewritten for T03b |
| Rematerialize | **none** (no blind texture retry) |

Scripts: `p19/her1/stage_her1t03b_fix.py`, meta `her1t03b_fix-update-meta.json`.

## Metrics (aim t=1.2, size=900, her1-hd)

| | before (her1am3+T03b) | after (her1am3c) | live |
|---|---|---|---|
| full nz | 75524 | **77835** | 75909 |
| gun-band flesh px (approx) | 11001 | **12958** (+1957) | 11503 |
| flesh gained vs before | — | **+2188** (almost all in stump↔shoulder band) | — |
| far-arm tip x (gun band) | 594 | 594 (unchanged) | 587 |
| support mat | 55fec0ec | 55fec0ec | 59fc3f63 |

## Self-review (honest)

| ECHO complaint | After her1am3c | Verdict |
|---|---|---|
| 3. inner/far arm wrong | Foreshort stump no longer floats detached from shoulder; keepbase restores proximal continuity (flesh +2k in that band). | **Improved / largely addressed** |
| 2. not joined to wrist (断腕) | Distal tip screen-x still **594** (same as stump tip before). Long `forearm_far` in this IK pose still ends short of `rifle-support` hand. Gap reduced visually vs floating stump but **not a clean wrist meet**. | **Partial — residual gap** |
| 1. hand size wrong | Still native **29×31** art / rig 58×62. No scale tracks; do **not** fake-upscale. Looks small vs her1 limb thickness. | **Unfixed by wiring — needs art** |

**Do not claim fully fixed.** Wiring fix was the right smallest change for H1; remaining size + distal join are art/Region-limited.

## Note for 对接师

1. Preview after keepbase: `g3_aim_fire.gif`, `fix_aim_guncrop.png`, `cmp_before_after_aim.png`, `cmp_live_vs_fix_aim.png`.
2. 靠里臂/ stump 漂从肩断开 — 已用 her1am3c keepbase 修。
3. 支撑手画布仍 29×31，相对 her1 粗臂仍偏小；**请美术更大画布重画**（不要程序放大）。
4. 腕接缝：长 `forearm_far` 在 G3 aim IK 下远端仍够不着 `rifle-support`；若仍判断腕，需 Region SOP 或加长远臂/腕接笔，不是再 rematerialize。
5. Live 未动。

## T01b

Paused / dry around rev 1255. **Not resumed.** Any writes in 1253→1262 were out of scope; this fix only touched her1bt→her1am3c (1268→1274).

## Preview paths

- Box: `/workspace/art/pkg/03_效果预览/her1_t03b_fix/`
- Handoff mirror: `/workspace/uploads/art_handoff_v2/03_效果预览/her1_t03b_fix/`
- ECHO: `E:\CodexBuild\...\p19\her1\render\her1_t03b_fix\` and `C:\Users\19086\Downloads\her1_t03b_fix\`
