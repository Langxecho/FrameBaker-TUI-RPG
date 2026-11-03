# MCP 辅助制作手册

## 先发现能力

MCP 地址是实际运行中的 FrameBaker `/mcp`，传输为 Streamable HTTP。已有 `wqy` 制作服务使用 `http://127.0.0.1:39127/mcp` 和 `storage-wqy-pilot`；其他机器以实际服务配置为准，不照抄旧 `shy`/3025 示例。每次任务先调用 `tools/list`，再查询能力与项目，不能因为文档出现工具名就假定当前服务已加载。

当前 HELLO WORLD 的插件、远端 ComfyUI 地址和已产任务收据见后端本机 MCP / ComfyUI 接手说明（后端仓库 `挂机game`：`docs/animation-mcp-comfyui-handoff-20261014.md`，ECHO 本机环境交接）。这是环境交接；可复用制作规则仍只在 FB `skill/` 维护。

当前 AIC 工具的职责如下：

| 工具 | 用途 | 是否写入 |
| --- | --- | --- |
| `aic_get_capabilities` | 查看实际坐标、Region/Mesh、导出版本支持与拒绝能力 | 否 |
| `aic_get_project_summary` | 有界读取骨架、附件、装备、动作、诊断 | 否 |
| `aic_get_workflow` | 读取 run、预算、候选和评审，优先取 run，避免输出完整历史 | 否 |
| `aic_get_diagnostics` | 结构和 v3 能力检查 | 否 |
| `aic_sample_pose` | 按 actionId 与秒采样骨骼/Socket 矩阵 | 否 |
| `split_material_parts` | 有界网格色键分件 | 是：创建新素材 |
| `aic_apply_operations` | 原子创建/修改骨架、绑定、BodyProfile、装备、动作、关键帧 | 是 |
| `aic_workflow` | 按 schema 冻结候选、记录真实评审、采用/恢复和有界预算操作 | 是 |
| `aic_render_candidate` / `aic_render_contact_sheet` | 用真实 CharacterPreview 渲染冻结候选，返回 PNG 与身份收据 | 写证据，不自动签收 |
| `aic_publish_v3` / `aic_publish_v4` | 按版本能力构建导出；v4 可使用 revision-guarded selection | 候选导出，不等于客户端/后端准入或生产激活 |

`aic_apply_operations` 必须给 `projectId`、读取到的 `baseRevision`、新的 `idempotencyKey`、1..64 个操作。操作类型包括 `create-skeleton`、`create-motion-clip`、`upsert-binding`、`upsert-keyframe`、`upsert-body-profile`、`upsert-equipment`、`upsert-action`、`set-runtime-capabilities`。先小批次写入，写后重新读取 revision；冲突、重复幂等键或诊断错误时停止，不覆盖并发制作者。

`aic_sample_pose` 的 `timeSeconds` 是非负秒；优先用稳定 `actionId`，不要用可能重名的展示名。枪口、主手、辅手要在相同动作/时间一起采样；只看一个骨骼的数值不能证明握持正确。

## 推荐调用顺序

```text
tools/list
→ aic_get_capabilities
→ list_projects / list_materials
→ aic_get_project_summary / aic_get_workflow（预算与当前候选）
→ aic_get_diagnostics
→ split_material_parts（有明确 4×4 或其他网格契约时）
→ aic_apply_operations（先骨架/绑定，再装备，再动作）
→ aic_sample_pose（多动作、多时刻、多 Socket）
→ aic_get_diagnostics
→ 冻结候选 → 真实截图与完整1×/局部慢放 → 记录评审
→ 按已验证版本导出 v3/v4 → 正式客户端完整窗口/动作检查
```

不要直接写 SQLite，也不要在 MCP 工具内部用 HTTP 自调用替代共用业务模块。外部 AI 可使用既有 HTTP 素材上传入口登记本地图片；工程写入仍走 revision/幂等保护的 MCP。导出 bytes/hash 不是美术验收或后端准入。

## MCP 连接与没有工具菜单时的调用

支持远程 MCP 的 AI 应添加名称 `framebaker`、地址 `<实际FB地址>/mcp`、传输 Streamable HTTP；不是 stdio，也不是 ComfyUI 本身的 MCP。客户端先 `initialize`，接收会话信息，再发送 `notifications/initialized`、`tools/list` 和 `tools/call`。SDK会话需要保留返回的 `Mcp-Session-Id` 与协商后的协议版本。

ECHO 本机曾用 `scripts/fb_mcp_call.ts`（未入库）。仓库内等价入口是 `scripts/her1/her1.ts` 的 `tools` / `call` 子命令，可在未预装连接器的 AI 中直接显式调用当前服务。它只调用指定工具，不自动后续生成、不重试、不绑定；参数从 JSON 文件读取，避免 shell 转义改坏 JSON：

```powershell
# 在 FrameBaker-TUI-RPG 仓库根目录
$env:FRAMEBAKER_MCP_URL = 'http://127.0.0.1:39127/mcp'
bun scripts/her1/her1.ts tools
bun scripts/her1/her1.ts call aic_get_capabilities
bun scripts/her1/her1.ts call list_media_plugins --args args/list_media_plugins.json
```

参数是一个 JSON object；大请求先保存成 UTF-8 JSON 再由程序读取，不拼接 shell 命令。PowerShell 原生参数转义若改变 JSON，引号错误是调用层问题，改用 SDK/已验证脚本读取 JSON，不能因此改协议。

标准 `tools/call` 信封如下（HTTP POST `/mcp`，`Content-Type: application/json`，`Accept: application/json, text/event-stream`）：

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_media_plugin","arguments":{"kind":"image","pluginId":"qwen_image_2_1"}}}
```

响应可能是 JSON 或 SSE。解析匹配 id 的 JSON-RPC消息，先检查 `error` / `result.isError`；普通返回的数据在 `result.content` 的 text块中，text本身仍是JSON字符串，需要第二次解析。`tools/list` 返回 inputSchema，插件详细参数在 `plugin.paramsSchema`，两者不是同一个schema。观察工具还会返回 image块，不要忽略图像或将 PNG 返回当已审图。

## 图片 / 视频媒体插件调用

`generate_with_media_plugin` 属于独立 `.iap/.vap/.aap` 系统，不通过 GenProvider 的 `providerId/model` 选择器。正确顺序：

1. `list_media_plugins({kind:"all"})` 找安装状态；`get_media_plugin({kind,pluginId})` 读 `paramsSchema`、constraints、configured/runnable。后两项是配置/文件状态，不证明远端健康。
2. 读当前工程与 workflow预算。角色生成用 `aicProjectId` 归属已有工程；`projectId` 是可选逐帧导入目标，不能用它替代骨骼预算归属。
3. `references` 仅有序 material UUID列表，不传本地路径、任意URL、frame ID或candidate ID。本地PNG先用 `POST /api/materials/upload` 的 multipart `file` 登记。当前媒体参考默认消费素材 raw；想锁定已处理PNG时先把该PNG登记为独立参考素材，不假定生成入口自动优先processed。
4. 把 `kind,pluginId,prompt,references,params,count,aicProjectId,name,idempotencyKey` 存成请求收据；视频还可给 `durationSeconds`。params严格按实际插件schema，不能套用普通 Stable Diffusion工作流参数。
5. 提交一次，保存 jobId/jobIds。调用 `get_job({jobId})` 查终态；当前实际status包括 `queued/running/done/error/cancelled`，不要只等不存在的 `failed` 字符串。HTTP成功仅是接收，不等于生成完成。
6. done 后从progress/归档收据找到 materialIds；通过素材库元数据核对 mediaPluginJobId、插件版本、实际尺寸、SHA与本地文件。再实际审图/看视频。未知/超时状态先对账，不重新提交。

有references时，当前Qwen插件进行图像编辑；无references时进行文生图。提示增强是该插件内的一步，当前schema没有关闭增强开关；发生增强超时不等于Comfy断线。`denoise` 是已暴露参数，但低值不能证明腕口/指形或蒙版外保持。

图像生成完成后，局部修复仍走 `repair_material_region`：source/patch/mask三素材、所消费PNG的SHA、同尺寸不透明二值mask，输出新素材；该工具不调用模型、不自动绑定。详情见局部补画（ECHO 本机未入库：`skill/fb-character-authoring/references/local-repair-and-performance.md`，见 `skill/README.md` 缺失清单）。

## 生成插件与显存

生成类 MCP 返回 jobId 时，先用 `get_job` 对账。ComfyUI地址由已安装插件的配置提供，不因本机8188未监听就判断不可用。共享ComfyUI图片/视频插件不可同时占用同一服务：

1. 等待前一个任务完成；
2. 现有 `mediaPlugins/comfyBootstrap.ts` → `runtime.ts` 的租约门禁在首次使用/插件切换时调用 `comfyCleanup.ts`。先读 `/queue`，空闲后请求 `/free`（`unload_models=true`、`free_memory=true`）；
3. 轮询 `/queue` 和 `/system_stats`，默认连续两次确认队列空且各设备 `torch_vram_total <= 64MiB`（总等待45s）。不是根据vram_free是否等于整卡容量判断；
4. 再加载下一个插件；失败就停止，不盲目重试。

不要在文档里写密钥/账密，不打印安装目录 `plugin.json`。默认让FB运行时管理清理，不绕过租约或手改SQLite，不清队列、不interrupt他人任务；`/free`返回200不是卸载完成。`COMFY_BUSY`、`COMFY_CLEANUP_UNCONFIRMED`等失败保留，先核对job/队列/阶段。

图片候选优先 `qwen_image_2_1`；视频参考用用户指定H3 `.cfp`转换的已安装 `.vap`，当前ID为 `minimax-h3-t8-i2v`。图片与视频的配置/工作流/缓存均以当前插件为准，不能只在本地找Comfy进程。

`recover_known_media_job({jobId})` 仅用于持久Comfy journal已有已知prompt、且插件声明支持恢复的同一失败job；它不创建新job/新prompt。Qwen当前不能默认具备此恢复能力。未知提交、done任务或没有journal的失败不能盲目调用恢复或再生成。

## 给 AI 的任务模板

```text
读取 skill/fb-character-authoring/SKILL.md 及 references/mcp-assistance.md。
目标：在本地 FrameBaker 工程 <projectId> 制作 <角色/装备>。
先只读获取 tools/list、aic_get_capabilities、summary、diagnostics；报告当前 revision 和错误。
只使用已有素材 <materialId>；若需生成，先给出 prompt/插件/尺寸/预算，完成后保留 jobId 与 SHA。
任何写入必须使用当前 baseRevision、新 idempotencyKey，分批不超过 64 项；不要改伤害、命中或后端机制。
完成后重新读 summary/diagnostics，采样 <动作+时间> 的主手、辅手、枪口，冻结候选并真实播放后按已验证的 v3/v4 能力导出。
停止并报告：revision 冲突、能力不支持、素材缺失、视觉未签收、Comfy 显存未回收。
```
