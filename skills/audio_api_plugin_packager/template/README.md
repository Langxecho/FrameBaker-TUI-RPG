# 插件说明

- 修改 `plugin.json` 中的 `secrets` / `params_schema` / `constraints`。
- 在 `provider.py` 的 `generate(...)` 中实现 HTTP 调用。
- provider 返回 `{"url": "https://.../result.mp3"}` 或 `{"audio_path": helpers.output_path("result.mp3")}`。
- 不要在 provider 中调用 ffmpeg；需要归档转码时使用 Audio Benchmark 的 `transcode_archive_*` 参数。
- 使用仓库内命令打包与校验：

  ```bash
  python -m aigc_bench.backends.audio_api_plugins.pack --src . --out ../my.aap
  python -m aigc_bench.backends.audio_api_plugins.validator ../my.aap
  ```
