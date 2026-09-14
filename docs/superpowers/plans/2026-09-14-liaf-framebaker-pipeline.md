# LIAF × FrameBaker 流水线改动计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `mission/tasks.md` 把 FrameBaker 从「能做图」补到「能向 LIAF 交付可校验的逐帧包与 Gunner 运行时包」，且不把权威命中写进素材。

**Architecture:** 制作工程、动画素材包、LIAF 游戏包三者分离。逐帧/怪物走增量清单 ZIP（契约冻结后的正式名，提案见 `mission/FB-00.md`）；玩家角色只把 **fbanim v3 发布路径** 当作 LIAF 入口，v2「导出骨骼包」降为制作预览。Warp/mesh 运行时继续拒绝，需要时用显式烘焙，禁止静默丢装备。

**Tech Stack:** 现有 Bun 工作区、`packages/shared` 契约、Pixi 编辑器、素材库 ZIP、`tests/fixtures/fbanim-v3`、MCP 与中英文 docs/i18n。不新增框架依赖。

## Global Constraints

- 开发分支：`shy`（不是 `main`）。
- 契约：LIAF-PIPELINE **R0 未冻结**；跨仓库字段不得在本仓单独发明第二份合同。R1 必须带 schema、样例、迁移说明。
- UI 文案走 `apps/web/src/i18n.ts` `t()`；错误用 `notify()`，确认用 `askConfirm()`。
- 不改生图/生视频/生音频三个插件 Tab 的通用行为（怪物 Tab / 导出另计）。
- 不把生成服务密钥、`storage/` 库、本机绝对路径写进交接包。
- 动作标记只表达美术时刻；禁止用素材包决定命中目标或伤害。
- 验证：`bun run typecheck`、相关 `bun test`；导出必须真点 UI 并打开产物。版本记录用 `bun run version:check` / `version:bump`。
- 跨仓 fixture：先 `bun scripts/sync_fbanim_fixtures.ts --target <engine> --dry-run`，禁止覆盖客户端已改字节。
- 已有功能不算新任务完成。

---

## 文件总图（按职责）

| 职责 | 主要路径 |
| --- | --- |
| 任务与交接 | `mission/README.md`、`tasks.md`、`contracts.md`、`handoff.md`、`FB-00.md`、后续 `FB-01.md`… |
| 怪物制作流水线 | `packages/shared/src/monster.ts`、`apps/server/src/monsterPipeline.ts`、`monsterExtractZip.ts`、`monsterExtractArchive.ts`、`apps/web/src/components/MonsterPipelinePage.tsx` |
| 逐帧时间轴导出 | `apps/web/src/export.ts`、`frameGeometry.ts`、`components/Editor.tsx`、`ExportAnimationModal.tsx` |
| 帧挂点/标记编辑（FB-02） | 新组件（建议 `apps/web/src/components/FrameSocketEditor.tsx`）+ 帧 `metadata` / 轴导出 JSON |
| 骨骼 v2 预览导出 | `apps/web/src/export.ts` `exportSkeletalProjectPackage`、`packages/shared/src/animationPackageV2.ts` |
| 骨骼 v3 LIAF 入口 | `apps/web/src/components/PublishWorkspace.tsx`、`publishDiagnostics.ts`、`skeletalExport.ts`、`animationPackageV3.ts`、`equipment.ts`、`actionComposition.ts` |
| Warp 烘焙（可选、需批准） | `apps/web/src/imageops/ops.ts` `warpImagePixels`、发布诊断新阶段 |
| Fixtures | `tests/fixtures/fbanim-v3/`；逐帧 fixture 路径 **等 G0 冻结后再建，不发明目录** |
| 文档 | `docs/api.md`、`docs/api.zh-CN.md`、`docs/architecture.md`、`docs/architecture.zh-CN.md`、`docs/CHANGELOG*.md`、制作教程、`AGENTS.md` |

---

### Task 0: 关闭 FB-00 审计交付

**Files:**
- Already created: `mission/FB-00.md`
- Modify: `mission/handoff.md`（提交后把 commit 填进交付记录）
- Do not modify exporters in this task

**Interfaces:**
- Consumes: 代码审计结论
- Produces: 可供 C-00 复核的报告；Q-01/02/06/07 提案

- [ ] **Step 1: 确认工作区只有审计文档未提交**

Run: `git status`

Expected: `mission/FB-00.md`、`mission/handoff.md` 已改；无密钥文件。

- [ ] **Step 2: 提交审计（仅当用户要求 git）**

```bash
git add mission/FB-00.md mission/handoff.md
git commit -m "docs: add FB-00 export audit for LIAF pipeline"
```

- [ ] **Step 3: 把报告路径发给总体负责人 / C-00**

验收：C-00 能按报告第 8 节打开真实 ZIP / `.fbanim`。在联合复核前 handoff 保持「进行中」或「待联合验收」，**不要**写成「已验收」。

---

### Task 1: 无冻结风险的本地加固（G0 前可做，不算 FB-01 完成）

**Files:**
- Modify: `apps/server/src/monsterExtractZip.ts` — 目录改用 `actionId`（`monster-02-attack`）而不是中文标题
- Modify: `apps/server/src/monsterExtractArchive.ts` — 写入 `sidecar.json`（文件名可暂用此名），页头注明 `liafPipeline: "R0-draft"`、`notARuntimeContract: true`
- Modify: `tests/monster-pipeline.test.ts`
- Modify: `apps/web/src/export.ts` — `frames.json` 增加 `durationSeconds: step.duration / fps`（保留原 `duration` 格数）
- Modify: `apps/web/src/i18n/zh.ts`、`en.ts`、骨骼导出按钮旁 hint：明确「导出骨骼包 ≠ LIAF 交付，LIAF 走发布 v3」
- Modify: `docs/architecture.md`、`docs/architecture.zh-CN.md` 各一段

**Interfaces:**
- Consumes: `MonsterActionId`、`run.extractFrameIds` 的 `actionId:fps` 键
- Produces: 仍可解压的 PNG 树 + 草稿 sidecar；旧标题路径不再作为稳定绑定键

- [x] **Step 1: 失败测试 — zip 路径用动作 ID**

`tests/monster-pipeline.test.ts` 增加：

```ts
expect(monsterExtractZipEntryPath({
  monsterName: "刀刃守卫",
  actionTitle: "平A",
  actionId: "monster-02-attack",
  fps: 4,
  frameIndex: 1,
})).toBe("刀刃守卫/monster-02-attack/4fps/0001.png");
```

（实现时给 `monsterExtractZipEntryPath` 增加 `actionId` 参数，标题只作 sidecar 的 `title`。）

- [x] **Step 2: 跑测确认失败**

Run: `bun test tests/monster-pipeline.test.ts`

- [x] **Step 3: 改路径函数与打包器，sidecar 含 `actions[].id`、`fps`、文件相对路径、`facing: "left"` 草稿**

- [x] **Step 4: 再跑测试 + `bun run typecheck`**

- [x] **Step 5: 逐帧导出补 `durationSeconds`，加单测或对 `meta` 结构的纯函数抽取后测**

- [x] **Step 6: UI/文档声明 v2 不是 LIAF 入口**

**停：** 不要把 sidecar 说成已冻结 `.monster`。

---

### Task 2: FB-01 逐帧 LIAF 包（依赖 G0 / Q-01/Q-02 冻结）

**Files:**
- Create: `packages/shared/src/liafFramePackage.ts`（名称以 R1 规范为准；未冻结前不要提交第二套字段）
- Modify: `monsterExtractArchive.ts`、`export.ts`（或新 `apps/web/src/frameRuntimeExport.ts`）使「导出给 LIAF」走同一 builder
- Create: 正负 fixtures（**目录以 G0 为准**）
- Create: `docs/` 制作教程：如何从仅有 PNG 的 ZIP **导入逐帧项目** 再导出；禁止写成 AI 流水线直接生成运行时包
- Modify: MCP 若有导出工具则与 HTTP 行为一致

**必须打进包的增量（相对今天的纯 PNG）：**

1. 稳定 `id` / `schemaVersion`
2. 每文件 sha256 digest + 依赖清单
3. 动作：`monster-0x-*` 或工程动作 ID、loop、facing、主 fps（24 为采样密度不是战斗频率）
4. 每帧 `durationSeconds` + 绝对 `t0`（避免格数累加漂移）
5. 统一 `originX/Y`（与 `exportAnimation` 包围盒算法对齐，`frameGeometry.ts`）
6. 裁剪：烘焙进 PNG 后 JSON 不再要求客户端加 `offset_*`
7. 挂点槽位（可先固定每动作一个 origin，逐帧覆盖留给 FB-02）
8. 不完整资源 → 校验失败，不写假成功包
9. 重导出保持稳定内容 ID（不要每次新 uid 当包 ID）

**Interfaces:**
- Consumes: 冻结后的 R1 schema
- Produces: 可离线校验的 ZIP；C-01 用同一 ID 绑定

- [ ] **Step 1: 把 R1 schema 抄进 shared（与规范源字段逐字一致）**
- [ ] **Step 2: 纯函数 `buildLiafFrameManifest` + 正例/缺 PNG 负例测试**
- [ ] **Step 3: 怪物打包与逐帧「导出给 LIAF」接同一函数**
- [ ] **Step 4: 待机/攻击切换：同一 origin 像素对齐的集成检查（导出后量 PNG 包围盒）**
- [ ] **Step 5: 更新 api/architecture 中英与 i18n**
- [ ] **Step 6: handoff 记「待联合验收」，等 C-01**

验收未过之前不算 FB-01 完成。

---

### Task 3: FB-02 挂点、发射标记、最小特效（依赖 FB-01 + C-00 能力反馈）

**Files:**
- Create: `apps/web/src/components/FrameMarkerEditor.tsx`（原点、枪口、受击、发射时刻）
- Modify: 帧或轴 `metadata`；预览层画十字/方向；导出写入包内 `sockets` / `markers`
- Modify: `apps/web/src/notice.ts` 用法：错误带「动作 ID / 挂点 ID」
- 素材：最小枪口闪光、曳光、金属火花 — **优先素材库已有图或手绘 PNG**，不自动打收费生成 API
- Modify: i18n zh/en

**Interfaces:**
- Consumes: FB-01 包结构上的 sockets/markers 字段
- Produces: 采样参考表（时刻 t、像素坐标、朝向）；C-02/C-03 用

规则：`weapon.fire` 只对齐权威「发射」阶段的**画面**；不要导出伤害或目标 ID。`combat.hitbox.*` 若契约改为 `presentationOnly`，UI 文案写「表现接触」不是「判定框」。

允许保存未完工程（缺挂点仍能存项目，导出 LIAF 包时再报错）。

- [ ] **Step 1: 元数据形状与纯函数校验测试**
- [ ] **Step 2: 编辑/预览 UI**
- [ ] **Step 3: 导出含挂点；缺必需挂点失败信息可定位**
- [ ] **Step 4: 三套最小 PNG 特效进样例包并注明来源**
- [ ] **Step 5: 浏览器按 user rule 点选挂点、导出、打开 JSON 核对**

---

### Task 4: FB-03 Gunner 运行时导出（依赖 G2 + Q-01/06 冻结）

**Files:**
- Modify: `PublishWorkspace.tsx` / `SkeletalProjectEditor.tsx` — 明确按钮文案「导出到终端 RPG」= **仅 v3**；v2 按钮改名「制作预览包」
- Modify: `export.ts` — v2 若含 warp，导出前 `notify` 警告「LIAF 不接受此包」；不要假装已烘焙
- Modify: `publishDiagnostics.ts` — 缺装备/事件/约束时 **error 阻断**，禁止静默省略
- Optional Create: 显式「烘焙 warp 为 PNG 并剥轨道」模式（须产品/契约批准），调用 `warpImagePixels`；文档写失去动态换装活变形
- Create: 可编辑 Gunner 工程（仓库内或交接说明，无绝对路径）
- Modify: `tests/fixtures/fbanim-v3/` **仅当**客户端同意同步；先 dry-run
- 贯通：冻结的 skeletonId + BodyProfile、`rifle_two_hand`（`holdMode: "two_hand"`）、hold/aim/fire/recoil clips、`muzzleSocket`、一个 `effectBindings`

**Interfaces:**
- Consumes: Q-06 Gunner 身份
- Produces: 确定性 `.fbanim` + capabilities；双手持握采样参考；**不是**只跑 `minimal-region`

- [ ] **Step 1: UI 入口正名 + i18n**
- [ ] **Step 2: 诊断：丢装备为错误**
- [ ] **Step 3: Gunner 工程走发布导出，解压 manifest version===3 且有 equipment**
- [ ] **Step 4: warp 工程无烘焙则无法导出 v3（已有行为，补 UI 说明）**
- [ ] **Step 5: fixture dry-run；与客户端对差异后再 sync**
- [ ] **Step 6: C-05 / B-05 联合验收前 handoff 不得标已验收**

禁止：把整角色拍成一张序列还声称骨骼兼容。

---

### Task 5: FB-04 传说武器样例（依赖 G3 + B-06/C-06）

**Files:**
- 装备定义 `actionOverrides`、持握 socket、专属 clip
- 一个技能阶段所需的帧/特效闭包（按权威阶段列表，不自造机制）
- 适配声明 JSON（合法 rig、失败时的错误路径）
- 教程与采样参考

- [ ] **Step 1: 单一武器工程，非法 rig 导出失败且能读出 socket/rig id**
- [ ] **Step 2: 技能素材闭包 + 标记**
- [ ] **Step 3: 与客户端联合看姿态/时间；不写跨骨架自动适配**

---

### Task 6: 全程文档、测试、交接卫生

每完成一个 FB 任务同步：

- `docs/api.md` + `docs/api.zh-CN.md`
- `docs/architecture.md` + `docs/architecture.zh-CN.md`
- `docs/CHANGELOG.md` + `docs/CHANGELOG.zh-CN.md`
- `AGENTS.md`（若导出入口变化）
- `mission/handoff.md` 用模板追加记录
- 测试：`bun run typecheck`、focused `bun test`；涉及版本则 `bun run version:check`

---

## 依赖与不可并行之处

```text
FB-00 审计 ──已完成草稿──► 提交 + C-00 复核
                │
                ├─► Task 1 本地加固（可并行于等待 G0）
                │
G0 冻结 Q-01/02 ──► FB-01 正式包 ──► FB-02 挂点/特效 ──► G1 联合验收
Q-06 + G2      ──► FB-03 Gunner v3
G3 + B-06/C-06 ──► FB-04 传说武器
```

**不要做的改动：** 在 R0 未冻结时提交第二套「正式」字段合同；改三个媒体插件 Tab；把 v2 工程包标成 LIAF 完成；为展示而改权威弹道机制；发明未在 G0 登记的 fixture 路径；把 `combat.hitbox` 当伤害判定导出。

## Spec coverage

| 需求 | 计划位置 |
| --- | --- |
| FB-00 报告与 Q 提案 | Task 0，`mission/FB-00.md` |
| PNG ZIP 缺语义 | Task 1 草稿 + Task 2 正式 |
| v2/v3 入口差异 | Task 1 文案 + Task 4 正名 |
| warp/mesh | Task 4 阻断/可选烘焙 |
| FB-01 稳定 ID/时间/origin/digest | Task 2 |
| FB-02 编辑入口与特效 | Task 3 |
| FB-03 Gunner 闭包 | Task 4 |
| FB-04 武器技能 | Task 5 |
| fixtures dry-run / 文档 / 无密钥 | Task 6 |

## 本组现在就能做 vs 必须等待

| 现在就能做 | 必须等待 |
| --- | --- |
| 提交 FB-00；Task 1 路径/sidecar/durationSeconds/文案 | FB-01 正式 schema（G0） |
| 准备刀刃守卫逐帧工程导入流程说明 | FB-02（C-00 能力 + FB-01） |
| 梳理现有 rifle fixtures 与装备工程差距 | FB-03（G2、Q-06） |
| | FB-04（G3、B-06/C-06） |
