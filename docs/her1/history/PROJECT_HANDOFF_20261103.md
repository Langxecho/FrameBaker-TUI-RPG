# HELLO WORLD her1 / FrameBaker 云端移交（2026-11-03）

ECHO 要求：把本地 SOP、skills、FrameBaker 工作流与正在进行的 her1 项目迁到云端，用 **Claude Opus 5.5** 继续；本地缓存可清理。

## 仓库
- 主仓库：https://github.com/Langxecho/FrameBaker-TUI-RPG
- 本机路径（ECHO）：`F:/CodeProject/FrameBaker-TUI-RPG`（另有 `-aic` / `-q07` worktree）
- 游戏侧：`F:/CodeProject/挂机game`（GitHub 可能对应 `tui-idle-rpg`；内容验收在 `liaf-preview`）

## 必须遵守的 SOP / skills（已附在 uploads）
1. `skills/fb-character-authoring/` — 角色剪辑正规法（attachmentVisibility + att: scale；HIDE=scale 0.001；勿用 translate-far 藏层）
2. `skills/rpg-content-production/` — 内容生产与交接
3. `skills/her1-fb-self-qc/` — 改完先自截图 QC，再联络美术对接师；只有确认要重画才 ping 对接
4. ECHO 上还有 `skill/` 下的 framebaker-production handbook（若仓库已有请对齐；本包以 box 副本为准）

## 硬约束
- **禁止动 live**：所有改动走加性 `*-her1` equipment / clip；live 轨不动，除非 ECHO 明确 OK。
- Region SOP：rest 隐 + 只写 SHOW scale；idle-support 用 STRIP，不要 HIDE-scale（会 PREVIEW_RENDER_FAILED）。
- 大肘/膝弯用角度铁桶 sprite-swap（attachmentVisibility scale keys），小弯用 overlap + joint patch。
- 描边 RGB(9,5,9)；open_edge 不算描边缺口。
- G1=K05 手枪；G3=K02 冲锋；G4=K01 步枪；G5=K07 狙击。
- 交付：聊天附 GIF/关键帧；自审通过再发。

## 当前工程状态（截至 2026-11-02/03）
### 已落地（live 未动）
- T01b idle 远侧支撑手：clip `her1am_c21k`；idle/prepare SHOW idle-support HIDE p15；aim/fire/recover 相反
- T03b G3 支撑手 rematerialize mat `55fec0ec`；仍有远腕缺口 → 开了更大画布 **T03c**（等画师）
- T09 近侧大臂腋下 rematerialize
- T10 foreshrt 三件曾入库 clip `her1am_c21l`，但相对正确参照 **悬空 FAIL** → 已 STRIP 到 `her1am_c21n`（rev 1335），并开 **T10b** 重画包（胸口托出前臂 25×39 必交；肘可选；大臂不画）

### 阻塞 / 等待
1. **T03c**（优先）：冲锋枪更大支撑手 — 包在 `01_待改/T03c_冲锋枪更大支撑手_g3`；画师交 `02_已交` 后 check_art → rematerialize → 薄接线 → 自审预览
2. **T10b**（次于 T03c）：远侧前臂胸口托出 — 包已交对接师；交回后 rematerialize + 薄接线
3. 其余美术债：腰缝旋转露缝、脸/颈洞、近肘更直档、膝 g1 接缝、握枪↔前臂接缝等（见 FIXED/REPORT）

### 关键 clip / rev 线索
- G1 绑定轨约 `her1bt` → `her1am_c21n`（T10 悬空清除后）
- T10 foreshrt mats：`35878b00` / `1475c51c` / `e329720b`（未改像素；要重画）
- 预览目录：`her1_t10_foreshrt_fix`（含 vs 正确参照三联）

### 对接
- 美术对接师 agent：`f5dc4070-c855-4a83-8313-1b47c4828415`（对画师说话，不讲代码）
- 自审不过不发完成稿；不主动 ping 对接做 routine QC

## 云端要做的事（outcome）
1. **把上述 skills/SOP 正式落到 FrameBaker-TUI-RPG 仓库**（`skill/` 或仓库既有约定路径），与 framebaker-production handbook 对齐、去重、可被后续 agent 加载。
2. **把 her1 项目续作能力迁到云端可执行形态**：脚本/文档/工具链能让 Opus 5.5 在 PR 中继续 T03c/T10b 接线与自审流程；无法直连 ECHO FB 时，产出可在 ECHO 一键应用的 patch/脚本 + 清晰 README。
3. **记录移交后的单一真相源**：仓库内一份 `her1` 状态页（或更新现有 handbook），标明 pending packs、clip 指针、live 不动规则。
4. 打开 PR；不要假设能直接改用户本机 FB 项目数据。

## 本包内容
- `skills/` — fb-character-authoring, rpg-content-production, her1-fb-self-qc
- `her1_status/` — HAND_*.md, FIXED*, REPORT, MAPPING, meta JSON, T10 fix notes
- `open_packs_meta/` — T03c / T10b 的说明与 _task.json（非完整 PSD）
