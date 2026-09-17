# FB-02 A1 Drone R1-A fixture

This directory contains the reproducible delivery for FB-02. It deliberately does not check in another copy of the 535 PNG source frames or rename a ZIP to `.monster`.

## Source and measurement

The source is the existing package-direct fixture at `F:\CodeProject\tui-rpg-terminal-engine\liaf-preview\fixtures\packages\A1Drone.monster`. It has five actions, 107 PNG frames per action, a 160x160 canvas, and a 24 Hz sample rate. The source `content.json` SHA-256 is `1a9dcdb14337a4da3f7fce5dc7281bf65644a01ca0efb3e0f56f799a223e1ac0`.

Coordinates use the R1-A top-left pixel coordinate system. `attack/54.png` was inspected at native 160x160 pixels: the red flash centroid is about `(11.6, 93.9)`, recorded as integer `muzzle=(12,94)` with `180` degrees (left). `electric_loop/54.png` has the matching nozzle centre at `(29,94)`. `hit_received/54.png` places the stable hull impact reference at `(80,95)`. Source frame 54 is the 55th exported frame; at 24 Hz its start is `2268 ms`, so both presentation markers use that time. These are presentation locations only: there are no targets, hitboxes, damage, or combat fields.

## Rebuild

Run from the FrameBaker repository:

```powershell
bun scripts/generate_a1_drone_fb02_fixture.ts -Output "$env:TEMP\A1Drone-fb02-r1-a.zip"
```

The generator reads the source PNGs, makes an in-memory PNG-folder ZIP, and uses the normal PNG/ZIP import assembler to write `sidecar.json` plus `frames/{actionId}/NNNN.png`. It verifies the source content hash and prints the SHA-256 of the deterministic output archive. The output is R1-A `framebaker.monster-sprite-extract`, not a `.monster` package.
