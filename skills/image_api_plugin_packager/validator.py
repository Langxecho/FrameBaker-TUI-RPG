#!/usr/bin/env python3
"""校验 .iap；优先委托给 aigc_bench.backends.image_api_plugins.validator。"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python validator.py <file.iap>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    repo_root = Path(__file__).resolve().parents[2]
    mod = repo_root / "src" / "aigc_bench" / "backends" / "image_api_plugins" / "validator.py"
    if mod.is_file():
        env = {**os.environ, "PYTHONPATH": str(repo_root / "src")}
        r = subprocess.run(
            [
                sys.executable,
                "-c",
                "from aigc_bench.backends.image_api_plugins.validator import validate_iap_package; import sys; r=validate_iap_package(sys.argv[1]); print('OK' if r.ok else 'FAIL'); [print(e) for e in r.errors]; sys.exit(0 if r.ok else 1)",
                path,
            ],
            cwd=str(repo_root),
            env=env,
        )
        return int(r.returncode)
    print("cannot find aigc_bench validator module", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
