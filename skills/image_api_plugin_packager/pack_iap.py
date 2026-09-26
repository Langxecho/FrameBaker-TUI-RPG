#!/usr/bin/env python3
"""CLI 包装：优先调用仓库内 pack_iap，避免与 src 逻辑漂移。"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--src", required=True)
    p.add_argument("--out", required=True)
    args = p.parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    src_py = repo_root / "src" / "aigc_bench" / "backends" / "image_api_plugins" / "pack.py"
    if src_py.is_file():
        env = {**os.environ, "PYTHONPATH": str(repo_root / "src")}
        r = subprocess.run(
            [sys.executable, "-m", "aigc_bench.backends.image_api_plugins.pack", "--src", args.src, "--out", args.out],
            cwd=str(repo_root),
            env=env,
        )
        return int(r.returncode)
    from zipfile import ZIP_DEFLATED, ZipFile  # noqa: PLC0415 — fallback minimal pack

    src = Path(args.src)
    out = Path(args.out)
    with ZipFile(out, "w", compression=ZIP_DEFLATED) as zf:
        for name in ("plugin.json", "provider.py", "README.md", "requirements.txt"):
            f = src / name
            if f.is_file():
                zf.write(f, arcname=name)
    print(out.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
