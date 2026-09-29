# AI 角色流水线实施卡（FrameBaker 实施树）

本页是实施树的状态记录；原始任务卡位于 `F:\CodeProject\FrameBaker-TUI-RPG\mission\ai-character-pipeline.md`，仅作只读参考，不能从本实施树反向修改。

## 当前可用状态（2026-09-26）

- AIC skeletal authoring API/MCP 已可创建骨架、动作、绑定、BodyProfile、装备并发布 `.fbanim v3`；发布按 revision 冻结并返回摘要地址。
- 已验证真实 FrameBaker 素材 `ecfeb992-399e-46a1-bd73-88799c8f1b45` 可作为后续角色制作的 source material。它不是成品职业包，也不代表最终美术质量。
- `scripts/aic_humanoid_recipe.ts` 通过 HTTP/MCP 创建 16 骨骼 humanoid 配方、四个动作、绑定并发布；脚本只调用公开 API，不直接写数据库。
- `split_material_parts` 是受 material ID 约束的确定性网格分件：固定 row-major cell、RGB 色键阈值、透明边缘裁剪和输出大小预算。它不是通用人体语义识别，也不生成 Mesh/蒙皮/成品美术。

## Split contract

HTTP：`POST /api/materials/:id/skeletal-split`，路径 `:id` 必须是 source material ID；body：

```json
{
  "rows": 3,
  "cols": 4,
  "keyColor": [255, 0, 255],
  "tolerance": 24,
  "parts": [{"name":"head","cell":0},{"name":"torso","cell":1}]
}
```

`cell` 为零基、行优先索引；parts 允许 1–64 项且不得重复或越界。请求可带 `Idempotency-Key`。返回 `sourceSha256` 与 `parts[]`，每项含 `name`、`cell`、新 `materialId`、`width`、`height`、`bounds`、`opaquePixels`。子素材保存为 `raw.png`，metadata 保留 source ID/digest、网格、色键、cell 与 bounds。

MCP 等价工具：`split_material_parts({ materialId, rows, cols, keyColor?, tolerance?, parts, idempotencyKey? })`。该工具只做有界像素裁切，不负责语义命名；part 名称和骨骼绑定由调用方提供。

## 数值姿势对照

`GET /api/projects/:id/aic-summary` 默认对 bones/attachments 分页（offset 默认 0、limit 默认 64、最大 256），并返回总数及截断标志；需要完整或局部姿势数值时使用 `GET /api/projects/:id/aic-pose` 或 MCP `aic_sample_pose`。输入为 `actionId`、`timeSeconds`，可选 `boneIds`、`socketIds`、`bodyProfileId`；共享采样器使用秒、MotionClip 插值和 FK，返回 local/world 矩阵与 socket position，应用 action speed 并显式报告 `clipTimeSeconds`。未知骨骼/插槽、超过 128 个选择项或多 BodyProfile 未指定 profile 均拒绝。该接口只采样 Region 绑定的骨骼变换，不推断约束、不生成 Mesh 或顶点权重蒙皮。

## 验收边界

当前已完成 FB 侧素材与 `.fbanim v3` 生成准备，并取得 B 侧本地 authority、C 侧 class 消费和真实宿主机械收据。D1
范围是 Region 技术样例：正式职业、formal-class WebSocket、Mesh、equipment combat 与生产发布不属于其关闭门槛，
也不能由本页证据宣称这些后续能力已完成。C 已实现完整游戏客户区截图和真实 CLI→PTY 输入验收；
操作系统桌面/物理键鼠不在该证据范围。不得将本页状态写成生产部署或成品职业承诺。

### 当前联合核对入口

2026-09-26 最后逐项核对位于 B `mission/aic-d1-completion.md`，取代下文历史收据的“当前”称谓。
统一收据 `target/aic-d1-delivery-20260926/cost-identity-receipt.json` 已验证 FB/C/B 实现摘要、
当前工程的同刻姿态、16 张全窗口阶段 PNG 和 7 张输入 PNG；同一宿主 90.005 秒性能 holdout 通过。
当前 project 为 `6ccb1319-f0f8-4258-ba5c-6dd9219080cb`，使用 despill-100 的 base/variant，
16/16 贴图、骨架、BodyProfile 与四动作摘要一致，variant 仅改变躯干 binding 宽度 12%。
完整窗口受击峰值已在原速 applied 后 91ms 采样并经 AI 确认可见，本地 Region D1 逐项签收完成。
原始证据和未知成本指标均如实保留，未扩大为正式职业/生产资格。

本轮 focused 验证：Bun 的 atomic/API/recipe-budget/media-plugin-runtime/comfy-cleanup 五个
文件合计 15 passed；`py -m pytest -q tests/test_comfy_provider_recovery.py` 为 6 passed。
未重新生成媒体或并行加载 Comfy 模型。三仓均为实施工作树，未提交/合并到主力分支。

## D1 真实收据（2026-09-26）

以下状态来自本实施树的真实收据，不是凭空生成的 token 或“看起来像通过”的占位结果：

- 源素材为 `ecfeb992-399e-46a1-bd73-88799c8f1b45`，source SHA-256 为 `77924ab10133f4eca0306474d3fac40bcf341003b3cdc211f1698f6d8b6a3d49`；`storage/aic-runs/humanoid-d1/recipe-state.json` 记录了 16 个有界分件、项目 `3c9712bc-6a69-473f-be16-ccd042ef853f` 和恢复检查点。
- B 侧本地 authority 收据已通过 base、variant 和 death：`backend-base.json` / `backend-base-v2.json` 与 `backend-variant.json` / `backend-variant-v2.json` 各跑完 100 帧且 `terminal=false`；`backend-death-v2.json` 在 1 帧终止且 `terminal=true`。这些是后端事实与事件收据，不代表渲染质量。
- 同一份 v3 产物的 C 侧离屏收据已通过：`base-v2.class`、`variant-v2.class` 均在 `storage/aic-runs/humanoid-d1/`；早期 `base.class`、`variant.class` 路径错误，保留为失败/过时收据，不计入通过。base revision 1 的 `.fbanim` digest 为 `sha256:17f10b4ed2328925e885100a1a0ade2304e35f85772cbba2a4acb5c0d2284194`，variant revision 2 的 digest 为 `sha256:41a2de04756bd5385f78a6c22716dbdec060db93345b0751bd5ee8483adae579`。旧可见 WezTerm 基础样例另有 30 applied、0 reject、0 stale、1 destroy；GUI 收到 469 帧且每帧 `characters=1`，host 身份为 `110x32 / DPI 144 / OpenGL`。这些是离屏/可见性/协议收据，不等于人工视觉质量或性能签收。
- B 侧当前机械收据 `target/aic-d1-final-20260926/acceptance.json` 标记 `status=local-mechanical-pass`、`fullPipelineAccepted=false`：base 30 commands/497 frames、variant 30/494、death 9/506，各自 destroy=1，所有 client probe 通过且 base/variant authority hash 相同。013915 保留为历史基线。该收据只证明本地 Region 机械路径和真实宿主遥测，不代表桌面截图/UI 检查或完整产品流水线验收；正式 class、live formal-class WS、Mesh、equipment combat 与生产不属于 D1 门槛。
- C 侧同刻姿态数值比较已通过：`target/aic-d1-20260926-013915/c-pose-variant/numeric-evidence.json` 共 8 组，`maxAbsError=3.552713678800501e-14 <= 1e-5`；C 使用独立 `aic_pose_compare` binary 复用 sampler/FK/socket。该证据只覆盖这 8 组样本，不能外推所有 rig；AI 视觉质量仍待独立检查，人工记录是可选证据，不是每轮制作门槛。
- 真实 terminal 客户端的 Region D1 机械路径已由当前总收据覆盖，但桌面截图/UI 检查仍未实现，当前**不得标记为完整产品流水线通过**。FB MCP 只读数值证据保存在 `storage/aic-runs/aic-mcp-acceptance/2026-09-25T17-42-43-745Z-37700/`；性能、启动与内存已有测量但各自受范围限制：新应用缓存不等同冷 OS、宿主峰值为抽样、GPU 回退是整卡而非每进程，不能外推为通用性能资格，也不能写成完全未测。视频恢复 job `8192fe6c-8f8b-4909-89d2-7fb8e1a8352f` 最终 `done`，promptId `d365b02e-c012-4a07-bf38-e35c0b8edbeb`，material `92d7f21f-8d0b-4005-a0f6-1c1e9c9daf5b`，run_attempt=3；图片恢复 job `186d05d9-10f8-48c1-b10e-4daf325f2946` 一次 `done`，material `1557d515-5dd2-493b-b093-a34d1bfeb74c`，耗时 35.261 秒。视频/图片只证明插件与恢复链路，不代表角色动画、视觉质量或战斗验收。
- 独立连续宿主观察使用同一 base 报告，位于后端 `target/aic-d1-20260926-092600/base/`：约 60.067 秒、1,822 个 GUI 帧、30 个命令全部 applied、一次 Destroy、无 logger gap；最大帧间隔 120.201 ms，未出现超过 250 ms 或 700 ms 的间隔。该测量增强了终端持续运行证据，但尚未冻结通用性能阈值或替代视觉检查。

- 只读成本收据位于后端 `target/aic-d1-cost-20260926-021755/cost-identity-receipt.json`，仅记录 job wall time、attempt、可知 prompt 对账与源码身份；模型计算时间、queue 等待、token 和账单金额均为未知并带原因。配方预算收据 `storage/aic-runs/humanoid-budget-receipt-1790360027312/` 验证了预算耗尽拒绝与 seed checkpoint 复用，未重发生成任务。
- 当前复采集 `target/aic-d1-cost-20260926-100000/cost-identity-receipt.json` 为 `collected-read-only`，重新绑定 060000 mechanical acceptance、2 个已完成媒体 job 和三仓 dirty identity；`fullPipelineAccepted=false` 保持不变，token/账单/供应商计算时间继续记录为未知。

## 复跑、恢复与成本边界

recipe 只通过公开 HTTP/MCP API 工作，使用现有素材，不直接写数据库；可用已有检查点安全恢复：

```powershell
bun scripts/aic_humanoid_recipe.ts --material ecfeb992-399e-46a1-bd73-88799c8f1b45 --url http://127.0.0.1:3025 --out storage/aic-runs/humanoid-d1
bun scripts/aic_humanoid_recipe.ts --material ecfeb992-399e-46a1-bd73-88799c8f1b45 --url http://127.0.0.1:3025 --variant --out storage/aic-runs/humanoid-d1
```

配方支持可执行的制作预算：`--max-calls`、`--max-wall-ms`、`--max-response-bytes`。每次 MCP 或产物下载都会先检查剩余额度，再把结果（包括失败）原子写入 `recipe-state.json` 的 `budget.receipts`；收据把 `observed*`（实测）与 `charged*`（保守门控费用）分开，进程中断时观测值保持 `null`、原调用开始时的 reservation 和 `limitSnapshot` 保留，并标记 `needsReconcile`，不会因恢复时提高 limits 而放大历史费用。未能知道 token 时固定记录 `tokens: null`，不会按字符估算。预算耗尽会在下一次网络操作前拒绝，并保留当前检查点；超出响应字节时会取消底层 HTTP 流。需要在新目录复用已有发布身份时，可使用 `--seed-checkpoint <旧 recipe-state.json>`；新 checkpoint 会记录 source checkpoint SHA-256、项目和 artifact digest，以及 `inheritedCost: "unknown"`，只复制 source/project/split/artifact 引用，不覆盖旧证据，也不会重新生成或发布。

可选 `--magenta-despill 0..100`（默认 `0`）把去品红强度传给 `split_material_parts`；更改强度需使用新的 `--out` 目录和检查点。`--magenta-despill 100` 的独立 D1 工程 `6ccb1319-f0f8-4258-ba5c-6dd9219080cb` 保存在 `storage/aic-runs/humanoid-d1-despill-100/`，不覆盖原始 base/variant 收据。同刻 FB/C 数值对比收据为该目录下 `pose-parity-receipt.json`：base 和 variant 各 8 组骨骼/挂点采样均通过 `maxAbsError <= 1e-5`；这只证明有限样本的数值一致，不代表人工视觉质量通过。

split、AIC operations 和 publish 都带有幂等/版本约束；重试不得换 source material 或覆盖不同内容的证据文件。已知 Comfy `promptId` 的恢复只对账 history/view；提交状态或输出状态未知时必须阻断，禁止盲目重提。D1 成本记录只保留已收据化的耗时、尝试次数和显存观测，不推算 token、价格或供应商账单。

插件共享 Comfy 运行时切换必须 fail closed：先串行等待旧任务租约释放；切换前必须能观测旧/新 endpoint 的队列为空，并确认 `unload_models/free_memory` 后连续两次显存回收观测。真实观察 `storage/aic-runs/humanoid-d1/comfy-cleanup-observation.json` 记录 H3 残留清理从 `853540864` 降至 `27262976` bytes、3061ms、队列全程为空；随后视频恢复与图片回切均已完成。该观察与恢复收据只证明插件切换/恢复链路，不等同于角色 video→image 内容质量、numeric/visual/performance 联验或 runtime 身份的全面证明。缺少清理能力、队列仍忙、显存不可观测或清理超时都会保持 runtime blocked，拒绝下一次提交，直到人工确认；不得先卸载旧插件再猜测新插件已安全加载。

最后，Region 绑定只是“矩形纹理 + 骨骼局部变换”的附件模型，不是 Mesh、顶点权重或运行时蒙皮。16 部件分件与对应绑定是技术样例和管线验收夹具，不是正式职业、成品角色或美术质量承诺。

## GUN-05 revision 13 与候选包收据（2026-09-29）

项目 `e59892ac-d398-4055-950f-883b00ac0abd` 已由姿态修正推进到 revision 13：
只调整 idle 右臂的平移与旋转，保留三把武器握点和纹理资源。结构化诊断为空，
单独装备兼容性均为 `ok=true`。共享 v3 builder 产物为
`sha256:8d89109485f4c0825a2021537f896e2fef20f8a8f6d6f7536bd273c9412308e0`，
1,237,990 bytes，34 entries，状态 `built-not-released`。

兼容预览经真实浏览器刷新后可观察到胸前持枪姿态。装备切换时旧图层残留的问题已在
`CharacterPreview` 修复：SVG 节点 key 纳入槽位、附件和素材身份，旧 image 会先卸载；
FrameBaker typecheck 和 loadout-preview focused tests 通过。该 revision 仍只作为 C 组包和
B 离线准入输入，未发布到生产或正式资产 registry，逐动作视觉签收仍待完成。

2026-09-26 续接收：后端本地 G2 runner 已重新通过 Docker/PostgreSQL，使用同一 `fb02_a1_drone@1.0.0`
归档身份完成 admission、公共归档和隔离发布/激活/loopback WebSocket 收据；这些结果由 B 台账保存，FB
不因此宣称正式职业或生产发布。插件仍保持单模型串行切换约束；本轮没有并行加载两个 Comfy 模型。

## GUN-05 枪手草稿续接（2026-09-29）

在已修正的 Region 绑定 revision 5 基础上，继续把两把独立武器候选接入同一枪手草稿：

- `fission_projector` 裂变投射器：来源素材
  `9ef0cbe5-4acb-4e1f-a9fb-8e008f359115`，原图 SHA-256
  `92a5dc3436522999cdd3cd4f368e8d755c8ca85f765dc807d78f36a5a8f1bb56`；
  去品红、裁切后的候选素材 SHA-256
  `d48979fc26c3b78f7f1440f1e014dd740b0cf7f969f3a6e6aff126a8b1be037c`。
- `phase_piercer` 相位贯穿器：来源素材
  `c9271611-bd7d-4641-84da-de998fabb785`，原图 SHA-256
  `e242a453b00e9fde00ae3289fbfa6a9a633a80d7fdcfdd660e95aa1a09842f4c`；
  去品红、裁切后的候选素材 SHA-256
  `10b2839560947116229b5f184a859362a91283e0f55e5a7a6b5c463cf6c07135`。

两件装备通过公开 `aic_apply_operations` 挂到工程
`e59892ac-d398-4055-950f-883b00ac0abd`，随后完成 revision 12 的姿态修正：idle
双臂整体抬高约 15px，脉冲/裂变/相位的辅手握点分别为 `+11/+23/+24`，枪口挂点为
`+26/+40/+51`。`aic_get_diagnostics` 返回空诊断，idle 主辅手误差约 1.26px，枪口已到
胸口高度；三把武器单独 `validateLoadout` 均 `ok=true`。这只证明结构、素材依赖和数值
姿态合同可编译，不证明逐动作画面已经完成目视签收。

共享 v3 builder 已在 revision 12 生成草稿包：
`sha256:1b99fe3d0c81f0283b19bb830fc9ca2029a4c4dead38d6f682aeec2399cfe534`，
1,237,929 bytes，包含 9 个动作、3 个装备、18 个纹理和 34 个条目。该包状态为
`built-not-released`；未发布正式 `.fbanim v3`，未写入客户端或后端正式资源。
证据收据位于 gitignored 的 `storage/aic-runs/gunner-weapons-20260929/`。

## 2026-09-29 GUN-05 revision15（未发布）

当前枪手工程`e59892ac-d398-4055-950f-883b00ac0abd`已修正肩部局部锚点，
三武器分别持握；裂变与相位通过`actionOverrides`引用包内`fission.<action>` /
`phase.<action>`，保留九基础动作，共27动作。投掷/注射/通信中段松开辅手。
三武器459次API姿态采样通过，持握最大误差0.182582px；视觉仍待逐动作签收。
配方`gunner_shoulder_pose.ts`、`gunner_weapon_poses.ts`只经MCP写草稿，保留旧clip。
校验`check_gunner_weapon_poses.ts`不把数值接触当作视觉结论。
revision15候选摘要`sha256:43254f5beae5bcc483bc610579ff047bbc293708120031393aa24eaa60935226`，
1,258,972 bytes，`built-not-released`。收据和修改前快照在忽略目录
`storage/aic-runs/gunner-weapon-poses-20260929/`；不替换历史D1，不算正式职业发布。

## 2026-09-26 D1 去品红与跨仓数值签收（与GUN-05独立）

`humanoid-d1-despill-100` 使用 `magentaDespill=100` 生成了独立 revision 2 工程，保留原始工程不变。
`pose-parity-receipt.json` 记录 FB MCP 与 C comparator 对 base/variant 各 8 个同刻采样的结果：覆盖
`idle/attack/hit/death`、`root/chest/hand_right` 和 `weapon_hand_right`，两包最大绝对误差
`3.552713678800501e-14 <= 1e-5`。这项收据只证明有限采样的数值一致；上传前画面和桌面窗口视觉仍由 C 侧记录，
不把 Region 绑定升级为 Mesh/蒙皮能力或正式职业资格。

B 侧当前 `aic-d1-final-20260926/acceptance.json` 已消费该 revision 的 base/variant `.fbanim`：
两包仅 bindings/manifest 变化，后端 authority variant 与 base 一致，所有 client probe 和真实宿主自动回放均通过。
provider/token/账单收据仍保持未知，不将媒体任务响应字节当作 token 或费用。
