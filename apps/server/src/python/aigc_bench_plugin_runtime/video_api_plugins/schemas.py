from __future__ import annotations

from dataclasses import dataclass
from typing import Any
import re

from aigc_bench_plugin_runtime.capabilities import normalize_capabilities


@dataclass(frozen=True)
class VideoApiPluginSpec:
    """Installed HTTP video generation API plugin."""

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
        elif not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", str(self.plugin_id)):
            errors.append("plugin_id must contain only letters, numbers, dot, underscore, or hyphen")
        if str(self.kind or "").strip() != "video_api":
            errors.append('kind must be "video_api"')
        if not any(cap in self.capabilities for cap in ("t2v", "i2v")):
            errors.append("capabilities must include t2v or i2v")

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

        if not isinstance(self.secrets or {}, dict):
            errors.append("secrets must be an object")
        else:
            for key, meta in (self.secrets or {}).items():
                if not isinstance(meta, dict):
                    errors.append(f"secrets.{key} must be an object")

        ps = self.params_schema or {}
        if not isinstance(ps, dict):
            errors.append("params_schema must be an object")
        else:
            for key, spec in ps.items():
                if not isinstance(spec, dict):
                    errors.append(f"params_schema.{key} must be an object")
                    continue
                typ = str(spec.get("type") or "").strip()
                if typ not in ("string", "integer", "number", "boolean", "enum", "json", ""):
                    errors.append(f"params_schema.{key} has invalid type: {typ!r}")
                if "enum" in spec and not isinstance(spec["enum"], list):
                    errors.append(f"params_schema.{key}.enum must be an array")

        constraints = self.constraints or {}
        if not isinstance(constraints, dict):
            errors.append("constraints must be an object")
            return errors
        dmin = constraints.get("min_duration_seconds")
        dmax = constraints.get("max_duration_seconds")
        if dmin is not None and (isinstance(dmin, bool) or not isinstance(dmin, (int, float)) or dmin < 0):
            errors.append("constraints.min_duration_seconds must be a non-negative number")
        if dmax is not None and (isinstance(dmax, bool) or not isinstance(dmax, (int, float)) or dmax < 0):
            errors.append("constraints.max_duration_seconds must be a non-negative number")
        if (
            isinstance(dmin, (int, float))
            and isinstance(dmax, (int, float))
            and not isinstance(dmin, bool)
            and not isinstance(dmax, bool)
            and dmin > dmax
        ):
            errors.append("duration constraints min_duration_seconds must be <= max_duration_seconds")
        exts = constraints.get("output_extensions")
        if exts is not None:
            if not isinstance(exts, list) or not all(isinstance(item, str) and item.startswith(".") for item in exts):
                errors.append("constraints.output_extensions must be an array of extensions")
        return errors

    @property
    def max_reference_images(self) -> int:
        raw = (self.constraints or {}).get("max_reference_images")
        if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0:
            return raw
        return 1

    @property
    def supports_text2video(self) -> bool:
        return bool((self.constraints or {}).get("supports_text2video", "t2v" in self.capabilities))

    @property
    def supports_image2video(self) -> bool:
        return bool((self.constraints or {}).get("supports_image2video", "i2v" in self.capabilities))

    @property
    def output_extensions(self) -> tuple[str, ...]:
        raw = (self.constraints or {}).get("output_extensions")
        if isinstance(raw, list):
            exts = tuple(str(item).lower() for item in raw if str(item or "").startswith("."))
            if exts:
                return exts
        return (".mp4", ".mov", ".webm", ".mkv")
