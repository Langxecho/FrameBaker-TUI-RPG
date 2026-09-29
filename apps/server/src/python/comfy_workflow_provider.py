"""Small, serial ComfyUI adapter for converted CFP workflows.

It uses only /upload/image, /prompt and /history/{id}; no workflow Python is
executed. Unknown prompt/history results fail closed and are returned as a
structured provider error so the outer job can persist its journal.
"""
from __future__ import annotations

import json
import mimetypes
import time
import urllib.request
import uuid
from pathlib import Path
from copy import deepcopy
from urllib.parse import quote, urlsplit
from urllib.request import url2pathname
import base64
import os


def _request(base: str, path: str, *, data: bytes | None = None, method: str = "GET", headers: dict[str, str] | None = None):
    req = urllib.request.Request(base.rstrip("/") + path, data=data, method=method, headers=headers or {})
    with urllib.request.urlopen(req, timeout=30) as response:  # noqa: S310 - endpoint is configured explicitly
        return response.read()


def _upload_bytes(base: str, name: str, raw: bytes) -> str:
    boundary = "----framebaker-" + uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{name}\"\r\nContent-Type: {mimetypes.guess_type(name)[0] or 'application/octet-stream'}\r\n\r\n").encode() + raw + f"\r\n--{boundary}--\r\n".encode()
    result = json.loads(_request(base, "/upload/image", data=body, method="POST", headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}))
    name = result.get("name")
    if not isinstance(name, str) or not name.strip():
        raise RuntimeError("COMFY_UPLOAD_UNKNOWN_RESULT")
    return name


def _local_path_from_file_url(ref: str) -> Path:
    try:
        parsed = urlsplit(ref)
    except ValueError as exc:
        raise RuntimeError("REFERENCE_URI_REQUIRED") from exc
    if parsed.scheme.lower() != "file" or parsed.query or parsed.fragment:
        raise RuntimeError("REFERENCE_URI_REQUIRED")
    if parsed.netloc and parsed.netloc.lower() != "localhost":
        raise RuntimeError("REFERENCE_REMOTE_AUTHORITY_FORBIDDEN")
    local_text = url2pathname(parsed.path)
    if not local_text or local_text.startswith(("//", "\\\\")):
        raise RuntimeError("REFERENCE_REMOTE_AUTHORITY_FORBIDDEN")
    return Path(local_text).resolve()


def _resolve_workflow_path(workflow_path: str | Path | None) -> Path:
    candidate = Path(workflow_path) if workflow_path is not None else Path(__file__).resolve().with_name("workflow.json")
    if not candidate.is_absolute() or candidate.name != "workflow.json":
        raise RuntimeError("WORKFLOW_TEMPLATE_REQUIRED")
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as exc:
        raise RuntimeError("WORKFLOW_TEMPLATE_REQUIRED") from exc
    if not resolved.is_file():
        raise RuntimeError("WORKFLOW_TEMPLATE_REQUIRED")
    return resolved


def generate_comfy_video(*, request, params, helpers, secrets=None, workflow_path: str | Path | None = None):
    base = str((secrets or {}).get("comfyui_base_url") or params.get("comfyuiEndpoint") or "").strip()
    if not base:
        raise RuntimeError("COMFY_ENDPOINT_LOCK_REQUIRED")
    journal = Path(request.output_dir) / "comfy-journal.json"
    run_key = Path(request.output_dir).name
    client_id = str(params.get("clientId") or f"framebaker-{run_key}")
    request_id = str(params.get("requestId") or run_key)
    def write_journal(status, **extra):
        tmp = journal.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({"clientId": client_id, "requestId": request_id, "status": status, **extra}), encoding="utf-8")
        os.replace(tmp, journal)
    def completed_result(known_id, video):
        query = "filename=" + quote(video["filename"]) + "&type=" + quote(str(video.get("type", "output"))) + "&subfolder=" + quote(str(video.get("subfolder", "")))
        return {"url": base.rstrip("/") + "/view?" + query, "metadata": {"clientId": client_id, "requestId": request_id, "promptId": known_id}}
    known_id = None
    if journal.is_file():
        try:
            previous = json.loads(journal.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise RuntimeError("COMFY_JOURNAL_INVALID")
        status = previous.get("status") if isinstance(previous, dict) else None
        if status == "completed":
            video = previous.get("output")
            if not isinstance(video, dict) or not isinstance(video.get("filename"), str):
                raise RuntimeError("COMFY_JOURNAL_COMPLETED_OUTPUT_INVALID")
            return completed_result(previous.get("promptId"), video)
        if status == "submitted" and isinstance(previous.get("promptId"), str) and previous["promptId"]:
            known_id = previous["promptId"]
            client_id = str(previous.get("clientId") or client_id)
            request_id = str(previous.get("requestId") or request_id)
        elif status in {"submitting", "unknown_submission", "unknown_output"}:
            raise RuntimeError("COMFY_SUBMISSION_STATE_UNKNOWN_RECONCILE_ONLY")
        else:
            raise RuntimeError("COMFY_JOURNAL_STATE_UNKNOWN")
    # 已知 promptId 的恢复路径只查 history，绝不再次上传引用或 POST /prompt。
    if known_id is None:
        requested_ref = str(params.get("refImage") or "").strip()
        allowed_refs = {str(item).strip() for item in request.image_urls if str(item).strip()}
        if requested_ref and requested_ref not in allowed_refs:
            raise RuntimeError("REFERENCE_NOT_IN_VALIDATED_REQUEST")
        ref = requested_ref or (request.image_urls[0] if request.image_urls else "")
        if not ref:
            raise RuntimeError("PRIMARY_IMAGE_REQUIRED")
        if ref.startswith("data:"):
            image_name = _upload_bytes(base, "reference.png", base64.b64decode(ref.split(",", 1)[1]))
        elif ref.lower().startswith("file:"):
            local = _local_path_from_file_url(ref)
            if not local.is_file():
                raise RuntimeError("REFERENCE_FILE_NOT_FOUND")
            image_name = _upload_bytes(base, local.name, local.read_bytes())
        elif ref.startswith(("http://", "https://")):
            image_name = _upload_bytes(base, "reference.png", helpers.download(ref))
        else:
            raise RuntimeError("REFERENCE_URI_REQUIRED")
        resolved_workflow_path = _resolve_workflow_path(workflow_path)
        workflow = json.loads(resolved_workflow_path.read_text(encoding="utf-8"))
        if not isinstance(workflow, dict):
            raise RuntimeError("WORKFLOW_TEMPLATE_INVALID")
        workflow = deepcopy(workflow)
        prompt_text = str(request.prompt or "")
        if isinstance(workflow.get("38"), dict):
            workflow["38"].setdefault("inputs", {})["prompt"] = prompt_text
        if isinstance(workflow.get("9"), dict):
            workflow["9"].setdefault("inputs", {})["noise_seed"] = int(params.get("seed", 0))
        if isinstance(workflow.get("7"), dict):
            workflow["7"].setdefault("inputs", {})["steps"] = int(params.get("steps", 4))
        if isinstance(workflow.get("14"), dict):
            workflow["14"].setdefault("inputs", {})["value"] = float(params.get("durationSeconds") or request.duration_seconds or 4.0)
        for node_id in ("40", "49", "50", "51", "52"):
            if isinstance(workflow.get(node_id), dict):
                workflow[node_id].setdefault("inputs", {})["image"] = image_name
        write_journal("submitting")
        payload = json.dumps({"prompt": workflow, "client_id": client_id}).encode()
        submitted = json.loads(_request(base, "/prompt", data=payload, method="POST", headers={"Content-Type": "application/json"}))
        known_id = submitted.get("prompt_id")
        if not isinstance(known_id, str) or not known_id:
            write_journal("unknown_submission")
            raise RuntimeError("COMFY_PROMPT_UNKNOWN_RESULT")
        write_journal("submitted", promptId=known_id)
    # Polling is bounded and serial; the outer job should journal client/request/prompt IDs.
    deadline = time.monotonic() + int(getattr(request, "timeout_s", 600))
    while time.monotonic() < deadline:
        history = json.loads(_request(base, f"/history/{known_id}"))
        if not isinstance(history, dict) or known_id not in history:
            time.sleep(1)
            continue
        entry = history[known_id]
        outputs = entry.get("outputs") if isinstance(entry, dict) else None
        if not isinstance(outputs, dict):
            time.sleep(1)
            continue
        node = outputs.get("12")
        videos = node.get("gifs") if isinstance(node, dict) else None
        video = videos[0] if isinstance(videos, list) and videos else None
        if not isinstance(video, dict) or not isinstance(video.get("filename"), str):
            write_journal("unknown_output", promptId=known_id)
            raise RuntimeError("COMFY_HISTORY_COMPLETED_WITHOUT_DECLARED_VIDEO")
        write_journal("completed", promptId=known_id, output=video)
        return completed_result(known_id, video)
    raise RuntimeError("COMFY_HISTORY_TIMEOUT_UNKNOWN")
