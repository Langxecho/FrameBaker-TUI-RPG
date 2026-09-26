"""HTTP 生图 API 调用实现（示例骨架）。

请求体字段从 params 读取，便于在 /api-plugins 管理页修改默认值。
"""

from __future__ import annotations

from typing import Any


def generate(*, request: Any, secrets: dict[str, str], params: dict[str, Any], helpers: Any) -> dict[str, str]:
    """
    request.prompt: str
    request.image_urls: list[str]
    request.mode: "t2i" | "i2i" | "multi_ref"
    """
    api_key = (secrets.get("api_key") or "").strip()
    if not api_key:
        raise RuntimeError("未配置 api_key（请在 plugin.json.secrets 或管理页填写）")
    base_url = (secrets.get("base_url") or "").strip()
    if not base_url:
        raise RuntimeError("未配置 base_url")

    timeout = int(params.get("timeout") or 120)

    # 参考图：任务传入的 URL 优先，否则用 params 里配置的默认列表
    ref_urls = list(request.image_urls or []) or list(params.get("images") or [])

    body = {
        "conversation_id": (params.get("conversation_id") or "").strip(),
        "prompt": request.prompt,
        "mode": params.get("mode") or "text_to_image",
        "media_type": params.get("media_type") or "image",
        "model": params.get("model") or "",
        "ratio": params.get("ratio") or "1:1",
        "resolution": params.get("resolution") or "SD",
        "count": int(params.get("count") or 1),
        "images": ref_urls,
        "with_watermark": bool(params.get("with_watermark", True)),
    }

    helpers.log(f"POST {base_url} timeout={timeout} mode={request.mode}")
    _ = body  # 接入真实 API 时使用，避免未使用告警

    # TODO: import requests
    # resp = requests.post(base_url, json=body, headers={"Authorization": f"Bearer {api_key}"}, timeout=timeout)
    # resp.raise_for_status()
    # ... 解析 JSON，return {"url": "..."} 或 {"base64": "..."}

    raise RuntimeError(
        "请在 provider.py 中实现真实 HTTP 调用（使用上面的 body），并 return {'url': ...} 或 {'base64': ...}"
    )
