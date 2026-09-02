from __future__ import annotations

import importlib.util
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from aigc_bench_plugin_runtime.safe_download import require_path_inside

from .registry import scan_video_api_plugins
from .schemas import VideoApiPluginSpec


_RATIO_PATTERNS = (
    re.compile(r"【目标画幅】\s*([0-9]{1,2}\s*:\s*[0-9]{1,2})"),
    re.compile(r"画幅\s*([0-9]{1,2}\s*:\s*[0-9]{1,2})"),
    re.compile(r"\baspect\s*ratio\s*[:=]?\s*([0-9]{1,2}\s*:\s*[0-9]{1,2})", re.I),
    re.compile(r"\bratio\s*[:=]\s*([0-9]{1,2}\s*:\s*[0-9]{1,2})", re.I),
    re.compile(r"\baspect(?:\s*ratio)?\s*[:=]\s*([0-9]{1,2}\s*:\s*[0-9]{1,2})", re.I),
)


def normalize_ratio(value: str | None) -> str | None:
    if not value:
        return None
    text = str(value).strip().replace("：", ":")
    text = re.sub(r"\s+", "", text)
    if not re.fullmatch(r"[0-9]{1,2}:[0-9]{1,2}", text):
        return None
    return text


def extract_ratio_from_text(*texts: str | None) -> str | None:
    """Extract aspect ratio from case note/prompt text.

    Preference order is the order of provided texts, then pattern priority:
    note 目标画幅 > 画幅 > ratio/aspect.
    """
    for text in texts:
        if not text:
            continue
        for pattern in _RATIO_PATTERNS:
            match = pattern.search(str(text))
            if match:
                ratio = normalize_ratio(match.group(1))
                if ratio:
                    return ratio
    return None


def resolve_ratio_for_plugin(
    *,
    prompt: str | None,
    note: str | None = None,
    params_schema: dict[str, Any] | None = None,
) -> str | None:
    """Resolve a ratio supported by the plugin, or None to keep plugin default."""
    ratio = extract_ratio_from_text(note, prompt)
    if not ratio:
        return None
    schema = (params_schema or {}).get("ratio")
    if not isinstance(schema, dict):
        return ratio
    enum = schema.get("enum")
    if isinstance(enum, list) and enum:
        allowed = {normalize_ratio(str(item)) for item in enum}
        allowed.discard(None)
        if ratio not in allowed:
            return None
    return ratio


@dataclass(frozen=True)
class GenerateVideoRequest:
    prompt: str
    image_urls: list[str]
    image_bytes: list[bytes]
    mode: str
    duration_seconds: float
    output_dir: str
    timeout_s: int
    params: dict[str, Any] | None = None


@dataclass
class PluginHelpers:
    plugin_id: str
    output_dir: str

    def output_path(self, filename: str = "result.mp4") -> str:
        root = Path(self.output_dir)
        root.mkdir(parents=True, exist_ok=True)
        return str((root / filename).resolve())

    def download(self, url: str, *, timeout: int = 120) -> bytes:
        from aigc_bench_plugin_runtime.safe_download import download_bytes

        return download_bytes(url, timeout=timeout)

    def log(self, msg: str) -> None:
        logging.getLogger("aigc_bench.video_api_plugin").info("[%s] %s", self.plugin_id, msg)

    def get_logger(self) -> logging.Logger:
        return logging.getLogger(f"aigc_bench.video_api_plugin.{self.plugin_id}")


def _merge_params(
    params_schema: dict[str, Any],
    overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, spec in (params_schema or {}).items():
        if isinstance(spec, dict) and "default" in spec:
            out[key] = spec["default"]
    if overrides:
        for key, value in overrides.items():
            if value is None:
                continue
            out[str(key)] = value
    return out


def _secrets_values(secrets: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, meta in (secrets or {}).items():
        if isinstance(meta, dict) and "value" in meta:
            out[str(key)] = "" if meta["value"] is None else str(meta["value"])
    return out


def _load_generate_fn(spec: VideoApiPluginSpec) -> Callable[..., Any]:
    root = Path(spec.root_dir)
    provider = root / "provider.py"
    if not provider.is_file():
        raise RuntimeError(f"provider.py missing under {root}")
    mod_name = f"aigc_bench_vap_{spec.plugin_id.replace('-', '_')}"
    fn_name = str((spec.entry or {}).get("function") or "generate").strip() or "generate"
    module_spec = importlib.util.spec_from_file_location(mod_name, str(provider))
    if module_spec is None or module_spec.loader is None:
        raise RuntimeError("failed to load provider module spec")
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    fn = getattr(module, fn_name, None)
    if not callable(fn):
        raise RuntimeError(f"callable {fn_name!r} not found in provider.py")
    return fn


def _validate_video_file(video_path: str, spec: VideoApiPluginSpec, *, output_dir: str) -> str:
    path = require_path_inside(Path(video_path), Path(output_dir))
    if not path.is_file():
        raise RuntimeError(f"provider returned missing video_path: {video_path}")
    if path.stat().st_size <= 0:
        raise RuntimeError(f"provider returned empty video file: {video_path}")
    if path.suffix.lower() not in spec.output_extensions:
        raise RuntimeError(f"provider returned unsupported video extension: {path.suffix}")
    return str(path)


def _constraint_number(raw: Any) -> float | None:
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    return None


def clamp_duration_seconds(
    duration_seconds: float,
    constraints: dict[str, Any] | None,
) -> tuple[float, bool, float | None, float | None]:
    """Clamp requested duration into plugin constraints, preserving fractions."""
    original = float(duration_seconds)
    requested = original
    dmin = _constraint_number((constraints or {}).get("min_duration_seconds"))
    dmax = _constraint_number((constraints or {}).get("max_duration_seconds"))
    if dmin is not None and requested < dmin:
        requested = dmin
    if dmax is not None and requested > dmax:
        requested = dmax
    if requested <= 0:
        requested = 0.1
    return requested, requested != original, dmin, dmax


def _validate_duration(request: GenerateVideoRequest, spec: VideoApiPluginSpec) -> None:
    constraints = spec.constraints or {}
    dmin = _constraint_number(constraints.get("min_duration_seconds"))
    dmax = _constraint_number(constraints.get("max_duration_seconds"))
    if dmin is not None and request.duration_seconds < dmin:
        raise RuntimeError(f"duration_seconds must be >= {dmin}")
    if dmax is not None and request.duration_seconds > dmax:
        raise RuntimeError(f"duration_seconds must be <= {dmax}")


class VideoApiPluginRunner:
    def __init__(self, registry_root: str) -> None:
        self._registry_root = registry_root

    @classmethod
    def from_plugin_root(cls, root: str) -> VideoApiPluginRunner:
        if not str(root or "").strip():
            raise RuntimeError("plugin root is required")
        return cls(str(root))

    def get_spec(self, plugin_id: str) -> VideoApiPluginSpec:
        spec = scan_video_api_plugins(self._registry_root).try_get(plugin_id)
        if spec is None:
            raise RuntimeError(f"unknown video API plugin: {plugin_id!r}")
        return spec

    def run(self, plugin_id: str, request: GenerateVideoRequest) -> dict[str, Any]:
        spec = self.get_spec(plugin_id)
        errors = spec.validate()
        if errors:
            raise RuntimeError("invalid plugin manifest: " + "; ".join(errors))
        if request.mode not in ("t2v", "i2v"):
            raise RuntimeError(f"unsupported video mode: {request.mode}")
        if request.mode == "t2v" and not spec.supports_text2video:
            raise RuntimeError(f"video API plugin {plugin_id!r} does not support t2v")
        if request.mode == "i2v" and not spec.supports_image2video:
            raise RuntimeError(f"video API plugin {plugin_id!r} does not support i2v")
        original_duration = float(request.duration_seconds)
        requested_duration, duration_clamped, _dmin, _dmax = clamp_duration_seconds(
            original_duration,
            spec.constraints or {},
        )
        if duration_clamped:
            request = GenerateVideoRequest(
                prompt=request.prompt,
                image_urls=list(request.image_urls),
                image_bytes=list(request.image_bytes),
                mode=request.mode,
                duration_seconds=requested_duration,
                output_dir=request.output_dir,
                timeout_s=request.timeout_s,
                params=dict(request.params) if request.params else None,
            )
        _validate_duration(request, spec)
        if len(request.image_urls) + len(request.image_bytes) > spec.max_reference_images:
            raise RuntimeError(f"video API plugin {plugin_id!r} supports at most {spec.max_reference_images} reference images")
        for key, meta in (spec.secrets or {}).items():
            if isinstance(meta, dict) and meta.get("required") and not str(meta.get("value", "")).strip():
                raise RuntimeError(f"missing required secret value: {key}")

        result = _load_generate_fn(spec)(
            request=request,
            secrets=_secrets_values(spec.secrets),
            params=_merge_params(spec.params_schema, request.params),
            helpers=PluginHelpers(plugin_id=plugin_id, output_dir=request.output_dir),
        )
        if not isinstance(result, dict):
            raise RuntimeError("generate() must return a dict")
        metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
        video_url = str(result.get("url") or "").strip()
        video_path = str(result.get("video_path") or "").strip()
        if video_path:
            # 仅接受已位于 output_dir 内的本地文件，禁止从任意绝对路径复制外泄
            video_path = _validate_video_file(video_path, spec, output_dir=request.output_dir)
            return {
                "video_path": video_path,
                "video_url": video_url,
                "metadata": metadata,
                "original_duration_s": original_duration,
                "requested_duration_s": requested_duration,
                "duration_clamped": duration_clamped,
            }
        if video_url:
            # URL 交由 Bun 侧有界下载（safeDownload）；Python 不在此拉取结果
            return {
                "url": video_url,
                "metadata": metadata,
                "original_duration_s": original_duration,
                "requested_duration_s": requested_duration,
                "duration_clamped": duration_clamped,
            }
        raise RuntimeError("generate() return dict must contain 'video_path' or 'url'")
