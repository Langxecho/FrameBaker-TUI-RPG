#!/usr/bin/env python3
"""CLI 包装：优先调用仓库内 pack_vap，避免与 src 逻辑漂移。"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--src", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    src_py = repo_root / "src" / "aigc_bench" / "backends" / "video_api_plugins" / "pack.py"
    if src_py.is_file():
        env = {**os.environ, "PYTHONPATH": str(repo_root / "src")}
        result = subprocess.run(
            [sys.executable, "-m", "aigc_bench.backends.video_api_plugins.pack", "--src", args.src, "--out", args.out],
            cwd=str(repo_root),
            env=env,
        )
        return int(result.returncode)

    from zipfile import ZIP_DEFLATED, ZipFile

    src = Path(args.src)
    out = Path(args.out)
    if out.suffix.lower() != ".vap":
        out = out.with_suffix(".vap")
    with ZipFile(out, "w", compression=ZIP_DEFLATED) as archive:
        for name in ("plugin.json", "provider.py", "README.md", "requirements.txt"):
            path = src / name
            if path.is_file():
                archive.write(path, arcname=name)
    print(out.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
