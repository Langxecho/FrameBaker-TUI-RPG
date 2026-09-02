from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
from pathlib import Path

import pytest

PYTHON_DIR = Path(__file__).resolve().parents[1]
RUNNER = PYTHON_DIR / "media_plugin_runner.py"
RUNTIME_ROOT = PYTHON_DIR / "aigc_bench_plugin_runtime"


def _write_plugin(
    root: Path,
    *,
    plugin_id: str,
    kind: str,
    capabilities: list[str],
    provider_src: str,
    secrets: dict | None = None,
    constraints: dict | None = None,
    params_schema: dict | None = None,
) -> Path:
    plugin_dir = root / plugin_id
    plugin_dir.mkdir(parents=True)
    manifest = {
        "plugin_id": plugin_id,
        "name": plugin_id,
        "version": "1.0.0",
        "kind": kind,
        "capabilities": capabilities,
        "entry": {"type": "python", "module": "provider", "function": "generate"},
        "secrets": secrets or {},
        "params_schema": params_schema or {},
        "constraints": constraints or {},
    }
    (plugin_dir / "plugin.json").write_text(json.dumps(manifest), encoding="utf-8")
    (plugin_dir / "provider.py").write_text(provider_src, encoding="utf-8")
    return plugin_dir


def _plugin_kind_root(tmp_path: Path, kind: str) -> Path:
    root = tmp_path / "media-plugins" / kind
    root.mkdir(parents=True, exist_ok=True)
    return root


def _run_runner(request: dict, tmp_path: Path, *, plugin_storage_root: Path | None = None) -> dict:
    request_path = tmp_path / "request.json"
    result_path = tmp_path / "result.json"
    request_path.write_text(json.dumps(request), encoding="utf-8")
    env = os.environ.copy()
    env["FRAMEBAKER_MEDIA_PLUGIN_ROOT"] = str((plugin_storage_root or (tmp_path / "media-plugins")).resolve())
    completed = subprocess.run(
        [
            sys.executable,
            str(RUNNER),
            "--request",
            str(request_path),
            "--result",
            str(result_path),
        ],
        cwd=str(tmp_path),
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    assert result_path.is_file(), f"stdout={completed.stdout!r} stderr={completed.stderr!r}"
    return json.loads(result_path.read_text(encoding="utf-8"))


def test_image_url_result(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "image_api")
    _write_plugin(
        plugins,
        plugin_id="img_ok",
        kind="image_api",
        capabilities=["t2i"],
        provider_src=(
            "def generate(*, request, secrets, params, helpers):\n"
            "    return {'url': 'https://example.invalid/ok.png', 'metadata': {'n': params.get('n')}}\n"
        ),
        params_schema={"n": {"type": "integer", "default": 3}},
        constraints={"supports_text2image": True},
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "image_api",
            "pluginId": "img_ok",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "pixel cat",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": None,
            "params": {},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert payload["ok"] is True
    assert payload["result"]["url"] == "https://example.invalid/ok.png"
    assert payload["result"]["metadata"]["n"] == 3


def test_video_local_output_validation(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "video_api")
    _write_plugin(
        plugins,
        plugin_id="vid_ok",
        kind="video_api",
        capabilities=["t2v"],
        provider_src=(
            "from pathlib import Path\n"
            "def generate(*, request, secrets, params, helpers):\n"
            "    path = helpers.output_path('result.mp4')\n"
            "    Path(path).write_bytes(b'video-bytes')\n"
            "    return {'video_path': path}\n"
        ),
        constraints={
            "supports_text2video": True,
            "min_duration_seconds": 1,
            "max_duration_seconds": 8,
            "output_extensions": [".mp4"],
        },
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "video_api",
            "pluginId": "vid_ok",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "walk cycle",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": 4,
            "params": {},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert payload["ok"] is True
    assert Path(payload["result"]["video_path"]).is_file()
    assert Path(payload["result"]["video_path"]).stat().st_size > 0


def test_audio_output_validation(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "audio_api")
    _write_plugin(
        plugins,
        plugin_id="aud_ok",
        kind="audio_api",
        capabilities=["t2a"],
        provider_src=(
            "from pathlib import Path\n"
            "def generate(*, request, secrets, params, helpers):\n"
            "    path = helpers.output_path('result.mp3')\n"
            "    Path(path).write_bytes(b'audio-bytes')\n"
            "    return {'audio_path': path}\n"
        ),
        constraints={"supports_text2audio": True, "output_extensions": [".mp3"]},
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "audio_api",
            "pluginId": "aud_ok",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "soft pad",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": 6,
            "params": {},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert payload["ok"] is True
    assert Path(payload["result"]["audio_path"]).is_file()


def test_audio_t2a_rejects_duration_outside_constraints(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "audio_api")
    _write_plugin(
        plugins,
        plugin_id="aud_duration_t2a",
        kind="audio_api",
        capabilities=["t2a"],
        provider_src=(
            "def generate(*, request, secrets, params, helpers):\n"
            "    raise AssertionError('should not run when duration is invalid')\n"
        ),
        constraints={
            "supports_text2audio": True,
            "min_duration_seconds": 2,
            "max_duration_seconds": 8,
            "output_extensions": [".mp3"],
        },
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "audio_api",
            "pluginId": "aud_duration_t2a",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "soft pad",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": 30,
            "params": {},
            "outputDir": str(out),
            "mode": "t2a",
        },
        tmp_path,
    )
    assert payload["ok"] is False
    assert payload["code"] in ("PLUGIN_RUNTIME_ERROR", "CONFIGURATION_ERROR")
    assert "duration_seconds must be <=" in payload["error"]


def test_audio_i2a_rejects_duration_outside_constraints(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "audio_api")
    _write_plugin(
        plugins,
        plugin_id="aud_duration_i2a",
        kind="audio_api",
        capabilities=["i2a"],
        provider_src=(
            "def generate(*, request, secrets, params, helpers):\n"
            "    raise AssertionError('should not run when duration is invalid')\n"
        ),
        constraints={
            "supports_image2audio": True,
            "min_duration_seconds": 2,
            "max_duration_seconds": 8,
            "max_reference_images": 1,
            "output_extensions": [".mp3"],
        },
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "audio_api",
            "pluginId": "aud_duration_i2a",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "soft pad",
            "imageUrls": ["https://example.invalid/ref.png"],
            "audioUrls": [],
            "durationSeconds": 30,
            "params": {},
            "outputDir": str(out),
            "mode": "i2a",
        },
        tmp_path,
    )
    assert payload["ok"] is False
    assert payload["code"] in ("PLUGIN_RUNTIME_ERROR", "CONFIGURATION_ERROR")
    assert "duration_seconds must be <=" in payload["error"]


def test_audio_params_merge_overrides(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "audio_api")
    _write_plugin(
        plugins,
        plugin_id="aud_params",
        kind="audio_api",
        capabilities=["t2a"],
        provider_src=(
            "from pathlib import Path\n"
            "def generate(*, request, secrets, params, helpers):\n"
            "    path = helpers.output_path('result.mp3')\n"
            "    Path(path).write_bytes(b'audio-bytes')\n"
            "    return {'audio_path': path, 'metadata': dict(params)}\n"
        ),
        params_schema={
            "voice": {"type": "string", "default": "soft"},
            "gain": {"type": "number", "default": 0.5},
        },
        constraints={"supports_text2audio": True, "output_extensions": [".mp3"]},
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "audio_api",
            "pluginId": "aud_params",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "soft pad",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": 6,
            "params": {"voice": "bright", "extra": "keep"},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert payload["ok"] is True
    meta = payload["result"]["metadata"]
    assert meta["voice"] == "bright"
    assert meta["gain"] == 0.5
    assert meta["extra"] == "keep"
    assert meta["duration_seconds"] == 6


def test_missing_required_secret(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "image_api")
    _write_plugin(
        plugins,
        plugin_id="img_secret",
        kind="image_api",
        capabilities=["t2i"],
        provider_src="def generate(*, request, secrets, params, helpers):\n    return {'url': 'https://x'}\n",
        secrets={"api_key": {"label": "Key", "required": True, "secret": True, "value": ""}},
        constraints={"supports_text2image": True},
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "image_api",
            "pluginId": "img_secret",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "x",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": None,
            "params": {},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert payload["ok"] is False
    assert payload["code"] == "PLUGIN_RUNTIME_ERROR"
    assert "missing required secret" in payload["error"]


def test_unsupported_mode(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "video_api")
    _write_plugin(
        plugins,
        plugin_id="vid_mode",
        kind="video_api",
        capabilities=["t2v"],
        provider_src=(
            "def generate(*, request, secrets, params, helpers):\n"
            "    raise AssertionError('should not run')\n"
        ),
        constraints={"supports_text2video": True, "supports_image2video": False, "output_extensions": [".mp4"]},
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "video_api",
            "pluginId": "vid_mode",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "x",
            "imageUrls": ["https://example.invalid/a.png"],
            "audioUrls": [],
            "durationSeconds": 4,
            "params": {},
            "outputDir": str(out),
            "mode": "i2v",
        },
        tmp_path,
    )
    assert payload["ok"] is False
    assert payload["code"] == "PLUGIN_RUNTIME_ERROR"
    assert "does not support i2v" in payload["error"] or "unsupported" in payload["error"]


def test_image_unsupported_mode_and_multi_ref(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "image_api")
    _write_plugin(
        plugins,
        plugin_id="img_mode",
        kind="image_api",
        capabilities=["t2i"],
        provider_src=(
            "def generate(*, request, secrets, params, helpers):\n"
            "    raise AssertionError('should not run')\n"
        ),
        constraints={
            "supports_text2image": True,
            "supports_image2image": False,
            "max_reference_images": 1,
        },
    )
    out = tmp_path / "out"
    out.mkdir()
    i2i = _run_runner(
        {
            "kind": "image_api",
            "pluginId": "img_mode",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "x",
            "imageUrls": ["https://example.invalid/a.png"],
            "audioUrls": [],
            "durationSeconds": None,
            "params": {},
            "outputDir": str(out),
            "mode": "i2i",
        },
        tmp_path,
    )
    assert i2i["ok"] is False
    assert "does not support i2i" in i2i["error"]

    multi = _run_runner(
        {
            "kind": "image_api",
            "pluginId": "img_mode",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "x",
            "imageUrls": [
                "https://example.invalid/a.png",
                "https://example.invalid/b.png",
            ],
            "audioUrls": [],
            "durationSeconds": None,
            "params": {},
            "outputDir": str(out),
            "mode": "multi_ref",
        },
        tmp_path,
    )
    assert multi["ok"] is False
    assert "does not support multi_ref" in multi["error"] or "at most" in multi["error"]


def test_plugin_root_must_be_absolute_and_contained(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "image_api")
    _write_plugin(
        plugins,
        plugin_id="img_root",
        kind="image_api",
        capabilities=["t2i"],
        provider_src="def generate(*, request, secrets, params, helpers):\n    return {'url': 'https://x'}\n",
        constraints={"supports_text2image": True},
    )
    out = tmp_path / "out"
    out.mkdir()
    relative = _run_runner(
        {
            "kind": "image_api",
            "pluginId": "img_root",
            "pluginRoot": "media-plugins/image_api",
            "prompt": "x",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": None,
            "params": {},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert relative["ok"] is False
    assert "absolute" in relative["error"]

    outside = tmp_path / "outside" / "image_api"
    outside.mkdir(parents=True)
    _write_plugin(
        outside,
        plugin_id="img_escape",
        kind="image_api",
        capabilities=["t2i"],
        provider_src="def generate(*, request, secrets, params, helpers):\n    return {'url': 'https://x'}\n",
        constraints={"supports_text2image": True},
    )
    escaped = _run_runner(
        {
            "kind": "image_api",
            "pluginId": "img_escape",
            "pluginRoot": str(outside.resolve()),
            "prompt": "x",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": None,
            "params": {},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert escaped["ok"] is False
    assert "contained" in escaped["error"]


def test_malformed_plugin_result(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "image_api")
    _write_plugin(
        plugins,
        plugin_id="img_bad",
        kind="image_api",
        capabilities=["t2i"],
        provider_src="def generate(*, request, secrets, params, helpers):\n    return 'not-a-dict'\n",
        constraints={"supports_text2image": True},
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "image_api",
            "pluginId": "img_bad",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "x",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": None,
            "params": {},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert payload["ok"] is False
    assert payload["code"] == "PLUGIN_RUNTIME_ERROR"
    assert "traceback" not in payload["error"].lower()
    assert "dict" in payload["error"]


def test_runtime_package_layout_exists() -> None:
    assert RUNTIME_ROOT.is_dir()
    assert (RUNTIME_ROOT / "capabilities.py").is_file()
    assert (RUNTIME_ROOT / "errors.py").is_file()
    assert (RUNTIME_ROOT / "image_api_plugins" / "runtime.py").is_file()
    assert (RUNTIME_ROOT / "video_api_plugins" / "runtime.py").is_file()
    assert (RUNTIME_ROOT / "audio_api_plugins" / "runtime.py").is_file()
    assert (RUNTIME_ROOT / "safe_download.py").is_file()


def test_image_local_image_path_and_paths(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "image_api")
    _write_plugin(
        plugins,
        plugin_id="img_local",
        kind="image_api",
        capabilities=["t2i"],
        provider_src=(
            "from pathlib import Path\n"
            "def generate(*, request, secrets, params, helpers):\n"
            "    p = Path(helpers.output_path('local.png'))\n"
            "    p.write_bytes(b'png-bytes')\n"
            "    return {'image_path': str(p), 'metadata': {'via': 'path'}}\n"
        ),
        constraints={"supports_text2image": True},
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "image_api",
            "pluginId": "img_local",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "pixel",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": None,
            "params": {},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert payload["ok"] is True
    assert Path(payload["result"]["image_path"]).is_file()
    assert payload["result"]["image_paths"][0] == payload["result"]["image_path"]


def test_video_rejects_outside_output_path_copy(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "video_api")
    outside = tmp_path / "secret.mp4"
    outside.write_bytes(b"ftyp-secret")
    _write_plugin(
        plugins,
        plugin_id="vid_escape",
        kind="video_api",
        capabilities=["t2v"],
        provider_src=(
            f"def generate(*, request, secrets, params, helpers):\n"
            f"    return {{'video_path': r'{outside}'}}\n"
        ),
        constraints={
            "supports_text2video": True,
            "output_extensions": [".mp4"],
            "min_duration_seconds": 1,
            "max_duration_seconds": 8,
        },
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "video_api",
            "pluginId": "vid_escape",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "x",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": 2.5,
            "params": {},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert payload["ok"] is False
    assert "PLUGIN_OUTPUT_INVALID" in payload["error"] or "escapes" in payload["error"]


def test_fractional_video_duration_preserved(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "video_api")
    _write_plugin(
        plugins,
        plugin_id="vid_frac",
        kind="video_api",
        capabilities=["t2v"],
        provider_src=(
            "from pathlib import Path\n"
            "def generate(*, request, secrets, params, helpers):\n"
            "    path = helpers.output_path('result.mp4')\n"
            "    Path(path).write_bytes(b'video-bytes')\n"
            "    return {'video_path': path, 'metadata': {'seen': request.duration_seconds}}\n"
        ),
        constraints={
            "supports_text2video": True,
            "min_duration_seconds": 0.5,
            "max_duration_seconds": 8.5,
            "output_extensions": [".mp4"],
        },
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "video_api",
            "pluginId": "vid_frac",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "walk",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": 2.75,
            "params": {},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert payload["ok"] is True
    assert payload["result"]["original_duration_s"] == 2.75
    assert payload["result"]["requested_duration_s"] == 2.75
    assert payload["result"]["metadata"]["seen"] == 2.75


def test_fractional_audio_duration_preserved(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "audio_api")
    _write_plugin(
        plugins,
        plugin_id="aud_frac",
        kind="audio_api",
        capabilities=["t2a"],
        provider_src=(
            "from pathlib import Path\n"
            "def generate(*, request, secrets, params, helpers):\n"
            "    path = helpers.output_path('result.mp3')\n"
            "    Path(path).write_bytes(b'audio-bytes')\n"
            "    return {'audio_path': path, 'metadata': dict(params)}\n"
        ),
        constraints={"supports_text2audio": True, "output_extensions": [".mp3"]},
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "audio_api",
            "pluginId": "aud_frac",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "pad",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": 1.5,
            "params": {},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert payload["ok"] is True
    assert payload["result"]["metadata"]["duration_seconds"] == 1.5


def test_safe_download_rejects_file_and_loopback() -> None:
    if str(PYTHON_DIR) not in sys.path:
        sys.path.insert(0, str(PYTHON_DIR))
    from aigc_bench_plugin_runtime.safe_download import assert_safe_download_url

    try:
        assert_safe_download_url("file:///tmp/secret.png")
        raised = False
    except RuntimeError as exc:
        raised = True
        assert "PLUGIN_DOWNLOAD_REJECTED" in str(exc)
    assert raised

    try:
        assert_safe_download_url("http://127.0.0.1/x")
        raised = False
    except RuntimeError as exc:
        raised = True
        assert "PLUGIN_DOWNLOAD_REJECTED" in str(exc)
    assert raised


def test_safe_download_rejects_trailing_dot_special_hosts() -> None:
    if str(PYTHON_DIR) not in sys.path:
        sys.path.insert(0, str(PYTHON_DIR))
    from aigc_bench_plugin_runtime.safe_download import assert_safe_download_url

    for url in (
        "http://localhost./secret",
        "http://foo.localhost./secret",
        "http://LOCALHOST./secret",
        "http://svc.internal./x",
        "http://printer.local./x",
    ):
        with pytest.raises(RuntimeError, match="PLUGIN_DOWNLOAD_REJECTED"):
            assert_safe_download_url(url)


def test_safe_download_fail_closed_on_dns_resolution_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    if str(PYTHON_DIR) not in sys.path:
        sys.path.insert(0, str(PYTHON_DIR))
    from aigc_bench_plugin_runtime import safe_download

    def boom(host, *args, **kwargs):
        raise OSError("mock DNS failure")

    monkeypatch.setattr(safe_download.socket, "getaddrinfo", boom)
    with pytest.raises(RuntimeError, match="PLUGIN_DOWNLOAD_REJECTED"):
        safe_download.assert_safe_download_url("https://nowhere.invalid/x.bin")


def test_safe_download_rejects_dns_to_loopback_hostname(monkeypatch: pytest.MonkeyPatch) -> None:
    if str(PYTHON_DIR) not in sys.path:
        sys.path.insert(0, str(PYTHON_DIR))
    from aigc_bench_plugin_runtime import safe_download

    def fake_getaddrinfo(host, *args, **kwargs):
        assert host == "localtest.me"
        return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("127.0.0.1", 0))]

    monkeypatch.setattr(safe_download.socket, "getaddrinfo", fake_getaddrinfo)
    with pytest.raises(RuntimeError, match="PLUGIN_DOWNLOAD_REJECTED"):
        safe_download.assert_safe_download_url("https://localtest.me/secret.bin")


def test_safe_download_allows_public_hostname(monkeypatch: pytest.MonkeyPatch) -> None:
    if str(PYTHON_DIR) not in sys.path:
        sys.path.insert(0, str(PYTHON_DIR))
    from aigc_bench_plugin_runtime import safe_download

    def fake_getaddrinfo(host, *args, **kwargs):
        assert host in {"cdn.example", "example.com"}
        # Avoid TEST-NET (203.0.113.0/24) — Python marks those is_private=True.
        return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("1.1.1.1", 0))]

    monkeypatch.setattr(safe_download.socket, "getaddrinfo", fake_getaddrinfo)
    safe_download.assert_safe_download_url("https://cdn.example/ok.bin")
    safe_download.assert_safe_download_url("https://example.com./ok.bin")


def test_safe_download_rejects_redirect_to_loopback(monkeypatch: pytest.MonkeyPatch) -> None:
    if str(PYTHON_DIR) not in sys.path:
        sys.path.insert(0, str(PYTHON_DIR))
    from aigc_bench_plugin_runtime import safe_download

    fetched: list[str] = []

    class _Resp:
        def __init__(self, status: int, headers: dict[str, str], body: bytes = b"") -> None:
            self.status_code = status
            self.headers = headers
            self._body = body

        def raise_for_status(self) -> None:
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}")

        def iter_content(self, chunk_size: int = 0):
            if self._body:
                yield self._body

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_getaddrinfo(host, *args, **kwargs):
        if host == "cdn.example":
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("1.1.1.1", 0))]
        raise OSError(f"mock DNS failure for {host}")

    def fake_get(url: str, *args, **kwargs):
        assert kwargs.get("allow_redirects") is False
        fetched.append(url)
        if url == "https://1.1.1.1/start.bin":
            return _Resp(302, {"Location": "http://127.0.0.1/secret.bin"})
        return _Resp(200, {}, b"should-not-fetch-private")

    monkeypatch.setattr(safe_download.socket, "getaddrinfo", fake_getaddrinfo)
    monkeypatch.setattr(safe_download, "_http_get", fake_get)

    with pytest.raises(RuntimeError, match="PLUGIN_DOWNLOAD_REJECTED"):
        safe_download.download_bytes("https://cdn.example/start.bin")
    assert fetched == ["https://1.1.1.1/start.bin"]
    assert not any("127.0.0.1" in u for u in fetched)


def test_safe_download_allows_validated_public_redirect(monkeypatch: pytest.MonkeyPatch) -> None:
    if str(PYTHON_DIR) not in sys.path:
        sys.path.insert(0, str(PYTHON_DIR))
    from aigc_bench_plugin_runtime import safe_download

    fetched: list[dict[str, object]] = []

    class _Resp:
        def __init__(self, status: int, headers: dict[str, str], body: bytes = b"") -> None:
            self.status_code = status
            self.headers = headers
            self._body = body

        def raise_for_status(self) -> None:
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}")

        def iter_content(self, chunk_size: int = 0):
            if self._body:
                yield self._body

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_getaddrinfo(host, *args, **kwargs):
        if host == "cdn.example":
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("1.1.1.1", 0))]
        raise OSError(f"mock DNS failure for {host}")

    def fake_get(url: str, *args, **kwargs):
        assert kwargs.get("allow_redirects") is False
        headers = kwargs.get("headers") or {}
        fetched.append({"url": url, "host": headers.get("Host")})
        if url == "https://1.1.1.1/start.bin":
            return _Resp(302, {"Location": "https://cdn.example/final.bin"})
        if url == "https://1.1.1.1/final.bin":
            return _Resp(200, {"Content-Length": "18"}, b"public-redirect-ok")
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(safe_download.socket, "getaddrinfo", fake_getaddrinfo)
    monkeypatch.setattr(safe_download, "_http_get", fake_get)

    data = safe_download.download_bytes("https://cdn.example/start.bin")
    assert data == b"public-redirect-ok"
    assert fetched == [
        {"url": "https://1.1.1.1/start.bin", "host": "cdn.example"},
        {"url": "https://1.1.1.1/final.bin", "host": "cdn.example"},
    ]


def test_safe_download_rejects_ipv4_mapped_cgnat_and_private() -> None:
    if str(PYTHON_DIR) not in sys.path:
        sys.path.insert(0, str(PYTHON_DIR))
    from aigc_bench_plugin_runtime.safe_download import assert_safe_download_url

    for url in (
        "http://[::ffff:100.64.0.1]/cgnat",
        "http://[::ffff:127.0.0.1]/loop",
        "http://[::ffff:7f00:1]/loop-hex",
        "http://[::ffff:169.254.169.254]/meta",
        "http://[::ffff:10.0.0.1]/priv",
        "http://[0:0:0:0:0:ffff:192.168.1.20]/priv",
    ):
        with pytest.raises(RuntimeError, match="PLUGIN_DOWNLOAD_REJECTED"):
            assert_safe_download_url(url)


def test_safe_download_pins_resolved_ip_and_preserves_host_sni(monkeypatch: pytest.MonkeyPatch) -> None:
    if str(PYTHON_DIR) not in sys.path:
        sys.path.insert(0, str(PYTHON_DIR))
    from aigc_bench_plugin_runtime import safe_download

    fetched: list[dict[str, object]] = []
    dns_calls: list[str] = []

    class _Resp:
        def __init__(self, body: bytes) -> None:
            self.status_code = 200
            self.headers = {"Content-Length": str(len(body))}
            self._body = body

        def raise_for_status(self) -> None:
            return None

        def iter_content(self, chunk_size: int = 0):
            if self._body:
                yield self._body

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_getaddrinfo(host, *args, **kwargs):
        dns_calls.append(host)
        if host == "cdn.example":
            # First lookup is public; a rebinding second lookup must not be used for connect.
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("1.1.1.1", 0))]
        raise OSError(f"mock DNS failure for {host}")

    def fake_get(url: str, *args, **kwargs):
        assert kwargs.get("allow_redirects") is False
        headers = kwargs.get("headers") or {}
        fetched.append(
            {
                "url": url,
                "host": headers.get("Host"),
                "server_hostname": kwargs.get("server_hostname"),
            }
        )
        assert url == "https://1.1.1.1/ok.bin"
        assert headers.get("Host") == "cdn.example"
        return _Resp(b"pinned-ok")

    monkeypatch.setattr(safe_download.socket, "getaddrinfo", fake_getaddrinfo)
    monkeypatch.setattr(safe_download, "_http_get", fake_get)

    data = safe_download.download_bytes("https://cdn.example/ok.bin")
    assert data == b"pinned-ok"
    assert dns_calls == ["cdn.example"]
    assert fetched == [{"url": "https://1.1.1.1/ok.bin", "host": "cdn.example", "server_hostname": "cdn.example"}]


def test_safe_download_rejects_redirect_to_mapped_cgnat(monkeypatch: pytest.MonkeyPatch) -> None:
    if str(PYTHON_DIR) not in sys.path:
        sys.path.insert(0, str(PYTHON_DIR))
    from aigc_bench_plugin_runtime import safe_download

    fetched: list[str] = []

    class _Resp:
        def __init__(self, status: int, headers: dict[str, str], body: bytes = b"") -> None:
            self.status_code = status
            self.headers = headers
            self._body = body

        def raise_for_status(self) -> None:
            if self.status_code >= 400:
                raise RuntimeError(f"HTTP {self.status_code}")

        def iter_content(self, chunk_size: int = 0):
            if self._body:
                yield self._body

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    def fake_getaddrinfo(host, *args, **kwargs):
        if host == "cdn.example":
            return [(socket.AF_INET, socket.SOCK_STREAM, 0, "", ("1.1.1.1", 0))]
        raise OSError(f"mock DNS failure for {host}")

    def fake_get(url: str, *args, **kwargs):
        assert kwargs.get("allow_redirects") is False
        fetched.append(url)
        if url == "https://1.1.1.1/start.bin":
            return _Resp(302, {"Location": "http://[::ffff:100.64.0.1]/secret.bin"})
        return _Resp(200, {}, b"should-not-fetch")

    monkeypatch.setattr(safe_download.socket, "getaddrinfo", fake_getaddrinfo)
    monkeypatch.setattr(safe_download, "_http_get", fake_get)

    with pytest.raises(RuntimeError, match="PLUGIN_DOWNLOAD_REJECTED"):
        safe_download.download_bytes("https://cdn.example/start.bin")
    assert fetched == ["https://1.1.1.1/start.bin"]
    assert not any("100.64" in u for u in fetched)


def test_video_url_result_is_deferred_to_bun(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "video_api")
    _write_plugin(
        plugins,
        plugin_id="vid_url",
        kind="video_api",
        capabilities=["t2v"],
        provider_src=(
            "def generate(*, request, secrets, params, helpers):\n"
            "    return {'url': 'https://cdn.example/result.mp4', 'metadata': {'n': 1}}\n"
        ),
        constraints={
            "supports_text2video": True,
            "min_duration_seconds": 1,
            "max_duration_seconds": 8,
            "output_extensions": [".mp4"],
        },
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "video_api",
            "pluginId": "vid_url",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "walk cycle",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": 4,
            "params": {},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert payload["ok"] is True
    assert payload["result"]["url"] == "https://cdn.example/result.mp4"
    assert "video_path" not in payload["result"] or not payload["result"].get("video_path")


def test_audio_url_result_is_deferred_to_bun(tmp_path: Path) -> None:
    plugins = _plugin_kind_root(tmp_path, "audio_api")
    _write_plugin(
        plugins,
        plugin_id="aud_url",
        kind="audio_api",
        capabilities=["t2a"],
        provider_src=(
            "def generate(*, request, secrets, params, helpers):\n"
            "    return {'url': 'https://cdn.example/result.wav', 'metadata': {'n': 1}}\n"
        ),
        constraints={"supports_text2audio": True, "output_extensions": [".wav", ".mp3"]},
    )
    out = tmp_path / "out"
    out.mkdir()
    payload = _run_runner(
        {
            "kind": "audio_api",
            "pluginId": "aud_url",
            "pluginRoot": str(plugins.resolve()),
            "prompt": "soft pad",
            "imageUrls": [],
            "audioUrls": [],
            "durationSeconds": 6,
            "params": {},
            "outputDir": str(out),
        },
        tmp_path,
    )
    assert payload["ok"] is True
    assert payload["result"]["url"] == "https://cdn.example/result.wav"
    assert "audio_path" not in payload["result"] or not payload["result"].get("audio_path")
