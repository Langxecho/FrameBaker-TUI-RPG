# her1_fixed2 — Region rest-hide + SHOW-only scale (her1g)

**Machine:** ECHO `b4abf5bf-…` · phase15 · project `90acc389…`  
**Tag:** `her1g` · **rev 456 → 458** (clips 457, acts 458; probe her1gP used 454→456)  
**Actions:** `c34-g1:her1bt-{idle,prepare,aim,fire,recover}` → `*-clip-her1g`  
**Equip:** `c34-g1-K05-p19y-her1`  
**Live / art01 / art02:** untouched  
**Asia/Shanghai:** 2026-10-26 ~19:30

## Method (SOP Region cutout)

`attachmentVisibility` cannot be stamped on Region (schema gap; prior STOP correct). For this project SOP means:

1. Binding **rest.scale `[0.001,0.001,1]`** stays for swap/hide parts (her1 body/iron + live twins already).
2. Clips write **SHOW only** (`scale [1000,1000,1]`) when a part must be visible.
3. **Never** clip scale ≲0.1 on animated live twins / her1 iron / `att-shoulder_cap_near-redraw1`.
4. Hide = **strip** `att:scale` from the new clip → sample falls back to rest 0.001.
5. **No FAR / near-offscreen / scale-0.18.**

### Iron elbows
- idle: SHOW const near/far **p105** only; other buckets **no** scale track.
- aim/fire: SHOW const near **p45** / far **p65** only.
- prepare/recover: step keyframes; active → SHOW 1000; inactive → **IDENT `[1,1,1]`** (rest×1 = effective 0.001 hide; not clip 0.001 / not FAR). Buckets never used in the schedule get **no** track.

### Caps
`att-cap_near`, `att-cap_far`, `att-shoulder_cap_near` have **rest [1,1,1]** (cannot rest-hide). Resolution: clip scale `0.001` (her1f-proven safe; **not** crash class). Listed under blockers_rest_ge1 with that resolution. `redraw1` rest already 0.001 → strip only.

### Knees
`att-p19x-knee_{near,far}_g1-her1` SHOW 1000; bend/g2–g5 no SHOW track.

## Hide-method proof
- `far_left` per phase: **0** (no translation |x| or |y| ≥ 1000).
- idle iron tracks: only `…-p105-her1` near+far, all_show=true.
- aim/fire: only p45 near + p65 far.
- Stripped live twin / non-her1 knee+elbow scale tracks from her1b base.

## BBox (900², success gate ~250–350 × ~550–700)

| phase | bbox (x,y,w,h) | nz |
|-------|----------------|-----|
| idle | 299,135,**299×664** | 67115 |
| prepare | 299,135,**299×664** | 68321 |
| aim | 299,135,**303×664** | 68853 |
| fire | 298,135,**306×664** | 68949 |
| recover | 299,135,**299×664** | 67187 |

Contrast her1f FAR ref aim: **61×135**. Framing restored to her1_now class.

## Previews
- `/workspace/art/pkg/03_效果预览/her1_fixed2_{idle,prepare,aim,fire,recover}.png`
- `her1_fixed2_five_actions.png` + `.gif` + `her1_fixed2_five_actions_large.gif` (crop→nearest ~700px wide, dark bg)
- work: `/workspace/art/her1/work/her1_fixed2/`
- ECHO: `phase15/p19/her1/render/her1_fixed2/`

## Scripts / meta
- `stage_her1g.py`, `ops-her1g.json`, `her1g-update-meta.json`
- Base: `ops-her1b-clips.json` (not broken her1b-after-her1hl)

## Visual QC / leftovers
- One coherent her1 figure expected; live-twin arm swarm removed by stripping SHOW scales.
- **Waist seam** torso_upper/lower/pelvis her1 split may remain (art residual).
- prepare/recover iron uses IDENT inactive keys (effective rest-hide); not pure “no track” on timed buckets.
- Caps need clip 0.001 because rest≥1 (documented exception).
- No straighter-than-p45 near-elbow bucket (aim ~30°→p45) — same residual as M2/her1f.

## Visual QC (aim large crop, Asia/Shanghai session)

- **Framing:** PASS — character fills ~300×664 on 900²; large GIF ~700×1459 nearest.
- **Coherence:** Single her1 silhouette readable; live twin SHOW scales stripped / rest-hidden. Not the her1f postage-stamp FAR look.
- **Leftovers (honest):**
  - Waist seam / horizontal gap between torso_upper–torso_lower–pelvis her1 split (art residual).
  - Shoulder/arm region still busy: her1 upper/forearm + iron elbow stack (alignment/coverage), not restored live-twin scale tracks.
  - Grip hand can read slightly detached from forearm at aim (socket/art residual).
  - Knee/leg silhouette a bit jagged at iron/g1 join.
- **Caps exception:** `att-cap_*` / `att-shoulder_cap_near` rest `[1,1,1]` → clip `0.001` (safe; not crash class). Documented in blockers_rest_ge1.
- **prepare/recover iron:** IDENT `[1,1,1]` on inactive timed keys (effective rest-hide); idle/aim/fire inactive iron = **no** scale track.

## Parent complaints addressed
- pt144u low-res / messy FAR framing → bbox restored to her1_now class.
- pt145u/pt146u FB SOP hide → Region rest-hide + SHOW-only scale keys (no FAR / no 0.18); attachmentVisibility N/A on Region.
