---
name: audio_api_plugin_packager
description: Use when packaging an HTTP audio generation API into an .aap plugin for aigc_bench, including plugin.json, provider.py, output_extensions declaration, secrets, params_schema, and the optional transcoding workflow.
---

# 生音频 HTTP API 插件（.aap）打包器

当用户要「新接入生音频 API」「打包 audio api plugin」「生成 .aap」「把某音频 API 做成 benchmark 可选项」时使用本 skill。

## Agent 必须遵守的契约

1. **所有密钥与可配置端点**必须写在 `plugin.json` 的 `secrets` 中（如 `api_key`、`base_url`），并设 `label` / `required` / `secret`；**禁止**在 `provider.py` 中硬编码密钥，只能通过 `secrets["api_key"]` 读取。
2. **HTTP 请求体中所有可由用户调整的字段**必须写在 `params_schema` 中并给出 `default`；运行时输入只有：`request.prompt`、`request.image_urls`、`request.image_bytes`、`request.audio_urls`、`request.audio_bytes`、`request.mode`、`request.duration_seconds`、`request.output_dir`、`request.timeout_s`。
3. **`params_schema` 类型**：`string` | `integer` | `number` | `boolean` | `json`；可选 `enum` 数组。
4. `provider.py` 必须实现顶层函数：

   ```python
   def generate(*, request, secrets, params, helpers):
       # request.mode in ("t2a"|"i2a"|"a2a")
       # return {"audio_path": helpers.output_path("result.mp3")} 或 {"url": "https://.../result.mp3"}
   ```

5. `.aap` ZIP 根目录只能包含 `plugin.json`、`provider.py`，以及可选的 `README.md`、`requirements.txt`。
6. `constraints.output_extensions` 只能声明 `.mp3`、`.wav`、`.flac`、`.ogg`、`.m4a`。
7. **不要在 provider 中调用 ffmpeg 转码**；归档转码由 runner 的 `transcode_archive_*` 参数处理，评分侧格式兜底由 scorer 处理。

## 模式输入

| mode | 输入 | duration | 约束 |
|---|---|---|---|
| `t2a` | `request.prompt` | 通常为空；插件可按自身参数处理 | 不依赖参考图/参考音频 |
| `i2a` | `request.prompt` + `request.image_urls` / `request.image_bytes` | 可用 `request.duration_seconds` | 受 `max_reference_images`、`min_duration_seconds`、`max_duration_seconds` 约束 |
| `a2a` | `request.prompt` + `request.audio_urls` / `request.audio_bytes` | 通常为空 | 受 `max_reference_audios` 约束 |

## 打包与校验

复制 `template/` 为工作目录，改 `plugin.json` 与 `provider.py`，再执行：

```bash
python -m aigc_bench.backends.audio_api_plugins.pack --src ./my_plugin --out my.aap
python -m aigc_bench.backends.audio_api_plugins.validator my.aap
```

也可以使用本 skill 附带脚本：

```bash
python skill/audio_api_plugin_packager/pack_aap.py --src ./my_plugin --out my.aap
python skill/audio_api_plugin_packager/validator.py my.aap
```

## 安装与使用

用户将 `.aap` 在 Web 页 **「生音频 API 插件」**（`/audio-api-plugins`）上传后，安装到当前工作目录 `plugins/audio_api/<plugin_id>/`。Audio Benchmark 中目标对象为 `{"kind":"audio_api_plugin","plugin_id":"<plugin_id>"}`，MCP 快速试跑可用 `aigc_run_audio_api_plugin`。
