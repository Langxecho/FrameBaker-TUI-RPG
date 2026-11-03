# HAND T03c OPEN — larger-canvas G3 support hand

Opened: 2026-10-31 (Asia/Shanghai)
Updated: 2026-11-03 07:25 Asia/Shanghai (live check)

## Status
- Pack opened for artist redraw. **Live untouched.** her1bt / materials / FB **not** written.
- Artist returned **v1** (2026-11-02 ~20:19) and **v2** (2026-11-02 ~21:03). Both **check_art FAIL**.
- Still waiting next PSD → `02_已交/` after redo. Do not stage / rematerialize / SHOW until PASS.

## Latest QC (v2)
- Path: `/workspace/uploads/art_handoff_v2/_check_手_T03c_v2/`
- Failures: 77 semi-transparent (orange); 48 outline breaks (red). Palette OK.
- Redo note image: `T03c_只要改外面_标注.png` (outside outline / alpha only; blue guide = keep interior).
- Inbox copies: `/workspace/uploads/inbox_t03c_v1/` · `/workspace/uploads/inbox_t03c_v2/`

## Why
T03b rematerialized 29×31 hand (mat `55fec0ec`). ECHO: hand too small vs limb, wrist gap, far-arm look. Wiring `her1am3c` improved proximal arm; size + distal wrist join need art.

## Sizes
| | value |
|---|---|
| native | **89×38** (was 29×31) |
| rig | **178×76** |
| paste offset | (60, 7) |
| pivot_px (y-from-top) | [70.0, 8.0] |
| FB pivot (y-from-bottom) | [0.786517, 0.789474] |
| socket | secondaryGrip |
| sprite_id | `hand_sup_g3_y` (replaces T03b her1 support) |

## Pack paths
- Inventory: `/workspace/art/pkg/01_待改/T03c_冲锋枪更大支撑手_g3/`
- Handoff mirror: `/workspace/uploads/art_handoff_v2/01_待改/T03c_冲锋枪更大支撑手_g3/`
- Flat desktop: `/workspace/uploads/art_handoff_v2/_xfer_T03c_冲锋枪更大支撑手_桌面/`
- Zip: `/workspace/uploads/art_handoff_v2/_xfer_T03c_冲锋枪更大支撑手_桌面.zip`
- Rebuild: `/workspace/art/pkg/_build_t03c/build_T03c.py`

## Hard rules for integrators
- Additive pack only. Do not write FB / live / her1bt / materials until artist returns + check_art PASS.
- Shooting hand (射击手) **not** in pack.
- Starter is placed small hand (direct pixels), not bilinear-upscaled.

## check_art history
- Starter (open pack): PASS (0 px change tip expected).
- Artist v1: FAIL (103 semi / 47 outline breaks).
- Artist v2: FAIL (77 semi / 48 outline breaks).
