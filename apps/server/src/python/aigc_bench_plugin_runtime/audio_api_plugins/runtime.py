from __future__ import annotations

import importlib.util
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from aigc_bench_plugin_runtime.errors import ConfigurationError
from aigc_bench_plugin_runtime.safe_download import download_bytes, require_path_inside

from .registry import scan_audio_api_plugins
from .schemas import AudioApiPluginSpec


_AUDIO_MEDIA_TYPES = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
}
_AUDIO_EXTENSIONS = tuple(_AUDIO_MEDIA_TYPES)


@dataclass(frozen=True)
class GenerateAudioRequest:
    prompt: str
    image_urls: list[str]
    image_bytes: list[bytes]
    audio_urls: list[str]
    audio_bytes: list[bytes]
    mode: str
    duration_seconds: float | None
    output_dir: str
    timeout_s: int
    params: dict[str, Any] | None = None


@dataclass
class PluginHelpers:
    plugin_id: str
    output_dir: str

    def output_path(self, filename: str = "result.mp3") -> str:
        root = Path(self.output_dir)
        root.mkdir(parents=True, exist_ok=True)
        return str((root / filename).resolve())

    def download(self, url: str, *, timeout: int = 120) -> bytes:
        return download_bytes(url, timeout=timeout)

    def log(self, msg: str) -> None:
        logging.getLogger("aigc_bench.audio_api_plugin").info("[%s] %s", self.plugin_id, msg)

    def get_logger(self) -> logging.Logger:
        return logging.getLogger(f"aigc_bench.audio_api_plugin.{self.plugin_id}")


def _merge_params(
    params_schema: dict[str, Any],
    request: GenerateAudioRequest,
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
    if request.duration_seconds is not None:
        out["duration_seconds"] = request.duration_seconds
    return out


def _load_generate_fn(spec: AudioApiPluginSpec) -> Callable[..., Any]:
    root = Path(spec.root_dir)
    provider = root / "provider.py"
    if not provider.is_file():
        raise RuntimeError(f"provider.py missing under {root}")
    mod_name = f"aigc_bench_aap_{spec.plugin_id.replace('-', '_')}"
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


def _validate_audio_file(audio_path: str, spec: AudioApiPluginSpec, *, output_dir: str) -> str:
    path = require_path_inside(Path(audio_path), Path(output_dir))
    if not path.is_file():
        raise RuntimeError(f"provider returned missing audio_path: {audio_path}")
    if path.stat().st_size <= 0:
        raise RuntimeError(f"provider returned empty audio file: {audio_path}")
    if path.suffix.lower() not in _AUDIO_EXTENSIONS:
        raise RuntimeError(f"provider returned unsupported audio extension: {path.suffix}")
    if path.suffix.lower() not in spec.output_extensions:
        raise ConfigurationError(
            f"provider returned extension {path.suffix!r} not in output_extensions {spec.output_extensions!r}"
        )
    return str(path)


def _constraint_number(raw: Any) -> float | None:
    if isinstance(raw, bool) or raw is None:
        return None
    if isinstance(raw, (int, float)):
        return float(raw)
    return None


def _validate_duration(request: GenerateAudioRequest, spec: AudioApiPluginSpec) -> None:
    if request.duration_seconds is None:
        return
    constraints = spec.constraints or {}
    dmin = _constraint_number(constraints.get("min_duration_seconds"))
    dmax = _constraint_number(constraints.get("max_duration_seconds"))
    if dmin is not None and request.duration_seconds < dmin:
        raise ConfigurationError(f"duration_seconds must be >= {dmin}")
    if dmax is not None and request.duration_seconds > dmax:
        raise ConfigurationError(f"duration_seconds must be <= {dmax}")


class AudioApiPluginRunner:
    def __init__(self, registry_root: str | None = None) -> None:
        self._registry_root = registry_root

    @classmethod
    def from_plugin_root(cls, root: str) -> AudioApiPluginRunner:
        if not str(root or "").strip():
            raise RuntimeError("plugin root is required")
        return cls(str(root))

    def get_spec(self, plugin_id: str) -> AudioApiPluginSpec:
        if not self._registry_root:
            raise RuntimeError("plugin root is required")
        spec = scan_audio_api_plugins(self._registry_root).try_get(plugin_id)
        if spec is None:
            raise RuntimeError(f"unknown audio API plugin: {plugin_id!r}")
        return spec

    def run(
        self,
        plugin_or_id: str | AudioApiPluginSpec,
        request: GenerateAudioRequest,
        secrets: dict[str, str] | None = None,
        helpers: PluginHelpers | None = None,
    ) -> dict[str, Any]:
        if isinstance(plugin_or_id, str):
            plugin_id = plugin_or_id
            plugin = self.get_spec(plugin_id)
            if secrets is None:
                secrets = {
                    k: str((meta or {}).get("value") or "")
                    for k, meta in (plugin.secrets or {}).items()
                    if isinstance(meta, dict)
                }
            if helpers is None:
                helpers = PluginHelpers(plugin_id=plugin_id, output_dir=request.output_dir)
            return self._run_plugin(plugin, request, secrets, helpers)
        if secrets is None or helpers is None:
            raise TypeError("secrets and helpers are required when passing AudioApiPluginSpec")
        return self._run_plugin(plugin_or_id, request, secrets, helpers)

    def _run_plugin(
        self,
        plugin: AudioApiPluginSpec,
        request: GenerateAudioRequest,
        secrets: dict[str, str],
        helpers: PluginHelpers,
    ) -> dict[str, Any]:
        errors = plugin.validate()
        if errors:
            raise RuntimeError("invalid plugin manifest: " + "; ".join(errors))
        if request.mode not in ("t2a", "i2a", "a2a"):
            raise RuntimeError(f"unsupported audio mode: {request.mode}")
        if request.mode == "t2a" and not plugin.supports_text2audio:
            raise RuntimeError(f"audio API plugin {plugin.plugin_id!r} does not support t2a")
        if request.mode == "i2a" and not plugin.supports_image2audio:
            raise RuntimeError(f"audio API plugin {plugin.plugin_id!r} does not support i2a")
        if request.mode == "a2a" and not plugin.supports_audio2audio:
            raise RuntimeError(f"audio API plugin {plugin.plugin_id!r} does not support a2a")

        _validate_duration(request, plugin)

        if request.mode == "i2a":
            ref_count = len(request.image_urls) + len(request.image_bytes)
            if ref_count > plugin.max_reference_images:
                raise ConfigurationError(
                    f"audio API plugin {plugin.plugin_id!r} supports at most "
                    f"{plugin.max_reference_images} reference images"
                )
        if request.mode == "a2a":
            ref_count = len(request.audio_urls) + len(request.audio_bytes)
            if ref_count > plugin.max_reference_audios:
                raise ConfigurationError(
                    f"max_reference_audios exceeded: audio API plugin {plugin.plugin_id!r} "
                    f"supports at most {plugin.max_reference_audios} reference audios"
                )

        for key, meta in (plugin.secrets or {}).items():
            if isinstance(meta, dict) and meta.get("required") and not str(secrets.get(key, meta.get("value", ""))).strip():
                raise RuntimeError(f"missing required secret value: {key}")

        result = _load_generate_fn(plugin)(
            request=request,
            secrets=secrets,
            params=_merge_params(plugin.params_schema, request, request.params),
            helpers=helpers,
        )
        if not isinstance(result, dict):
            raise RuntimeError("generate() must return a dict")

        metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
        audio_url = str(result.get("url") or "").strip()
        audio_path = str(result.get("audio_path") or "").strip()

        if audio_path:
            # 仅接受已位于 output_dir 内的本地文件，禁止从任意绝对路径复制外泄
            audio_path = _validate_audio_file(audio_path, plugin, output_dir=request.output_dir)
            return {"audio_path": audio_path, "audio_url": audio_url, "metadata": metadata}
        if audio_url:
            # URL 交由 Bun 侧有界下载（safeDownload）；Python 不在此拉取结果
            return {"url": audio_url, "metadata": metadata}
        raise RuntimeError("generate() return dict must contain 'audio_path' or 'url'")
