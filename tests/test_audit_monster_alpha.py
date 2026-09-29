import importlib.util
import io
import json
import tempfile
import unittest
from pathlib import Path
from zipfile import ZipFile

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("audit_monster_alpha", ROOT / "scripts" / "audit_monster_alpha.py")
AUDIT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(AUDIT)


def png(alpha=255, size=(2, 2)):
    image = Image.new("RGBA", size, (40, 80, 120, alpha))
    output = io.BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class MonsterAlphaAuditTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "sample.monster"
        self.report = self.root / "report.json"

    def pack(self, contents):
        with ZipFile(self.archive, "w") as archive:
            for name, data in contents.items():
                archive.writestr(name, data)

    def test_opaque_gate_reports_and_exits_two(self):
        self.pack({"assets/idle/0.png": png()})
        self.assertEqual(AUDIT.main([str(self.archive), "--output", str(self.report), "--require-transparency"]), 2)
        report = json.loads(self.report.read_text(encoding="utf-8"))
        self.assertTrue(report["frames"][0]["allOpaque"])
        self.assertEqual(report["actions"]["idle"]["edgeAlpha"]["opaque"], 4)

    def test_transparent_r1a_frame_passes(self):
        image = Image.new("RGBA", (2, 2), (40, 80, 120, 0))
        image.putpixel((0, 0), (40, 80, 120, 255))
        output = io.BytesIO()
        image.save(output, format="PNG")
        self.pack({"frames/idle/0.png": output.getvalue()})
        self.assertEqual(AUDIT.main([str(self.archive), "--output", str(self.report), "--require-transparency"]), 0)
        self.assertEqual(json.loads(self.report.read_text(encoding="utf-8"))["frames"][0]["transparentPixels"], 3)

    def test_empty_source_frame_fails_gate(self):
        self.pack({"idle/24fps/0.png": png(alpha=0)})
        self.assertEqual(AUDIT.main([str(self.archive), "--output", str(self.report), "--require-transparency"]), 2)
        self.assertTrue(json.loads(self.report.read_text(encoding="utf-8"))["frames"][0]["emptyFrame"])

    def test_one_pixel_edge_count_and_unrequested_gate(self):
        self.pack({"idle/0.png": png(size=(1, 1))})
        self.assertEqual(AUDIT.main([str(self.archive), "--output", str(self.report)]), 0)
        report = json.loads(self.report.read_text(encoding="utf-8"))
        self.assertEqual(report["frames"][0]["edgeAlpha"]["opaque"], 1)
        self.assertIsNone(report["transparencyGate"]["passed"])

    def test_bad_png_fails_without_report(self):
        self.pack({"frames/idle/0.png": b"not a png"})
        self.assertEqual(AUDIT.main([str(self.archive), "--output", str(self.report)]), 1)
        self.assertFalse(self.report.exists())

    def test_pixel_budget_and_refuse_overwrite(self):
        self.pack({"frames/idle/0.png": png(size=(3, 3))})
        previous = AUDIT.MAX_FRAME_PIXELS
        try:
            AUDIT.MAX_FRAME_PIXELS = 4
            self.assertEqual(AUDIT.main([str(self.archive), "--output", str(self.report)]), 1)
            self.assertFalse(self.report.exists())
        finally:
            AUDIT.MAX_FRAME_PIXELS = previous
        self.report.write_text("preserve", encoding="utf-8")
        self.assertEqual(AUDIT.main([str(self.archive), "--output", str(self.report)]), 1)
        self.assertEqual(self.report.read_text(encoding="utf-8"), "preserve")


if __name__ == "__main__":
    unittest.main()
