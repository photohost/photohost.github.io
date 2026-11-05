"""Publish short hover excerpts with the article index."""
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit


class ArticleText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.skipped = 0
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if not self.depth:
            if tag == "div" and dict(attrs).get("id") == "postBody":
                self.depth = 1
            return
        if tag not in ("br", "hr", "img", "input", "source", "wbr"):
            self.depth += 1
        if tag in ("script", "style", "pre", "code", "noscript"):
            self.skipped += 1
        if tag in ("p", "div", "li", "br", "h1", "h2", "h3", "h4"):
            self.parts.append(" ")

    def handle_endtag(self, tag):
        if not self.depth:
            return
        if tag in ("script", "style", "pre", "code", "noscript"):
            self.skipped = max(0, self.skipped - 1)
        if tag not in ("br", "hr", "img", "input", "source", "wbr"):
            self.depth -= 1

    def handle_data(self, data):
        if self.depth and not self.skipped:
            self.parts.append(data)


def excerpt(html):
    parser = ArticleText()
    parser.feed(html)
    text = " ".join("".join(parser.parts).split())
    return text[:160] + ("…" if len(text) > 160 else "") if text else "這篇文章以圖片或程式碼為主，點擊閱讀完整內容。"


def publish_excerpts():
    path = Path("docs/postList.json")
    if not path.is_file():
        return
    index = json.loads(path.read_text(encoding="utf-8"))
    for post in index.values():
        if not isinstance(post, dict) or not isinstance(post.get("postUrl"), str):
            continue
        parsed = urlsplit(post["postUrl"])
        if parsed.scheme or parsed.netloc:
            continue
        relative = unquote(parsed.path).lstrip("/")
        if not relative.startswith("post/") or Path(relative).name != relative[5:]:
            continue
        article = Path("docs") / relative
        if article.is_file():
            post["excerpt"] = excerpt(article.read_text(encoding="utf-8"))
    path.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
