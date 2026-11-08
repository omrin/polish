import html

from wa_core.diffing import word_diff

STYLE = {
    "delete": "color:#c62828;background:#fdecea;text-decoration:line-through;",
    "insert": "color:#1b5e20;background:#e3f6e5;",
    "equal": "",
}


def diff_html(original: str, corrected: str, direction: str = "ltr") -> str:
    parts = []
    for op in word_diff(original, corrected):
        text = html.escape(op.text).replace("\n", "<br>")
        parts.append(f'<span style="{STYLE[op.op]}">{text}</span>' if STYLE[op.op] else text)
    align = "right" if direction == "rtl" else "left"
    return f'<p dir="{direction}" align="{align}" style="white-space:pre-wrap;">{"".join(parts)}</p>'
