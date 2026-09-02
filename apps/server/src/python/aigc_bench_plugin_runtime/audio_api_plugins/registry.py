from __future__ import annotations

import json
from pathlib import Path

from .schemas import AudioApiPluginSpec


class AudioApiPluginRegistry:
    def __init__(self) -> None:
        self._plugins: dict[str, AudioApiPluginSpec] = {}

    def register(self, plugin: AudioApiPluginSpec) -> None:
        self._plugins[plugin.plugin_id] = plugin

    def get(self, plugin_id: str) -> AudioApiPluginSpec:
        return self._plugins[plugin_id]

    def try_get(self, plugin_id: str) -> AudioApiPluginSpec | None:
        return self._plugins.get(plugin_id)

    def list_plugins(self) -> list[AudioApiPluginSpec]:
        return list(self._plugins.values())


def _spec_from_raw(raw: dict, root_dir: str) -> AudioApiPluginSpec:
    return AudioApiPluginSpec(
        plugin_id=str(raw["plugin_id"]),
        name=str(raw.get("name", raw["plugin_id"])),
        version=str(raw.get("version", "1.0.0")),
        kind=str(raw.get("kind", "audio_api")),
        capabilities=tuple(raw.get("capabilities", [])),
        entry=dict(raw.get("entry", {})),
        secrets=dict(raw.get("secrets", {})),
        params_schema=dict(raw.get("params_schema", {})),
        constraints=dict(raw.get("constraints", {})),
        root_dir=root_dir,
    )


def scan_audio_api_plugins(root_dir: str) -> AudioApiPluginRegistry:
    registry = AudioApiPluginRegistry()
    root = Path(root_dir)
    if not root.exists():
        return registry
    for plugin_json in root.glob("*/plugin.json"):
        try:
            raw = json.loads(plugin_json.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if str(raw.get("kind") or "").strip() != "audio_api":
            continue
        try:
            registry.register(_spec_from_raw(raw, str(plugin_json.parent)))
        except KeyError:
            continue
    return registry


def load_audio_api_plugin_from_dir(plugin_dir: str) -> AudioApiPluginSpec:
    root = Path(plugin_dir)
    raw = json.loads((root / "plugin.json").read_text(encoding="utf-8"))
    return _spec_from_raw(raw, str(root.resolve()))


def load_audio_api_plugin(plugin_dir: str) -> AudioApiPluginSpec:
    return load_audio_api_plugin_from_dir(plugin_dir)
