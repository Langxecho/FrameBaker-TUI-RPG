"""Normalize the reviewed GUN-05 attempt-2 sheet; never alter its source PNG."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "storage/materials/355dbc4d-02ff-4134-be3c-97a8f1531ab7/raw.png"
OUTPUT = ROOT / "storage/aic-runs/gunner-parts-20260928/normalized"
EXPECTED_SHA256 = "60118f524c00130bc349cadc47005fe01a0d1c8bd07f166d450770df2eeb479a"
PARTS = (
    "head", "torso", "pelvis", "weapon_pulse_array",
    "upper_arm_left", "upper_arm_right", "forearm_left", "forearm_right",
    "thigh_left", "thigh_right", "shin_left", "shin_right",
    "foot_left", "foot_right", "hand_left", "hand_right",
)
GUTTER_FRACTION = 0.15
GUN_LEFT_EXTENSION = 48
MAGENTA = (255, 0, 255)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def is_background(rgb: np.ndarray) -> np.ndarray:
    # The generated source's dominant background is near (207, 32, 137),
    # not #ff00ff. Keep purple visor (lower R/higher B), cyan, skin, and ink.
    r, g, b = (rgb[:, :, i].astype(np.int16) for i in range(3))
    return (r >= 150) & (g <= 95) & (b >= 85) & (b <= 195) & ((r - b) >= 30)


def component_from_roi(roi: Image.Image, name: str) -> tuple[Image.Image, dict]:
    rgb = np.asarray(roi.convert("RGB"))
    bg_candidate = is_background(rgb)
    labels, count = ndimage.label(bg_candidate, structure=np.ones((3, 3), dtype=bool))
    border = np.concatenate((labels[0], labels[-1], labels[:, 0], labels[:, -1]))
    exterior_ids = np.unique(border[border > 0])
    exterior = np.isin(labels, exterior_ids)
    # Interior background holes use the same chroma family, not foreground.
    foreground = ~(exterior | bg_candidate)
    fg_labels, fg_count = ndimage.label(foreground, structure=np.ones((3, 3), dtype=bool))
    sizes = np.bincount(fg_labels.ravel())
    sizes[0] = 0
    if fg_count == 0:
        raise ValueError(f"{name}: no foreground component")
    main_id = int(np.argmax(sizes))
    main_size = int(sizes[main_id])
    second_size = int(np.partition(sizes, -2)[-2]) if len(sizes) > 2 else 0
    if second_size > 100:
        raise ValueError(f"{name}: second foreground component too large ({second_size} px)")
    foreground = fg_labels == main_id
    ys, xs = np.where(foreground)
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    rgba = np.asarray(roi.convert("RGBA")).copy()
    rgba[:, :, 3] = np.where(foreground, 255, 0).astype(np.uint8)
    isolated = Image.fromarray(rgba, "RGBA").crop(bbox)
    evidence = {
        "name": name,
        "sourceRoiSize": list(roi.size),
        "sourceBboxInRoi": list(bbox),
        "sourceOpaquePixels": main_size,
        "discardedForegroundNoisePixels": int(np.count_nonzero(fg_labels) - main_size),
        "backgroundCandidatePixels": int(bg_candidate.sum()),
        "exteriorBackgroundPixels": int(exterior.sum()),
        "foregroundComponentCount": int(fg_count),
    }
    return isolated, evidence


def main() -> None:
    actual_hash = sha256(SOURCE)
    if actual_hash != EXPECTED_SHA256:
        raise ValueError(f"source hash mismatch: {actual_hash}")
    source = Image.open(SOURCE).convert("RGB")
    if source.width != 1216 or source.height != 1216:
        raise ValueError(f"unexpected source size: {source.size}")
    cell = source.width // 4
    max_extent = int(cell * (1 - 2 * GUTTER_FRACTION))
    sheet = Image.new("RGBA", source.size, (0, 0, 0, 0))
    evidence = []
    for index, name in enumerate(PARTS):
        row, col = divmod(index, 4)
        x0, y0 = col * cell, row * cell
        roi_x0 = x0 - GUN_LEFT_EXTENSION if name == "weapon_pulse_array" else x0
        roi = source.crop((roi_x0, y0, x0 + cell, y0 + cell))
        isolated, detail = component_from_roi(roi, name)
        scale = min(1.0, max_extent / isolated.width, max_extent / isolated.height)
        size = (max(1, round(isolated.width * scale)), max(1, round(isolated.height * scale)))
        if size != isolated.size:
            isolated = isolated.resize(size, Image.Resampling.NEAREST)
        px = x0 + (cell - size[0]) // 2
        py = y0 + (cell - size[1]) // 2
        sheet.alpha_composite(isolated, (px, py))
        detail.update({
            "cell": index,
            "sourceRoi": [roi_x0, y0, x0 + cell, y0 + cell],
            "scale": scale,
            "normalizedBbox": [px, py, px + size[0], py + size[1]],
            "normalizedSize": list(size),
            "gutters": [px - x0, py - y0, x0 + cell - px - size[0], y0 + cell - py - size[1]],
        })
        if min(detail["gutters"]) < int(cell * GUTTER_FRACTION):
            raise ValueError(f"{name}: insufficient normalized gutter")
        evidence.append(detail)

    OUTPUT.mkdir(parents=True, exist_ok=True)
    transparent = OUTPUT / "gunner-parts-4x4-transparent.png"
    chroma = OUTPUT / "gunner-parts-4x4-magenta.png"
    checker = OUTPUT / "gunner-parts-4x4-checker.png"
    sheet.save(transparent)
    bg = Image.new("RGBA", source.size, (*MAGENTA, 255))
    bg.alpha_composite(sheet)
    bg.convert("RGB").save(chroma)
    yy, xx = np.indices((source.height, source.width))
    tiles = (xx // 24 + yy // 24) % 2
    preview_rgb = np.repeat(np.where(tiles[:, :, None] == 0, 216, 168).astype(np.uint8), 3, axis=2)
    preview = Image.fromarray(preview_rgb, "RGB").convert("RGBA")
    preview.alpha_composite(sheet)
    preview.convert("RGB").save(checker)
    record = {
        "sourceMaterialId": "355dbc4d-02ff-4134-be3c-97a8f1531ab7",
        "sourceSha256": actual_hash,
        "sourceSize": list(source.size),
        "partOrder": list(PARTS),
        "backgroundPredicate": "R>=150,G<=95,85<=B<=195,R-B>=30; 8-connected exterior plus all matching holes",
        "foregroundSelection": "largest 8-connected component per ROI; fail if runner-up >100 px",
        "gunLeftExtensionPx": GUN_LEFT_EXTENSION,
        "gutterFraction": GUTTER_FRACTION,
        "interpolation": "nearest",
        "files": {"transparent": str(transparent), "magenta": str(chroma), "checker": str(checker)},
        "hashes": {"transparent": sha256(transparent), "magenta": sha256(chroma), "checker": sha256(checker)},
        "cells": evidence,
    }
    (OUTPUT / "evidence.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(json.dumps({"sourceSha256": actual_hash, "hashes": record["hashes"], "cells": len(evidence)}))


if __name__ == "__main__":
    main()
