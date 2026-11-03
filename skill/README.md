# FrameBaker 制作 SOP（`skill/`）

本目录是 FrameBaker 角色/内容制作 SOP 的**唯一真源**。2026-11-03 从 ECHO 本机与 box 缓存迁入并对齐，此后本机副本作废；修改只在这里做，经 PR 合入。

这些 skill 不会被编辑器或 agent 自动发现。开始相关工作时，先按下表直接读对应的 `SKILL.md`，再按其中的 references 列表继续读。

| skill | 何时读 |
| --- | --- |
| [`fb-character-authoring/`](fb-character-authoring/SKILL.md) | 任何 FB 角色制作：分件、绑定、Region 显隐与铁桶、MCP / ComfyUI 生成、动作与验收 |
| [`rpg-content-production/`](rpg-content-production/SKILL.md) | 游戏内容生产与跨仓交付（FB → `.fbanim` → 客户端 / 后端） |
| [`her1-fb-self-qc/`](her1-fb-self-qc/SKILL.md) | HELLO WORLD her1 每次改动之后、发预览或联系美术对接师之前 |

her1 项目的当前状态、待交美术包和续作命令不写在 skill 里，见 [`docs/her1/README.md`](../docs/her1/README.md) 与 [`docs/her1/ECHO_RUNBOOK.md`](../docs/her1/ECHO_RUNBOOK.md)。

## 去重约定

- **Region 显隐 / 铁桶 / 换手图**只在 [`fb-character-authoring/references/region-visibility.md`](fb-character-authoring/references/region-visibility.md) 写一次。原来散在 handoff、FIXED2、HAND_T01b 和各 SKILL 里的 SHOW / STRIP / IDENT 规则、translate-far 与 HIDE-scale 禁令，以及 cap 例外，都合并到这一页，其他文件只链接它。脚本阈值在 `docs/her1/state.json` 的 `visibility` 段，两处同步修改。
- **跨仓总规则**（后端发布、交付入口）以后端仓库 `挂机game` 的 `docs/game-handbook/content/framebaker-production.md`（framebaker-production 手册）为准；本目录只放 FB 侧制作 SOP，不复制该手册。客户端合同以 `tui-rpg-terminal-engine` 的 `docs/liaf-development-handbook.md` 为准。原 SOP 里的 `F:/…` 本机绝对链接已改成“仓库名 + 路径”文字。
- **项目状态与 SOP 分离**：具体 revision、素材 id、clip tag 只记在 `docs/her1/`，SOP 里只保留可复用规则和历史教训。
- ECHO 本机的 `scripts/fb_mcp_call.ts` 未入库，仓库内的等价入口是 `bun scripts/her1/her1.ts tools|call`。

## 与其他目录的关系

- `skills/`（`origin/shy` 分支上的 `image/video/audio_api_plugin_packager`）与根目录 `skills-lock.json`（第三方 skill 锁）是**另一套东西**：媒体插件打包工具与外部 skill 依赖，不是制作 SOP。不要把本目录的内容挪过去。
- `origin/shy` 分支上有本目录的旧版副本（`fb-character-authoring` 的 SKILL 与 4 个 reference，以及 `rpg-content-production/SKILL.md`）。本目录在它的基础上扩充，内容是它的超集。日后合并 shy 时，`skill/` 下出现 add/add 冲突一律取本目录版本，然后检查 shy 有没有独有段落需要补回。

## 缺失清单（ECHO 本机存在、未入库）

下列文件在原 SOP 中被引用，但迁移包和仓库任一分支里都没有。SOP 正文已标注“ECHO 本机未入库”。这些文件回到仓库前，相关段落只能当作背景，不能当作可执行步骤；有人补回时，在同一 PR 里删掉对应标注和本条目。

| 路径 | 被谁引用 |
| --- | --- |
| `docs/superpowers/specs/2026-10-03-ai-character-workbench-design.md` | fb-character-authoring、rpg-content-production |
| `docs/superpowers/plans/2026-10-03-ai-character-workbench.md` | fb-character-authoring、rpg-content-production |
| `docs/superpowers/plans/2026-10-04-v4-character-animation-readiness.md` | fb-character-authoring |
| `docs/superpowers/plans/2026-10-05-gunner-action-library.md` | subagent-animation-pipeline |
| `docs/superpowers/plans/2026-10-06-animation-session-handoff.md` | fb-character-authoring、rpg-content-production、production-handoff |
| `docs/superpowers/plans/2026-10-06-gunner-r43-continuity.md` | art-methods |
| `skill/fb-character-authoring/references/video-reference-keyframes.md` | fb-character-authoring、ai-loop |
| `skill/fb-character-authoring/references/eyes-and-blinking.md` | fb-character-authoring |
| `skill/fb-character-authoring/references/local-repair-and-performance.md` | fb-character-authoring、acceptance、mcp-assistance、production-handoff |

后端仓库 `挂机game` 中的 `docs/animation-mcp-comfyui-handoff-20261014.md` 属于 ECHO 本机环境交接，不属于缺失 SOP。
