"""Read-only alpha audit for R1-A and .monster ZIP frame archives."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import warnings
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from PIL import Image, UnidentifiedImageError


FRAME_PATH = re.compile(r"^(?:(?:frames|assets)/)?([A-Za-z0-9_.-]+)/(?:[0-9]+fps/)?([A-Za-z0-9_.-]+)\.png$")
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_FRAMES = 4096
MAX_FRAME_BYTES = 16 * 1024 * 1024
MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024
MAX_FRAME_PIXELS = 4_000_000
MAX_TOTAL_PIXELS = 1_000_000_000
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class AuditError(Exception):
    pass


def digest_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def audit(archive_path: Path) -> dict:
    if not archive_path.is_file():
        raise AuditError("归档不存在")
    if archive_path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise AuditError("归档压缩大小超出预算")
    frames = []
    total_pixels = 0
    try:
        with ZipFile(archive_path) as archive:
            infos = [info for info in archive.infolist() if FRAME_PATH.fullmatch(info.filename)]
            if not infos:
                raise AuditError("未找到 frames/{action}/、assets/{action}/ 或 {action}/[24fps/] PNG 动作帧")
            if len(infos) > MAX_FRAMES:
                raise AuditError("动作帧数量超出预算")
            if len({info.filename for info in infos}) != len(infos):
                raise AuditError("ZIP 中有重复动作帧路径")
            if any(info.file_size > MAX_FRAME_BYTES for info in infos):
                raise AuditError("单帧解压大小超出预算")
            if sum(info.file_size for info in archive.infolist()) > MAX_TOTAL_UNCOMPRESSED:
                raise AuditError("归档总解压大小超出预算")
            for info in sorted(infos, key=lambda item: item.filename):
                match = FRAME_PATH.fullmatch(info.filename)
                assert match is not None
                with archive.open(info) as stream:
                    raw = stream.read(MAX_FRAME_BYTES + 1)
                if len(raw) > MAX_FRAME_BYTES or len(raw) != info.file_size:
                    raise AuditError(f"帧大小不符合预算: {info.filename}")
                if not raw.startswith(PNG_SIGNATURE):
                    raise AuditError(f"不是有效 PNG: {info.filename}")
                from io import BytesIO

                with warnings.catch_warnings():
                    warnings.simplefilter("error", Image.DecompressionBombWarning)
                    with Image.open(BytesIO(raw)) as image:
                        if image.format != "PNG":
                            raise AuditError(f"不是有效 PNG: {info.filename}")
                        width, height = image.size
                        pixels = width * height
                        if pixels > MAX_FRAME_PIXELS or total_pixels + pixels > MAX_TOTAL_PIXELS:
                            raise AuditError(f"像素预算超限: {info.filename}")
                        total_pixels += pixels
                        alpha = image.convert("RGBA").getchannel("A")
                        histogram = alpha.histogram()
                        transparent = histogram[0]
                        partial = sum(histogram[1:255])
                        opaque = histogram[255]
                        edge = alpha.crop((0, 0, width, 1)).histogram()
                        if height > 1:
                            bottom = alpha.crop((0, height - 1, width, height)).histogram()
                            edge = [a + b for a, b in zip(edge, bottom)]
                        if height > 2:
                            left = alpha.crop((0, 1, 1, height - 1)).histogram()
                            edge = [a + b for a, b in zip(edge, left)]
                            if width > 1:
                                right = alpha.crop((width - 1, 1, width, height - 1)).histogram()
                                edge = [a + b for a, b in zip(edge, right)]
                frames.append({
                    "path": info.filename, "action": match.group(1), "pngSha256": hashlib.sha256(raw).hexdigest(),
                    "width": width, "height": height, "allOpaque": transparent == 0 and partial == 0,
                    "emptyFrame": opaque == 0 and partial == 0,
                    "transparentPixels": transparent, "partialAlphaPixels": partial, "opaquePixels": opaque,
                    "edgeAlpha": {"transparent": edge[0], "partial": sum(edge[1:255]), "opaque": edge[255]},
                })
    except (BadZipFile, OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError,
            Image.DecompressionBombWarning, EOFError) as error:
        raise AuditError(f"归档或 PNG 解码失败: {error}") from error
    actions = {}
    for frame in frames:
        summary = actions.setdefault(frame["action"], {"frameCount": 0, "allOpaque": True,
            "transparentPixels": 0, "partialAlphaPixels": 0, "dimensions": set(),
            "edgeAlpha": {"transparent": 0, "partial": 0, "opaque": 0}})
        summary["frameCount"] += 1
        summary["allOpaque"] &= frame["allOpaque"]
        summary["transparentPixels"] += frame["transparentPixels"]
        summary["partialAlphaPixels"] += frame["partialAlphaPixels"]
        summary["dimensions"].add(f'{frame["width"]}x{frame["height"]}')
        for key in summary["edgeAlpha"]:
            summary["edgeAlpha"][key] += frame["edgeAlpha"][key]
    for summary in actions.values():
        summary["dimensions"] = sorted(summary["dimensions"])
    return {"schema": "framebaker.monster-alpha-audit.v1", "archiveSha256": digest_file(archive_path),
            "archivePath": str(archive_path.resolve()), "frameCount": len(frames),
            "totalPixels": total_pixels, "actions": actions, "frames": frames}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="只读审计 R1-A ZIP / .monster ZIP 动作 PNG 的透明度。")
    parser.add_argument("archive", type=Path, help="输入 ZIP 或 .monster ZIP")
    parser.add_argument("--output", type=Path, required=True, help="新的 JSON 报告路径，不覆盖已有文件")
    parser.add_argument("--require-transparency", action="store_true", help="仅在明确要求透明 sprite 时启用门禁")
    args = parser.parse_args(argv)
    if args.output.exists():
        print(f"报告已存在，拒绝覆盖: {args.output}", file=sys.stderr)
        return 1
    try:
        report = audit(args.archive)
        gate_failed = args.require_transparency and any(
            frame["allOpaque"] or frame["emptyFrame"] for frame in report["frames"]
        )
        report["transparencyGate"] = {"requested": args.require_transparency,
            "passed": None if not args.require_transparency else not gate_failed,
            "opaqueFrameCount": sum(frame["allOpaque"] for frame in report["frames"]),
            "emptyFrameCount": sum(frame["emptyFrame"] for frame in report["frames"])}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as stream:
            json.dump(report, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
    except (AuditError, OSError) as error:
        print(f"审计失败: {error}", file=sys.stderr)
        return 1
    print(f"已审计 {report['frameCount']} 帧；报告: {args.output}")
    if gate_failed:
        print("透明度门禁未通过：存在全不透明或全透明空帧", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
