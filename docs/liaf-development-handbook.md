# LIAF 制作开发手册：FrameBaker 端

更新：2026-09-26。面向第一次接触三端流水线的开发者，也作为 AI 制作任务的操作入口。

本手册对应 `FrameBaker-TUI-RPG-aic` 的 `codex/aic-fb-pipeline` 实施树。团队主开发分支仍是 `shy`；本地实现与验收不表示已经合并、推送或部署。本次更新只修改文档。

## 1. 先理解三端分工

| 环节 | 制作什么 | 交付给谁 |
| --- | --- | --- |
| FrameBaker（FB） | 图片、怪物帧动画、角色骨骼、贴图绑定、动作和挂点 | 客户端 LIAF |
| 客户端（C） | 组装身份、机制引用、表现资源，校验包并预览；消费战斗事实 | 后端导入器及终端表现运行时 |
| 后端（B） | 注册机制，执行 Worker/Kernel，决定攻击、命中、伤害、死亡和奖励 | 客户端表现消费者 |

怪物走逐帧 PNG 路线，没有角色骨骼。FB 的怪物 PNG ZIP 还不是 `.monster`，必须经过 LIAF 组包。角色走骨骼路线：Skeleton 是骨架，CharacterBinding 把图片附到骨骼，MotionClip 描述随时间变化的动作，BodyProfile 定义身体契约和装备挂点。

角色发布产物是 `.fbanim v3`，C 端再将已验证资源组入 `.class`。当前没有已确认的 `.player` 包契约。制作端的动作时间、命中姿势和事件标记都不能决定游戏伤害；视觉上的剑与目标相交也不等于后端判定命中。

先读 [当前实施状态](../mission/ai-character-pipeline.md)，查询字段时读 [API 与 MCP](api.zh-CN.md)。三端总签收记录在后端仓库 `mission/aic-d1-completion.md`，后端及客户端各自的 `docs/liaf-development-handbook.md` 继续说明组包与运行流程。

## 2. 当前可复现的 D1 样例

D1 是中性人形技术样例，不是正式职业，也不是恢复 Gunner 职业设计。它包含 16 个图片部件、Region 骨骼绑定、武器外观、`idle/attack/hit/death` 四个动作，以及只把躯干宽度增加 12% 的外观变体。

Region 附件是一块随骨骼变换的矩形图片。它不包含 Mesh 顶点权重蒙皮。当前 v3 发布拒绝 `meshSkinning` 和 `runtimeWarp`；现有装备数据结构也不等于任意传说武器、独立动作和装备战斗链路都已验收。

截至本次记录，本地 D1 已完成 FB 发布、C 组包、B 权威探针、C 真实 WezTerm 播放与观察。基础/变体使用相同战斗输入时权威摘要相等，外观变更不改变战斗。死亡单独有终态证据。正式职业 live WebSocket、Mesh、正式装备战斗、生产部署及怪物 G1/G2 仍是独立门禁。

## 3. 从一张部件图开始

启动本实施树的服务，按 [README](../README.zh-CN.md) 配置运行环境。下面配方使用本机 `http://127.0.0.1:3025`，MCP 路径为 `/mcp`；它不是生产地址，也不意味着其他开发服务默认使用这个端口。

先通过素材导入或图片插件任务获得已有图片素材 ID。D1 配方要求一张已按约定排列的 4×4 部件图，零基、逐行排列为：

| 行 | 第 1 格 | 第 2 格 | 第 3 格 | 第 4 格 |
| --- | --- | --- | --- | --- |
| 0 | head | torso | pelvis | sword |
| 1 | upper_arm_left | upper_arm_right | forearm_left | forearm_right |
| 2 | thigh_left | thigh_right | shin_left | shin_right |
| 3 | foot_left | foot_right | hand_left | hand_right |

`split_material_parts` 按显式网格裁切、去色键并保存透明图片，返回各部件的素材 ID、尺寸、边界和源摘要。它不会识别任意图片中的人体结构，也不会自动把一张完整立绘转成正确蒙皮。需要先保证部件布局、朝向、轮廓和关节位置符合配方。

D1 使用品红底色。可选 `magentaDespill` 只处理新透明边缘相邻像素的品红溢色，不能修复缺失轮廓。改变去色键参数后，要使用新的输出目录与相应幂等身份，不能覆盖旧证据。

## 4. 用结构化数据调整骨骼和动作

先读能力和局部数值，再有针对性地取图，避免每次修改都让 AI 读全工程和大量视频帧。

| MCP 工具 | 用途 |
| --- | --- |
| `aic_get_capabilities` | 查询当前能力与明确拒绝的特性 |
| `aic_get_project_summary` | 读取 revision、指定骨骼、附件、动作和时间段的结构化摘要 |
| `aic_sample_pose` | 对指定动作时刻采样骨骼 local/world 矩阵及挂点位置 |
| `aic_get_diagnostics` | 检查结构、引用、素材和运行时能力 |
| `aic_apply_operations` | 原子修改骨骼、绑定、动作、关键帧等数据 |
| `aic_publish_v3` | 冻结 revision，生成可追溯的 `.fbanim v3` 发布包 |

摘要支持实体过滤以及 `boneOffset/boneLimit`、`attachmentOffset/attachmentLimit` 分页，默认 64、最大 256；需检查总数和截断标志。姿势采样可选择最多 128 个骨骼和 128 个挂点，不必回传整个工程。

坐标使用右手系、Y 向上、+Z 向前，长度为像素，变换顺序 `T*R*S`。`timeSeconds` 是动作时钟的秒数；采样先应用动作 `speed`，再按动作级 `repeat/loop` 解析剪辑时间。不要混淆动作循环与 `clipLoop`，也不要把帧号直接当秒传入。查询多个 BodyProfile 中的挂点必须指定 `bodyProfileId`。这些数值用于定位姿势与挂点问题，不表示已有自动 IK 或通用蒙皮求解器。

每次写入携带当前 `baseRevision`、本次操作的 `idempotencyKey` 和 1–64 项 `operations`。一个批次整体成功或整体拒绝；非法操作、过期 revision 或同一幂等键对应不同输入不能产生部分写入。遇到冲突先重读摘要再修改，不通过直接写数据库跳过校验。

## 5. 跑通配方并导出

下列 `<...>` 是需要替换的占位符。配方只使用已有素材并调用公开 MCP，不会在执行中自动发起图片或视频生成。

```powershell
Set-Location F:\CodeProject\FrameBaker-TUI-RPG-aic
bun scripts/aic_humanoid_recipe.ts --material <已有的4x4素材ID> --url http://127.0.0.1:3025 --out storage/aic-runs/<本次新目录> --magenta-despill 100
```

配方完成分件、创建骨骼项目、绑定、BodyProfile、四个动作、诊断及发布。产物为 `base.fbanim` 和 `recipe-state.json`。以相同素材、目录和去色键参数再次运行并追加 `--variant`，生成躯干增宽版本 `variant.fbanim`，保留基础产物。

本地已验收样例的素材 ID 是 `ecfeb992-399e-46a1-bd73-88799c8f1b45`，输出位于 `storage/aic-runs/humanoid-d1-despill-100/`。这些是本机已有证据，不是其他机器必然存在的素材或应该覆盖的目录。

配方输出 `published-not-yet-accepted` 是正确行为：FB 发布成功还没有证明 C 能播放，也没有证明 B 导入和战斗通过。下载时配方核对摘要与字节数，拒绝覆盖不同内容的已有文件。

调用预算可追加 `--max-calls N`、`--max-wall-ms N`、`--max-response-bytes N`。检查点保存执行身份与预算；恢复时沿用源素材和参数。`--seed-checkpoint <recipe-state.json>` 只用于在新目录复用完整的已发布身份，其继承成本标为未知，不能据此声称制作零成本。响应字节数不是模型 token，生成耗时也不等于显卡用量或账单；未测量的成本须保留为未知。

## 6. 图片和视频插件共用显卡

本地图片插件为 `qwen_image_2_1`，视频插件为由用户提供的 H3 CFP 转换得到的 `minimax-h3-t8-i2v`。CFP 通过 [CFP → VAP 适配器](cfp-vap-adapter.md) 转为声明式 VAP；这不是原生执行任意 CFP 的能力。安装、配置、生成和检查任务结果应走公开媒体插件 API/MCP，字段以 [API 手册](api.zh-CN.md) 为准。

两者使用同一个 `http://ddns.langxecho.top:8188` ComfyUI 服务。插件切换必须串行获取运行租约，确认队列为空，执行 `unload_models=true/free_memory=true`，并获得连续两次 `torch_vram_total <= 64 MiB` 的观测，才允许提交下一插件任务。队列忙、观测缺失或卸载超时会阻断切换，不应为了继续制作同时加载两个模型。

已有 `promptId` 的任务先对账历史和输出。提交结果未知时不能盲目重提，避免重复生成与显存竞争。保留失败及恢复收据；密钥留在本地配置，不写入手册、包或交接报告。图片/视频生成成功只说明任务成功，不自动证明部件布局、动画质量或角色链路验收。

## 7. 交给 C 和 B，闭合一轮修改

1. FB 交付 `.fbanim` 原始字节、project ID、revision、digest、byteLength，以及 BodyProfile、动作与挂点摘要。先通过诊断，不仅交截图。
2. C 使用 `aic_class_pack` 校验并组装 `.class`；保持包内素材归属和摘要。D1 包为专用测试身份，不登记为正式职业。
3. B 使用 `aic_character_probe` 读取同一 `.class` 和已验证 `.monster`，通过正式 Worker/Kernel 产生事实报告。它是本地隔离探针，不操作生产数据库。
4. C 使用同一包和 B 报告做探针验证、真实 WezTerm 播放，记录动作应用、拒绝、序列与 Canvas 销毁。
5. 通过 C 的 `/v1/window/latest` 和 `/v1/window/frames` 观察完整客户区 UI 与角色画面。原有 `/v1/latest` 只含纯画布。整窗采样最高 5 FPS，短动作需定点采样，不能用几张截图证明所有帧都流畅。
6. 将数值问题定位到骨骼/挂点/关键帧后回到 FB 小范围修改，发布新 revision，重新传递摘要。禁止让新素材搭配旧身份报告冒充复验。

C 截图、命令与真实宿主启动参数见客户端仓库 `docs/client-handbook/client/game-canvas-capture.md` 及 `docs/liaf-development-handbook.md`。后端流程及失败定位见后端仓库 `docs/liaf-development-handbook.md`。D1 离线事实回放与正式 LIAF 工作台的后端调试会话是两个入口，不能混用快捷键或启动要求。

## 8. 当前验收与后续边界

D1 总签收以 B 的 `mission/aic-d1-completion.md` 为准，统一身份收据位于 B 的 `target/aic-d1-delivery-20260926/cost-identity-receipt.json`。FB 当前证据目录为 `storage/aic-runs/humanoid-d1-despill-100/`，包含基础/变体发布与 pose parity 收据。旧目录中的早期“等待视觉验收”记录保留为历史，不作为最终结论。

当前已记录真实整窗图、CLI→PTY 输入、正常速度受击峰值图及关闭截图后的 90 秒宿主性能样本；CLI 输入不等于物理键鼠验收，性能样本不等于开启截图的开销或 60 FPS 承诺。FB 上一轮相关 Bun 测试 15 项、Python provider 恢复测试 6 项及 typecheck 通过；本次纯文档更新没有重新执行这些测试。

下一阶段仍需明确正式职业与美术标准、复杂骨架/蒙皮能力、装备独立动作兼容、正式在线角色链路及长期性能。现有自动化完成的是有约束的 Region 样例流水线，不能承诺任意角色的创意设计、素材质量和全部制作功能都能零人工完成。
