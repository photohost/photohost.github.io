"""Notion -> GitHub Issues. Python 3.12+, standard library only.

Preview is read-only remotely. Publish is explicitly selected by the workflow.
Published publishes once; repost explicitly exports edits; delete removes the
linked Issue and deployed page. Deployment receipts prevent repeated actions.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
from pathlib import Path
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid

STATE = Path(".notion-sync/state.json")
BATCH = Path("work/notion-batch.json")
PREVIEW = Path("work/notion-preview")
MAX_FILE = 20 * 1024 * 1024
MARKER = re.compile(r"<!-- notion-page:([0-9a-f-]{36}) -->")


class SyncError(Exception):
    pass


class APIError(SyncError):
    def __init__(self, method, path, status):
        self.status = status
        super().__init__(f"API {method} {path.split('?')[0]} returned HTTP {status}")


def read_json(path, fallback=None):
    p = Path(path)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else fallback


def write_json(path, value):
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(p)


class API:
    def __init__(self, base, token, extra=None, delay=0):
        self.base = base
        self.headers = {"Authorization": "Bearer " + token,
                        "Content-Type": "application/json", "User-Agent": "notion-gmeek-sync"}
        self.headers.update(extra or {})
        self.delay = delay

    def call(self, method, path, data=None):
        if not path.startswith("/") or path.startswith("//"):
            raise SyncError("Invalid API path")
        request = urllib.request.Request(self.base + path,
            data=None if data is None else json.dumps(data).encode(),
            headers=self.headers, method=method)
        # Retrying creation after a timeout could duplicate Issues. Recover via
        # the page marker on the next run instead. Reads and absolute PATCHes retry.
        safe = method in ("GET", "PATCH") or path.endswith("/query")
        for attempt in range(4):
            time.sleep(self.delay)
            try:
                with urllib.request.urlopen(request, timeout=45) as response:
                    content = response.read()
                    return json.loads(content) if content else {}
            except urllib.error.HTTPError as exc:
                if safe and (exc.code == 429 or exc.code >= 500) and attempt < 3:
                    retry = exc.headers.get("Retry-After", "")
                    time.sleep(min(float(retry), 60) if retry.isdigit() else 2 ** (attempt + 1))
                    continue
                # Do not echo API bodies or signed image URLs into public logs.
                raise APIError(method, path, exc.code) from None
            except (urllib.error.URLError, TimeoutError, OSError):
                if safe and attempt < 3:
                    time.sleep(2 ** (attempt + 1))
                    continue
                raise SyncError("Network request failed; rerun to recover by the existing Issue marker") from None

    def pages(self, path):
        result = []
        for page in range(1, 1001):
            sep = "&" if "?" in path else "?"
            items = self.call("GET", f"{path}{sep}per_page=100&page={page}")
            result.extend(items)
            if len(items) < 100:
                return result
        raise SyncError("GitHub pagination limit exceeded")


def uuid_text(value):
    try:
        return str(uuid.UUID(value))
    except (ValueError, TypeError, AttributeError):
        raise SyncError("Invalid Notion page ID") from None


def plain(items):
    return "".join(x.get("plain_text", x.get("text", {}).get("content", "")) for x in items)


def escape(text):
    text = html.escape(text, quote=False)
    return re.sub(r"([\\`*_{}\[\]#!|>~])", r"\\\1", text)


def link_url(url):
    if urllib.parse.urlsplit(url).scheme not in ("https", "http", "mailto"):
        raise SyncError("Only http(s) and mailto links are supported")
    return urllib.parse.quote(url, safe=":/?&=#%+@;,$!~*'[]")


def rich(items):
    out = []
    for item in items:
        kind = item.get("type", "text")
        if kind == "equation":
            out.append("$" + item["equation"]["expression"] + "$")
            continue
        if kind != "text":
            raise SyncError("Mentions must be replaced with ordinary text or public links before publishing")
        raw = item.get("text", {}).get("content", item.get("plain_text", ""))
        ann = item.get("annotations", {})
        if ann.get("code"):
            fence = "`" * (max([len(x) for x in re.findall(r"`+", raw)] or [0]) + 1)
            content = fence + " " + raw + " " + fence
        else:
            content = escape(raw)
            for key, marker in (("bold", "**"), ("italic", "*"), ("strikethrough", "~~")):
                if ann.get(key) and content.strip():
                    m = re.fullmatch(r"(\s*)(.*?)(\s*)", content, flags=re.S)
                    content = m[1] + marker + m[2] + marker + m[3]
            if ann.get("underline"):
                content = "<u>" + content + "</u>"
        href = item.get("href") or (item.get("text", {}).get("link") or {}).get("url")
        if href:
            content = f"[{content}]({link_url(href)})"
        out.append(content)
    return "".join(out)


def asset_host(url):
    parts = urllib.parse.urlsplit(url)
    host = (parts.hostname or "").lower()
    allowed = ("amazonaws.com", "notion.so", "notion-static.com", "notionusercontent.com")
    return parts.scheme == "https" and not parts.username and parts.port in (None, 443) and any(
        host == suffix or host.endswith("." + suffix) for suffix in allowed)


class AssetRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not asset_host(newurl):
            raise SyncError("Unexpected Notion file redirect")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Assets:
    TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif",
             "image/webp": ".webp", "image/avif": ".avif", "application/pdf": ".pdf",
             "video/mp4": ".mp4", "audio/mpeg": ".mp3", "audio/ogg": ".ogg"}

    def __init__(self, home, preview):
        self.home = home.rstrip("/")
        self.root = PREVIEW / "notion-assets" if preview else Path("static/notion-assets")

    def resolve(self, obj):
        kind = obj.get("type")
        if kind == "external":
            return link_url(obj["external"]["url"])
        if kind != "file":
            raise SyncError("Unsupported file reference; wait for the Notion upload to finish")
        url = obj["file"]["url"]
        if not asset_host(url):
            raise SyncError("Unexpected Notion file host")
        try:
            with urllib.request.build_opener(AssetRedirect()).open(url, timeout=60) as response:
                mime = response.headers.get_content_type()
                data = response.read(MAX_FILE + 1)
        except (urllib.error.URLError, TimeoutError, OSError):
            raise SyncError("Could not download a Notion attachment") from None
        if len(data) > MAX_FILE:
            raise SyncError("Attachment exceeds 20 MiB; use an externally hosted link")
        ext = self.TYPES.get(mime)
        if not ext:
            raise SyncError("Unsupported attachment media type; use PNG/JPEG/WebP/GIF/AVIF/PDF/MP4/MP3/OGG")
        name = hashlib.sha256(data).hexdigest() + ext
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / name).write_bytes(data)
        return self.home + "/notion-assets/" + name


class Renderer:
    def __init__(self, notion, assets):
        self.notion = notion
        self.assets = assets
        self.visits = 0

    def children(self, block_id):
        result, cursor = [], None
        while True:
            query = {"page_size": 100}
            if cursor:
                query["start_cursor"] = cursor
            page = self.notion.call("GET", f"/blocks/{block_id}/children?" + urllib.parse.urlencode(query))
            result.extend(page["results"])
            if not page["has_more"]:
                return result
            cursor = page["next_cursor"]
            if not cursor:
                raise SyncError("Incomplete Notion block pagination")

    def render(self, blocks, depth=0):
        if depth > 20:
            raise SyncError("Article exceeds 20 nested block levels")
        out = []
        for block in blocks:
            self.visits += 1
            if self.visits > 2000:
                raise SyncError("Article exceeds 2000 blocks")
            kind = block["type"]
            data = block.get(kind, {})
            text = rich(data.get("rich_text", []))
            nested = ""
            if block.get("has_children") and kind != "table":
                nested = self.render(self.children(block["id"]), depth + 1)
            if kind == "paragraph":
                value = text + ("\n\n" + nested if nested else "")
            elif kind in ("heading_1", "heading_2", "heading_3"):
                value = "#" * int(kind[-1]) + " " + text + ("\n\n" + nested if nested else "")
            elif kind in ("bulleted_list_item", "numbered_list_item", "to_do"):
                prefix = {"bulleted_list_item": "- ", "numbered_list_item": "1. ",
                          "to_do": "- [x] " if data.get("checked") else "- [ ] "}[kind]
                value = prefix + text.replace("\n", "\n" + " " * len(prefix))
                if nested:
                    value += "\n\n" + "\n".join(" " * len(prefix) + line for line in nested.splitlines())
            elif kind in ("quote", "callout"):
                value = "\n".join("> " + line for line in (text + ("\n\n" + nested if nested else "")).splitlines())
            elif kind == "code":
                raw = plain(data.get("rich_text", []))
                fence = "`" * max(3, 1 + max([len(x) for x in re.findall(r"`+", raw)] or [0]))
                language = re.sub(r"[^A-Za-z0-9_+-]", "", data.get("language", ""))
                value = f"{fence}{language}\n{raw}\n{fence}"
            elif kind == "equation":
                value = "$$\n" + data["expression"] + "\n$$"
            elif kind == "divider":
                value = "---"
            elif kind in ("image", "file", "pdf", "video", "audio"):
                url = self.assets.resolve(data)
                caption = rich(data.get("caption", []))
                label = escape(plain(data.get("caption", [])) or data.get("name", kind))
                value = ("!" if kind == "image" else "") + f"[{label}]({url})"
                if kind == "image" and caption:
                    value += "\n\n" + caption
            elif kind in ("bookmark", "embed", "link_preview"):
                url = link_url(data["url"])
                value = f"[{rich(data.get('caption', [])) or escape(data['url'])}]({url})"
            elif kind == "toggle":
                value = f"<details>\n<summary>{html.escape(plain(data.get('rich_text', [])))}</summary>\n\n{nested}\n\n</details>"
            elif kind in ("column_list", "column"):
                value = nested  # Notion columns become sequential sections.
            elif kind == "table":
                rows = self.children(block["id"])
                if not rows:
                    continue
                cells = [[rich(c).replace("\n", "<br>") for c in r["table_row"]["cells"]] for r in rows]
                if not data.get("has_column_header"):
                    cells.insert(0, [""] * data["table_width"])
                lines = ["| " + " | ".join(row) + " |" for row in cells]
                lines.insert(1, "| " + " | ".join(["---"] * data["table_width"]) + " |")
                value = "\n".join(lines)
            elif kind == "table_of_contents":
                continue  # The existing site theme generates its own TOC.
            else:
                raise SyncError(f"Unsupported Notion block: {kind}; convert it before publishing")
            out.append(value)
        return "\n\n".join(out).strip()


def property_text(page, name):
    prop = page["properties"][name]
    return plain(prop.get(prop["type"], []))


def text_property(value):
    return {"rich_text": [{"text": {"content": value}}]}


def status_name(page, config):
    return (page["properties"][config["properties"]["status"]].get("status") or {}).get("name")


def valid_slug(value):
    if not value or len(value) > 180 or value in (".", "..") or value.endswith((".", " ")):
        raise SyncError("Slug is empty or invalid")
    if re.search(r'[<>:/\\|?*"\x00-\x1f%#]', value):
        raise SyncError("Slug must be one filename segment without an extension or URL")
    if value.lower().endswith(".html"):
        raise SyncError("Slug must omit .html")
    return value


def slug_key(value):
    return unicodedata.normalize("NFC", value).casefold()


def existing_slug(post):
    path = urllib.parse.unquote(post["postUrl"])
    if not path.startswith("post/") or not path.endswith(".html"):
        raise SyncError("Only regular Gmeek posts can be linked to Notion")
    return valid_slug(path[5:-5])


def source_config(body):
    try:
        result = json.loads((body or "").splitlines()[-1].split("##")[1])
        return result if isinstance(result, dict) else {}
    except (ValueError, IndexError):
        return {}


def article_digest(title, body, labels):
    names = sorted(x["name"] if isinstance(x, dict) else x for x in labels)
    data = [title, (body or "").replace("\r\n", "\n"), names]
    return hashlib.sha256(json.dumps(data, ensure_ascii=False).encode()).hexdigest()


def publication_time(site):
    return dt.datetime.now(dt.timezone(dt.timedelta(hours=site.get("UTC", 8)))).replace(microsecond=0)


def article_body(markdown, pid, meta):
    body = markdown.replace("\r\n", "\n").replace("\n", "\r\n")
    return body + f"\r\n\r\n<!-- notion-page:{pid} -->\r\n<!-- ##{json.dumps(meta, ensure_ascii=False)}## -->"


class Sync:
    def __init__(self, notion, github, repo, config, site, state=None, blog=None, delete_github=None):
        self.notion, self.github, self.repo = notion, github, repo
        self.config, self.site = config, site
        self.p = config["properties"]
        self.state = state if state is not None else read_json(STATE, {"version": 1, "pages": {}})
        self.blog = blog if blog is not None else read_json("blogBase.json", {})
        self.batch = []
        self.delete_github = delete_github
        self.repost_status = config.get("repost_status", "repost")
        self.delete_status = config.get("delete_status", "delete")

    def requested(self, page):
        entry = self.state["pages"].get(uuid_text(page["id"]), {})
        status = status_name(page, self.config)
        if status == self.delete_status:
            return not entry.get("deletion_deployed")
        if status == self.repost_status:
            return True
        return (status == self.config["publish_status"] and
                not entry.get("deployed_fingerprint") and not entry.get("deleted"))

    def publish_pages(self):
        schema = self.notion.call("GET", "/data_sources/" + self.config["data_source_id"])
        types = {"title": "title", "status": "status", "tags": "multi_select", "date": "date",
                 "slug": "rich_text", "issue": "number", "url": "url", "result": "rich_text",
                 "synced": "date", "published": "checkbox"}
        for key, expected in types.items():
            if schema.get("properties", {}).get(self.p[key], {}).get("type") != expected:
                raise SyncError(f"Notion property {self.p[key]} must be {expected}")
        pages, cursor = [], None
        while True:
            body = {"page_size": 100, "filter": {"or": [
                {"property": self.p["status"], "status": {"equals": value}}
                for value in (self.config["publish_status"], self.repost_status, self.delete_status)]}}
            if cursor:
                body["start_cursor"] = cursor
            response = self.notion.call("POST", "/data_sources/" + self.config["data_source_id"] + "/query", body)
            pages.extend(p for p in response["results"] if not p.get("archived") and not p.get("in_trash"))
            if not response["has_more"]:
                return pages
            cursor = response["next_cursor"]
            if not cursor:
                raise SyncError("Incomplete Notion page pagination")

    def prepare(self, pages, preview):
        issues = [x for x in self.github.pages(f"/repos/{self.repo}/issues?state=all") if "pull_request" not in x]
        by_number = {x["number"]: x for x in issues}
        by_marker = {}
        for issue in issues:
            for pid in MARKER.findall(issue.get("body") or ""):
                if pid in by_marker and by_marker[pid]["number"] != issue["number"]:
                    raise SyncError("Multiple Issues reference the same Notion page")
                by_marker[pid] = issue
        occupied = {slug_key(existing_slug(post)): int(key[1:])
                    for key, post in self.blog.get("postListJson", {}).items()}
        for entry in self.state["pages"].values():
            occupied[slug_key(entry["slug"])] = entry["issue"]
        prepared, linked = [], set()
        assets = Assets(self.site["homeUrl"], preview)
        for page in pages:
            pid = uuid_text(page["id"])
            entry = self.state["pages"].get(pid, {})
            status = status_name(page, self.config)
            if not self.requested(page):
                # Do not even read blocks or copy draft attachments after publication.
                prepared.append({"page_id": pid, "action": "noop", "needs_sync": False,
                                 "title": "", "body": "", "tags": [], "file_title": pid,
                                 "issue": entry.get("issue", 0), "slug": entry.get("slug", "")})
                continue
            if status == self.delete_status:
                prepared.append(self.prepare_delete(page, entry, by_number, by_marker))
                continue
            if entry.get("deleted"):
                raise SyncError("此文章的 Issue 已刪除；請複製成新的 Notion 文章後再發布")
            title = property_text(page, self.p["title"]).strip()
            if not title or len(title) > 200 or "\n" in title or "\r" in title:
                raise SyncError(f"Published page {pid} requires a title of 1–200 characters on one line")
            number = page["properties"][self.p["issue"]].get("number")
            entry = self.state["pages"].get(pid, {})
            old_number = entry.get("issue")
            if number is not None and (number != int(number) or number < 1):
                raise SyncError("Issue number must be a positive integer")
            if number and old_number and number != old_number:
                raise SyncError("An existing page cannot be reassigned to a different Issue")
            number = int(number or old_number or by_marker.get(pid, {}).get("number", 0))
            issue = by_number.get(number) if number else None
            if number and (not issue or issue["state"] != "open"):
                raise SyncError(f"Issue #{number} does not exist or is closed; reopen it explicitly to update")
            if issue:
                markers = MARKER.findall(issue.get("body") or "")
                if markers and markers != [pid]:
                    raise SyncError(f"Issue #{number} belongs to a different Notion page")
                if by_marker.get(pid, {}).get("number", number) != number or number in linked:
                    raise SyncError("Conflicting page-to-Issue mapping")
                linked.add(number)
            tags = [t["name"] for t in page["properties"][self.p["tags"]]["multi_select"]]
            if not tags or any(t in self.site.get("singlePage", []) for t in tags):
                raise SyncError(f"{title}: select at least one article tag; single-page labels are not supported")
            slug = entry.get("slug")
            post = self.blog.get("postListJson", {}).get("P" + str(number))
            if not slug and post:
                slug = existing_slug(post)
            if not slug and issue:
                slug = source_config(issue.get("body")).get("notion_slug")
            requested = property_text(page, self.p["slug"]).strip()
            if slug and requested and slug != requested:
                raise SyncError(f"{title}: keep the existing Slug {slug}; changing URLs requires a migration")
            # Notion page IDs can share their first 12 digits. Use the whole ID
            # for new URLs, while keeping every previously assigned URL above.
            slug = valid_slug(slug or requested or "notion-" + pid.replace("-", ""))
            key = slug_key(slug)
            if key in occupied and (not number or occupied[key] != number):
                raise SyncError(f"{title}: Slug is already used by another article")
            occupied[key] = number or pid
            # Gmeek's Markdown backup uses the sanitized title, even with a fixed URL.
            file_title = re.sub(r'[<>:/\\|?*"\x00-\x1f]', '-', title).casefold()
            for other in issues:
                other_title = re.sub(r'[<>:/\\|?*"\x00-\x1f]', '-', other["title"]).casefold()
                if other["state"] == "open" and other["number"] != number and other_title == file_title:
                    raise SyncError(f"{title}: another open Issue has the same backup filename")
            if any(x["file_title"] == file_title for x in prepared):
                raise SyncError("Two Published articles have the same backup filename")
            renderer = Renderer(self.notion, assets)
            markdown = renderer.render(renderer.children(pid))
            if not markdown.strip():
                raise SyncError(f"{title}: article body is empty")
            meta = source_config(issue.get("body")) if issue else {}
            # Keep enough metadata in the Issue to recover its URL even if the
            # response or the following state-file commit is interrupted.
            meta["notion_slug"] = slug
            old_digest = article_digest(issue["title"], issue.get("body"), issue["labels"]) if issue else None
            # A failed deployment retries the same publication time and Issue.
            # A new repost (even with unchanged text) receives a fresh time.
            retry = (meta.get("notion_published_at") and old_digest != entry.get("deployed_fingerprint") and
                     article_digest(title, article_body(markdown, pid, meta), tags) == old_digest)
            if not retry:
                timestamp = publication_time(self.site)
                meta["timestamp"] = int(timestamp.timestamp())
                meta["notion_published_at"] = timestamp.isoformat()
            body = article_body(markdown, pid, meta)
            if len(body.encode("utf-8")) > 60000:
                raise SyncError(f"{title}: article is too long for one GitHub Issue")
            latest = self.notion.call("GET", "/pages/" + pid)
            if (latest["last_edited_time"] != page["last_edited_time"] or
                    status_name(latest, self.config) != status):
                raise SyncError(f"{title}: content changed during export; rerun")
            fingerprint = article_digest(title, body, tags)
            issue_matches = issue and article_digest(issue["title"], issue.get("body"), issue["labels"]) == fingerprint
            prepared.append({"page_id": pid, "action": "publish", "status": status,
                             "title": title, "file_title": file_title,
                             "body": body, "tags": tags, "slug": slug, "issue": number,
                             "old_issue": issue, "revision": latest["last_edited_time"],
                             "published_at": meta["notion_published_at"],
                             "fingerprint": fingerprint,
                             "needs_sync": status == self.repost_status or not issue_matches or entry.get("deployed_fingerprint") != fingerprint})
        return prepared

    def prepare_delete(self, page, entry, by_number, by_marker):
        pid = uuid_text(page["id"])
        number = page["properties"][self.p["issue"]].get("number")
        if number is not None and (number != int(number) or number < 1):
            raise SyncError("Issue number must be a positive integer")
        if number and entry.get("issue") and number != entry["issue"]:
            raise SyncError("An existing page cannot be reassigned to a different Issue")
        number = int(number or entry.get("issue") or by_marker.get(pid, {}).get("number", 0))
        issue = by_number.get(number)
        if issue and ("pull_request" in issue or MARKER.findall(issue.get("body") or "") != [pid]):
            raise SyncError("拒絕刪除：Issue 不含此 Notion 文章的唯一對應標記")
        if not issue and (not number or entry.get("issue") != number):
            raise SyncError("此頁沒有可確認的已發布 Issue，無法刪除")
        if by_marker.get(pid, {}).get("number", number) != number:
            raise SyncError("Conflicting page-to-Issue mapping")
        slug = entry.get("slug") or (source_config(issue.get("body")).get("notion_slug") if issue else None)
        post = self.blog.get("postListJson", {}).get("P" + str(number))
        if post:
            existing = existing_slug(post)
            if slug and slug != existing:
                raise SyncError("拒絕刪除：已部署網址與文章對應不一致")
            slug = existing
        if not slug:
            raise SyncError("拒絕刪除：找不到可確認的文章網址")
        return {"page_id": pid, "action": "delete", "status": self.delete_status,
                "issue": number, "slug": valid_slug(slug), "old_issue": issue,
                "revision": page["last_edited_time"], "needs_sync": True,
                "title": "", "file_title": pid, "body": "", "tags": [],
                "fingerprint": ""}

    def delete_issue(self, item):
        if not self.delete_github:
            raise SyncError("請先設定 NOTION_DELETE_TOKEN：由 photohost 建立、限此儲存庫且 Issues 讀寫權限的 GitHub 權杖")
        # A personal repository only permits its owner to permanently delete Issues.
        owner = self.repo.split("/")[0]
        actor = self.delete_github.call("GET", "/user")
        if actor.get("login", "").casefold() != owner.casefold():
            raise SyncError("NOTION_DELETE_TOKEN 必須由此儲存庫擁有者建立")
        repository = self.delete_github.call("GET", f"/repos/{self.repo}")
        if repository.get("full_name", "").casefold() != self.repo.casefold() or not repository.get("permissions", {}).get("admin"):
            raise SyncError("NOTION_DELETE_TOKEN 無法確認此儲存庫的擁有者權限")
        try:
            current = self.delete_github.call("GET", f"/repos/{self.repo}/issues/{item['issue']}")
        except APIError as exc:
            entry = self.state["pages"].get(item["page_id"], {})
            if exc.status in (404, 410) and entry.get("issue") == item["issue"]:
                return  # Recover after a successful deletion with a lost response.
            raise
        if ("pull_request" in current or MARKER.findall(current.get("body") or "") != [item["page_id"]]
                or not current.get("node_id")):
            raise SyncError("拒絕刪除：Issue 不含此 Notion 文章的唯一對應標記")
        if item["old_issue"] and current["updated_at"] != item["old_issue"]["updated_at"]:
            raise SyncError("GitHub Issue changed before deletion; retry after reviewing it")
        response = self.delete_github.call("POST", "/graphql", {
            "query": "mutation($id:ID!){deleteIssue(input:{issueId:$id}){repository{nameWithOwner}}}",
            "variables": {"id": current["node_id"]}})
        deleted_repo = ((response.get("data") or {}).get("deleteIssue") or {}).get("repository") or {}
        if response.get("errors") or deleted_repo.get("nameWithOwner", "").casefold() != self.repo.casefold():
            raise SyncError("GitHub 拒絕刪除 Issue；請確認 NOTION_DELETE_TOKEN 的擁有者與 Issues 讀寫權限")

    def publish(self, prepared):
        prepared = [item for item in prepared if item["needs_sync"]]
        if not prepared:
            print("All Published articles are already deployed; no changes")
            return
        labels = ({x["name"] for x in self.github.pages(f"/repos/{self.repo}/labels")}
                  if any(x["action"] == "publish" for x in prepared) else set())
        for item in prepared:
            pid = item["page_id"]
            latest = self.notion.call("GET", "/pages/" + pid)
            if (latest.get("archived") or latest.get("in_trash") or
                    latest["last_edited_time"] != item["revision"] or
                    status_name(latest, self.config) != item["status"]):
                raise SyncError("An article changed before processing; rerun")
            if item["action"] == "delete":
                self.delete_issue(item)
                self.state["pages"][pid] = {**self.state["pages"].get(pid, {}),
                    "issue": item["issue"], "slug": item["slug"], "deleted": True,
                    "deletion_deployed": False}
                write_json(STATE, self.state)
                self.save_batch(item, "GitHub Issue 已刪除，等待網站下架部署")
                continue
            for label in item["tags"]:
                if label not in labels:
                    self.github.call("POST", f"/repos/{self.repo}/labels", {"name": label, "color": "cfd3d7"})
                    labels.add(label)
            payload = {"title": item["title"], "body": item["body"], "labels": item["tags"]}
            if item["issue"]:
                current = self.github.call("GET", f"/repos/{self.repo}/issues/{item['issue']}")
                if current["updated_at"] != item["old_issue"]["updated_at"]:
                    raise SyncError("GitHub Issue changed during sync; rerun before overwriting")
                if article_digest(current["title"], current.get("body"), current["labels"]) != item["fingerprint"]:
                    self.github.call("PATCH", f"/repos/{self.repo}/issues/{item['issue']}", payload)
            else:
                created = self.github.call("POST", f"/repos/{self.repo}/issues", payload)
                item["issue"] = created["number"]
            self.state["pages"][pid] = {**self.state["pages"].get(pid, {}),
                                        "issue": item["issue"], "slug": item["slug"]}
            write_json(STATE, self.state)
            self.save_batch(item, "已同步至 GitHub，等待網站部署")
            print(f"Synced Issue #{item['issue']}; awaiting deployment")

    def save_batch(self, item, message):
        self.batch.append({"page_id": item["page_id"], "issue": item["issue"], "slug": item["slug"],
                           "action": item["action"], "status": item["status"],
                           "fingerprint": item["fingerprint"],
                           "published_at": item.get("published_at"),
                           "revision": item["revision"]})
        write_json(BATCH, self.batch)
        updated = self.notion.call("PATCH", "/pages/" + item["page_id"], {"properties": {
            self.p["issue"]: {"number": item["issue"]}, self.p["slug"]: text_property(item["slug"]),
            self.p["result"]: text_property(message)}})
        self.batch[-1]["revision"] = updated["last_edited_time"]
        write_json(BATCH, self.batch)

    def finalize(self, succeeded):
        for item in read_json(BATCH, []):
            deleting = item.get("action") == "delete"
            status = item.get("status", self.config["publish_status"])
            if succeeded:
                if not deleting:
                    issue = self.github.call("GET", f"/repos/{self.repo}/issues/{item['issue']}")
                    digest = article_digest(issue["title"], issue.get("body"), issue["labels"])
                    if digest != item["fingerprint"]:
                        print("Issue changed during deployment; left Notion status unchanged")
                        continue
            page = self.notion.call("GET", "/pages/" + item["page_id"])
            # Preserve edits made by the writer while Pages was building.
            if page.get("archived") or page.get("in_trash") or page["last_edited_time"] != item["revision"]:
                if succeeded:
                    self.record_deployment(item)
                print("Notion page changed during deployment; left its status unchanged")
                continue
            if status_name(page, self.config) != status:
                if succeeded:
                    self.record_deployment(item)
                continue
            props = {self.p["result"]: text_property(f"網站部署失敗；保持 {status}，系統將自動重試")}
            if succeeded:
                props = {self.p["result"]: text_property("已從網站下架並刪除 GitHub Issue" if deleting else "已成功發布至網站"),
                         self.p["published"]: {"checkbox": not deleting},
                         self.p["synced"]: {"date": {"start": dt.datetime.now(dt.timezone.utc).isoformat()}},
                         self.p["url"]: {"url": None if deleting else self.site["homeUrl"].rstrip("/") + "/post/" + urllib.parse.quote(item["slug"], safe="") + ".html"}}
                if deleting:
                    props[self.p["issue"]] = {"number": None}
                else:
                    props[self.p["status"]] = {"status": {"name": self.config["publish_status"]}}
                    props[self.p["date"]] = {"date": {"start": item.get("published_at") or publication_time(self.site).isoformat()}}
            self.notion.call("PATCH", "/pages/" + item["page_id"], {"properties": props})
            if succeeded:
                self.record_deployment(item)

    def record_deployment(self, item):
        entry = self.state["pages"].get(item["page_id"])
        if entry and entry["issue"] == item["issue"] and entry["slug"] == item["slug"]:
            if item.get("action") == "delete":
                entry["deletion_deployed"] = True
            else:
                entry["deployed_fingerprint"] = item["fingerprint"]
                if item.get("published_at"):
                    entry["published_at"] = item["published_at"]
            write_json(STATE, self.state)

    def report_error(self, pages, message):
        result = "發布前檢查失敗：" + message[:1800]
        for page in pages:
            if not self.requested(page) or any(x["page_id"] == uuid_text(page["id"]) for x in self.batch):
                continue
            latest = self.notion.call("GET", "/pages/" + uuid_text(page["id"]))
            if (not latest.get("archived") and not latest.get("in_trash") and
                    latest["last_edited_time"] == page["last_edited_time"] and
                    status_name(latest, self.config) == status_name(page, self.config) and
                    property_text(latest, self.p["result"]) != result):
                self.notion.call("PATCH", "/pages/" + uuid_text(page["id"]),
                                 {"properties": {self.p["result"]: text_property(result)}})


def output(name, value):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{name}={value}\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["preview", "publish", "finalize-success", "finalize-failure"])
    args = parser.parse_args()
    config, site = read_json("notion-sync.json"), read_json("config.json")
    if not os.environ.get("NOTION_TOKEN"):
        raise SyncError("Set the NOTION_TOKEN GitHub Actions secret first")
    if not os.environ.get("GITHUB_TOKEN"):
        raise SyncError("GITHUB_TOKEN is missing")
    repo = os.environ.get("GITHUB_REPOSITORY", "photohost/photohost.github.io")
    notion = API("https://api.notion.com/v1", os.environ["NOTION_TOKEN"],
                 {"Notion-Version": config["notion_version"]}, delay=0.35)
    github = API("https://api.github.com", os.environ["GITHUB_TOKEN"],
                 {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"})
    delete_token = os.environ.get("NOTION_DELETE_TOKEN")
    delete_github = API("https://api.github.com", delete_token,
        {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}) if delete_token else None
    sync = Sync(notion, github, repo, config, site, delete_github=delete_github)
    if args.command.startswith("finalize-"):
        sync.finalize(args.command == "finalize-success")
        return
    write_json(BATCH, [])
    pages = sync.publish_pages()
    print(f"Found {len(pages)} article(s) with publication commands")
    if not pages:
        output("has_articles", "false")
        return
    try:
        prepared = sync.prepare(pages, preview=args.command == "preview")
    except SyncError as exc:
        if args.command == "publish":
            sync.report_error(pages, str(exc))
        raise
    if args.command == "preview":
        PREVIEW.mkdir(parents=True, exist_ok=True)
        for item in prepared:
            (PREVIEW / (item["page_id"] + ".md")).write_text(item["body"], encoding="utf-8")
        write_json(PREVIEW / "plan.json", [{k: x[k] for k in ("page_id", "action", "title", "issue", "slug", "tags", "needs_sync")} for x in prepared])
        print("Preview generated. GitHub Issues and Notion were not modified.")
        return
    try:
        sync.publish(prepared)
    except SyncError as exc:
        sync.report_error(pages, str(exc))
        raise
    finally:
        output("has_articles", "true" if sync.batch else "false")


if __name__ == "__main__":
    try:
        main()
    except SyncError as exc:
        print("Sync stopped: " + str(exc), file=sys.stderr)
        sys.exit(1)


