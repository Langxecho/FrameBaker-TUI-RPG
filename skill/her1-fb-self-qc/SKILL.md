---
name: her1-fb-self-qc
description: >-
  Use after any HELLO WORLD / FrameBaker her1 character edit (clip, attachment,
  rematerialize, iron-bucket wiring) before chatting previews or contacting
  美术对接师.
---
# her1 FrameBaker 自审再联络

## When
After any character change on the FB workflow (additive `*-her1`, Region SHOW/STRIP scale, rematerialize, iron-bucket wiring). Before sending chat GIFs/stills to ECHO as “done”, and before messaging 美术对接师.

先读：[`docs/her1/README.md`](../../docs/her1/README.md)（her1 单一真相源）与 [Region 显隐与铁桶规范](../fb-character-authoring/references/region-visibility.md)。

## Steps
1. Stay on FrameBaker: additive `*-her1` only; live untouched unless ECHO explicitly OK’d live; no translate-far / offscreen hide hacks; idle-support is STRIP, never HIDE-scale.
2. 美术交回的 PSD/PNG 先跑 `bun scripts/her1/her1.ts check --pack <T03c|T10b> --input <file>`。FAIL（半透明、描边断口、色板外、尺寸不符）直接退回美术，不入库、不接线。
3. Render the affected actions yourself (aim/fire/idle/prepare/recover as relevant) to stills + GIF under `03_效果预览/<任务>/`（ECHO 包目录）或 runner 的 `storage/her1-runs/<run>/render/`。
4. Open the stills/GIF and self-QC for obvious issues:
   - silhouette vs reference（如 T10b 的 `正确.jpg`；同枪、同动作、同时间对比）；
   - placement / anchors：手贴护木/握把、腕口接前臂、肩与枪之间无缺口；
   - floating limbs、悬空肉块、stump flesh on idle；
   - missing segments across frames、相邻帧闪烁；
   - live 孪生件是否重新冒出（“手臂群”）。
5. If the issue is wiring/anchors/clip/visibility — fix it yourself in FB with a new additive clip tag; re-render; re-QC. Do **not** ping 美术对接师 for wiring-only iterations.
6. Contact 美术对接师 **only** when self-QC confirms the asset itself must be fixed or redrawn (wrong art, wrong size, missing bucket, need new PSD). Include red-box stills + plain art-language ask（对画师说话，不讲代码）; pack under `01_待改/` when opening work. 美术对接师 agent id 见 `docs/her1/README.md`。
7. Only after self-QC PASS, attach chat GIFs/keyframes (no Downloads-folder handoff to ECHO).
8. 把结果写回 `docs/her1/README.md`（clip 指针、rev、verdict、预览路径）并提交；不在仓库外另留“最新状态”。

## Do not
- Ship unreviewed previews.
- Ask the liaison to “take a look” at every wiring try.
- Treat liaison FYI as a substitute for your own screenshot QC.
- 把 check PASS、audit-clip PASS、渲染成功当成视觉通过；它们只是进入看图的门槛。
