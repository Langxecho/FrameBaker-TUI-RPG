from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from aigc_bench_plugin_runtime.capabilities import normalize_capabilities


@dataclass(frozen=True)
class ImageApiPluginSpec:
    """已安装的 HTTP 生图 API 插件（磁盘 manifest + provider.py）。"""

    plugin_id: str
    name: str
    version: str
    kind: str
    capabilities: tuple[str, ...]
    entry: dict[str, Any]
    secrets: dict[str, Any]
    params_schema: dict[str, Any]
    constraints: dict[str, Any]
    root_dir: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(self, "capabilities", normalize_capabilities(self.capabilities))

    def validate(self) -> list[str]:
        errors: list[str] = []
        if not str(self.plugin_id or "").strip():
            errors.append("plugin_id is required")
        if str(self.kind or "").strip() != "image_api":
            errors.append('kind must be "image_api"')
        ent = self.entry or {}
        if not isinstance(ent, dict):
            errors.append("entry must be an object")
        else:
            if str(ent.get("type") or "").strip() != "python":
                errors.append('entry.type must be "python"')
            if str(ent.get("module") or "").strip() != "provider":
                errors.append('entry.module must be "provider"')
            if not str(ent.get("function") or "").strip():
                errors.append("entry.function is required")
        sec = self.secrets or {}
        if not isinstance(sec, dict):
            errors.append("secrets must be an object")
        else:
            for k, meta in sec.items():
                if not isinstance(meta, dict):
                    errors.append(f"secrets.{k} must be an object")
                    continue
                # value 可在管理页后填；运行前由 ImageApiPluginRunner 校验 required
        ps = self.params_schema or {}
        if not isinstance(ps, dict):
            errors.append("params_schema must be an object")
        else:
            for pk, spec in ps.items():
                if not isinstance(spec, dict):
                    errors.append(f"params_schema.{pk} must be an object")
                    continue
                t = str(spec.get("type") or "").strip()
                if t not in ("string", "integer", "number", "boolean", "enum", "json", ""):
                    errors.append(f"params_schema.{pk} has invalid type: {t!r}")
                if "enum" in spec:
                    en = spec["enum"]
                    if not isinstance(en, list):
                        errors.append(f"params_schema.{pk}.enum must be an array")
        return errors

    @property
    def max_reference_images(self) -> int:
        raw = (self.constraints or {}).get("max_reference_images")
        if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0:
            return raw
        return 8

    @property
    def supports_text2image(self) -> bool:
        return bool((self.constraints or {}).get("supports_text2image", True))

    @property
    def supports_image2image(self) -> bool:
        return bool((self.constraints or {}).get("supports_image2image", True))
