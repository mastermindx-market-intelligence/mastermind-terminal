"""Build the self-contained review artifact. No network, data feed, or app changes."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent
template = (ROOT / "index.template.html").read_text()
assert template.count("/*STUDIO_CSS*/") == template.count("/*STUDIO_JS*/") == 1
html = template.replace("/*STUDIO_CSS*/", (ROOT / "studio.css").read_text())
html = html.replace("/*STUDIO_JS*/", (ROOT / "studio.js").read_text())
(ROOT / "Other_Assets_Design_Studio.html").write_text(html)
print(f"Built {len(html):,} characters; NOT_APPLIED_TO_PAPER")
