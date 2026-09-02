#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any


def _short_error(exc: BaseException) -> str:
    message = str(exc).strip() or exc.__class__.__name__
    # 用户侧只保留短错误，不回传 traceback / 密钥细节
    first_line = message.splitlines()[0].strip()
    if len(first_line) > 500:
        return first_line[:497] + "..."
    return first_line


def _write_result(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _ensure_runtime_on_path() -> Path:
    python_dir = Path(__file__).resolve().parent
    runtime_root = python_dir
    # aigc_bench_plugin_runtime 与本文件同级
    if str(runtime_root) not in sys.path:
        sys.path.insert(0, str(runtime_root))
    return python_dir


def _repo_root() -> Path:
    # apps/server/src/python/media_plugin_runner.py -> repo root
    return Path(__file__).resolve().parents[4]


def _default_media_plugin_storage_root() -> Path:
    return (_repo_root() / "storage" / "media-plugins").resolve()


def _configured_media_plugin_storage_root() -> Path:
    override = str(os.environ.get("FRAMEBAKER_MEDIA_PLUGIN_ROOT") or "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return _default_media_plugin_storage_root()


def _is_relative_to(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def _resolve_safe_plugin_root(raw: Any) -> str:
    """Require an absolute pluginRoot contained under the configured storage plugin root.

    Task 2 owns this containment check so the Python runner never trusts a relative
    or escaped path; Task 3/4 install/run layers keep writing under the same root.
    """
    text = str(raw or "").strip()
    if not text:
        raise RuntimeError("pluginRoot is required")
    candidate = Path(text)
    if not candidate.is_absolute():
        raise RuntimeError("pluginRoot must be an absolute path")
    resolved = candidate.resolve()
    storage_root = _configured_media_plugin_storage_root()
    if not _is_relative_to(resolved, storage_root):
        raise RuntimeError("pluginRoot must be contained under the configured media plugin storage root")
    if not resolved.is_dir():
        raise RuntimeError("pluginRoot must be an existing directory")
    return str(resolved)


def _as_str_list(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise RuntimeError("imageUrls/audioUrls must be arrays")
    return [str(item) for item in value]


def _infer_image_mode(image_urls: list[str], explicit: str | None) -> str:
    if explicit:
        return explicit
    if len(image_urls) >= 2:
        return "multi_ref"
    if len(image_urls) == 1:
        return "i2i"
    return "t2i"


def _infer_video_mode(image_urls: list[str], explicit: str | None) -> str:
    if explicit:
        return explicit
    return "i2v" if image_urls else "t2v"


def _infer_audio_mode(image_urls: list[str], audio_urls: list[str], explicit: str | None) -> str:
    if explicit:
        return explicit
    if audio_urls:
        return "a2a"
    if image_urls:
        return "i2a"
    return "t2a"


def _run_image(request: dict[str, Any]) -> dict[str, Any]:
    from aigc_bench_plugin_runtime.image_api_plugins.runtime import GenerateRequest, ImageApiPluginRunner

    plugin_root = _resolve_safe_plugin_root(request.get("pluginRoot"))
    plugin_id = str(request.get("pluginId") or "").strip()
    output_dir = str(request.get("outputDir") or "").strip() or None
    if not plugin_id:
        raise RuntimeError("pluginId is required")
    image_urls = _as_str_list(request.get("imageUrls"))
    mode = _infer_image_mode(image_urls, str(request.get("mode") or "").strip() or None)
    params = request.get("params") if isinstance(request.get("params"), dict) else None
    runner = ImageApiPluginRunner.from_plugin_root(plugin_root)
    return runner.run(
        plugin_id,
        GenerateRequest(
            prompt=str(request.get("prompt") or ""),
            image_urls=image_urls,
            mode=mode,
            params=params,
            output_dir=output_dir,
        ),
    )


def _run_video(request: dict[str, Any]) -> dict[str, Any]:
    from aigc_bench_plugin_runtime.safe_download import as_float_duration
    from aigc_bench_plugin_runtime.video_api_plugins.runtime import GenerateVideoRequest, VideoApiPluginRunner

    plugin_root = _resolve_safe_plugin_root(request.get("pluginRoot"))
    plugin_id = str(request.get("pluginId") or "").strip()
    output_dir = str(request.get("outputDir") or "").strip()
    if not plugin_id or not output_dir:
        raise RuntimeError("pluginId and outputDir are required")
    image_urls = _as_str_list(request.get("imageUrls"))
    mode = _infer_video_mode(image_urls, str(request.get("mode") or "").strip() or None)
    duration_seconds = as_float_duration(request.get("durationSeconds"), default=4.0)
    assert duration_seconds is not None
    params = request.get("params") if isinstance(request.get("params"), dict) else None
    timeout_s = int(request.get("timeoutSeconds") or 600)
    runner = VideoApiPluginRunner.from_plugin_root(plugin_root)
    return runner.run(
        plugin_id,
        GenerateVideoRequest(
            prompt=str(request.get("prompt") or ""),
            image_urls=image_urls,
            image_bytes=[],
            mode=mode,
            duration_seconds=duration_seconds,
            output_dir=output_dir,
            timeout_s=timeout_s,
            params=params,
        ),
    )


def _run_audio(request: dict[str, Any]) -> dict[str, Any]:
    from aigc_bench_plugin_runtime.audio_api_plugins.runtime import AudioApiPluginRunner, GenerateAudioRequest
    from aigc_bench_plugin_runtime.safe_download import as_float_duration

    plugin_root = _resolve_safe_plugin_root(request.get("pluginRoot"))
    plugin_id = str(request.get("pluginId") or "").strip()
    output_dir = str(request.get("outputDir") or "").strip()
    if not plugin_id or not output_dir:
        raise RuntimeError("pluginId and outputDir are required")
    image_urls = _as_str_list(request.get("imageUrls"))
    audio_urls = _as_str_list(request.get("audioUrls"))
    mode = _infer_audio_mode(image_urls, audio_urls, str(request.get("mode") or "").strip() or None)
    duration_seconds = as_float_duration(request.get("durationSeconds"), default=None)
    params = request.get("params") if isinstance(request.get("params"), dict) else None
    timeout_s = int(request.get("timeoutSeconds") or 600)
    runner = AudioApiPluginRunner.from_plugin_root(plugin_root)
    return runner.run(
        plugin_id,
        GenerateAudioRequest(
            prompt=str(request.get("prompt") or ""),
            image_urls=image_urls,
            image_bytes=[],
            audio_urls=audio_urls,
            audio_bytes=[],
            mode=mode,
            duration_seconds=duration_seconds,
            output_dir=output_dir,
            timeout_s=timeout_s,
            params=params,
        ),
    )


def execute_request(request: dict[str, Any]) -> dict[str, Any]:
    kind = str(request.get("kind") or "").strip()
    if kind == "image_api":
        return _run_image(request)
    if kind == "video_api":
        return _run_video(request)
    if kind == "audio_api":
        return _run_audio(request)
    raise RuntimeError(f"unsupported media plugin kind: {kind!r}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="FrameBaker media plugin JSON runner")
    parser.add_argument("--request", required=True, help="path to request JSON")
    parser.add_argument("--result", required=True, help="path to result JSON")
    args = parser.parse_args(argv)

    result_path = Path(args.result)
    try:
        _ensure_runtime_on_path()
        request_path = Path(args.request)
        raw = json.loads(request_path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise RuntimeError("request JSON must be an object")
        result = execute_request(raw)
        _write_result(result_path, {"ok": True, "result": result})
        return 0
    except Exception as exc:  # noqa: BLE001 - CLI 边界统一收敛
        # 详细 traceback 仅写 stderr，供服务端日志；结果文件只含短错误
        traceback.print_exc(file=sys.stderr)
        _write_result(
            result_path,
            {
                "ok": False,
                "code": "PLUGIN_RUNTIME_ERROR",
                "error": _short_error(exc),
            },
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
