#!/usr/bin/env python3
"""Bounded, deterministic grid cropper for material-id constrained skeletal parts."""
import argparse, base64, hashlib, json, sys
from pathlib import Path

from PIL import Image

MAX_PIXELS = 16_000_000
MAX_OUTPUT_BYTES = 32 * 1024 * 1024

def fail(message):
    print(json.dumps({"ok": False, "error": message}, ensure_ascii=False))
    raise SystemExit(0)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--request", required=True)
    args = parser.parse_args()
    try:
        request = json.loads(Path(args.request).read_text(encoding="utf-8"))
        image = Image.open(args.input)
        width, height = image.size
        if width < 1 or height < 1 or width * height > MAX_PIXELS:
            fail("source image exceeds pixel budget")
        image = image.convert("RGBA")
        rows, cols = int(request["rows"]), int(request["cols"])
        key = request.get("keyColor") or [255, 0, 255]
        tolerance = int(request.get("tolerance", 24))
        magenta_despill = int(request.get("magentaDespill", 0))
        if magenta_despill < 0 or magenta_despill > 100:
            fail("magentaDespill must be 0..100")
        if magenta_despill and key != [255, 0, 255]:
            fail("magentaDespill requires keyColor [255,0,255]")
        source = image.load()
        results = []
        total = 0
        for part in request["parts"]:
            cell = int(part["cell"])
            row, col = divmod(cell, cols)
            x0, x1 = (width * col) // cols, (width * (col + 1)) // cols
            y0, y1 = (height * row) // rows, (height * (row + 1)) // rows
            cropped = image.crop((x0, y0, x1, y1))
            pixels = cropped.load()
            keyed = bytearray(cropped.width * cropped.height) if magenta_despill else None
            opaque_count = 0
            bx0, by0 = cropped.width, cropped.height
            bx1 = by1 = -1
            for y in range(cropped.height):
                for x in range(cropped.width):
                    r, g, b, a = pixels[x, y]
                    if a and ((r-key[0])**2 + (g-key[1])**2 + (b-key[2])**2) <= tolerance*tolerance:
                        pixels[x, y] = (r, g, b, 0)
                        if keyed is not None:
                            keyed[y * cropped.width + x] = 1
                        a = 0
                    if a:
                        opaque_count += 1
                        bx0 = min(bx0, x)
                        by0 = min(by0, y)
                        bx1 = max(bx1, x + 1)
                        by1 = max(by1, y + 1)
            if not opaque_count:
                fail(f"cell {cell} has no opaque pixels")
            if keyed is not None:
                for y in range(cropped.height):
                    for x in range(cropped.width):
                        r, g, b, a = pixels[x, y]
                        excess = min(r - g, b - g)
                        if not a or excess <= 0:
                            continue
                        nearby_key = any(
                            keyed[ny * cropped.width + nx]
                            for ny in range(max(0, y - 1), min(cropped.height, y + 2))
                            for nx in range(max(0, x - 1), min(cropped.width, x + 2))
                        )
                        if nearby_key:
                            reduction = (excess * magenta_despill + 50) // 100
                            pixels[x, y] = (r - reduction, g, b - reduction, a)
            trimmed = cropped.crop((bx0, by0, bx1, by1))
            import io
            out = io.BytesIO()
            trimmed.save(out, format="PNG", optimize=False, compress_level=6)
            encoded = base64.b64encode(out.getvalue()).decode("ascii")
            total += len(out.getvalue())
            if total > MAX_OUTPUT_BYTES:
                fail("split output exceeds byte budget")
            results.append({"cell": cell, "width": trimmed.width, "height": trimmed.height,
                            "bounds": {"x": x0 + bx0, "y": y0 + by0, "w": trimmed.width, "h": trimmed.height},
                            "opaquePixels": opaque_count, "pngBase64": encoded,
                            "sha256": hashlib.sha256(out.getvalue()).hexdigest()})
        print(json.dumps({"ok": True, "width": width, "height": height, "parts": results}, ensure_ascii=False))
    except Exception as exc:
        fail(str(exc))

if __name__ == "__main__":
    main()
