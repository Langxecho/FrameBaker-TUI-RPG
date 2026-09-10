# 刀刃机器人怪物流水线测试

用于集成测试：**身份参考图单独确认 → 动作静图锁参考图 → 图生视频 → 拆帧**。  
测试角色：**刀刃机器人**（手臂为长刀的赛博守卫）。

开发服务：`bun dev` → [http://localhost:3000](http://localhost:3000) → 顶栏 **生成中心** → **怪物**。

生图 / 生视频 / 生音频三个插件页不要改、不要用来跑本用例。

---

## 流程总览

```text
怪物页顶部生图连接（默认 https://euzhi.vip/v1 + gpt-image-2，可回退 Euzhi GPT Image 2 插件密钥）
        +（可选）安装 MiniMax H3 I2V 插件
        │
        ▼
① 填写外貌 → 生成参考图（只出一张身份静图，不会自动开流水线）
        │
        ▼
② 看图：不满意就改文案再生成，或上传/从素材库换一张
        │  选定后页面会显示「已选定的流水线参考图」
        ▼
③ 填写需要的动作静图 / 视频提示词 → 开始流水线
        │
        ▼
④ 先生成全部动作静图（含待机）→ 每个动作视频都以待机静图为 I2VA 首帧（默认 4 秒；上传给插件的是 JPEG）→ 拆帧
        │
        ▼
⑤ 素材库核对：外貌是否同一机体、透明底、朝左；同一文件夹里应有「…拆帧包」zip（动画名/动作/fps/帧图），可下载解压
```

服务端不会在参考图完成后自动继续。没选定参考图时，「开始流水线」不可用。

---

## 测试前检查

1. **怪物页顶部**填好生图连接：Base `https://euzhi.vip/v1`、模型 `gpt-image-2`、API Key（或已安装并填过密钥的 Euzhi GPT Image 2 插件）。不要用设置页的 OpenAI / 图匠 `admin.euzhi.com/tujiang/api/v1`（会 405）。
2. 若要测视频：媒体插件 Python 已装（`scripts/setup_media.ps1`），且已安装可运行的 `.vap`。默认插件 id 为 `minimax-h3-t8-i2v`。未安装或不可运行时，流水线会**只出静图**（除非你在下拉里显式选了一个坏插件，那时会报错）。
3. 建议分辨率保持 **256 × 256**（页内默认）。Gemini / MiniMax 接口只认比例，像素靠拆帧贴画。
4. **自动抠图**建议开；拆帧去背选 **连通抠实心底 + 去掉品红**。
5. 背景目标是**真透明**，不要品红底。

建议先只跑 **平A**（开视频时系统会自动补待机静图当首帧），通了再补特殊 / 受击 / 死亡。

---

## 固定表单（全程用同一套）

| 项 | 值 |
| --- | --- |
| 名称 | `刀刃守卫` |
| 出图宽度 / 高度 | `256` / `256` |
| 图生视频插件 | `minimax-h3-t8-i2v`（测静图-only 则选「只生成静图」） |
| 视频时长 | `4` 秒 |
| 拆帧 fps | 勾选 `4 fps`（需要更密再勾 `24`） |
| 拆帧后导入 | 第一次建议「只进素材库」 |

---

## ① 身份参考图

把下面整段贴进 **怪物外貌**，点 **生成参考图**。  
系统会再拼上「全身朝左、透明底、禁止品红」等锁，不必自己写那些约束。

```text
Pixel-art game enemy, one full body, facing LEFT. Cyber sentry robot named Blade Guard. Slim armored torso and helmet visor, iron-gray metal with cyan edge lights. BOTH ARMS ARE LONG STRAIGHT BLADES from the shoulder, no hands, no fingers, no guns. Blades are flat silvery cutting edges, slightly longer than the torso. Compact legs, hard-edged sprite, entire unit visible. Neutral idle standing ready. Isolated subject only.
```

**通过标准（必须等人确认，不要直接开流水线）**

- 全身入画、朝左、能看清双臂是刀不是手。
- 无场景、无地板、无棋盘格、无品红 / `#FF00FF` 实心底。
- 不满意：改一两处描述再生成，或用页内参考选择器上传/换素材。满意后再看「已选定的流水线参考图」。

生成完成后任务结束即停，这是预期行为。

---

## ② 动作静图文案

每个动作槽只写**这一帧的姿势**。外貌由选定参考图锁定。空槽不会生成。

建议五条都填，便于看外貌是否漂。若省时间，至少填 **待机、平A**。

**待机**

```text
Neutral idle keyframe. Both blade-arms hang slightly forward like sheathed guards, cyan visor lit, compact stance, full body facing LEFT, readable silhouette.
```

**平A**

```text
Basic melee slash keyframe. Front blade-arm swept across in a clear horizontal cut, back blade still as counterweight, same robot, full body facing LEFT.
```

**特殊攻击**

```text
Charged cross-slash keyframe. Both blade-arms raised then crossing in an X in front of the chest, more telegraphed than the basic attack, same robot, full body facing LEFT.
```

**受击**

```text
Hit-reaction keyframe. Torso flinches backward, visor flicker, blade-arms still attached, unit intact, full body facing LEFT.
```

**死亡**

```text
Death-clip START pose only: still fully intact standing, visor dimming, not wrecked, not exploding, entire subject visible, full body facing LEFT.
```

动作静图必须仍是**同一台刀刃机器人**（双臂长刀、铁灰+青光、朝左、透明底）。若漂成持枪人型或长出手掌，记下 Provider / 模型后换图或重跑该槽。

---

## ③ 视频提示词（I2VA）

时长与表单一致（**默认 4 秒**）。**所有动作视频的 `<Picture 1>` 都是待机静图**，不是该动作自己的关键帧。提示词要从待机姿势演到该动作。

可点「填入默认视频提示词」再改，或直接粘贴下面全文。留空则服务端按 H3 模板自动拼（同样从待机起、约 4 秒）。

**待机（4s）**

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Pixel-art Blade Guard robot. <Picture 1> is the idle standing still. Keep the exact identity, silhouette, colors, blade-arms, and LEFT-facing. Begin in that idle pose. Neutral idle: subtle visor pulse and a tiny stance shift, blades stay as arms, no walking off frame. Full body stays inside the frame with a locked camera at slow speed and small amplitude. Isolated subject on an empty void so every frame can be keyed to transparency. Duration about 4.0 seconds. No text, logo, or watermark.

overall_soundscape: Soft servo hum and faint metal tick; no crowd, no music bleed.

non_diegetic_music: N/A
```

**平A（4s）**

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Pixel-art Blade Guard robot. <Picture 1> is the idle standing still. Keep the exact identity, silhouette, colors, blade-arms, and LEFT-facing. Begin in that idle pose, then the front blade-arm completes one readable horizontal slash and returns toward guard. Full body stays inside the frame with a locked camera at slow speed and small amplitude. Isolated subject on an empty void so every frame can be keyed to transparency. Duration about 4.0 seconds. No text, logo, or watermark.

overall_soundscape: One sharp metal slash whoosh and light servo; no crowd, no music bleed.

non_diegetic_music: N/A
```

**特殊攻击（4s）**

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Pixel-art Blade Guard robot. <Picture 1> is the idle standing still. Keep the exact identity, silhouette, colors, blade-arms, and LEFT-facing. Begin in that idle pose, then both blade-arms charge and cross in one X slash, more telegraphed than a basic attack, then settle. Full body stays inside the frame with a locked camera at slow speed and small amplitude. Isolated subject on an empty void so every frame can be keyed to transparency. Duration about 4.0 seconds. No text, logo, or watermark.

overall_soundscape: Rising servo charge then dual blade clash; no crowd, no music bleed.

non_diegetic_music: N/A
```

**受击（4s）**

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Pixel-art Blade Guard robot. <Picture 1> is the idle standing still. Keep the exact identity, silhouette, colors, blade-arms, and LEFT-facing. Begin in that idle pose, then a short recoil flinch and recovery; unit stays intact, no death, no explosion. Full body stays inside the frame with a locked camera at slow speed and small amplitude. Isolated subject on an empty void so every frame can be keyed to transparency. Duration about 4.0 seconds. No text, logo, or watermark.

overall_soundscape: Dull metal impact and short servo strain; no crowd, no music bleed.

non_diegetic_music: N/A
```

**死亡（4s）**

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.

integrated_multimodal_description: [Shot 1] Pixel-art Blade Guard robot. <Picture 1> is the idle standing still. Keep the exact identity, silhouette, colors, blade-arms, and LEFT-facing. Begin fully intact in that idle pose, visor dies, knees buckle, collapse in place without leaving the frame; do not spawn wreckage piles that hide the body. Full body stays inside the frame with a locked camera at slow speed and small amplitude. Isolated subject on an empty void so every frame can be keyed to transparency. Duration about 4.0 seconds. No text, logo, or watermark.

overall_soundscape: Power-down whir and final metal thud; no crowd, no music bleed.

non_diegetic_music: N/A
```

点 **开始流水线（n 个动作）**。右侧任务应按「全部动作静图（待机优先）→ 各动作视频（均引用待机静图）→ 拆帧」推进。

---

## ④ 核对清单

| 检查项 | 预期 |
| --- | --- |
| 参考图与流水线是否拆开 | 生成参考图完成后流水线未自动开始 |
| 未选参考图 | 「开始流水线」不可用或提交报「请先选定或上传」 |
| 外貌一致性 | 各动作仍是双臂长刀赛博守卫，不是持械人型 |
| 朝向 | 全身朝左 |
| 背景 | 透明或可被连通去背清掉；无品红目标底 |
| 画布 | 拆帧结果贴进 256×256 |
| 视频首帧 | 每个动作视频的第一帧都是待机静图 |
| 视频时长 | 约 4 秒 |
| 静图-only | 插件选跳过视频时无视频任务、无拆帧 |
| 插件页 | 生图/生视频/生音频表单未被这次操作改掉 |

可选：拆帧后导入逐帧项目，时间轴能播。

---

## 接口对照（自动化时可跳过 UI）

1. `POST /api/materials/monster-reference`  
   `{ "appearance": "…上文外貌…", "name": "刀刃守卫", "width": 256, "height": 256 }` → `{ "jobId" }`  
   等 `job_done` 拿 `materialIds[0]`。
2. `POST /api/materials/monster-pipeline`  
   必填 `referenceMaterialId`，再带 `actions` / `videoPrompts`（键为 `monster-01-idle` … `monster-05-death`）。

MCP：`generate_monster_reference` 然后 `generate_monster_pipeline`（必须已有素材 ID）。
