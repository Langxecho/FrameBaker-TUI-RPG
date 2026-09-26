"""HTTP audio generation API provider skeleton."""

from __future__ import annotations

from typing import Any


def generate(*, request: Any, secrets: dict[str, str], params: dict[str, Any], helpers: Any) -> dict[str, Any]:
    """
    request.prompt: str
    request.image_urls: list[str]
    request.image_bytes: list[bytes]
    request.audio_urls: list[str]
    request.audio_bytes: list[bytes]
    request.mode: "t2a" | "i2a" | "a2a"
    request.duration_seconds: int | None
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
        "format": params.get("format") or "mp3",
        "images": list(request.image_urls or []),
        "audios": list(request.audio_urls or []),
        **dict(params.get("extra") or {}),
    }

    helpers.log(f"POST {base_url} timeout={request.timeout_s} mode={request.mode}")
    _ = body

    # TODO: import requests
    # resp = requests.post(base_url, json=body, headers={"Authorization": f"Bearer {api_key}"}, timeout=request.timeout_s)
    # resp.raise_for_status()
    # data = resp.json()
    # return {"url": data["audio_url"]}
    # Or download manually to helpers.output_path("result.mp3") and return {"audio_path": path}.
    # If the remote service returns a direct URL, prefer returning {"url": ...}; aigc_bench will download it.

    raise RuntimeError("请在 provider.py 中实现真实 HTTP 调用，并 return {'url': ...} 或 {'audio_path': ...}")
