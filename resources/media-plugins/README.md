# 团队可复现的媒体插件资源

本目录保存实际使用过的插件源码及无凭据安装包，不包含模型权重、生成图/视频、运行时数据库或 Python 缓存。`source/` 便于审阅；同目录归档可在 FrameBaker 设置的媒体插件页安装。插件是可执行 Python，安装前应阅读源码与依赖。

| 插件 | 安装包 | 来源 |
| --- | --- | --- |
| Qwen Image 2.1，1.0.1 | `qwen_image_2_1/qwen_image_2_1.iap` | AIC 制作服务实际安装版本 |
| MiniMax H3 T8 I2V，1.0.0 | `minimax-h3-t8-i2v/minimax-h3-t8-i2v.vap` | AIC 已安装的 CFP 适配版本，含 workflow 和 Python 执行器 |
| Euzhi GPT Image 2，1.0.0 | `euzhi_gpt_image2/euzhi_gpt_image2.iap` | 团队已有下载插件的脱敏版本 |

`minimax-h3-t8-i2v.cfp` 是用户提供的原始工作流包，SHA-256 为
`0e821940cfead8d706a0be939c9bf9ae82b9e129c7e5c50440d7654acb680c67`。
它不是 FrameBaker 原生 `.vap`；安装时使用上表适配包，保留 CFP 用于追溯。

每个插件的 `receipt.json` 记录归档与逐文件 SHA。打包用
`bun scripts/archive-media-plugin-resource.ts <本地插件目录> <新输出目录>`，
复用 FrameBaker manifest 校验、导出脱敏和 ZIP 实现；输出目录必须不存在。
校验范围是 manifest 与归档往返，不声称本次重新执行了云端生图或视频任务。

## 安装后配置

所有 `secrets.*.value` 均已清空，包括非敏感端点；到本机设置中填写，不把配置后的包重新提交。

- Qwen：`comfyui_base_url`、`enhancer_base_url`、`enhancer_api_key`。反推模型及生成参数以 manifest 为准。
- H3：`comfyui_base_url`。需要工作流引用的模型及 Comfy 节点；不随本仓库分发模型。
- Euzhi：`api_key`、`base_url`（服务商图像 API 地址）。

团队共享 ComfyUI 端点为 `http://ddns.langxecho.top:8188`。切换图片/视频插件之前，等待任务结束，卸载前一个插件的模型并确认显存回收；不要同时加载两套模型。AIC 自动清理/恢复增强代码位于 `codex/aic-fb-pipeline`，本次仅把资源与 SOP 放到 `shy`，没有自动合并该分支。

原始本地插件可能含密钥，`staging/` 被本目录 `.gitignore` 排除；原安装目录未修改。仓库资源无密钥不代表他人无需自己的服务授权。插件和模型的许可、服务账户权限以原提供者条款为准。
