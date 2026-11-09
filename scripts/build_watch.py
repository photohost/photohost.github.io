"""Publish only completed Notion viewing records as a static poster wall."""
from __future__ import annotations

import hashlib
import html
import io
import json
import os
from pathlib import Path
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

from PIL import Image, ImageOps, UnidentifiedImageError

from notion_sync import API, SyncError

ROOT = Path("static/watch-assets")
STATE = Path(".watch-sync/state.json")
PAGE = Path("static/watch.html")
MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 40_000_000


def text(value):
    return html.escape(str(value or ""), quote=True)


def plain(items):
    return "".join(item.get("plain_text", item.get("text", {}).get("content", "")) for item in items)


def movie(page):
    props = page.get("properties", {})
    status = (props.get("Status", {}).get("status") or {}).get("name")
    if status != "Done" or page.get("archived") or page.get("in_trash"):
        return None
    title = plain(props.get("名稱", {}).get("title", []))
    if not title:
        return None
    files = props.get("Cover", {}).get("files", [])
    cover = files[0] if files else None
    if not cover:
        raise SyncError(f"已看完紀錄 {page['id']} 缺少 Cover")
    kind = cover.get("type")
    url = (cover.get(kind) or {}).get("url")
    if kind not in ("file", "external") or not url:
        raise SyncError(f"已看完紀錄 {page['id']} 的 Cover 無法下載")
    date = (props.get("日期", {}).get("date") or {}).get("start", "")
    rating = props.get("評分", {}).get("number")
    media_type = (props.get("Type", {}).get("select") or {}).get("name", "")
    return {"id": page["id"], "title": title, "date": date,
            "rating": rating, "type": media_type, "cover": cover, "url": url}


def query_completed(notion, source_id):
    rows, cursor = [], None
    while True:
        body = {"page_size": 100, "filter": {"property": "Status", "status": {"equals": "Done"}},
                "sorts": [{"property": "日期", "direction": "descending"}]}
        if cursor:
            body["start_cursor"] = cursor
        result = notion.call("POST", f"/data_sources/{source_id}/query", body)
        rows.extend(filter(None, (movie(page) for page in result["results"])))
        if not result.get("has_more"):
            return rows
        cursor = result.get("next_cursor")
        if not cursor:
            raise SyncError("觀影紀錄分頁不完整")


def poster_key(item):
    cover = item["cover"]
    # Notion refreshes signed URLs. The file ID remains stable until the cover changes.
    stable = cover.get("id") or urllib.parse.urlsplit(item["url"]).path
    return hashlib.sha256(stable.encode("utf-8")).hexdigest()


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != "https":
            raise SyncError("海報重新導向至非 HTTPS 網址")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download_poster(url):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.username or parts.password:
        raise SyncError("海報必須使用 HTTPS 連結")
    request = urllib.request.Request(url, headers={"User-Agent": "gmeek-watch-wall"})
    with urllib.request.build_opener(SafeRedirect()).open(request, timeout=40) as response:
        data = response.read(MAX_IMAGE_BYTES + 1)
    if len(data) > MAX_IMAGE_BYTES:
        raise SyncError("海報大於 15 MiB，請先縮小後重新上傳")
    try:
        try:
            from pillow_heif import register_heif_opener
            register_heif_opener(thumbnails=False)
        except ImportError:
            pass
        with Image.open(io.BytesIO(data)) as original:
            if original.width * original.height > MAX_PIXELS:
                raise SyncError("海報像素過大，請先縮小後重新上傳")
            original = ImageOps.exif_transpose(original)
            original.thumbnail((600, 900), Image.Resampling.LANCZOS)
            image = original.convert("RGB")
            output = io.BytesIO()
            image.save(output, "WEBP", quality=78, method=5)
            return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError):
        raise SyncError("海報不是可讀取的圖片，請改用 JPEG、PNG 或 WebP") from None


def sync_posters(rows):
    previous = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    next_state = {}
    ROOT.mkdir(parents=True, exist_ok=True)
    for item in rows:
        key = poster_key(item)
        old = previous.get(item["id"], {})
        if old.get("key") == key and (ROOT / old.get("file", "missing")).is_file():
            filename = old["file"]
        else:
            content = download_poster(item["url"])
            filename = hashlib.sha256(content).hexdigest()[:24] + ".webp"
            (ROOT / filename).write_bytes(content)
        item["image"] = "/watch-assets/" + filename
        with Image.open(ROOT / filename) as poster:
            item["width"], item["height"] = poster.size
        next_state[item["id"]] = {"key": key, "file": filename}
    for path in ROOT.glob("*.webp"):
        if path.name not in {entry["file"] for entry in next_state.values()}:
            path.unlink()
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(next_state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def render(rows):
    groups = {}
    for item in rows:
        year = item["date"][:4] if item["date"] else "日期未填"
        groups.setdefault(year, []).append(item)
    sections = []
    for year, entries in groups.items():
        cards = []
        for item in entries:
            rating = "未評分" if item["rating"] is None else f"{item['rating']:g} 分"
            cards.append(f'''<button type="button" class="watch-card" data-title="{text(item['title'])}" data-rating="{text(rating)}" data-image="{text(item['image'])}" aria-label="查看 {text(item['title'])} 的海報與評分">
  <img src="{text(item['image'])}" alt="{text(item['title'])} 海報" loading="lazy" decoding="async" width="{item.get('width', 400)}" height="{item.get('height', 600)}">
  <span class="watch-card-info"><strong>{text(item['title'])}</strong><span>{text(rating)}</span></span>
</button>''')
        sections.append(f'<section class="watch-year"><h2>{text(year)}</h2><div class="watch-grid">{"".join(cards)}</div></section>')
    return f'''<!doctype html>
<html lang="zh-Hant" data-blog-layout="watch"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>觀影紀錄 · 終末</title><meta name="description" content="已看完的電影與劇集觀影紀錄">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+JP:wght@400..700&amp;family=Noto+Serif+TC:wght@400..700&amp;display=swap">
<link rel="stylesheet" href="/watch.css"><script src="/starfield.js" defer></script><script src="/watch.js" defer></script></head>
<body><main class="watch-shell"><header class="watch-header"><a href="/" class="watch-home" aria-label="映畫鑑賞，回首頁"><span id="watch-typewriter">映畫鑑賞</span></a><a href="/about.html" class="watch-about" aria-label="個人主頁">關於</a></header>
<h1>觀影紀錄</h1><p class="watch-intro">6分以上(含)為推薦，7至8分是我的最愛，9分與10分神作。低於6分者一律大便不推薦</p><p class="watch-count">已看完的電影與劇集 · {len(rows)} 部</p>
{"".join(sections) if sections else '<p>目前還沒有已看完的紀錄。</p>'}
</main><dialog id="watch-preview" aria-label="海報預覽"><button type="button" class="watch-close" aria-label="關閉預覽">×</button><img alt=""><div><strong></strong><span></span></div></dialog></body></html>'''


def main():
    token = os.environ.get("NOTION_TOKEN")
    if not token:
        raise SyncError("缺少 NOTION_TOKEN")
    source = os.environ.get("NOTION_WATCH_SOURCE_ID")
    if not source:
        raise SyncError("缺少 NOTION_WATCH_SOURCE_ID")
    try:
        source = str(uuid.UUID(source))
    except ValueError:
        raise SyncError("NOTION_WATCH_SOURCE_ID 不是有效的資料來源 ID") from None
    notion = API("https://api.notion.com/v1", token, {"Notion-Version": "2025-09-03"}, delay=.35)
    rows = query_completed(notion, source)
    sync_posters(rows)
    PAGE.write_text(render(rows), encoding="utf-8")
    Path("docs").mkdir(exist_ok=True)
    shutil.copy2(PAGE, "docs/watch.html")
    shutil.copytree(ROOT, "docs/watch-assets", dirs_exist_ok=True)
    for path in Path("docs/watch-assets").glob("*.webp"):
        if path.name not in {entry["file"] for entry in json.loads(STATE.read_text(encoding="utf-8")).values()}:
            path.unlink()
    print(f"觀影海報牆已產生：{len(rows)} 筆已看完紀錄")


if __name__ == "__main__":
    try:
        main()
    except SyncError as exc:
        print(f"觀影海報牆同步失敗：{exc}", file=sys.stderr)
        sys.exit(1)
