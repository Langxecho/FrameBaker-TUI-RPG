"""HTTP audio API plugins (.aap)."""

from .registry import (
    AudioApiPluginRegistry,
    load_audio_api_plugin,
    load_audio_api_plugin_from_dir,
    scan_audio_api_plugins,
)  # no cwd-relative plugin root helper
from .runtime import AudioApiPluginRunner, GenerateAudioRequest, PluginHelpers
from .schemas import AudioApiPluginSpec

__all__ = [
    "AudioApiPluginRegistry",
    "AudioApiPluginRunner",
    "AudioApiPluginSpec",
    "GenerateAudioRequest",
    "PluginHelpers",
    "load_audio_api_plugin",
    "load_audio_api_plugin_from_dir",
    "scan_audio_api_plugins",
]
