# FrameBaker 媒体插件系统设计

## 1. 目标与边界

FrameBaker 新增一套独立的媒体插件体系，用于导入并调用 `.iap` 生图插件、`.vap` 生视频插件和 `.aap` 生音频插件。该体系与现有 `GenProvider` 完全并行，不修改现有 provider 类型、配置或执行路径。

首期包含：

- 仅上传插件压缩包，不导入展开目录。
- 使用项目统一的 `.venv-media` Python 环境。
- 插件设置、密钥和参数默认值管理。
- `/generate` 生成中心，提供生图、生视频、生音频三个标签。
- 根据 `plugin.json` 的 `params_schema` 动态渲染表单。
- 从素材库选择符合能力约束的参考媒体。
- 三类生成统一进入 FrameBaker 现有异步任务队列。
- 生成结果扩展为统一媒体素材，进入现有素材库。
- 图片可在提交时选择额外导入指定项目。
- MCP 提供插件查询和生成工具。

本期不包含 `.cfp` ComfyUI 插件、`.pap` Prompt Agent 插件，也不通过 MCP 管理插件安装、删除或密钥。

## 2. 总体架构

```text
前端 / MCP
  -> FrameBaker Bun API
  -> 现有 jobs 队列
  -> Bun 生成 JSON 请求
  -> .venv-media Python runner
  -> 动态加载插件 provider.py
  -> JSON 结果与媒体文件
  -> Bun 校验并归档 materials
```

Bun/TypeScript 是产品层的唯一主控，负责插件注册表、安装、设置 API、任务队列、素材归档、前端和 MCP。Python 只负责复用媒体插件运行时，加载可信插件中的 `provider.py` 并返回结构化结果。

不启动常驻 Python Web 服务。FrameBaker 通过受控子进程调用 Python runner，避免重复实现服务状态、端口管理和生命周期协调。

插件中的 Python 是可信代码。首期提供路径隔离、包校验、超时、输出限制和密钥脱敏，但不承诺操作系统级沙箱；设置界面需要明确提示这一点。

## 3. 后端模块与存储

新增媒体插件模块，建议目录为：

```text
apps/server/src/mediaPlugins/
  types.ts
  paths.ts
  registry.ts
  manifest.ts
  installer.ts
  secrets.ts
  runner.ts
  service.ts
```

职责分别为插件类型、存储路径、插件扫描、manifest 校验、安装、密钥/参数更新、Python 子进程调用和业务编排。

运行时目录固定基于 `STORAGE_ROOT`，不使用 cwd 相对路径：

```text
storage/media-plugins/
  image_api/<plugin-id>/plugin.json
  video_api/<plugin-id>/plugin.json
  audio_api/<plugin-id>/plugin.json

storage/media-plugin-runs/<job-id>/
  request.json
  result.json
  result.png / result.mp4 / result.mp3
```

插件扩展名映射：

```text
image_api <-> .iap
video_api <-> .vap
audio_api <-> .aap
```

现有 `materials` 表扩展为统一媒体素材。保留现有图片字段，并通过 `metadata.mediaKind` 标识 `image`、`video` 或 `audio`。如当前 schema 需要显式媒体类型字段，使用数据库迁移增加字段，但必须保持旧图片记录可正常读取。

插件来源写入：

```text
source = media-plugin:<plugin-id>
metadata.mediaKind = image | video | audio
```

metadata 还可记录插件 ID、插件版本、prompt、参数、参考素材 ID 和 provider 返回的非敏感 metadata。任何 secret 都不得写入任务 payload、日志或 metadata。

## 4. 插件安装与运行协议

前端仅上传 `.iap`、`.vap` 或 `.aap` 文件。Bun 服务端负责读取扩展名、校验包结构、校验 manifest、阻止 Zip Slip，并安装到对应类型目录。相同插件 ID 需要二次确认后覆盖。

Bun 与 Python runner 通过 JSON 文件通信，避免 prompt、参考资源和动态 JSON 参数受命令行转义影响：

```json
{
  "kind": "image_api",
  "pluginId": "example-image",
  "prompt": "pixel art warrior",
  "imageUrls": [],
  "audioUrls": [],
  "durationSeconds": null,
  "params": { "ratio": "1:1" },
  "outputDir": "<STORAGE_ROOT>/media-plugin-runs/<job-id>"
}
```

Runner 成功返回：

```json
{
  "ok": true,
  "result": {
    "url": "https://example.invalid/result.png",
    "image_path": "<output>/result.png",
    "video_path": "<output>/result.mp4",
    "audio_path": "<output>/result.mp3",
    "metadata": {}
  }
}
```

失败返回结构化错误，并由 Bun 转换为用户可读文本：

```json
{
  "ok": false,
  "error": "missing required secret value: api_key",
  "code": "PLUGIN_RUNTIME_ERROR"
}
```

Python runner 复用外部媒体插件系统的运行时核心代码，但不复用其 FastAPI 页面和路由，也不依赖 `F:/TestProject/aigc_bench/tmp/媒体插件系统` 的运行时路径。

## 5. API 与任务流

插件管理 API：

```text
GET    /api/media-plugins
GET    /api/media-plugins/:kind
GET    /api/media-plugins/:kind/:pluginId
POST   /api/media-plugins/import
PATCH  /api/media-plugins/:kind/:pluginId/secrets
PATCH  /api/media-plugins/:kind/:pluginId/params
DELETE /api/media-plugins/:kind/:pluginId
```

生成 API：

```text
POST /api/media-generation
```

生成 API 只创建异步任务，不直接执行插件。请求包括媒体类型、插件 ID、prompt、参考素材 ID、动态参数、数量、时长、文件夹、可选项目 ID 和名称。

任务类型扩展为：

```text
media_plugin_image
media_plugin_video
media_plugin_audio
```

现有 `jobs` 表、队列、取消机制、WebSocket 事件和任务面板继续复用。任务进度增加：

```json
{
  "phase": "running",
  "pluginId": "example-image",
  "mediaKind": "image",
  "message": "正在调用插件"
}
```

执行阶段为：校验插件、准备参考媒体、运行 Python、下载或整理输出、校验输出、归档素材、可选导入项目。

排队任务取消后不执行。运行中的任务终止 Python 子进程并清理临时输出目录。生成批次中的每个结果可创建独立素材，但保留批次关联信息。

## 6. 素材归档

统一归档函数接收媒体类型、文件路径、名称、来源、metadata 和 folder ID。

- 图片保存原始文件，必要时生成处理文件；可按现有逻辑导入项目帧。
- 视频保存原始媒体文件，并生成首帧缩略图用于素材列表。
- 音频保存原始媒体文件，记录时长、格式和采样信息。
- 视频和音频不进入帧编辑器。
- 图片选择项目目标时，先归档素材，再复用现有素材导入逻辑创建项目帧。
- 项目导入失败时保留已归档素材，并在任务中记录错误。

## 7. 前端

新增 `/generate` 生成中心，内部使用三个标签：

```text
生图 | 生视频 | 生音频
```

左侧为生成配置，包含插件、能力提示、prompt、参考素材、动态参数、数量/时长和归档目标。右侧显示任务进度、图片/视频/音频结果预览、错误和素材库入口。

插件参数根据 schema 自动映射：`string` 文本框、`integer/number` 数字框、`boolean` 开关、`enum` 下拉框、`json` JSON 编辑区。前端进行基础校验，服务端执行完整校验。

参考素材按媒体类型和插件约束过滤。客户端提交素材 ID，服务端负责解析为受控 URL 或文件输入，不允许客户端提交任意本地路径。

设置页新增媒体插件区域，按生图、生视频、生音频展示插件卡片，支持导入、覆盖确认、查看详情、密钥编辑、参数默认值编辑、测试、导出和删除。密钥只显示配置状态，不回填明文。

素材库增加“全部 / 图片 / 视频 / 音频”筛选。图片继续使用现有预览和处理能力；视频提供首帧、播放器和下载；音频提供播放器、时长和下载。所有用户可见文字使用 `t()` / `useT()`，并同步补充中英文词条；视觉样式复用现有像素主题和 CSS 变量。

## 8. MCP

新增查询工具：

```text
list_media_plugins
get_media_plugin
```

查询返回插件 ID、名称、版本、能力、参数 schema、约束、密钥配置状态和是否可运行，不返回密钥明文。

新增生成工具：

```text
generate_with_media_plugin
```

输入包含 kind、pluginId、prompt、references、params、count、durationSeconds、folderId、projectId 和 name。参考媒体只接受 FrameBaker 素材 ID。

工具调用前校验插件、参考素材、参数 schema、约束和必填密钥，然后创建异步任务并返回 job ID。AI 使用现有任务查询工具获取状态和结果。

MCP 不允许安装、删除插件、修改密钥、修改默认参数、执行任意 Python 或提交任意本地路径。

## 9. 错误与安全

错误代码至少覆盖：

```text
PLUGIN_PACKAGE_INVALID
PLUGIN_NOT_FOUND
PLUGIN_NOT_CONFIGURED
PLUGIN_PARAMETER_INVALID
PLUGIN_REFERENCE_INVALID
PYTHON_RUNTIME_UNAVAILABLE
PYTHON_DEPENDENCY_MISSING
PLUGIN_TIMEOUT
PLUGIN_EXECUTION_FAILED
PLUGIN_OUTPUT_INVALID
MEDIA_ARCHIVE_FAILED
```

插件 ID 使用安全字符；解压阻止路径穿越；插件目录和任务输出目录始终位于 `STORAGE_ROOT` 下。runner 的 cwd、输入和输出均由服务端控制。输出必须存在、非空、位于任务目录内，并符合插件声明的扩展名。

Python 环境不可用、依赖缺失、超时和插件异常都要转成可诊断的任务错误。详细 traceback 仅写脱敏服务端日志，用户和 MCP 只获得不含 secret 的摘要。

## 10. 验证

验证包括：

- `bun run typecheck`。
- Python runner 的 manifest、安装覆盖、Zip Slip、参数、密钥、JSON 协议、超时和输出校验测试。
- Bun 侧数据库迁移、插件 API、任务入队、三类媒体归档、取消、失败和 MCP 输入校验测试。
- 手动上传最小测试插件，完成三类媒体生成，检查素材预览、下载、任务状态和 MCP 调用。
- 清理 smoke test 产生的 `storage` 和临时输出。

## 11. 非目标

- 不改造或合并现有 `GenProvider`。
- 不接入 `.cfp` 和 `.pap`。
- 不启动常驻 Python HTTP 服务。
- 不为插件自动安装任意声明依赖。
- 不提供操作系统级插件沙箱。
- 不允许 MCP 进行插件管理或任意文件操作。
