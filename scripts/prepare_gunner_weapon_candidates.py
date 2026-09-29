"""Deterministically key generated weapon candidates and emit compact RGBA sprites."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / "storage/aic-runs/gunner-weapons-20260929"
OUTPUT = RUN / "normalized"
WEAPONS = {
    "fission_projector": (ROOT / "storage/materials/9ef0cbe5-4acb-4e1f-a9fb-8e008f359115/raw.png", "9ef0cbe5-4acb-4e1f-a9fb-8e008f359115"),
    "phase_piercer": (ROOT / "storage/materials/c9271611-bd7d-4641-84da-de998fabb785/raw.png", "c9271611-bd7d-4641-84da-de998fabb785"),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def key_and_crop(source: Path) -> tuple[Image.Image, dict]:
    image = Image.open(source).convert("RGBA")
    rgb = np.asarray(image.convert("RGB"), dtype=np.int16)
    border = np.concatenate((rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]), axis=0)
    bg = np.median(border, axis=0)
    distance = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    r, g, b = (rgb[:, :, i] for i in range(3))
    # Require both red AND blue chroma; red-only tests erase the orange lamp.
    chroma_magenta = (r >= 130) & (g <= 110) & (b >= 70) & (b >= g + 30) & (r >= b + 20)
    candidate = (distance <= 48) | chroma_magenta
    labels, count = ndimage.label(candidate, structure=np.ones((3, 3), dtype=bool))
    border_labels = np.unique(np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1])))
    exterior = np.isin(labels, border_labels[border_labels > 0])
    # Remove keyed pixels everywhere, including enclosed holes in ring emitters
    # and trigger guards. The distance threshold is anchored to the border color
    # so violet energy windows remain foreground.
    foreground = ~(exterior | candidate)
    # Keep the largest connected foreground component; reject a likely second object.
    fg_labels, fg_count = ndimage.label(foreground, structure=np.ones((3, 3), dtype=bool))
    sizes = np.bincount(fg_labels.ravel())
    sizes[0] = 0
    main = int(np.argmax(sizes))
    if main == 0 or int(sizes[main]) < 100:
        raise ValueError(f"{source.name}: foreground not detected")
    second = int(np.partition(sizes, -2)[-2]) if len(sizes) > 2 else 0
    if second > int(sizes[main] * 0.08):
        raise ValueError(f"{source.name}: multiple large foreground components ({second}px)")
    mask = fg_labels == main
    ys, xs = np.where(mask)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    rgba = np.asarray(image).copy()
    rgba[:, :, 3] = np.where(mask, 255, 0).astype(np.uint8)
    cropped = Image.fromarray(rgba, "RGBA").crop(bbox)
    # Keep a small transparent gutter so the socket does not touch the silhouette.
    gutter = 6
    padded = Image.new("RGBA", (cropped.width + gutter * 2, cropped.height + gutter * 2), (0, 0, 0, 0))
    padded.alpha_composite(cropped, (gutter, gutter))
    return padded, {"source": str(source), "sourceSha256": sha256(source), "sourceSize": list(image.size), "backgroundMedian": bg.tolist(), "keyDistance": 48, "chromaPredicate": "R>=130,G<=110,B>=70,B>=G+30,R>=B+20", "bbox": list(bbox), "foregroundPixels": int(mask.sum()), "outputSize": list(padded.size), "gutter": gutter}


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = {}
    for name, (source, material_id) in WEAPONS.items():
        result, detail = key_and_crop(source)
        output = OUTPUT / f"{name}.png"
        result.save(output)
        detail.update({"materialId": material_id, "output": str(output), "outputSha256": sha256(output)})
        records[name] = detail
    (OUTPUT / "evidence.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
    print(json.dumps(records, indent=2))


if __name__ == "__main__":
    main()
