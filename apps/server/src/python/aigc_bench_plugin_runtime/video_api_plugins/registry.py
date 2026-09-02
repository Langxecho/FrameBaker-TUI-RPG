from __future__ import annotations

import json
from pathlib import Path

from .schemas import VideoApiPluginSpec


class VideoApiPluginRegistry:
    def __init__(self) -> None:
        self._plugins: dict[str, VideoApiPluginSpec] = {}

    def register(self, plugin: VideoApiPluginSpec) -> None:
        self._plugins[plugin.plugin_id] = plugin

    def get(self, plugin_id: str) -> VideoApiPluginSpec:
        return self._plugins[plugin_id]

    def try_get(self, plugin_id: str) -> VideoApiPluginSpec | None:
        return self._plugins.get(plugin_id)

    def list_plugins(self) -> list[VideoApiPluginSpec]:
        return list(self._plugins.values())


def _spec_from_raw(raw: dict, root_dir: str) -> VideoApiPluginSpec:
    return VideoApiPluginSpec(
        plugin_id=str(raw["plugin_id"]),
        name=str(raw.get("name", raw["plugin_id"])),
        version=str(raw.get("version", "1.0.0")),
        kind=str(raw.get("kind", "video_api")),
        capabilities=tuple(raw.get("capabilities", [])),
        entry=dict(raw.get("entry", {})),
        secrets=dict(raw.get("secrets", {})),
        params_schema=dict(raw.get("params_schema", {})),
        constraints=dict(raw.get("constraints", {})),
        root_dir=root_dir,
    )


def scan_video_api_plugins(root_dir: str) -> VideoApiPluginRegistry:
    registry = VideoApiPluginRegistry()
    root = Path(root_dir)
    if not root.exists():
        return registry
    for plugin_json in root.glob("*/plugin.json"):
        try:
            raw = json.loads(plugin_json.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if str(raw.get("kind") or "").strip() != "video_api":
            continue
        try:
            registry.register(_spec_from_raw(raw, str(plugin_json.parent)))
        except KeyError:
            continue
    return registry


def load_video_api_plugin_from_dir(plugin_dir: str) -> VideoApiPluginSpec:
    root = Path(plugin_dir)
    raw = json.loads((root / "plugin.json").read_text(encoding="utf-8"))
    return _spec_from_raw(raw, str(root.resolve()))
