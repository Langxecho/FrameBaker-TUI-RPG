from __future__ import annotations

from typing import Any

import requests


def _first_image_payload(payload: Any) -> dict[str, str]:
    if not isinstance(payload, dict):
        raise RuntimeError(f"响应不是 JSON 对象: {type(payload).__name__}")

    err = payload.get("error")
    if isinstance(err, dict) and err.get("message"):
        raise RuntimeError(str(err.get("message")))
    if payload.get("message") and payload.get("code") not in (None, 0, "0", 200, "200"):
        raise RuntimeError(str(payload.get("message")))

    data = payload.get("data")
    item: Any = None
    if isinstance(data, list) and data:
        item = data[0]
    elif isinstance(data, dict):
        item = data
        nested = data.get("data")
        if isinstance(nested, list) and nested:
            item = nested[0]
    elif isinstance(payload.get("images"), list) and payload["images"]:
        item = payload["images"][0]

    if isinstance(item, str) and item.strip():
        value = item.strip()
        if value.startswith("http://") or value.startswith("https://"):
            return {"url": value}
        return {"base64": value}

    if not isinstance(item, dict):
        raise RuntimeError(f"无法解析生图结果: {payload}")

    url = (item.get("url") or item.get("image_url") or "").strip()
    if isinstance(url, dict):
        url = str(url.get("url") or "").strip()
    b64 = (item.get("b64_json") or item.get("base64") or item.get("b64") or "").strip()
    if url:
        return {"url": url}
    if b64:
        return {"base64": b64}
    raise RuntimeError(f"结果缺少 url/b64_json: {item}")


def generate(*, request: Any, secrets: dict[str, str], params: dict[str, Any], helpers: Any) -> dict[str, str]:
    api_key = (secrets.get("api_key") or "").strip()
    if not api_key:
        raise RuntimeError("未配置 api_key（请在 plugin.json.secrets 或管理页填写）")
    base_url = (secrets.get("base_url") or "").strip()
    if not base_url:
        raise RuntimeError("未配置 base_url")

    timeout = int(params.get("timeout") or 180)
    body = {
        "model": params.get("model") or "gpt-image-2",
        "prompt": request.prompt,
        "size": params.get("size") or "1024x1024",
        "quality": params.get("quality") or "medium",
        "n": int(params.get("n") or 1),
    }
    response_format = (params.get("response_format") or "").strip()
    if response_format:
        body["response_format"] = response_format

    helpers.log(f"POST {base_url} timeout={timeout} model={body['model']} size={body['size']}")
    resp = requests.post(
        base_url,
        json=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        timeout=timeout,
    )
    try:
        payload = resp.json()
    except Exception:
        payload = None
    if resp.status_code >= 400:
        detail = payload if payload is not None else (resp.text or "")[:500]
        raise RuntimeError(f"HTTP {resp.status_code}: {detail}")
    if payload is None:
        raise RuntimeError(f"响应不是 JSON: {(resp.text or '')[:500]}")
    return _first_image_payload(payload)
