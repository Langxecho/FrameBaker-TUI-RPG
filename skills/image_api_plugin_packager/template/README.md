# 插件说明

- 修改 `plugin.json` 中的 `secrets` / `params_schema`。
- 在 `provider.py` 的 `generate(...)` 中实现 HTTP 调用。
- 使用仓库内命令打包与校验：

  ```bash
  python -m aigc_bench.backends.image_api_plugins.pack --src . --out ../my.iap
  python -m aigc_bench.backends.image_api_plugins.validator ../my.iap
  ```
