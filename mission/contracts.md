# LIAF 流水线共享契约与待决事项

契约编号：LIAF-PIPELINE；修订：R4；状态：冻结边界 A 的怪物逐帧素材、Q-03 即时行动 consumer 子合同、Q-04 参数/机制兼容子合同、Q-05 最小资源分发 consumer 合同，以及 Q-07 G1 测量方法和最低硬阈值。
R4 不代表 G0 整体、未列明的正式 wire schema 或后续关口已经验收通过；未冻结事项明确保留在本文件。

规范源：后端仓库 `挂机game/mission/contracts.md`。
客户端和 FrameBaker 的同名文件应同步本规范源的同一修订，便于各组独立阅读。
总体负责人维护规范源、决策记录并同步镜像；组员通过本仓库 handoff 提出变更，
不得在镜像中单独发明另一份字段合同。本次 R4 额外冻结当前后端参数/机制兼容边界；
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

### Q-03 冻结子合同：combatFacts v2 即时行动批次

Q-03 现冻结其最小消费者边界：[`combat-facts-v2.schema.json`](fixtures/g0/combat-facts-v2.schema.json)、
[`combat-facts-v2.canonical.json`](fixtures/g0/combat-facts-v2.canonical.json) 与
[`validate-combat-facts-v2.ps1`](fixtures/g0/validate-combat-facts-v2.ps1)。它们严格对应现有
`CombatFactBatch` 的 serde wire，而非新 WebSocket/API；正式 `combat.snapshot` 与 debug `PreviewFrame`
继续可选携带该 batch。冻结范围是即时 `action.launched` → `action.impact` → `action.finished`，以及
既有 v2 其他事实的解析形状，不定义新的弹道玩法、资源下载、缓存或性能阈值。

canonical batch 故意包含两只相同模板怪物（实例 `101`、`102`）在同一 `atMs=100` 各自完成一次
行动，证明实例身份不能由 monster/template ID 代替。每个 impact 和 finished 的
`parentSequence` 指向该 action 的 launch（这是当前真实 wire）；序列中的时间顺序仍是
launch → impact → finished。`sequence` 是字符串十进制、只在同一 `combatId` 内单调；消费者去重键
必须是 `(combatId, sequence)`，不得以 actionId、sourceId 或 templateId 去重。

`throughSequence` 是该 batch 已知事实水位。重连的只读 snapshot 可以 `items=[]` 且保留当前水位；
消费者以它建立 baseline，**不得**重播小于等于该水位的历史命中。随后增量必须连续；重复、倒退、
乱序或缺口不能重演或无限等待，应请求/使用新的状态 baseline 并降级。未知 target、source、
contentRef、kind 或违反 parent/action 因果的 item 均为 fail-closed 合同错误，不得由客户端补算。

此子合同只解除 C-02 对已有事实 batch 的字段、因果、去重和 rebase 语义猜测；客户端实际消费、
真实终端观察、Q-05 资源缓存、Q-07 性能阈值、G0/G1 和 C-02 验收仍未完成。

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
package/version/archive/content 摘要与 asset refs。资源字节 URL、公共读取边界与客户端缓存
最小要求见下方 Q-05；其他职业包接入、客户端缓存实现和联合验收仍未完成。

### Q-04 冻结子合同：参数与机制兼容 v1

Q-04 的机器可读规范是
[`q04-parameter-mechanism-contract-v1.json`](fixtures/g0/q04-parameter-mechanism-contract-v1.json)，
并由 [`validate-q04-parameter-mechanism-contract.ps1`](fixtures/g0/validate-q04-parameter-mechanism-contract.ps1)
直接绑定当前 Rust 注册目录序列化。它冻结公共 `hp`、`attack`、`armor`、`attackIntervalMs` 的
整数类型、单位和范围，以及当前已实现的两条不同数值路径；不新增玩法、wire 或持久模板资源。

- `.monster numericConfig` 的未知字段、非整数及越界值拒绝；`hp`、`attack`、`armor` 必填，
  `attackIntervalMs` 按现有导入行为可缺省。调试 sandbox 先校验包和临时覆盖，再按键替换，且只允许
  package sandbox，不接受 baseline wave plan。
- 附包的 Game Content 模板有两份现有投影：`schemaConfig` 用注册默认值加包中已声明字段构建；
  `baseHp/baseAttack/baseArmor/attackIntervalMs` 则从包值和当前 Game Content fallback 构建。它们不是
  一个可编辑的持久模板链，stage 不回写 `schemaConfig`。
- Game Content wave 只对标量战斗值使用 `*Mult` 乘法并四舍五入，或使用对应 `*Final` 替换；同字段
  两者同时存在即拒绝。它不等同于 debug 的按键替换，也不应被消费者误述为“倍率覆盖包配置”。
- `registryVersion`、整体 `mechanismCatalogSha256`、单机制 `compatibilitySha256` 与包的 archive/content
  SHA-256 是不同身份边界，不能相互替换。未知机制、未知字段、非法范围及试图以覆盖掩盖非法 base
  均 fail-closed。目录中 `runtimeEffectiveness=notCertified` 仍适用，不把输入合同说成所有字段已完成
  联合运行验收。

Q-04 只解除 B-01/C-03 对当前参数来源、替换/倍率语义和机制身份的猜测；客户端目录消费、真实素材、
真实测量与 G0/G1 联合验收仍未完成。A1 当前即时命中保持 Q-03 边界；真实飞行属于 B-06/G4 的单独机制增量。

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
具体缓冲值、误差和容量预算由下方 Q-07 定义测量方法和最低硬阈值；真实测量结果仍须在 G1 验收时提交，不能由合同文本替代。

### Q-07 冻结子合同：G1 性能与同步测量 v1

Q-07 的机器可读规范是 [`q07-g1-measurement-contract-v1.json`](fixtures/g0/q07-g1-measurement-contract-v1.json)，
并由 [`validate-q07-g1-measurement-contract.ps1`](fixtures/g0/validate-q07-g1-measurement-contract.ps1) 做合同自检。
它冻结 C-02/C-04 可共同使用的测量条件、注入场景、记录字段和最低 hard-fail 线，**不含一次实测结果**。

- 每次运行必须记录 backend/client/FrameBaker（适用时）commit、client binary SHA-256、包 archive/content SHA-256、
  fixture 摘要、WezTerm 版本/config SHA-256、窗口/DPI、CPU/GPU/内存/显示器和完整日志位置。样本须连续至少 60 秒或至少 600 帧，且始终记录两项实际值。
- 测试两只拥有不同 entity ID 的 `a1_drone`、24 FPS 场景；运行 ordered normal，以及 duplicate、out-of-order、late、rebase 注入。
  注入 duplicate/out-of-order/late 只能触发既有丢弃、快进/装饰省略或 baseline/rebase 行为，不能重播 impact、补算或预测权威结果。
- hard fail：单个 encoded OSC command 不得超过 65536 bytes；任一滚动秒不得超过 120 commands；正常路径和 emitted OSC command 不得有 stale/rejected sequence。
  为避免将刻意重复的输入误作失败，duplicate 输入本身必须计数并被消费层丢弃，但不得产生 stale/rejected 的 emitted command。
- hard fail：连续 24 FPS 段的绝对 timeline drift 不得超过 42 ms；最大 observed presentation-frame interval 不得超过 250 ms，
  且不得出现任一 `>=700 ms` 停顿。rebase 断点另记原因，不能藏入连续 drift。
- hard fail：场景峰值不超过 entity 20、particle 100、effect primitive 64、character 8；successful/failed refresh、rerun、
  reconnect/rebase 和 normal exit 后，scene 对象均为零且 Canvas 已销毁。持久磁盘 cache 不是 scene 泄漏，仍须单独记录其大小。
- archive bytes、解压 bytes、PNG bytes、RGBA decoded bytes、cache disk bytes 与 GUI upload dimensions 均为必填**记录项**。
  当前没有已测 aggregate budget；缺失或未知时只能标为 `not-measured`/G2 前待定，绝不能标为达标。

Q-07 冻结只解除 C-02/C-04 对“测什么、如何判”的等待；它不证明实现已完成、不把 Q-07 当作实测通过，
也不完成 G0、G1、G2 或任何生产验收。

## 资源与版本

战斗冻结内容及表现依赖，按确切摘要加载；资源字节与战斗消息分开传输。
复用既有 package 归档分发接口；Q-05 不增加 manifest、资源描述符或另一套下载 API。
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
不把不可变资源身份设计等同于恢复复杂运营发布流程。

### Q-05 冻结子合同：资源归档分发 v1

Q-05 冻结的可执行规范是
[`resource-delivery-contract-v1.json`](fixtures/g0/resource-delivery-contract-v1.json)。它只让 C-04
从 `combatFacts.contentSources` 的既有 package 身份得到 archive bytes；不新增 manifest/API，
不实现客户端缓存，也不冻结 Q-07、C-04、G0 或 G2。

- `archiveSha256` 是**完整 admitted archive bytes** 的 SHA-256，固定为 64 位小写十六进制；
  URL、ETag 和客户端缓存 key 都使用它。`contentSha256` 是 canonical `content.json` 身份，不能
  代替 archive 身份或推导 URL。
- 对有 package identity 和 `archiveSha256` 的 `contentSources` 条目，消费者按 `sourceKind` 映射：
  `monster` -> `GET /content/monster-packages/{archiveSha256}.monster`；
  `player` -> `GET /content/class-packages/{archiveSha256}.class`；
  `equipment` -> `GET /content/equipment-packages/{archiveSha256}.equipment`。`assetRefs` 是已 admission
  的闭包元数据，不是另一组下载地址；没有 package identity 的旧来源没有 URL，保留正常表现降级。
- 成功 `200` 返回原始 archive bytes、对应 package MIME、`Content-Length`、
  `Cache-Control: public, max-age=31536000, immutable`、`ETag: "sha256:{archiveSha256}"` 和
  `X-Content-Type-Options: nosniff`。相同 ETag 的 `If-None-Match` 返回 `304`，至少保留 ETag 与
  immutable cache header。
- 三条 GET 路由无认证、无 Admin cookie/token、无 debug token；SHA-256 是不可猜的内容地址，
  不是账号或战斗秘密。服务端仅返回 admitted、当前 runtime-qualified 的归档：路径/数据库/实际 bytes
  三者摘要一致、大小不超过服务端 archive 上限、没有 authoring evidence 或 `preview/` 成员；monster
  还必须通过已注册机制运行资格。非法 hash、未知 hash、摘要漂移或不合格包都 fail-closed。
- 同一时刻可按各自 archive SHA-256 读取多个 admitted runtime-qualified 版本，不依赖当前 active
  release；新发布不得改写旧 archive identity。这是地址稳定性，不承诺未定义的长期保留或客户端驱逐策略。
- 客户端负责开发/正式 cache root 隔离、临时下载整包校验后原子入缓存，以及按 archiveSha256 而非
  object name/version 命中缓存。下载、校验、能力或缓存失败只降级表现并保留权威文本/UI；不得暂停、
  改变或推导 Worker 的战斗、命中、奖励或结果。

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
| Q-03 | 已冻结 `combatFacts v2` 即时行动的字段、身份/顺序、目标、同 tick 因果与 rebase consumer 子合同；真实飞行不在此范围 | canonical/负例、B-00、C-00 | C-02 可实现；B-02/C-02/G1 待联合验收 |
| Q-04 | R4 已冻结当前四参数的类型/范围/单位、package/debug 替换与 Game Content wave multiplier/final 的不同路径、目录身份边界；不伪造持久模板链 | `q04-parameter-mechanism-contract-v1.json`、B-00 | B-01/C-03 可按合同消费；G0/G1 仍待联合验收 |
| Q-05 | 已冻结最小 archive byte endpoint、身份、公共读取、资格、版本共存和客户端降级边界；缓存实现/预算/联合验收未冻结 | `resource-delivery-contract-v1.json`、B-04、C-00 | C-04 可按合同实现；B-04/C-04/G0/G2 均待联合验收 |
| Q-06 | 首个正式职业的 rig 身份、装备闭包、武器动作覆盖与不支持能力 | FB-00、C-00、B-00 | G3/G4 |
| Q-07 | 已冻结 G1 双 A1/24 FPS 测量方法、记录项与最低 hard-fail 阈值；总资源预算及真实结果仍待测 | `q07-g1-measurement-contract-v1.json`、C-00、FB-00、B-00 | C-02/C-04 可按同一方法实现/记录；G0/G1 仍待真实测量与联合验收 |

总体负责人在后端 mission/program.md 记录决策、原因、受影响任务及契约修订。
组员可立即进行 00 审计和不依赖未定接口的本地准备；边界实现从对应契约冻结后开始。
不要求每个内部实现细节都审批；跨仓库语义修改才走此协调过程。
