from __future__ import annotations

import base64
import importlib.util
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from aigc_bench_plugin_runtime.safe_download import download_bytes, require_path_inside

from .registry import scan_image_api_plugins
from .schemas import ImageApiPluginSpec


@dataclass(frozen=True)
class GenerateRequest:
    prompt: str
    image_urls: list[str]
    mode: str  # "t2i" | "i2i" | "multi_ref"
    params: dict[str, Any] | None = None
    output_dir: str | None = None


@dataclass
class PluginHelpers:
    """注入给 provider.generate 的辅助能力。"""

    plugin_id: str
    output_dir: str | None = None

    def output_path(self, filename: str = "result.png") -> str:
        if not self.output_dir:
            raise RuntimeError("output_dir is required for local image output")
        root = Path(self.output_dir)
        root.mkdir(parents=True, exist_ok=True)
        return str((root / filename).resolve())

    def download(self, url: str, *, timeout: int = 120) -> bytes:
        return download_bytes(url, timeout=timeout)

    def log(self, msg: str) -> None:
        logging.getLogger("aigc_bench.image_api_plugin").info("[%s] %s", self.plugin_id, msg)

    def get_logger(self) -> logging.Logger:
        return logging.getLogger(f"aigc_bench.image_api_plugin.{self.plugin_id}")


def _merge_params(
    params_schema: dict[str, Any],
    overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, spec in (params_schema or {}).items():
        if not isinstance(spec, dict):
            continue
        if "default" in spec:
            out[key] = spec["default"]
    if overrides:
        for key, value in overrides.items():
            if value is None:
                continue
            out[str(key)] = value
    return out


def _secrets_values(secrets: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for k, meta in (secrets or {}).items():
        if isinstance(meta, dict) and "value" in meta:
            out[str(k)] = "" if meta["value"] is None else str(meta["value"])
    return out


def _load_generate_fn(spec: ImageApiPluginSpec) -> Callable[..., Any]:
    root = Path(spec.root_dir)
    prov = root / "provider.py"
    if not prov.is_file():
        raise RuntimeError(f"provider.py missing under {root}")
    mod_name = f"aigc_bench_iap_{spec.plugin_id.replace('-', '_')}"
    entry = spec.entry or {}
    fn_name = str(entry.get("function") or "generate").strip() or "generate"
    spec_obj = importlib.util.spec_from_file_location(mod_name, str(prov))
    if spec_obj is None or spec_obj.loader is None:
        raise RuntimeError("failed to load provider module spec")
    module = importlib.util.module_from_spec(spec_obj)
    spec_obj.loader.exec_module(module)
    fn = getattr(module, fn_name, None)
    if not callable(fn):
        raise RuntimeError(f"callable {fn_name!r} not found in provider.py")
    return fn


class ImageApiPluginRunner:
    def __init__(self, registry_root: str) -> None:
        self._registry_root = registry_root

    @classmethod
    def from_plugin_root(cls, root: str) -> ImageApiPluginRunner:
        if not str(root or "").strip():
            raise RuntimeError("plugin root is required")
        return cls(str(root))

    def get_spec(self, plugin_id: str) -> ImageApiPluginSpec:
        reg = scan_image_api_plugins(self._registry_root)
        spec = reg.try_get(plugin_id)
        if spec is None:
            raise RuntimeError(f"unknown image API plugin: {plugin_id!r}")
        return spec

    def run(self, plugin_id: str, request: GenerateRequest) -> dict[str, Any]:
        spec = self.get_spec(plugin_id)
        errs = spec.validate()
        if errs:
            raise RuntimeError("invalid plugin manifest: " + "; ".join(errs))
        if request.mode not in ("t2i", "i2i", "multi_ref"):
            raise RuntimeError(f"unsupported image mode: {request.mode}")
        if request.mode == "t2i" and not spec.supports_text2image:
            raise RuntimeError(f"image API plugin {plugin_id!r} does not support t2i")
        if request.mode in ("i2i", "multi_ref") and not spec.supports_image2image:
            raise RuntimeError(f"image API plugin {plugin_id!r} does not support {request.mode}")
        ref_count = len(request.image_urls)
        if request.mode == "i2i" and ref_count < 1:
            raise RuntimeError("i2i requires at least one reference image")
        if request.mode == "multi_ref" and ref_count < 2:
            raise RuntimeError("multi_ref requires at least two reference images")
        if request.mode in ("i2i", "multi_ref") and ref_count > spec.max_reference_images:
            raise RuntimeError(
                f"image API plugin {plugin_id!r} supports at most {spec.max_reference_images} reference images"
            )
        for k, meta in (spec.secrets or {}).items():
            if isinstance(meta, dict) and meta.get("required") and not str(meta.get("value", "")).strip():
                raise RuntimeError(f"missing required secret value: {k}")
        fn = _load_generate_fn(spec)
        params = _merge_params(spec.params_schema, request.params)
        secrets = _secrets_values(spec.secrets)
        helpers = PluginHelpers(plugin_id=plugin_id, output_dir=request.output_dir)
        result = fn(request=request, secrets=secrets, params=params, helpers=helpers)
        if not isinstance(result, dict):
            raise RuntimeError("generate() must return a dict")
        return _normalize_image_result(result, output_dir=request.output_dir)


def _normalize_image_result(result: dict[str, Any], *, output_dir: str | None) -> dict[str, Any]:
    metadata = result.get("metadata") if isinstance(result.get("metadata"), dict) else {}
    image_paths_raw = result.get("image_paths")
    image_path = str(result.get("image_path") or "").strip()
    image_url = str(result.get("url") or "").strip()
    b64 = str(result.get("base64") or "").strip()

    paths: list[str] = []
    if isinstance(image_paths_raw, list) and image_paths_raw:
        if not output_dir:
            raise RuntimeError("output_dir is required when provider returns image_paths")
        root = Path(output_dir)
        for item in image_paths_raw:
            text = str(item or "").strip()
            if not text:
                raise RuntimeError("generate() image_paths contains an empty path")
            resolved = require_path_inside(Path(text), root)
            if not resolved.is_file() or resolved.stat().st_size <= 0:
                raise RuntimeError(f"generate() returned missing/empty image_path: {text}")
            paths.append(str(resolved))
        out: dict[str, Any] = {"image_paths": paths, "metadata": metadata}
        if paths:
            out["image_path"] = paths[0]
        return out

    if image_path:
        if not output_dir:
            raise RuntimeError("output_dir is required when provider returns image_path")
        resolved = require_path_inside(Path(image_path), Path(output_dir))
        if not resolved.is_file() or resolved.stat().st_size <= 0:
            raise RuntimeError(f"generate() returned missing/empty image_path: {image_path}")
        return {"image_path": str(resolved), "image_paths": [str(resolved)], "metadata": metadata}

    if b64:
        if not output_dir:
            # 兼容仅返回 base64 的旧契约；Bun 侧仍可落盘
            return {"base64": b64, "metadata": metadata}
        dest = Path(output_dir) / "result.png"
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(base64.b64decode(b64))
        resolved = require_path_inside(dest, Path(output_dir))
        return {
            "image_path": str(resolved),
            "image_paths": [str(resolved)],
            "base64": b64,
            "metadata": metadata,
        }

    if image_url:
        # URL 仍交由 Bun 侧有界下载（safeDownload）；Python 只规范化本地路径契约
        return {"url": image_url, "metadata": metadata}

    raise RuntimeError("generate() return dict must contain 'image_path'/'image_paths' and/or 'url'/'base64'")
