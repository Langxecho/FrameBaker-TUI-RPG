# her1_fixed — five-action cleanup (FB-live)

**Machine:** ECHO `b4abf5bf-…` · phase15 · project `90acc389…`  
**Final tag:** `her1f` · **rev 447 → 449** (clips 448, acts 449)  
**Actions:** `c34-g1:her1bt-{idle,prepare,aim,fire,recover}` → `*-clip-her1f`  
**Equip (verify):** `c34-g1-K05-p19y-her1`  
**Live / art01 / art02 / unrelated clips:** untouched

## Rev path (relevant)

| step | rev | what |
|------|-----|------|
| her1hl | 342→411 | hide-live upsert on `*-clip-her1b` (scale→0.001) — **broke rasterizer** |
| her1m2 | 411→416 | iron elbows on her1b (scale 1000/0.001) — still broken preview |
| probes | 416→447 | bisect; `her1c`/`her1e` rebuilds failed for same crash classes |
| **her1f** | **447→449** | new `*-clip-her1f` + retarget her1bt — **preview OK** |

`*-clip-her1b` still holds the broken her1hl/her1m2 keys; her1bt no longer points at them.

## Root cause of PREVIEW_RENDER_FAILED

FB `aic_render_preview` rasterizer crashes when a **clip scale track** sets these to **≲0.1** (0.001):

1. **Existing animated live twin tracks** (e.g. `att-head_cheek`, arms) that were authored at scale `1` / `1000`
2. **her1 iron elbow** attachments (`att-p19y-elbow_*-c21-p*-her1`) — binding *rest* scale 0.001 is fine; putting 0.001 in a **clip** track is not
3. **`att-shoulder_cap_near-redraw1`** specifically (other caps tolerate new-track 0.001)

Scale ≥ ~0.15 on those, or **no clip scale track** (rest hide), or **translate-far**, all render OK.

## What her1f did

**Hide-live (translate-far `[5000,5000,0]`):**  
cheek, far/near upper+forearm live, thigh_far_clean, live knee_g1, all non-her1 `knee*` / `elbow*` scale-tracked aids, `att-shoulder_cap_near-redraw1`.

**Caps (safe):** `att-cap_near/far`, `att-shoulder_cap_near` → new scale `0.001`.

**Iron elbows:** all 12 buckets scale `1000`; **translation** origin vs far per her1m2 schedule (idle p105/p105; aim/fire near p45 + far p65; prepare/recover change-points). Never clip-scale `0.001` on her1 iron.

**Knees:** `att-p19x-knee_{near,far}_g1-her1` scale `1000`; bend / g2–g5 left at binding rest `0.001` (no clip 0.001 tracks).

## Previews (FB-live, honest)

- `/workspace/art/pkg/03_效果预览/her1_fixed_{idle,prepare,aim,fire,recover}.png`
- `/workspace/art/pkg/03_效果预览/her1_fixed_five_actions.png` + `.gif`
- copies: `/workspace/art/her1/work/her1_fixed/`
- ECHO: `phase15/p19/her1/render/her1_fixed/`

Framing matches prior her1_now (character small, lower-right on 900² canvas) — camera/sample framing, not a her1f regression.

## Leftover visual issues

- **Waist seam** between torso_upper / torso_lower / pelvis her1 split — still possible under torso rotation (secondary; not double-torso).
- Idle may show minor waist/back pixel noise vs aim (check stills).
- Iron inactive buckets sit at translation far rather than true scale-hide; active bucket only is on-screen.
- No straighter-than-p45 near-elbow bucket (aim ~30° → p45) — same as M2 residual.
- her1b clips remain in broken preview state if something still points at them.

## Scripts / meta

- `phase15/p19/her1/stage_her1f.py`, `ops-her1f.json`, `her1f-update-meta.json`
- box: `/workspace/art/her1/stage_her1f.py`, `ops-her1f.json`, `her1f-update-meta.json`
- revert note updated in `p19/revert-her1.json` → her1f

## Blockers / none for verify

FB-live verify path recovered. No blocker for viewing five actions. Optional follow-ups: waist pivot tweak; purge or rebuild her1b; crop/zoom preview camera.

## Crop / still notes (Asia/Shanghai session)

Content bbox ~60×130 on 900² (same framing class as her1_now). Strip/GIF is the best overview. Prepare/aim look like one coherent her1 figure with iron elbows on; waist split/seam still readable on prepare. Fire still has some pixel clutter at this scale — treat as residual art/seam noise, not the old live-twin arm swarm.
