"""Generate page-specific Google Fonts requests for the two pilot articles."""
from html.parser import HTMLParser
from pathlib import Path
import re
from urllib.parse import quote

PILOT_PAGES = {
    Path("docs/post/notion-35d40a03f4e8.html"),
    Path("docs/post/2nd278.html"),
}
FONT_URL = re.compile(r"""https://fonts\.googleapis\.com/css2\?[^"']+""")
UI_TEXT = (
    "文章目錄前往文末圖片預覽使用調整大小放大後可捲動查看關閉適合視窗"
    "文章閱讀位置文末閱讀位置回到頂端縮小圖片放大圖片圖片縮放比例"
    "Esc Copyright Powered by Gmeek Less is best ←→↑↓＋−×✕…% "
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
)


class PageCharacters(HTMLParser):
    def __init__(self):
        super().__init__()
        self.characters = set(UI_TEXT)
        self.skip = None

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.skip = tag
        if not self.skip:
            for name, value in attrs:
                if name in {"alt", "title", "aria-label"} and value:
                    self.characters.update(value)

    def handle_endtag(self, tag):
        if tag == self.skip:
            self.skip = None

    def handle_data(self, data):
        if not self.skip:
            self.characters.update(data)


def font_head(path, html, head):
    if path not in PILOT_PAGES or not FONT_URL.search(head):
        return head
    parser = PageCharacters()
    parser.feed(html)
    characters = "".join(sorted(c for c in parser.characters if c.isprintable()))
    query = "&amp;text=" + quote(characters, safe="")
    # Use the regular font request if a later edit makes the URL too long.
    return FONT_URL.sub(lambda match: match[0] + query
                        if len(match[0]) + len(query) <= 7500 else match[0], head)


def apply_pilot(head):
    for path in sorted(PILOT_PAGES):
        if not path.is_file():
            continue
        html = path.read_text(encoding="utf-8")
        before, separator, after = html.partition("</head>")
        if separator and before.count(head) == 1:
            updated = before.replace(head, font_head(path, html, head), 1) + separator + after
            if updated != html:
                path.write_text(updated, encoding="utf-8")
