# qwen image2.1

This aigc_bench image API plugin enhances every incoming prompt with the bundled
Qwen Image 2.1 prompt-rewriting contract and then routes the request to ComfyUI.

- No reference image: uses the supplied text-to-image workflow.
- One to ten reference images: uses the supplied image-edit workflow and connects
  each uploaded image to `TextEncodeQwenImage21.images.image_N` in input order.
- The configured enhancer accepts eight images per request, so nine or ten images
  use a two-stage rewrite: the first eight produce a draft and the remaining images
  reconcile that draft into the final prompt. Every reference is inspected.
- The default ComfyUI endpoint is `http://ddns.langxecho.top:8188/`.
- Endpoints and the prompt-enhancer API key are managed through plugin secrets.
- Model, sampling, sizing, prompt-enhancement, upload, and timeout settings are
  exposed through plugin parameters.
- Neither workflow unloads ComfyUI models or clears VRAM after generation, allowing
  subsequent tasks to reuse the loaded model cache.

Install the packaged `qwen_image_2_1.iap` on the aigc_bench `/api-plugins` page.
The model identifier is `iap__qwen_image_2_1`.
