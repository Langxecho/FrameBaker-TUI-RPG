# CFP → VAP adapter

`scripts/convert_cfp_to_vap.py` converts the supplied ComfyUI `.cfp` archive into a declarative `.vap` archive. It validates that the source is a small ZIP containing only `plugin.json` and `workflow.json`, rejects path traversal, records the source SHA-256 in the generated manifest, and copies a fixed HTTP provider template. It never imports or executes CFP code and never contacts ComfyUI during conversion.

The generated provider is a converted plugin, not native CFP support. At runtime it uses the existing Python media-plugin runner and calls only ComfyUI `/upload/image`, `/prompt`, and `/history/{id}`. It accepts explicit duration, seed, steps, and reference-image parameters. The provider is serial and bounded; unknown prompt/history/output states fail closed. Persistent `clientId`, request ID, known prompt ID, and journal/cleanup ownership remain responsibilities of the surrounding media-plugin job/runtime.

The generated package is written under ignored `storage/converted-vap/` by default. The adapter does not install the package, configure secrets, run a job, or upload anything to the configured Comfy endpoint.

## D1 plugin sources

The D1 local setup uses the supplied CFP archive at
`C:\Users\19086\Downloads\TestGame\minimax-h3-t8-i2vMiniMAX-H3-T8双时钟采样4步无损加速+图生视频.cfp` and the image plugin source at
`F:\TestProject\aigc_bench\plugins\image_api\qwen_image_2_1`. The converted video plugin is installed as
`minimax-h3-t8-i2v`; the image plugin keeps the id `qwen_image_2_1`. Both are configured for the shared
ComfyUI endpoint `http://ddns.langxecho.top:8188`.

The two plugins share one GPU runtime. Before a plugin switch the server takes the runtime lease, waits for
both Comfy queue lists to be empty, sends `/free` with `unload_models=true` and `free_memory=true`, then
requires two consecutive `torch_vram_total <= 64 MiB` observations. If any step is unobservable, busy, or
times out, the switch is rejected and the runtime remains blocked until an operator clears it. Credentials stay
in local ignored plugin settings and are never copied into source control or evidence reports.
