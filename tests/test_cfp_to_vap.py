import hashlib
import importlib
import json
import sys
import zipfile
from pathlib import Path
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("convert", ROOT / "scripts" / "convert_cfp_to_vap.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def test_conversion_is_declarative_and_records_digest(tmp_path):
    source = tmp_path / "x.cfp"
    with zipfile.ZipFile(source, "w") as z:
        z.writestr("plugin.json", json.dumps({"plugin_id": "demo", "backend": "comfyui", "endpoint": "http://127.0.0.1:8188", "inputs": {"prompt": {}, "primary_image": {}}, "outputs": {"video": {}}}))
        workflow = {"12": {"class_type": "VHS_VideoCombine", "inputs": {"gifs": []}}, "14": {"class_type": "PrimitiveFloat", "inputs": {"value": 5}}, "38": {"class_type": "CR Prompt Text", "inputs": {"prompt": ""}}, "40": {"class_type": "LoadImage", "inputs": {"image": ""}}, "7": {"class_type": "MiniMaxH3DualClockSamplerT8", "inputs": {}}, "9": {"class_type": "RandomNoise", "inputs": {}}}
        z.writestr("workflow.json", json.dumps(workflow))
    out = tmp_path / "out.vap"
    result = mod.convert(source, out)
    assert result["source_sha256"] == hashlib.sha256(source.read_bytes()).hexdigest()
    with zipfile.ZipFile(out) as vap:
        assert set(vap.namelist()) == {"plugin.json", "workflow.json", "provider.py", "comfy_workflow_provider.py"}
        wrapper = vap.read("provider.py").decode()
        assert "exec(" not in wrapper
        assert "spec_from_file_location" in wrapper
        assert 'workflow_path=_PLUGIN_DIR / "workflow.json"' in wrapper
        assert "from comfy_workflow_provider import" not in wrapper
        manifest = json.loads(vap.read("plugin.json"))
        assert manifest["params_schema"]["steps"]["default"] == 4
        assert manifest["secrets"]["comfyui_base_url"]["value"] == "http://127.0.0.1:8188"
        provider = vap.read("comfy_workflow_provider.py").decode()
        assert 'outputs.get("12")' in provider
        assert '"url": base.rstrip("/") + "/view?"' in provider


def test_zip_slip_rejected(tmp_path):
    source = tmp_path / "bad.cfp"
    with zipfile.ZipFile(source, "w") as z:
        z.writestr("../plugin.json", "{}")
    try:
        mod.convert(source, tmp_path / "x.vap")
    except ValueError as exc:
        assert "escapes" in str(exc)
    else:
        raise AssertionError("expected path rejection")


def test_converted_plugin_runs_through_real_runner_with_its_own_workflow(tmp_path, monkeypatch):
    source = tmp_path / "runner.cfp"
    workflow = {
        "12": {"class_type": "VHS_VideoCombine", "inputs": {"gifs": []}},
        "14": {"class_type": "PrimitiveFloat", "inputs": {"value": 5}},
        "38": {"class_type": "CR Prompt Text", "inputs": {"prompt": ""}},
        "40": {"class_type": "LoadImage", "inputs": {"image": ""}},
        "7": {"class_type": "MiniMaxH3DualClockSamplerT8", "inputs": {}},
        "9": {"class_type": "RandomNoise", "inputs": {}},
    }
    with zipfile.ZipFile(source, "w") as z:
        z.writestr(
            "plugin.json",
            json.dumps(
                {
                    "plugin_id": "runner-demo",
                    "backend": "comfyui",
                    "endpoint": "http://127.0.0.1:8188",
                    "inputs": {"prompt": {}, "primary_image": {}},
                    "outputs": {"video": {}},
                }
            ),
        )
        z.writestr("workflow.json", json.dumps(workflow))

    vap = tmp_path / "runner.vap"
    mod.convert(source, vap)
    plugin_storage = tmp_path / "media-plugins" / "video_api"
    plugin_dir = plugin_storage / "runner-demo"
    plugin_dir.mkdir(parents=True)
    with zipfile.ZipFile(vap) as archive:
        archive.extractall(plugin_dir)
    reference = tmp_path / "reference image.png"
    reference.write_bytes(b"reference")
    output_dir = tmp_path / "run"
    output_dir.mkdir()

    python_dir = ROOT / "apps/server/src/python"
    monkeypatch.syspath_prepend(str(python_dir))
    runner = importlib.import_module("media_plugin_runner")
    monkeypatch.setenv("FRAMEBAKER_MEDIA_PLUGIN_ROOT", str(plugin_storage))
    calls = []

    class FakeResponse:
        def __init__(self, payload):
            self.payload = payload

        def read(self):
            return self.payload

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

    def fake_urlopen(req, timeout=30):
        path = req.full_url.removeprefix("http://127.0.0.1:8188")
        calls.append((path, req.get_method()))
        if path == "/upload/image":
            return FakeResponse(json.dumps({"name": "uploaded.png"}).encode())
        if path == "/prompt":
            payload = json.loads(req.data)
            assert payload["prompt"]["38"]["inputs"]["prompt"] == "runner prompt"
            assert payload["prompt"]["40"]["inputs"]["image"] == "uploaded.png"
            return FakeResponse(json.dumps({"prompt_id": "prompt-1"}).encode())
        if path == "/history/prompt-1":
            return FakeResponse(
                json.dumps(
                    {
                        "prompt-1": {
                            "outputs": {
                                "12": {
                                    "gifs": [
                                        {"filename": "result.mp4", "type": "output", "subfolder": ""}
                                    ]
                                }
                            }
                        }
                    }
                ).encode()
            )
        raise AssertionError(f"unexpected request: {path}")

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    result = runner.execute_request(
        {
            "kind": "video_api",
            "pluginRoot": str(plugin_storage.resolve()),
            "pluginId": "runner-demo",
            "prompt": "runner prompt",
            "imageUrls": [reference.resolve().as_uri()],
            "durationSeconds": 4,
            "outputDir": str(output_dir.resolve()),
            "timeoutSeconds": 1,
            "params": {},
        }
    )

    assert calls == [
        ("/upload/image", "POST"),
        ("/prompt", "POST"),
        ("/history/prompt-1", "GET"),
    ]
    assert result["url"].endswith("/view?filename=result.mp4&type=output&subfolder=")
    journal = json.loads((output_dir / "comfy-journal.json").read_text(encoding="utf-8"))
    assert journal["status"] == "completed"
    assert journal["promptId"] == "prompt-1"
    sys.modules.pop("media_plugin_runner", None)
