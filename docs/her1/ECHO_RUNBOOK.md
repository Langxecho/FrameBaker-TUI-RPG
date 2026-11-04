# her1 ECHO 运行手册

给 ECHO（或在 ECHO 上运行的 agent）用：在本机 FrameBaker 上完成 **check → rematerialize → 薄接线 → 自审**。云端 agent 连不到 `127.0.0.1:39127`，只能改仓库；真正写入 FB 的每一步都在这里，由 ECHO 执行。

状态与规则以 [`README.md`](README.md) / [`state.json`](state.json) 为准；显隐规范见 [`region-visibility.md`](../../skill/fb-character-authoring/references/region-visibility.md)。

## 0. 准备（一次）

```powershell
cd F:\CodeProject\FrameBaker-TUI-RPG
git pull                       # 拿到最新 docs/her1/state.json 与 scripts/her1/
powershell -c "irm bun.sh/install.ps1 | iex"   # 未装 bun 时
bun install
bun run her1 help
```

- FB 服务需已在 `http://127.0.0.1:39127` 运行（MCP `/mcp`，REST `/api/*`）。地址不同时每条命令加 `--mcp http://host:port/mcp`，或设环境变量 `FRAMEBAKER_MCP_URL`。
- 运行输出默认写到仓库 `storage/her1-runs/<时间>-<命令>/`（gitignored）。可用 `--out <目录>` 改到 ECHO 工作目录，例如 `--out E:\CodexBuild\demo-final-20261015\phase15\p19\her1\runs\t03c-v3`。
- 用独立 worktree（如 `F:\CodeProject\FB-her1-run`）执行时，apply 会在 worktree 里回写 `docs/her1/state.json`。拉取仓库新版本前，先把本地这份 `state.json` 的改动和仓库版对一遍（回报给云端的结果已入库），再 `git checkout -- docs/her1/state.json` 后 `git pull`，避免冲突或覆盖。
- 所有写命令默认 **dry-run**。只有加 `--apply --expected-rev <N>` 才会写入，N 必须等于 `probe` 刚读到的 revision。

## 1. 核对现场（每次动手前）

```powershell
bun run her1 probe
```

它会依次确认：`tools/list` 含 `aic_get_project_summary` 与 `aic_apply_operations`；读取 revision；live 素材前缀与 `state.json` 一致（不一致立即停止）；各枪 `her1bt-*` 指针与 README §3 一致；her1 装备齐全。

- 退出码 0：全部一致。3：有指针不一致（逐条列出），先查明来源，再更新 README §3 与 `state.json`，不要直接接线。1：停止（缺工具、live 不符、连不上）。
- revision 不等于 `state.json` 的 `lastKnownRevision` 时会提示，说明这期间有人写过项目，先查清楚。

## 2. 检查美术回稿（离线，云端也能跑）

```powershell
bun run her1 check --pack T03c --input "<美术包根>\02_已交\T03c_支撑手.psd" --record
bun run her1 check --pack T10b --input "<美术包根>\02_已交\T10b_远侧前臂胸口托出.psd" --record
bun run her1 check --pack T10b --sprite att-p19x-elbow_far_foreshrt_g1aim --input "<…>\T10b_远侧手肘胸口托出.psd" --record
```

- 读取 PSD 中名为「在这里画」的图层（也接受 PNG）。检查尺寸、半透明（alpha 只能 0/255）、色板、外露描边 RGB(9,5,9)。
- 接缝豁免带（`state.json` 的 `openEdge.band`，缺省取任务的 `intended_open_edge_band`，例如 T03c 腕口 `[0,0,59,37]`）内：半透明像素和描边缺口都不计失败，与朝向无关；色板仍然检查。用了豁免时结论记为 `PASS_seam_exempt`，与对接师判定一致。`_task.json` 的 `open_edge_pixels` 只豁免描边缺口。
- 可选 `--starter <起点.png>` 统计相对起点图的改动（problem_box 内/外）。若画师把切口挪了位置，对接师可给 `--open-edge-mask <蒙版.png>`（不透明像素=豁免）。
- 输出：`*_check.json`、`*_check_overlay.png`（×12；橙=半透明，红=描边断口，青=色板外，品红十字=pivot），PASS 时另有规范化 `<sprite>-her1.png`。
- `--record` 把结论追加到 `state.json` 的 `checkHistory`。**FAIL 就退回画师**（叠加图给对接师，用美术语言描述），不进入下一步。

## 3. T03c（优先级 1）：G3 支撑手 rematerialize

> 2026-11-04 已落地（rev 1339，素材 `e53e3c92`），不要再跑 apply。下面的命令留作同类“只换图”任务的模板；重做 T03c 前先在 README §6 写明原因。

```powershell
bun run her1 probe                                   # 记下 revision，例如 1335
bun run her1 t03c --input "<美术包根>\02_已交\T03c_支撑手.psd"
# 看输出目录里的 T03c-operations.json：只应有两个 upsert-equipment
#   c34-g3-K02-p19v-p19y-her1 与 -her1-hd，只改 :support-hand 的 materialId / size [178,76] / pivot
bun run her1 t03c --input "<…>\T03c_支撑手.psd" --apply --expected-rev 1335
```

apply 依次执行：再次 check（FAIL 即停）→ 连接核对 → revision 闸门 → 上传 PNG（metadata 带 sha256 与来源）→ `aic_apply_operations`（baseRevision + 幂等键 `her1-t03c-r<rev>-<hash>`）→ 重读文档，live 快照逐字节比对 → 写 `T03c-receipt.json` → 回写 `state.json`（`currentMaterial`、`currentSize`、`status=rematerialized-pending-self-qc`、`lastKnownRevision`）。

T03c 默认不改 clip：her1am3c 已经显示 support-hand。自审（§6）若仍断腕，再用 §5 的 `wire` 以 her1am3c 为基线开 `her1am3d`。

## 4. T10b（优先级 2）：G1 透视前臂 rematerialize + 薄接线

```powershell
bun run her1 probe
bun run her1 t10b --forearm "<…>\T10b_远侧前臂胸口托出.psd"
#   可选：--elbow "<…>\T10b_远侧手肘胸口托出.psd"   交了手肘才加
#   默认：--tag her1am_c21o --phases aim,fire；需要 recover 也显示时 --phases aim,fire,recover
#   只换图不接线：--no-wiring
bun run her1 t10b --forearm "<…>.psd" --apply --expected-rev <N>
```

计划内容（dry-run 时先核对 `T10b-operations.json` 与新 clip JSON）：

1. `upsert-binding`：只改 `att-p19x-forearm_far_foreshrt_g1aim-her1`（及交了的手肘）的素材、size（50×78 / 144×144）、pivot；rest 保持 `[0.001,0.001,1]`。
2. 每个相位一条 `create-motion-clip`：从**当前指针** `c34-g1:<phase>-clip-her1am_c21n` 复制为 `…-her1am_c21o`，删掉涉及件的 `att:` scale 轨，前臂（手肘）写整段常量 SHOW `[1000,1000,1]`（step），大臂 `att-p19x-upper_arm_far_foreshrt_g1aim-her1` 保持 STRIP；其余轨道原样。
3. 每个相位一条 `upsert-action`：`c34-g1:her1bt-<phase>` 改指向新 clip，name/speed/repeat/loop 原样。

闸门：动作当前指针必须正好是基线 clip（否则停止，提示先 probe）；新 tag 不能是退役 tag；新 clip 过 Region 显隐审计（translate-far、HIDE-scale、SHOW 过量等，有错误就不写入）。成功后 `state.json` 记录 `guns.G1.phaseClipTags = {aim: her1am_c21o, fire: her1am_c21o}`，`clipTag` 仍是 c21n（其余相位）。

## 5. 通用薄接线 `wire`

```powershell
bun run her1 wire --gun G3 --base-tag her1am3c --tag her1am3d --phases aim,fire `
  --show <rest 隐藏的 her1 附件,…> --strip <her1 附件,…>
bun run her1 wire ... --apply --expected-rev <N>
```

- `--show` 只接受 rest 为 0.001 的 her1 附件（rest 可见的件不需要 SHOW，写 1000 会过量）；`--strip` 删掉该件的 scale 轨。
- 只能触碰 id 含 `her1` 的附件。需要动 live 孪生件的轨（例如 HIDE 基础远臂）不在脚本范围内：先在 README 写明理由，经 ECHO 同意后用 §7 的 `call` 手工提交，并补渲染证据。

## 6. 渲染与自审（每次写入后必做）

```powershell
bun run her1 tools                                    # 看 ECHO 当前有哪些渲染/预览工具
bun run her1 tools --name aic_render_preview          # 打印参数 schema
bun run her1 call aic_render_preview --args render-g3-aim.json --out <预览目录>
```

`call` 从 JSON 文件读参数（避免 shell 转义），文本结果打印到终端，image 结果存为 `<工具名>-<序号>.png`。参数按 `tools --name` 的 schema 填写（项目、动作 `c34-g3:her1bt-aim`、装备 `…-her1-hd`、时间点、尺寸等）。

按 [`skill/her1-fb-self-qc`](../../skill/her1-fb-self-qc/SKILL.md) 看图：剪影对照参考（T10b 对照 `正确.jpg`）、手/腕/肩锚点、悬空、跨帧缺段、live 孪生件冒出。G3 看 idle/prepare/aim/fire/recover；G1 至少 aim/fire（及改了的相位）。

- 自审 FAIL 且是接线问题：自己开新 tag 再试（§5），不打扰对接师。
- 自审 FAIL 且是素材问题：用红框图 + 美术语言给对接师 `f5dc4070-c855-4a83-8313-1b47c4828415` 开新包。
- 自审 PASS：GIF/关键帧附在聊天里发给 ECHO；然后 §8 提交。

## 7. 回退与应急

每次 `t03c` / `t10b` / `wire`（含 dry-run）都会在输出目录同时写 `<任务>-revert-operations.json`：写入前的 her1 binding / 装备 / 动作指针原值（新建的 clip 不删，只是不再被引用）。

```powershell
bun run her1 probe                                     # 当前 revision，例如 1336
bun run her1 revert --ops <运行目录>\T10b-revert-operations.json
bun run her1 revert --ops <运行目录>\T10b-revert-operations.json --apply --expected-rev 1336
```

回退文件只允许 her1 装备与 her1bt 动作，写后同样核对 live 快照。回退后把 `state.json` 中该任务的素材 / 状态 / `phaseClipTags` 改回（git 历史里有写入前版本），在 README 记一笔。

脚本报“写入后 live 快照发生变化”时：**立即停止**，不要再写；保存输出目录，跑 `probe` 记录现状，回报 ECHO，由 ECHO 决定如何恢复 live。

## 8. 提交回仓库（必须）

```powershell
git checkout -b her1/<任务>-<日期>
git add docs/her1/state.json docs/her1/README.md
git commit -m "her1: <任务> <结果>（rev <前>→<后>）"
git push -u origin HEAD
```

README §6 写清：check 结论、素材 id 前 8 位、新 tag、rev、自审结论与 ECHO 上的预览路径。预览图、PSD、回执不入库。
