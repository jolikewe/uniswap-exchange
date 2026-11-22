"""Assemble ../index.html from src/ (template.html + style.css + core.js + ui.js)."""
import pathlib
here = pathlib.Path(__file__).parent / "src"
t = (here / "template.html").read_text()
for key, f in [("/*STYLE*/", "style.css"), ("//CORE", "core.js"), ("//UI", "ui.js")]:
    t = t.replace(key, (here / f).read_text().strip("\n"))
(here.parent.parent / "index.html").write_text(t)
print("index.html", len(t), "bytes")
