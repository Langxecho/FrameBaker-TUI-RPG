---
name: video_api_plugin_packager
description: 将 HTTP 生视频 API 封装为 aigc_bench 的 .vap 插件（plugin.json + provider.py），含校验与打包命令。
---

# 生视频 HTTP API 插件（.vap）打包器

当用户要「新接入生视频 API」「打包 video api plugin」「生成 .vap」「把某视频 API 做成 benchmark 可选项」时使用本 skill。

## Agent 必须遵守的契约

1. **所有密钥与可配置端点**必须写在 `plugin.json` 的 `secrets` 中（如 `api_key`、`base_url`），并设 `label` / `required` / `secret`；**禁止**在 `provider.py` 中硬编码密钥，只能通过 `secrets["api_key"]` 读取。
2. **HTTP 请求体中所有可由用户调整的字段**必须写在 `params_schema` 中并给出 `default`；运行时输入只有：`request.prompt`、`request.image_urls`、`request.image_bytes`、`request.mode`、`request.duration_seconds`、`request.output_dir`、`request.timeout_s`。
3. **`params_schema` 类型**：`string` | `integer` | `number` | `boolean` | `json`；可选 `enum` 数组。
4. `provider.py` 必须实现顶层函数：

   ```python
   def generate(*, request, secrets, params, helpers):
       # request.mode in ("t2v"|"i2v")
       # return {"video_path": helpers.output_path("result.mp4")} 或 {"url": "https://.../result.mp4"}
   ```

5. 交付前在**含本仓库的 Python 环境**中运行校验：

   ```bash
   python -m aigc_bench.backends.video_api_plugins.validator <path/to/plugin.vap>
   ```

6. 打包：

   ```bash
   python -m aigc_bench.backends.video_api_plugins.pack --src ./my_plugin --out my.vap
   ```

## 目录脚手架

复制 `template/` 为工作目录，改 `plugin.json` 与 `provider.py`，再执行上述 pack / validator。

## 安装与使用

用户将 `.vap` 在 Web 页 **「生视频 API 插件」**（`/video-api-plugins`）上传后，安装到当前工作目录 `plugins/video_api/<plugin_id>/`。Video Benchmark 中模型名为 `vap__<plugin_id>`。
