# Codex + MCP 制作闭环

这是 `wqy` 的执行流程。FB 展示制作效果，Codex 负责操作与评审；关闭 Codex 不会产生一个后台自主设计角色的代理。

## 任务与预算

先通过 `list_projects`、`aic_get_capabilities`、`aic_get_project_summary` 找实际工程、revision 与能力。新角色使用 `create_project(kind:"skeletal")`。不要沿用教程中的 UUID。

调用 `aic_workflow` 建立目标：

```json
{"projectId":"实际工程ID","command":{"operation":"start","idempotencyKey":"task-start-v1","goal":"制作指定参考的侧视角色，保持脸、服装和配色，检查肩肘弯曲","maxIterations":24,"maxGenerationJobs":8}}
```

已有任务先 `aic_get_workflow`，查看候选和 jobs。暂停使用 `pause`，同一轮继续使用 `resume`；已完成或预算用尽要开始新一轮时使用 `reopen` 明确追加有限预算，不能直接改数据库预算。每次新意图换幂等键，网络重试保留旧键。暂停阻止新编辑/生成提交，不代表远端任务已经取消；已入队任务仍按 job 对账。相同幂等键重试复用原结果且不重复扣预算。媒体生成骨骼项目使用 `aicProjectId` 作为 AIC 预算 owner，`projectId` 仍是逐帧素材导入目标。预算耗尽先保留最佳候选并报告，不能创建新工程绕过预算。

## 图片、分件、绑定

1. 使用实际安装的图像插件生成完整形象；提示词描述身份、朝向、画风、轮廓、最终尺寸、无遮挡关节和一致光照。先观察形象再分件。
2. 固定参考图生成分件图：明确网格行列、逐格部件语义、相同人物、完整关节覆盖、透明/纯色底；`split_material_parts` 是确定性网格裁切，不是人体语义分割。
3. 原图保留，修复生成新的 material。先查插件实际支持的 reference/mask 参数；不支持局部蒙版时不要伪造接口，可重新生成单部件并替换绑定。
4. `aic_apply_operations` 用 `create-skeleton`、`upsert-binding`、`create-motion-clip`、`upsert-action` 写合法数据。所有操作携带当前 baseRevision，1–64 项原子提交。
5. 单点修正使用 `patch-attachment`（size/pivot/rest/materialId）、`patch-slot`（boneId/drawOrder）、`patch-bone-rest`、`upsert-keyframe`、`delete-keyframe`。单位、y 轴、局部父坐标、归一化轴心必须从工程读取；不要凭图像位置直接填世界坐标。

Region 附件只能跟随一根骨骼。图片上关节点 `(x,y)` 到 pivot 是 `(x/W,1-y/H)`。关节补重叠区、去内部黑边、修轴心/层次，先于重生成全身。无法满足柔性弯曲时记录失败样例；不得声称 Mesh/warp 已支持。

## 候选、观察、评审

1. 原子修改成功后，用 `capture` + 当前 revision 保存候选，label 说明本轮变化。候选保存文档、骨架、动作和实际 PNG，不随共享素材变化。
2. `aic_render_candidate` 指定候选、动作、时间、BodyProfile、装备。返回 PNG 和 evidenceId，必须实际查看图片。`aic_render_contact_sheet` 使用 `observation:{mode:"contact-sheet",times:[0,0.2,0.4]}`检查多个时刻；它不能证明连续播放节奏。
3. 先查有界摘要与数值，仅在必要时读取图像；一般一张整身图加问题时刻的接触表，避免反复发送完整纹理/base64。
4. `review` 绑定 candidateId、evidenceIds、verdict 与具体 feedback。仅生成图片不是审查。失败记录 `revise` 并说明部位/时间/问题；通过记录 `pass` 必须有同候选证据。
5. 用户采用，或在已授权目标范围内由 AI 采用，使用 `adopt`。最新评审未通过时不能采用。不要把旧候选的评审贴到新候选。

## 动画与握持

采用视频参考制作时，按 H3 视频参考到骨骼关键帧（ECHO 本机未入库：`skill/fb-character-authoring/references/video-reference-keyframes.md`，见 `skill/README.md` 缺失清单） 执行：先修正首帧外观/视线，再生成视频、拆帧、提取姿态、制作关键帧和实际播放复查。生成视频成功不等于骨骼动画已完成。

角色本体默认空手。即使参考立绘持枪，也要先提取服装、身体和空手手形，不能把武器烘进角色贴图或默认 character-binding。武器作为独立装备资源，在实际装配后显示；无装备预览应当确实不含枪、枪柄或扳机残片。空手手形与握持手形分别制作，移除武器后要检查被遮挡的掌心、手指和手套轮廓，不能把“隐藏枪图层”直接当成空手验收通过。

先中性姿态和弯曲检查，再添加动作。工作台可选动作/装备，播放、暂停、逐帧、拖动、速率、循环；暂停播放和暂停制作独立。握持使用 BodyProfile 插座与 weapon 主/辅握点。两骨 IK 只覆盖当前客户端的二维链约定，诊断失败先修数据，不能截图后掩盖。

FB 默认预览页不需要打开手工轨道面板。可复制候选、动作、时间定位信息给 Codex，例如“候选 B，fire 0.12 秒右肩突出”。对相邻帧、整角色、前一合格候选都复查，防止局部修复破坏其他位置。

## 恢复与交付

- `restore` 要求当前 baseRevision，创建新的 revision 和私有素材/动作 ID；不会覆盖共享资产，也不会把 revision 倒退。
- `aic_publish_candidate` 导出已采用冻结候选；后续工作区修改不混入导出。
- 保存可编辑工程、candidateId/digest、review/evidence、产物 digest 和未通过项。
- 正式客户端按同一包、动作、时间和装备观察；FB 结构通过、视觉合格、客户端合格、后端准入与生产部署分别签收。
- `storage-wqy-pilot` 已完成静态肩部修正前后观察、采纳、恢复和冻结导出；工作台真实截图验证完整居中、播放、相机稳定、骨骼开关和高级编辑入口。LIAF export 已将 3 个 `.equipment` 转换成功，但暂无终端视觉验收；这不等同完整枪手美术验收，也未验证真实 Comfy GPU 卸载。
- 事件特效、Mesh/warp、视频自动录制不在当前观察契约内。不要承诺静态角色通过后所有动作自动合格。

## 真实制作记录：枪手赤红眼睛（2026-10-04）

本节既是本次任务的收据，也是以后执行“参考图局部修色 → 拆件 → Region 绑定 → 观察修正”的可复用 SOP。本轮完成了静态站姿和 Region 绑定；动作、独立装备握持与客户端验收尚未完成。

### 目标与输入

- 输入参考：素材 `gunner-reference-red-eyes-20261004`，蓝发女性像素枪手，正面全身、双手自然下垂持双枪。
- 初轮目标：只把两只眼睛的棕色虹膜改为赤红色，保留亮度层次、黑色瞳孔和白色高光；脸型、头发、服装、比例、画布和站姿保持。先保留品红背景验证修色，再在拆件阶段单独抠背景。
- 用户后续明确：**默认空手，不持武器**。初轮照搬参考图双枪的版本只保留为历史候选；新基线应移除默认武器，修复空手手形，保留原有站姿与人物身份。持枪不是默认外观验收项。
- 新角色工程：`ec754f38-24d6-4516-8c1d-18a4cfc3ee7c`，制作分支 `wqy`，存储 `storage-wqy-pilot`。旧 `wqy-pilot-e59892ac-d398-4055-950f-883b00ac0abd` 是橙发角色试点，不能覆盖或混用绑定。

### 执行顺序

1. 先复制并登记原始参考，永远不覆盖原始素材。
2. 先查插件实际采样路径与局部编辑能力，再选择参数。prompt 明确写成“change only X / preserve Y”。本次 Qwen 的低降噪尝试未成功，不能复用为推荐配方：`denoise` 原样传给 KSampler，不是局部修改强度；插件没有 mask/inpaint 路径。恢复基线可采用插件默认 `denoise=1, steps=40, cfg=1, euler/simple`，但尚未在此角色重新生成验证，也不保证局部以外像素不变。
3. 等待 job 终态后，用 `GET /api/jobs/:id` 对账；失败时记录错误，不能盲目重提。本次四次提交依次遇到插件目录不一致、远端增强无法读取 `file://`、生成成功但输出纹理噪声（job `4e4c9459-faed-4ec9-b461-fb32973713ac`），以及增强响应 content 类型不支持（job `18715710-db14-45dc-b86f-6fde864c71b6`，未进入采样）。任务 done 不等于画面合格。
4. 当目标是单纯、可定义的像素颜色变换时，采用确定性局部修正作为降级路径：在原图副本的已定位眼睛区域内，只转换满足虹彩颜色条件的像素，排除皮肤、白色高光和黑色轮廓；输出新的 PNG，不修改原图。
5. 对输出图做整身目视检查，并放大检查目标区域。验收项目必须逐项确认：眼睛颜色、姿态、武器、服装、头发、背景、画布尺寸、像素边缘。
6. 登记新的素材 ID，metadata 写入父素材、修改类型和验收用途。首个确定性修正版 `f3e06a64-16b1-4f24-a5dd-6f13694bd436` 在放大复查中发现虹膜层次压平、局部颜色溢出，必须继续修正，不作为合格基线；保留失败图用于比较。局部颜色变换应保留亮度差异、黑色瞳孔和白色高光，并验证眼睛蒙版之外的像素差异为零。
7. 用户已授权继续拆分、骨骼绑定和站姿预览，在新工程推进；无需为每个正常制作步骤反复确认。不能覆盖旧橙发工程，也不能把静态立绘通过误写成动作和游戏接入完成。

### 可复用判断规则

- 生图输出出现纹理噪声、角色漂移或任意未请求改变时，直接判定失败；不要用后续骨骼步骤掩盖。
- 小范围颜色、裁切、命名和元数据等可完全描述的操作优先使用确定性工具，以节省生成预算并保证可重复。
- AI 生成失败和确定性修正都必须保留证据；候选素材、工程候选、视觉评审、客户端验证分开记录。
- 制作阶段可提前在客户端 LIAF 排查兼容性，但只有完成“素材候选 → 部件拆分 → Region 绑定 → 中性姿态预览 → 动作/握持预览 → 发布导出”并逐项验收，才能把角色交付为完整成品。

### 本轮拆件与绑定方法

1. 使用 `scripts/gunner_reference_regions.py` 从原始素材重新修色：限定虹膜多边形与颜色范围，只调整色相/饱和度，保留明暗。此次修改 360 个像素；脚本断言眼睛蒙版外像素完全不变。
2. 从画布外部 flood fill 去除相连品红背景，避免按全图颜色阈值误删服装；仍需目视检查发丝边缘和封闭空隙，不能把 flood fill 成功等同干净抠图。
3. 以语义多边形切成头、躯干、骨盆、左右上臂/前臂/手、左右大腿/小腿/鞋、左右枪，共 17 个 Region。逐件排他分配原图可见像素，最后重组比对。此脚本是当前参考图的专用配方，有原图 SHA 和 864×1152 尺寸保护，**不是通用人体分割器**。
4. 比对使用标准化透明 RGB 后的完整 RGBA 字节相等；不能只用 `ImageChops.difference(...).getbbox()` 检查 RGBA，因为默认 alpha 检查可能漏掉 RGB 差异。像素精确重组只能证明静态可还原，不能证明语义分件或弯曲质量合格。
5. manifest 保留每件源图裁切框、原图关节点和父部件。设裁切左上角为 `(left,top)`、宽高 `(W,H)`，原图关节点 `(jx,jy)`，则归一化轴心为 `((jx-left)/W, 1-(jy-top)/H)`。父骨骼局部位移为 `((jx-parentX)/1152, (parentY-jy)/1152, 0)`；Region 尺寸也除以 1152。原图 y 向下，骨架 y 向上。
6. `scripts/gunner_reference_bind.ts` 通过素材上传与 AIC operation API 写入，创建 18 根骨骼（含 root）与绑定；不直接写数据库。收据绑定工程 ID、服务地址和 manifest 摘要，保存素材 ID、baseRevision 与结果。已成功的重复执行只读取当前 revision，不重复上传或写绑定。
7. 静态 `idle` 使用零轨道保持原站姿。另建 `joint-check` 检查肘部小角度弯曲，诊断动作不能冒充正式待机/攻击动画。

在仓库根目录执行以下命令可重现本参考图处理；更换角色时必须重新定义分件和关节点，不能复用坐标：

```powershell
python scripts/gunner_reference_regions.py storage-wqy-pilot/materials/gunner-reference-red-eyes-20261004/raw.png storage-wqy-pilot/gunner-authoring-20261004
bun scripts/gunner_reference_bind.ts storage-wqy-pilot/gunner-authoring-20261004 ec754f38-24d6-4516-8c1d-18a4cfc3ee7c http://127.0.0.1:39127
```

本机 `python` 为 Python 3.12，含 Pillow 12.2.0；`.venv-media` 未安装 Pillow，不能直接用它执行此脚本。其他机器先选择含 Pillow 的图像处理环境。以上命令依赖本地原始素材与正在运行的对应隔离服务。素材、蒙版与收据在 `storage-wqy-pilot/gunner-authoring-20261004/`，受忽略规则保护，文档中的 UUID 仅是本次收据，不是新工程默认值。

### 初轮验收与发现的问题（持枪历史候选）

- 新红眼参考素材：`4f1e1dab-c072-4301-99cd-83eeffa49d82`。旧的压平虹膜版本不再作为输入。
- 工程 revision：`3`；候选：`35ad539d-b05f-4e14-9033-bd196a2beaa3`；digest：`sha256:5d70aec3762b3a6dbc53def0ff82f33678e0c2fee0948db78fdd781f61cef0f9`。
- 静态实际预览证据：`a3be5b10429b195f93954e61d4a0fda81701b638cafb450d194f6e870bef602f`。已目视确认赤红眼睛、原站姿、双枪下垂与全身居中，并在真实工作台中复查。
- 20° 肘部检查证据：`440383b889fe908f8c5511a2c20ae1ba9c1e71aefe70c3899a63dc5d464135c9`。发现切割残片和关节覆盖不足，未通过。证据 PNG 保存在该存储根的 `aic-evidence/<evidenceId>.png`。
- 评审 `c680b928-92c2-4809-afc6-744bc67ec9cb` 使用 `revise`：静态站姿可作制作基线，完整角色尚未通过，因此未执行完整成品采用/发布。
- 下一轮先修正误归属像素，再为肘/肩等关节补画被遮挡区域、设置重叠和绘制顺序，比较静态与正负小角度接触表。补画允许新增隐藏像素，但必须保留原站姿可见轮廓；不能通过缩小检查角度掩盖裂口。
- 此历史候选的两把枪是独立 Region 随手部骨骼运动，**尚不是**独立 `.equipment`、BodyProfile 插座或已验证 IK 握持。用户纠正后，不再把此持枪候选作为默认角色基线。
- 本轮使用确定性图像处理和 API 操作，没有新提交图片/视频生成任务；没有验证 ComfyUI 插件切换时的显存卸载。

### 用户纠正：默认空手（2026-10-04）

本轮以用户最新反馈为准：角色本体默认空手，保留原图下垂手腕、自然微握手形、露指手套、服装、站姿和赤红虹膜。武器需要在未来独立装备制作完成并装配后显示；本轮没有实现正式装备切换。

- 先查看原图、手和枪的放大裁片，确认仅移除 gun 附件仍有柄部残留。重新提取手套/手指，排除暖色皮肤后修复金属残边，并清理旧 torso 残余层中的武器碎片。初次局部修补曾把手指误涂成深灰，放大复查后已纠正；因此必须同时检查全身与双手细节。
- 默认 binding 已移除两个 gun slots/attachments，现有 15 个 Region；枪素材与原持枪候选保留，18 根骨骼保留供后续制作。结构查询 `weaponAttachments=[]`、`diagnostics=[]`。
- 新素材：左手 `6fe47ec3-67fc-422e-95fa-b0a7fe4ed17c`，右手 `0c556104-9b1d-4ebc-a389-1af0a710e457`，清理残片的 torso `dae800b1-e974-44fe-ab8d-50977aee4135`。
- 工程 revision `5`，候选 `e56fc3d6-ce3d-4ca2-b9e3-8e101e6c8b42`，digest `sha256:b91aeb4dd46acb4a2f7f416aea0a94a3ad696948afd64dc6211a5a82db29bff5`。
- 实际静态证据 `44c27443bd65bbc531ee7f3eeabac2e0883ff6570f68acd25656629d6b7ac50d`；从该截图裁切的 `empty-hands/left-actual-preview.png`、`right-actual-preview.png` 已放大检查。真实工作台已确认动作“空手原始站姿”、装备“无装备”下双手不持枪。
- 以原重组图为基准，在手/枪局部矩形范围内改变 19949 个像素，范围外 RGBA 差异为 0；检查结果记录于 `storage-wqy-pilot/gunner-authoring-20261004/empty-hands/manifest.json`。
- 评审 `c4855eb7-b320-4f02-98d6-1e14a0f5b980` 保持 `revise`：本轮空手静态修正通过，但此前肘部覆盖不足、正式动作/装备及客户端验收仍未完成。没有采用或发布为完整角色成品。
- 现有 workflow 没有修改 run goal 的接口，原目标文字作为历史记录保留；新候选中文标题及本轮评审明确以用户“默认空手”反馈覆盖持双枪要求，不直接修改数据库、不为改文案重开预算。

本参考专用复现命令（在仓库根目录，使用前确认同一输入、服务与工程）：

```powershell
python scripts/gunner_empty_hands.py
bun scripts/gunner_empty_hands_bind.ts storage-wqy-pilot/gunner-authoring-20261004
```

脚本按新裁切框重算手部 pivot，API 写入使用 revision 和幂等键。`empty-hands/binding-receipt.json` 保存结果，已验证绑定脚本成功后重复执行复用收据、不重复写入。当前脚本坐标仅适用于本参考，不能当作通用自动空手转换器。

### 视线与视频首帧（2026-10-04）

用户要求双眼看向角色前方，不直视观众。根据脸部三分之四角度和鼻梁确认此参考的头部前方为画面右侧；只平移原有虹膜/瞳孔/高光，不扭头、不改身体。

- 最终双眼右移 5 个原图像素，使用同眼既有眼白明暗补旧位置；835 个像素变化限定在两眼矩形内，矩形外严格 RGBA 差异为 0。先试 3 像素，整身仍偏对观众，故最终对比图、贴图、首帧和实际预览统一为 5 像素版本。
- 工程 revision `6`，候选 `0384a38d-d8e3-4c2d-ba9d-7997c71e275c`，digest `sha256:3aa9e587d4613910ef26dfaec0947d980c1d98444ff84b5d6afa2bf55a2a669c`；实际证据 `9455e2365c6cd270a0d5a71fc596af8d7ba1b6556378e898e11f913039542fa6`。静态通过，整体角色仍待修订。
- 新头部素材 `48ecbe1e-2a59-4f40-bc3f-52ef1adc135f`；完整透明首帧 `d4d4e26f-8de6-4606-bb24-423ec105491a`；原画布 RGB 首帧 `3ce920b2-8180-4823-817d-17bed58775b4`。
- H3 插件当前工作流固定 16:9，故额外制作 RGB 浅色背景首帧 `08d2c62c-fbc5-499d-b839-e54b09e86142`：1152×648 画布，原图等比缩至 405×540，左上角放置于 `(373,54)`，不拉伸角色。原骨骼坐标系保持不变。
- 源图、眼部前后对比、manifest 与绑定收据保存于 `storage-wqy-pilot/gunner-authoring-20261004/forward-gaze/`。复现脚本为 `gunner_forward_gaze.py`、`gunner_forward_gaze_bind.ts`，仍仅适用于此参考。
- 视频制作与 K 帧按 视频参考 SOP（ECHO 本机未入库：`skill/fb-character-authoring/references/video-reference-keyframes.md`，见 `skill/README.md` 缺失清单） 继续；有首帧不等于已有视频或骨骼动画。
