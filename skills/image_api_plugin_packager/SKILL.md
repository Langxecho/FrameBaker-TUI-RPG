---
name: image_api_plugin_packager
description: 将 HTTP 生图 API 封装为 aigc_bench 的 .iap 插件（plugin.json + provider.py），含校验与打包命令。
---

# 生图 HTTP API 插件（.iap）打包器

当用户要「新接入生图 API」「打包 image api plugin」「生成 .iap」「把某 API 做成 benchmark 可选项」时使用本 skill。

## Agent 必须遵守的契约

1. **所有密钥与可配置端点**必须写在 `plugin.json` 的 `secrets` 中（如 `api_key`、`base_url`），并设 `label` / `required` / `secret`；**禁止**在 `provider.py` 中硬编码密钥，只能通过 `secrets["api_key"]` 读取。
2. **HTTP 请求体中所有可由用户调整的字段**（如 `conversation_id`、`model`、`ratio`、`resolution`、`count`、`with_watermark`、默认 `images` 等）必须写在 `params_schema` 中并给出 `default`；**禁止**在 `provider.py` 里写死这些业务常量。运行时输入只有：`request.prompt`、`request.image_urls`（及由二者推导的 `request.mode`）。组请求体时用 `params["字段名"]` 读取。
3. **`params_schema` 类型**：`string` | `integer` | `number` | `boolean` | `json`（数组或对象，如默认参考图列表、扩展字段）；可选 `enum` 数组（管理页渲染为下拉框）。**不要**把整条 JSON 请求体塞进一个巨大字符串硬编码在 `provider.py`；应拆成多个 `params_schema` 键。
4. `provider.py` 必须实现顶层函数：
   ```python
   def generate(*, request, secrets, params, helpers):
       # request.prompt, request.image_urls, request.mode in ("t2i"|"i2i"|"multi_ref")
       return {"url": "..."}  # 或 {"base64": "..."}
   ```

5. 交付前在**含本仓库的 Python 环境**中运行校验（推荐）：

   ```bash
   python -m aigc_bench.backends.image_api_plugins.validator <path/to/plugin.iap>
   ```

   若无法 import `aigc_bench`，则使用本目录下的 `validator.py`（见下文）。

6. 打包（推荐调用仓库内实现，避免双份逻辑漂移）：

   ```bash
   python -m aigc_bench.backends.image_api_plugins.pack --src ./my_plugin --out my.iap
   ```

## 目录脚手架

复制 `template/` 为工作目录，改 `plugin.json` 与 `provider.py`，再执行上述 pack / validator。

## 安装与使用

用户将 `.iap` 在 Web 页 **「生图 API 插件」**（`/api-plugins`）上传后，安装到当前工作目录 `plugins/image_api/<plugin_id>/`。Benchmark / 批量生图中模型名为 `iap__<plugin_id>`。
