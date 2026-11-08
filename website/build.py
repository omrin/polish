"""Wrap website/page.html into website/index.html (a full HTML document for GitHub Pages)."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="icon" href="icon.png">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
"""

if __name__ == "__main__":
    page = (HERE / "page.html").read_text(encoding="utf-8")
    (HERE / "index.html").write_text(HEAD + page + "\n</body>\n</html>\n", encoding="utf-8")
    print("wrote website/index.html")
