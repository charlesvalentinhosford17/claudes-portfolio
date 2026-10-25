"""Render the example data and check the daily report is exactly one A4 page.
Run: python3 reports/test_daily_report.py   (needs reportlab and pypdf; not part of npm test on purpose,
so the engine tests that every routine runs never depend on Python packages)."""
import pathlib, subprocess, sys, tempfile
from pypdf import PdfReader

here = pathlib.Path(__file__).parent
with tempfile.TemporaryDirectory() as tmp:
    out = pathlib.Path(tmp) / "example.pdf"
    subprocess.run([sys.executable, str(here / "daily_report.py"), str(here / "example.json"), str(out)], check=True)
    pages = len(PdfReader(str(out)).pages)
    fonts = out.read_bytes().count(b"/FontFile")
assert pages == 1, f"expected 1 page, got {pages}"
assert fonts == 0, "only built-in Helvetica is allowed (no embedded fonts)"
print(f"ok: example renders on {pages} page, no embedded fonts")
