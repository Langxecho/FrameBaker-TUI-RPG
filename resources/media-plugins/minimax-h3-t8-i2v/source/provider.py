from __future__ import annotations

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
