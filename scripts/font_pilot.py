"""Generate bounded font subsets with a full-font fallback for dynamic text."""
from html import escape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import quote

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
        self.existing_characters = None

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == 'meta' and attributes.get('name') == 'blog-font-characters':
            self.existing_characters = attributes.get('content')
        if tag in {"script", "style"}:
            self.skip = tag
        if not self.skip:
            for name, value in attrs:
                if name in {"alt", "title", "aria-label", "placeholder"} and value:
                    self.characters.update(value)

    def handle_endtag(self, tag):
        if tag == self.skip:
            self.skip = None

    def handle_data(self, data):
        if not self.skip:
            self.characters.update(data)


def font_head(path, html, head, use_existing=False):
    if path == Path('docs/tag.html') or not FONT_URL.search(head):
        return head
    parser = PageCharacters()
    parser.feed(html)
    # Include text in all local controls, including typewriter words and status messages.
    for script in Path('static').glob('*.js'):
        parser.characters.update(script.read_text(encoding='utf-8'))
    if path.parent == Path('docs'):
        # All titles/tags share one list-page subset, including subsequent feed pages.
        try:
            data = json.loads(Path('docs/postList.json').read_text(encoding='utf-8'))
            for post in data.values():
                if isinstance(post, dict) and isinstance(post.get('labels'), list):
                    parser.characters.update(post.get('postTitle', ''))
                    for label in post['labels']:
                        parser.characters.update(label)
        except (OSError, ValueError, TypeError):
            pass  # Actual page text is still covered; runtime guards dynamic additions.
    characters = parser.existing_characters if use_existing else None
    if characters is None:
        characters = "".join(sorted(c for c in parser.characters if c.isprintable()))
    query = "&amp;text=" + quote(characters, safe="")
    urls = FONT_URL.findall(head)
    if any(len(url) + len(query) > 7500 for url in urls):
        return head
    result = FONT_URL.sub(lambda match: match[0] + query, head)
    return (result + '<meta name="blog-font-characters" content="' + escape(characters, quote=True) + '">'
            + '<meta name="blog-font-fallback" content="' + urls[0] + '">')


def apply_pilot(head):
    for path in sorted(Path('docs').rglob('*.html')):
        if not path.is_file():
            continue
        html = path.read_text(encoding="utf-8")
        before, separator, after = html.partition("</head>")
        if separator and before.count(head) == 1:
            updated = before.replace(head, font_head(path, html, head), 1) + separator + after
            if updated != html:
                path.write_text(updated, encoding="utf-8")
