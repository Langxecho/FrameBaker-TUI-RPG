from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse, urlunparse

import requests
from requests.adapters import HTTPAdapter

DEFAULT_MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024
MAX_REDIRECTS = 5
_REDIRECT_STATUSES = {301, 302, 303, 307, 308}


def _normalize_hostname(hostname: str) -> str:
    host = (hostname or "").strip().lower().strip("[]")
    while host.endswith("."):
        host = host[:-1]
    return host


def _is_cgnat(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv4Address):
        # 100.64.0.0/10
        return ip in ipaddress.ip_network("100.64.0.0/10")
    return False


def _is_unsafe_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        return _is_unsafe_ip(mapped)
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
        or _is_cgnat(ip)
    )


def _is_unsafe_hostname(hostname: str) -> bool:
    host = _normalize_hostname(hostname)
    if not host:
        return True
    if host in {"localhost", "0.0.0.0", "::", "::1"}:
        return True
    if host.endswith(".localhost") or host.endswith(".local") or host.endswith(".internal"):
        return True
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return _is_unsafe_ip(ip)


def _reject(message: str) -> None:
    raise RuntimeError(f"PLUGIN_DOWNLOAD_REJECTED: {message}")


def assert_safe_download_url(url: str) -> None:
    resolve_and_assert_safe_download_url(url)


@dataclass(frozen=True)
class ResolvedSafeDownload:
    logical_url: str
    connect_url: str
    request_host: str
    server_name: str
    selected_address: str


def _select_safe_address(host: str) -> str:
    try:
        infos = socket.getaddrinfo(host, None)
    except OSError as exc:
        raise RuntimeError("PLUGIN_DOWNLOAD_REJECTED: DNS resolution failed") from exc
    if not infos:
        _reject("DNS resolution failed")
    saw_addr = False
    selected: str | None = None
    for info in infos:
        raw = info[4][0]
        try:
            addr = ipaddress.ip_address(raw)
        except ValueError:
            continue
        saw_addr = True
        if _is_unsafe_ip(addr):
            _reject("refusing loopback/link-local/private download target")
        if selected is None:
            selected = str(addr)
    if not saw_addr or selected is None:
        _reject("DNS resolution failed")
    return selected


def resolve_and_assert_safe_download_url(url: str) -> ResolvedSafeDownload:
    text = str(url or "").strip()
    parsed = urlparse(text)
    if parsed.scheme not in {"http", "https"}:
        _reject(f"unsupported URL scheme {parsed.scheme!r}")
    host = _normalize_hostname(parsed.hostname or "")
    if not host:
        _reject("refusing loopback/link-local/private download target")
    if _is_unsafe_hostname(host):
        _reject("refusing loopback/link-local/private download target")

    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        selected = _select_safe_address(host)
    else:
        if _is_unsafe_ip(literal):
            _reject("refusing loopback/link-local/private download target")
        selected = str(literal)

    connect_host = selected
    try:
        selected_ip = ipaddress.ip_address(selected)
    except ValueError:
        selected_ip = None
    if isinstance(selected_ip, ipaddress.IPv6Address):
        connect_host = f"[{selected}]"

    connect_netloc = connect_host
    if parsed.port is not None:
        connect_netloc = f"{connect_host}:{parsed.port}"

    connect_url = urlunparse(
        (parsed.scheme, connect_netloc, parsed.path or "", parsed.params, parsed.query, parsed.fragment)
    )
    request_host = parsed.netloc or host
    return ResolvedSafeDownload(
        logical_url=text,
        connect_url=connect_url,
        request_host=request_host,
        server_name=host,
        selected_address=selected,
    )


class _HostnameTLSAdapter(HTTPAdapter):
    """Pin TLS SNI / cert hostname to the logical host while connecting to a validated IP."""

    def __init__(self, server_hostname: str, *args: Any, **kwargs: Any) -> None:
        self._server_hostname = server_hostname
        super().__init__(*args, **kwargs)

    def init_poolmanager(self, connections: int, maxsize: int, block: bool = False, **pool_kwargs: Any):
        pool_kwargs["assert_hostname"] = self._server_hostname
        pool_kwargs["server_hostname"] = self._server_hostname
        return super().init_poolmanager(connections, maxsize, block=block, **pool_kwargs)


def _http_get(
    url: str,
    *,
    headers: dict[str, str],
    timeout: int,
    stream: bool,
    allow_redirects: bool = False,
    server_hostname: str | None = None,
):
    """HTTP GET used by download_bytes; tests may monkeypatch this symbol."""
    kwargs: dict[str, Any] = {
        "headers": headers,
        "timeout": timeout,
        "stream": stream,
        "allow_redirects": allow_redirects,
    }
    if server_hostname and urlparse(url).scheme == "https":
        session = requests.Session()
        session.mount("https://", _HostnameTLSAdapter(server_hostname))
        return session.get(url, **kwargs)
    return requests.get(url, **kwargs)


def _resolve_redirect_url(current_url: str, location: str | None) -> str:
    loc = (location or "").strip()
    if not loc:
        _reject("redirect missing Location")
    return urljoin(current_url, loc)


def download_bytes(url: str, *, timeout: int = 120, max_bytes: int = DEFAULT_MAX_DOWNLOAD_BYTES) -> bytes:
    current = str(url or "").strip()

    for hop in range(MAX_REDIRECTS + 1):
        resolved = resolve_and_assert_safe_download_url(current)
        headers = {"Host": resolved.request_host}
        server_hostname = resolved.server_name if urlparse(resolved.logical_url).scheme == "https" else None
        with _http_get(
            resolved.connect_url,
            headers=headers,
            timeout=timeout,
            stream=True,
            allow_redirects=False,
            server_hostname=server_hostname,
        ) as resp:
            if resp.status_code in _REDIRECT_STATUSES:
                if hop >= MAX_REDIRECTS:
                    _reject("too many redirects")
                current = _resolve_redirect_url(resolved.logical_url, resp.headers.get("Location"))
                continue

            resp.raise_for_status()
            declared = resp.headers.get("Content-Length")
            if declared is not None:
                try:
                    if int(declared) > max_bytes:
                        _reject(f"response exceeds {max_bytes} bytes")
                except ValueError:
                    pass
            chunks: list[bytes] = []
            total = 0
            for chunk in resp.iter_content(chunk_size=256 * 1024):
                if not chunk:
                    continue
                total += len(chunk)
                if total > max_bytes:
                    _reject(f"response exceeds {max_bytes} bytes")
                chunks.append(chunk)
            if total <= 0:
                _reject("empty download")
            return b"".join(chunks)

    _reject("too many redirects")
    raise AssertionError("unreachable")


def download_to_file(
    url: str,
    dest: Path,
    *,
    timeout: int = 120,
    max_bytes: int = DEFAULT_MAX_DOWNLOAD_BYTES,
) -> Path:
    data = download_bytes(url, timeout=timeout, max_bytes=max_bytes)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return dest.resolve()


def require_path_inside(path: Path, root: Path) -> Path:
    resolved = path.resolve()
    root_resolved = root.resolve()
    try:
        resolved.relative_to(root_resolved)
    except ValueError as exc:
        raise RuntimeError(f"PLUGIN_OUTPUT_INVALID: path escapes outputDir: {path}") from exc
    return resolved


def as_float_duration(value: Any, *, default: float | None = None) -> float | None:
    if value is None:
        return default
    if isinstance(value, bool):
        raise RuntimeError("duration_seconds must be a number")
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise RuntimeError("duration_seconds must be a number") from exc
    if not (number > 0):
        raise RuntimeError("duration_seconds must be > 0")
    return number
