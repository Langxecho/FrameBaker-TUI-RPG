#!/usr/bin/env python3
"""Validate .aap packages via aigc_bench when available."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: python validator.py <file.aap>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    repo_root = Path(__file__).resolve().parents[2]
    module = repo_root / "src" / "aigc_bench" / "backends" / "audio_api_plugins" / "validator.py"
    if module.is_file():
        env = {**os.environ, "PYTHONPATH": str(repo_root / "src")}
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "from aigc_bench.backends.audio_api_plugins.validator import validate_aap_package; import sys; r=validate_aap_package(sys.argv[1]); print('OK' if r.ok else 'FAIL'); [print(e) for e in r.errors]; sys.exit(0 if r.ok else 1)",
                path,
            ],
            cwd=str(repo_root),
            env=env,
        )
        return int(result.returncode)
    print("cannot find aigc_bench validator module", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
