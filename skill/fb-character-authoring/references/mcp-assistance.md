# MCP 辅助制作手册

## 先发现能力

AIC 工作树的 MCP 地址是运行中的 FrameBaker `/mcp`（默认本机 `http://127.0.0.1:3025/mcp`，以服务启动日志和 `tools/list` 为准）。主 `shy` 树和 AIC 工作树的工具集合不同；每次任务先调用 `tools/list` 或 `aic_get_capabilities`，把能力快照写进收据。不能因为文档里出现工具名就假定当前服务已加载。

当前 AIC 工具的职责如下：

| 工具 | 用途 | 是否写入 |
| --- | --- | --- |
| `aic_get_capabilities` | 查看坐标、Region、v3 支持与拒绝能力 | 否 |
| `aic_get_project_summary` | 有界读取骨架、附件、装备、动作、诊断 | 否 |
| `aic_get_diagnostics` | 结构和 v3 能力检查 | 否 |
| `aic_sample_pose` | 按 actionId 与秒采样骨骼/Socket 矩阵 | 否 |
| `split_material_parts` | 有界网格色键分件 | 是：创建新素材 |
| `aic_apply_operations` | 原子创建/修改骨架、绑定、BodyProfile、装备、动作、关键帧 | 是 |
| `aic_publish_v3` | 使用相同 builder 构建 v3 候选并返回摘要 | 生成候选，不等于激活 |

`aic_apply_operations` 必须给 `projectId`、读取到的 `baseRevision`、新的 `idempotencyKey`、1..64 个操作。操作类型包括 `create-skeleton`、`create-motion-clip`、`upsert-binding`、`upsert-keyframe`、`upsert-body-profile`、`upsert-equipment`、`upsert-action`、`set-runtime-capabilities`。先小批次写入，写后重新读取 revision；冲突、重复幂等键或诊断错误时停止，不覆盖并发制作者。

`aic_sample_pose` 的 `timeSeconds` 是非负秒；优先用稳定 `actionId`，不要用可能重名的展示名。枪口、主手、辅手要在相同动作/时间一起采样；只看一个骨骼的数值不能证明握持正确。

## 推荐调用顺序

```text
tools/list
→ aic_get_capabilities
→ list_projects / list_materials
→ aic_get_project_summary
→ aic_get_diagnostics
→ split_material_parts（有明确 4×4 或其他网格契约时）
→ aic_apply_operations（先骨架/绑定，再装备，再动作）
→ aic_sample_pose（多动作、多时刻、多 Socket）
→ aic_get_diagnostics
→ aic_publish_v3
→ 人工打开 FB 兼容预览逐动作检查
```

不要让 AI 直接写 SQLite 或用 HTTP 自调用绕过 MCP；不要把 `aic_publish_v3` 返回的 bytes/hash 当作美术验收或后端准入。

## 生成插件与显存

生成类 MCP（例如 `generate_frames`、`generate_with_media_plugin`）返回 jobId 时，先用 `get_job` 对账 `queued/running/done/failed`，下载或引用输出后再继续。共享 ComfyUI 时图片和视频插件不可同时占用同一服务：

1. 等待前一个任务完成；
2. 通过项目已有 Comfy cleanup 入口请求 `/free`（`unload_models=true`、`free_memory=true`）；
3. 轮询 `/system_stats`，确认队列为空且显存已回收；
4. 再加载下一个插件；失败就停止，不盲目重试。

不要在文档里写死云端密钥、账号、密码或把共享 ComfyUI 当作永远可用。图片候选优先使用 `qwen_image_2_1`；视频候选优先使用用户指定的 H3 `.cfp` 插件。插件路径、服务地址和模型缓存均以当前设置/`list_media_plugins` 为准。

## 给 AI 的任务模板

```text
读取 skill/fb-character-authoring/SKILL.md 及 references/mcp-assistance.md。
目标：在本地 FrameBaker 工程 <projectId> 制作 <角色/装备>。
先只读获取 tools/list、aic_get_capabilities、summary、diagnostics；报告当前 revision 和错误。
只使用已有素材 <materialId>；若需生成，先给出 prompt/插件/尺寸/预算，完成后保留 jobId 与 SHA。
任何写入必须使用当前 baseRevision、新 idempotencyKey，分批不超过 64 项；不要改伤害、命中或后端机制。
完成后重新读 summary/diagnostics，采样 <动作+时间> 的主手、辅手、枪口，构建 v3 候选。
停止并报告：revision 冲突、能力不支持、素材缺失、视觉未签收、Comfy 显存未回收。
```
