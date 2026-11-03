"""Render one blog page for the password-protected preview workflow."""
import base64
from html import escape, unescape
import mimetypes
import os
from pathlib import Path
import re
from urllib.parse import urlsplit

from build_gmeek import render_markdown_request
from image_reading import ATTRIBUTE, IMAGE_TAG
from notion_sync import (API, Assets, PREVIEW, Renderer, SyncError, extract_site_timestamp,
                         property_text, read_json, uuid_text)


def preview_page_id(value):
    if value.startswith("https://"):
        value = urlsplit(value).path.rstrip("/").rsplit("/", 1)[-1]
        match = re.search(r"[a-fA-F0-9]{32}$", value)
        if match:
            value = match[0]
    return uuid_text(value)


def embed_preview_images(html, home):
    def embed(match):
        tag = match.group()
        attrs = {attribute[1].lower(): attribute for attribute in ATTRIBUTE.finditer(tag)}
        source = attrs.get("data-canonical-src") or attrs.get("src")
        if source is None:
            return tag
        url = unescape(source[2] or source[3] or source[4] or "")
        prefix = home.rstrip("/") + "/notion-assets/"
        if not url.startswith(prefix):
            return tag
        name = url[len(prefix):]
        if not re.fullmatch(r"[a-f0-9]{64}\.(?:png|jpg|gif|webp|avif)", name):
            return tag
        path = PREVIEW / "notion-assets" / name
        if not path.is_file():
            return tag
        mime = mimetypes.guess_type(path.name)[0]
        data = base64.b64encode(path.read_bytes()).decode("ascii")
        src = attrs["src"]
        return tag[:src.start()] + f' src="data:{mime};base64,{data}"' + tag[src.end():]

    return IMAGE_TAG.sub(embed, html)


def main():
    config, site = read_json("notion-sync.json"), read_json("config.json")
    pid = preview_page_id(os.environ.get("PREVIEW_PAGE", "").strip())
    notion = API("https://api.notion.com/v1", os.environ["NOTION_TOKEN"],
                 {"Notion-Version": config["notion_version"]}, delay=0.35)
    page = notion.call("GET", "/pages/" + pid)
    if (page.get("parent", {}).get("data_source_id") != config["data_source_id"] or
            page.get("archived") or page.get("in_trash")):
        raise SyncError("請指定 blog 資料庫中的文章")
    assets = Assets(site["homeUrl"], preview=True)
    renderer = Renderer(notion, assets)
    blocks, _ = extract_site_timestamp(renderer.children(pid), site)
    markdown = renderer.render(blocks)
    if not markdown.strip():
        raise SyncError("文章沒有可預覽的內容")
    html = embed_preview_images(render_markdown_request(markdown, os.environ["GITHUB_TOKEN"]),
                                site["homeUrl"])
    title = escape(property_text(page, config["properties"]["title"]))
    css = Path("static/reading.css").read_text(encoding="utf-8")
    PREVIEW.mkdir(parents=True, exist_ok=True)
    (PREVIEW / "index.html").write_text(f"""<!doctype html>
<html lang="zh-Hant" data-blog-layout="post">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400;600;700&amp;display=swap">
<style>
{css}
body {{ padding: clamp(18px, 5vw, 45px); box-sizing: border-box; }}
#header {{ border-bottom: 1px solid #bbb; }}
#postBody table {{ border-collapse: collapse; display: block; overflow: auto; }}
#postBody th, #postBody td {{ padding: 6px 12px; border: 1px solid #aaa; }}
#postBody pre {{ overflow: auto; padding: 12px; }}
</style>
<body><p>發布前預覽</p><header id="header"><h1>{title}</h1></header>
<main id="postBody" class="markdown-body">{html}</main></body></html>""", encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except SyncError as exc:
        # Workflow logs are public and may otherwise expose draft content.
        print("預覽產生失敗。請檢查頁面連結、文章內容和 Notion 連線權限。")
        raise SystemExit(1) from None
