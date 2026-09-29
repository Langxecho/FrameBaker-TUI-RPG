import json
from pathlib import Path
from types import SimpleNamespace
import importlib.util

import pytest


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "comfy_provider", ROOT / "apps/server/src/python/comfy_workflow_provider.py"
)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def request(output_dir):
    return SimpleNamespace(
        output_dir=str(output_dir), image_urls=[], prompt="ignored", duration_seconds=4, timeout_s=1
    )


def test_submitted_journal_only_reconciles_history(tmp_path, monkeypatch):
    (tmp_path / "comfy-journal.json").write_text(
        json.dumps({"clientId": "client", "requestId": "job", "status": "submitted", "promptId": "known"}),
        encoding="utf-8",
    )
    calls = []

    def fake_request(base, path, **kwargs):
        calls.append((path, kwargs.get("method", "GET")))
        assert path == "/history/known"
        return json.dumps({"known": {"outputs": {"12": {"gifs": [{"filename": "result.mp4", "type": "output", "subfolder": ""}]}}}}).encode()

    monkeypatch.setattr(mod, "_request", fake_request)
    result = mod.generate_comfy_video(
        request=request(tmp_path), params={}, helpers=SimpleNamespace(), secrets={"comfyui_base_url": "http://comfy"}
    )
    assert calls == [("/history/known", "GET")]
    assert result["url"].endswith("/view?filename=result.mp4&type=output&subfolder=")
    journal = json.loads((tmp_path / "comfy-journal.json").read_text(encoding="utf-8"))
    assert journal["status"] == "completed"
    assert journal["promptId"] == "known"


def test_unknown_submission_never_calls_prompt(tmp_path, monkeypatch):
    (tmp_path / "comfy-journal.json").write_text(
        json.dumps({"clientId": "client", "requestId": "job", "status": "unknown_submission"}),
        encoding="utf-8",
    )
    called = False

    def fake_request(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("network must not be called")

    monkeypatch.setattr(mod, "_request", fake_request)
    try:
        mod.generate_comfy_video(
            request=request(tmp_path), params={}, helpers=SimpleNamespace(), secrets={"comfyui_base_url": "http://comfy"}
        )
    except RuntimeError as exc:
        assert "RECONCILE_ONLY" in str(exc)
    else:
        raise AssertionError("expected fail-closed recovery")
    assert called is False


def test_file_url_decodes_windows_encoded_space_and_unicode(tmp_path):
    reference = tmp_path / "encoded space" / "角色 reference.png"
    reference.parent.mkdir()
    reference.write_bytes(b"reference-bytes")
    file_url = reference.as_uri()

    assert "%20" in file_url
    assert "%E8%A7%92%E8%89%B2" in file_url
    assert mod._local_path_from_file_url(file_url) == reference.resolve()


@pytest.mark.parametrize(
    "file_url",
    [
        "file://remote-host/share/reference.png",
        "file:////remote-host/share/reference.png",
    ],
)
def test_file_url_rejects_remote_unc_authority(file_url):
    with pytest.raises(RuntimeError, match="REFERENCE_REMOTE_AUTHORITY_FORBIDDEN"):
        mod._local_path_from_file_url(file_url)


def test_requested_reference_must_remain_in_validated_image_url_allowlist(tmp_path, monkeypatch):
    allowed = (tmp_path / "allowed.png").resolve().as_uri()
    requested = (tmp_path / "other.png").resolve().as_uri()
    req = request(tmp_path)
    req.image_urls = [allowed]
    called = False

    def fake_request(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("network must not be called")

    monkeypatch.setattr(mod, "_request", fake_request)
    with pytest.raises(RuntimeError, match="REFERENCE_NOT_IN_VALIDATED_REQUEST"):
        mod.generate_comfy_video(
            request=req,
            params={"refImage": requested},
            helpers=SimpleNamespace(),
            secrets={"comfyui_base_url": "http://comfy"},
        )
    assert called is False
