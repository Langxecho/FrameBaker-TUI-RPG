#!/usr/bin/env python3
"""Convert a trusted CFP archive into a declarative FrameBaker VAP archive.

The converter never imports or executes CFP code and never contacts ComfyUI.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import posixpath
import zipfile
from pathlib import Path
from typing import Any

MAX_ARCHIVE_BYTES = 8 * 1024 * 1024
MAX_ENTRY_BYTES = 2 * 1024 * 1024
REQUIRED = {"plugin.json", "workflow.json"}


def _safe_name(name: str) -> str:
    normalized = posixpath.normpath(name.replace("\\", "/"))
    if normalized.startswith("../") or normalized in {"..", "."} or normalized.startswith("/"):
        raise ValueError("archive path escapes root")
    if "\x00" in normalized:
        raise ValueError("archive path contains NUL")
    return normalized


def _read_json(zf: zipfile.ZipFile, name: str) -> dict[str, Any]:
    try:
        raw = zf.read(name)
        if len(raw) > MAX_ENTRY_BYTES:
            raise ValueError(f"{name} exceeds size budget")
        value = json.loads(raw.decode("utf-8"))
    except KeyError as exc:
        raise ValueError(f"missing {name}") from exc
    except UnicodeDecodeError as exc:
        raise ValueError(f"{name} must be UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    return value


def convert(source: Path, destination: Path) -> dict[str, Any]:
    if source.suffix.lower() != ".cfp":
        raise ValueError("source must have .cfp extension")
    if source.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("source archive exceeds size budget")
    source_digest = hashlib.sha256(source.read_bytes()).hexdigest()
    with zipfile.ZipFile(source) as cfp:
        infos = [info for info in cfp.infolist() if not info.is_dir()]
        if any(info.file_size > MAX_ENTRY_BYTES for info in infos):
            raise ValueError("archive entry exceeds size budget")
        names = [_safe_name(info.filename) for info in infos]
        if len(set(names)) != len(names):
            raise ValueError("duplicate or aliased archive paths")
        if set(names) != REQUIRED:
            raise ValueError(f"CFP must contain exactly {sorted(REQUIRED)}")
        manifest = _read_json(cfp, "plugin.json")
        workflow = _read_json(cfp, "workflow.json")
    if str(manifest.get("backend", "")).lower() != "comfyui":
        raise ValueError("only ComfyUI CFP archives are supported")
    plugin_id = str(manifest.get("plugin_id", "")).strip()
    if not plugin_id or any(ch not in "abcdefghijklmnopqrstuvwxyz0123456789-_" for ch in plugin_id):
        raise ValueError("plugin_id must be a safe ASCII identifier")
    endpoint = str(manifest.get("endpoint", "http://127.0.0.1:8188")).strip()
    if not (endpoint.startswith("http://") or endpoint.startswith("https://")):
        raise ValueError("endpoint must be HTTP(S)")
    outputs = manifest.get("outputs")
    if not isinstance(outputs, dict) or "video" not in outputs:
        raise ValueError("CFP must declare a video output")
    inputs = manifest.get("inputs")
    if not isinstance(inputs, dict) or not isinstance(inputs.get("prompt"), dict) or not isinstance(inputs.get("primary_image"), dict):
        raise ValueError("CFP must declare prompt and primary_image inputs")
    required_nodes = {"12": "VHS_VideoCombine", "14": "PrimitiveFloat", "38": "CR Prompt Text", "40": "LoadImage", "7": "MiniMaxH3DualClockSamplerT8", "9": "RandomNoise"}
    for node_id, class_type in required_nodes.items():
        node = workflow.get(node_id)
        if not isinstance(node, dict) or node.get("class_type") != class_type or not isinstance(node.get("inputs"), dict):
            raise ValueError(f"unsupported CFP workflow node {node_id}/{class_type}")
    if "value" not in workflow["14"]["inputs"]:
        raise ValueError("unsupported CFP output or duration node shape")
    vap_manifest = {
        "plugin_id": plugin_id,
        "name": f"{manifest.get('name', plugin_id)} (converted CFP)",
        "version": str(manifest.get("version", "1.0.0")),
        "kind": "video_api",
        "capabilities": ["i2v"],
        "entry": {"type": "python", "module": "provider", "function": "generate"},
        "secrets": {"comfyui_base_url": {"label": "ComfyUI base URL", "required": True, "value": endpoint}},
        "params_schema": {
            "durationSeconds": {"type": "number", "default": 4.0, "min": 0.1, "max": 15.0},
            "seed": {"type": "integer", "default": 0, "min": 0},
            "steps": {"type": "integer", "default": 4, "min": 1, "max": 64},
            "refImage": {"type": "string", "default": ""},
        },
        "constraints": {"min_duration_seconds": 0.1, "max_duration_seconds": 15.0, "max_reference_images": 5, "converted_from": "cfp", "comfyuiEndpoint": endpoint},
        "metadata": {"source_cfp_sha256": source_digest, "source_cfp_name": source.name, "endpoint": endpoint},
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as vap:
        vap.writestr("plugin.json", json.dumps(vap_manifest, ensure_ascii=False, indent=2) + "\n")
        vap.writestr("workflow.json", json.dumps(workflow, ensure_ascii=False, separators=(",", ":")))
        vap.writestr("provider.py", PROVIDER_TEMPLATE)
        vap.writestr("comfy_workflow_provider.py", (Path(__file__).resolve().parents[1] / "apps/server/src/python/comfy_workflow_provider.py").read_text(encoding="utf-8"))
    return {"plugin_id": plugin_id, "source_sha256": source_digest, "output": str(destination), "kind": "video_api"}


PROVIDER_TEMPLATE = '''from __future__ import annotations

import importlib.util
from pathlib import Path


_PLUGIN_DIR = Path(__file__).resolve().parent
_HELPER_PATH = _PLUGIN_DIR / "comfy_workflow_provider.py"
_HELPER_SPEC = importlib.util.spec_from_file_location(
    f"framebaker_comfy_helper_{_PLUGIN_DIR.name}", _HELPER_PATH
)
if _HELPER_SPEC is None or _HELPER_SPEC.loader is None:
    raise RuntimeError("COMFY_HELPER_REQUIRED")
_HELPER = importlib.util.module_from_spec(_HELPER_SPEC)
_HELPER_SPEC.loader.exec_module(_HELPER)


def generate(*, request, secrets, params, helpers):
    return _HELPER.generate_comfy_video(
        request=request,
        params=params,
        helpers=helpers,
        secrets=secrets,
        workflow_path=_PLUGIN_DIR / "workflow.json",
    )
'''


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    destination = args.output or (Path("storage") / "converted-vap" / f"{args.source.stem}.vap")
    print(json.dumps(convert(args.source, destination), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
