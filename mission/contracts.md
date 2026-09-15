# LIAF 流水线共享契约与待决事项

契约编号：LIAF-PIPELINE；修订：R1；状态：仅冻结边界 A 的怪物逐帧素材子合同。
R1 不代表 G0 整体、正式 wire schema 或后续关口已经验收通过；未冻结事项明确保留在本文件。

规范源：后端仓库 `挂机game/mission/contracts.md`。
客户端和 FrameBaker 的同名文件应同步本规范源的同一修订，便于各组独立阅读。
总体负责人维护规范源、决策记录并同步镜像；组员通过本仓库 handoff 提出变更，
不得在镜像中单独发明另一份字段合同。本次 R1 已交付 schema、样例及转换边界；
其余部分不能仅因本文件修订升级而视为冻结。

## 职责与内容对象

| 角色/仓库 | 所有权 |
| --- | --- |
| 总体负责人兼后端组 / 挂机game | 整体设计、机制语义、事件契约、导入校验、版本解析、权威执行、联合验收 |
| 客户端组 / tui-rpg-terminal-engine | 正式 Rust LIAF、内容组装与导出、共享表现编排器、像素引擎、正式客户端资源缓存与展示 |
| 素材编辑器组 / FrameBaker-TUI-RPG | 制作工程、帧/骨骼/装备/特效素材、挂点与标记、目标运行时导出、canonical 动画 fixtures |

怪物无骨骼，使用逐帧素材；玩家角色使用骨骼。
定义与实例分离：怪物/职业/角色外观/装备/技能定义可以复用，
战斗单位、行动、弹道、命中与持续效果实例分别具有生命周期。
FrameBaker 制作工程、动画素材交付物、LIAF 游戏内容包是不同产物。
沿用现有 .monster / .class / .equipment / .fbanim；.player 尚不是已确认支持的契约。
不新增文件后缀或任意机制脚本来绕开现有校验。

## 边界 A：FrameBaker → LIAF

素材需要稳定 ID、版本/摘要、依赖清单、动作、帧时长/曲线、循环与朝向、
统一对象原点、裁剪偏移、挂点位置及方向、动作语义标记、能力要求。
帧挂点和骨骼 socket 对外提供相同的定位语义，内部实现保持不同。
24 FPS 是采样密度，不是战斗频率；时间表示须避免逐帧取整累计漂移。
镜像同时转换原点、挂点和方向；材质裁剪不能造成动作切换跳位。
装备动作声明 rig/body profile、持握方式、必需 socket 及覆盖范围。

FrameBaker 拥有素材元数据；LIAF 拥有机制/表现绑定。
LIAF 的必要修正保存为显式覆盖，重新导入时不反向改写制作工程。
更新后按稳定 ID 保留绑定；删除被引用对象必须报错。
v2 普通导出与 v3 发布的收敛、warp/mesh 的拒绝或烘焙范围需按现有代码冻结，
不得静默丢弃装备、事件或动态换装能力。

### R1 冻结子合同：FrameBaker 怪物逐帧素材 v1

Q-01/Q-02 中“无骨骼怪物逐帧素材交给 LIAF”的 Boundary A 输入冻结为
[`framebaker-monster-sprite-extract-v1.schema.json`](fixtures/g0/framebaker-monster-sprite-extract-v1.schema.json)。
这是制作交付 ZIP 根目录中的 `sidecar.json` 合同，不是 `.monster`，不包含机制、数值或
服务端可执行内容。它只冻结 FrameBaker 的怪物逐帧 source material；不冻结 G0 整体、
Q-03/Q-05/Q-07、真实包联合验收或新的后端 wire。

- FB-01 负责按本 schema 产生 `sidecar.json` 和其列出的 `frames/` PNG；不得把现有 PNG ZIP
  直接改为 `.monster` 扩展名，也不得把 R0 draft sidecar 冒充运行时包。
- C-01 负责显式转换已校验的 sidecar/frames 到既有 `.monster` assets manifest、`content.json`
  和 package-scoped assets：逐帧 `durationMs`、action binding 和 package checksum 必须由该转换
  产物明确写入/重算，不能由 loader 猜测或沿用 ZIP 名称。

- ZIP 内帧路径固定为 `frames/{actionId}/{nnnn}.png`，路径和 `actionId` 不使用显示名称；
  `source.projectId` 用于重导入关联，`source.exportId` 标识一次不可变导出。
- 所有帧保持同一完整画布，像素坐标原点为左上，X 向右、Y 向下；`objectOriginPx`
  是所有动作共享的对象落点。v1 不允许逐帧裁剪，因此不需要猜测 trim offset。
- 面向方向显式声明。关于 X 轴镜像，连续坐标按 `x' = canvas.width - x` 转换对象原点、
  anchor 与方向；像素采样由消费者按 `width - 1 - pixelX` 处理。
- 时间使用非负整数毫秒。每帧同时给绝对 `startTimeMs` 和正数 `durationMs`，相邻帧必须连续；
  24 FPS 可使用 42/42/41ms 等误差分配，`sampleRateHz` 只是制作采样信息，不是战斗 tick。
- `loopMode` 只允许 `once`、`loop`、`hold`，与当前 `.monster` loader 的实际交集一致；
  `ping_pong` 未被该 loader 支持，schema 必须拒绝，不能回退为 `loop` 后静默接受。
- anchor 是表现定位点，可随帧变化；marker 必须带 `presentationOnly: true` 且位于动作时长内。
  `combat.hitbox.*` 被 schema 拒绝，素材标记绝不决定命中、伤害或目标。
- schema 之外仍必须校验 actionId、帧路径和 anchor ID 唯一、帧连续、marker 未越界，
  并按每个小写 SHA-256 校验实际 PNG 字节。缺少下游绑定声明为必需的 anchor 时应 fail-closed。

正例、负例与可执行检查位于 [`mission/fixtures/g0`](fixtures/g0)。之后的破坏性变化必须发布
`schemaVersion: 2`；消费者仍须拒绝未知必需能力。
骨骼角色继续只把 `.fbanim v3` 作为发布准备输入；v2 工程 ZIP 不是角色交付物。
骨骼的 socket、正式职业 rig 与装备闭包仍不属于本子合同。C-00 已核对真实 `.monster` loader 的
`durationMs`、动作 ID、逐帧 anchor/marker 和 `.fbanim v3` 边界；因此 FB-01/C-01 的 Q-01/Q-02
契约阻塞解除，但两项实现和 G1 联合验收均未完成。

## 边界 B：LIAF → 后端/客户端

游戏内容包闭合身份、注册机制引用、受控参数、动作语义、
攻击表现定义及素材依赖。保留 package-scoped ownership、
路径限制、digest/checksum 校验和容量限制。包不得携带任意可执行机制代码。
机制目录提供中文说明、参数类型/单位/范围/覆盖权限、
阶段、表现语义、依赖、版本和案例；后端负责最终校验。

目标参数层次为：基础值 → 所选数值模板 → 关卡显式覆盖，
调试临时覆盖另行冻结、不得写回运营数据。
替换与倍率是不同语义；B-01 必须核对现有解析后再冻结公式及迁移策略。
缺项只限制需要该项的操作，不阻塞保存未完成工程或编辑其他内容；
不恢复全局草稿/版本发布审批 UI。

## 边界 C：后端 → 表现编排器

以下是语义要求，尚不是 JSON 字段声明：
战斗身份（调试附 session/run）、行动身份、弹道/命中子事件身份、
顺序、权威模拟时间、来源、实际目标或落点、能力/武器来源、
阶段及结果、冻结内容身份。
sequence 负责排序/去重，行动身份负责因果关联，不能互相替代。
参数字符串或 HP 差不能替代结构化命中事实。

阶段目标：开始、前摇、发射/出招、可选飞行、命中、收尾、中断。
即时攻击允许发射和命中同刻；真实飞行的目标绑定、延迟、
拦截/取消/穿透及死亡后行为必须由后端机制决定。
客户端仅计算视觉位置，不计算命中、伤害、掉落或胜负。
美术发射标记对齐权威阶段；脚步/抛壳等标记仅触发表现。
同 tick 顺序和真实飞行是否已在正式路径实现，必须先做 B-00 审计，
不能因为存在 ActionDefinition/projectile_ms 字段就宣称已支持。

### 当前后端候选 combatFacts v2（未冻结为 R1）

后端 B-02 已在内部 snapshot 候选结构中生成 `schemaVersion = 2`，但正式
WebSocket 尚未公开，客户端也尚未声明消费；因此本节仍是联调候选，不会因 Boundary A 的
R1 子合同而自动冻结。它仍须经三仓样例、负例和迁移说明验收后冻结。

每条事实共有：`sequence`、`actionId`、`parentSequence`、`atMs`、
`sourceId`、`abilityId`、`contentRef`、`kind`、`payload`。
`sequence` 是战斗内单调序号；`actionId` 聚合同一权威行动；
`parentSequence` 精确指向已先发布的直接原因事实，三者不可互相替代。

当前候选事实种类：

- `action.launched`：冻结目标集合与 delivery。
- `action.impact`：结构化 `targetId`、`outcome`、`resolvedDamage`、
  `hpLoss`、`hpAfter`、`critical`、`killed`。
- `action.finished`：权威收尾完成。
- `effect.started` / `effect.refreshed` / `effect.tick` / `effect.ended`：
  持续效果身份、代次、剩余次数、下一 tick 和结构化 tick 结果。
- `reaction.damage`：装备追加伤害；携带触发/root/parent 内部事件 ID、
  equipment instance/template、release、effect、compatibility rule 及同形
  `ImpactFact`。它的外层 `actionId` 归属原权威行动，`parentSequence`
  指向触发它的公开 launch/impact/effect 事实，外层 `contentRef` 指向冻结装备来源。

候选 `contentSources` 使用 `sourceKind = player | monster | equipment`。
怪物来源可冻结注册实体、定义版本、包/资源摘要和 asset refs；Gunner 玩家来源冻结
`.class` package/version/archive/content 摘要与 asset refs；装备来源冻结
release、instance、template、content hash、frame manifest version，以及 `.equipment`
package/version/archive/content 摘要与 asset refs。其他职业包接入、召唤物来源、正式资源下载、
鉴权与缓存合同仍未完成，不能据此宣称资源分发契约已经闭合。

## 表现与时钟

LIAF 离线预览、权威调试、正式战斗共用表现编排器，事件来源不同。
基础轨道：攻击者动作、发射效果、弹道、命中效果、目标反馈、收尾。
绑定阶段而非仅绑定固定毫秒；动作分段适配且有速度范围，
不能把弹道/烟雾随攻速整体加速。
目标受击动作由目标自身解析，死亡/受击等冲突采用明确仲裁。
表现实例归属单位、行动、弹道或世界位置，取消规则不得一刀切。

使用有界表现时间缓冲，动作、战场血条、伤害与死亡统一对时；
模型保留最新权威状态，客户端控制不依据过期的显示状态。
迟到事件快进或省略装饰；积压时 rebase，不无限补播。
不提前展示尚未收到的命中。断线时显示状态，不预测战斗结果。
调试暂停/单步同时驱动动画和特效；只读记录回看不推进或回滚 Worker。
重连仅恢复可重建的存续状态，不重放历史命中。
具体缓冲值、误差和容量预算在 G0 定义测量方法，G1 前给出实测阈值。

## 资源与版本

战斗冻结内容及表现依赖，按确切摘要加载；资源字节与战斗消息分开传输。
复用现有内容/资产分发接口，API 路径和清单形状由 B-04/C-04 确认。
开发缓存与正式缓存隔离，均使用同一安全加载能力。
资源准备不能无限暂停权威战斗，资源迟到从当前表现时间接入。
可选装饰可省略；核心资源不可用给出明确降级，
摘要损坏或必需能力不支持拒绝加载该资源，保留权威文本/UI。
降级不算内容完整验收通过，不静默使用同名旧资源。
下载临时文件校验后原子入缓存；磁盘/解码/纹理/实例预算分别限制，
活动单位和收尾特效引用的资源不能提前驱逐。

区分机制契约兼容版本、机制实现身份/registryVersion、
包归档摘要与内容摘要。调试记录全部身份、有效参数与 seed。
内容修订保持当前会话冻结，新版本重跑后生效。
不把不可变资源身份等同于恢复复杂运营发布流程。

## 分期边界

G0：现状审计、最小 schema/事件样例、负例、版本与时间契约冻结。
G1：A1 从 FrameBaker 交付到 LIAF 组装，再到权威调试完整演出。
G2：同一包进入本地正式后端关卡，正式客户端资源分发与表现验收。
G3：首个经产品确认的正式职业 + 标准 rig + 一件适配装备 + 一个装备关联效果。
Gunner 仅可作为现有链路测试夹具，不是正式职业、产品范围或跨组验收硬依赖。
G4：一把传说武器专属动作/特效及一项明确技能交互；真实机制扩展另有后端测试。
G1 如 A1 现有语义为即时命中，使用曳光；不得为展示慢弹道改变机制。
真实延迟弹道先单独冻结后端语义和用例，再进入后续能力增量。
以上都是计划关口，目前均未验收通过；生产部署始终是独立授权和验收。

## 待决事项（由总体负责人协调，不让各组分别猜测）

| 编号 | 需确定的内容 | 提案输入 | 阻塞范围 |
| --- | --- | --- | --- |
| Q-01 | R1 已冻结 Boundary A 怪物逐帧 source-material schema；C-01 显式转换为既有 `.monster` assets manifest，FB-01 交付 sidecar/frames | FB-00、C-00 | FB-01、C-01 可开工；真实包联合验收仍在 G1 |
| Q-02 | R1 已冻结怪物像素坐标、毫秒时间、表现 marker、镜像及 `once`/`loop`/`hold`；骨骼 socket 消费不在本子合同 | FB-00、C-00 | 怪物素材导出与挂点采样可开工；骨骼部分仍待 Q-06 |
| Q-03 | A1 权威行动路径、事件身份/顺序、目标与同 tick 命中 | B-00、C-00 | B-02、C-02 |
| Q-04 | 参数覆盖范围、合成规则、机制版本兼容 | B-00 | B-01、C-03 |
| Q-05 | 分发接口、战斗依赖冻结、缓存与重新加载策略 | B-00、C-00 | B-04、C-04 |
| Q-06 | 首个正式职业的 rig 身份、装备闭包、武器动作覆盖与不支持能力 | FB-00、C-00、B-00 | G3/G4 |
| Q-07 | 性能基线、时钟误差、资源及并发预算与测量方案 | C-00、FB-00、B-00 | G1 性能验收 |

总体负责人在后端 mission/program.md 记录决策、原因、受影响任务及契约修订。
组员可立即进行 00 审计和不依赖未定接口的本地准备；边界实现从对应契约冻结后开始。
不要求每个内部实现细节都审批；跨仓库语义修改才走此协调过程。
