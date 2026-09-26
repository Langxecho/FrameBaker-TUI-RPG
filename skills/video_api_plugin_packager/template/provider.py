"""HTTP 生视频 API 调用实现（示例骨架）。"""

from __future__ import annotations

from typing import Any


def generate(*, request: Any, secrets: dict[str, str], params: dict[str, Any], helpers: Any) -> dict[str, Any]:
    """
    request.prompt: str
    request.image_urls: list[str]
    request.image_bytes: list[bytes]
    request.mode: "t2v" | "i2v"
    request.duration_seconds: int
    request.output_dir: str
    request.timeout_s: int
    """
    api_key = (secrets.get("api_key") or "").strip()
    if not api_key:
        raise RuntimeError("未配置 api_key（请在 plugin.json.secrets 或管理页填写）")
    base_url = (secrets.get("base_url") or "").strip()
    if not base_url:
        raise RuntimeError("未配置 base_url")

    body = {
        "prompt": request.prompt,
        "mode": request.mode,
        "duration_seconds": request.duration_seconds,
        "model": params.get("model") or "",
        "ratio": params.get("ratio") or "16:9",
        "resolution": params.get("resolution") or "720p",
        "images": list(request.image_urls or []),
        **dict(params.get("extra") or {}),
    }

    helpers.log(f"POST {base_url} timeout={request.timeout_s} mode={request.mode}")
    _ = body

    # TODO: import requests
    # resp = requests.post(base_url, json=body, headers={"Authorization": f"Bearer {api_key}"}, timeout=request.timeout_s)
    # resp.raise_for_status()
    # ... 解析 JSON，return {"url": "https://.../result.mp4"}
    # 或下载到 helpers.output_path("result.mp4") 后 return {"video_path": path}

    raise RuntimeError("请在 provider.py 中实现真实 HTTP 调用，并 return {'url': ...} 或 {'video_path': ...}")
