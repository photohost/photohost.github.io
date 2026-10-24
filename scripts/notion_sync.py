"""Notion -> GitHub Issues. Python 3.12+, standard library only.

Preview is read-only remotely. Publish is explicitly selected by the workflow.
Only Ready pages are read; Published is written only after Pages deployment.
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
                raise SyncError(f"API {method} {path.split('?')[0]} returned HTTP {exc.code}") from None
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
        result = json.loads((body or "").split("\r\n")[-1].split("##")[1])
        return result if isinstance(result, dict) else {}
    except (ValueError, IndexError):
        return {}


def article_digest(title, body, labels):
    names = sorted(x["name"] if isinstance(x, dict) else x for x in labels)
    data = [title, (body or "").replace("\r\n", "\n"), names]
    return hashlib.sha256(json.dumps(data, ensure_ascii=False).encode()).hexdigest()


class Sync:
    def __init__(self, notion, github, repo, config, site, state=None, blog=None):
        self.notion, self.github, self.repo = notion, github, repo
        self.config, self.site = config, site
        self.p = config["properties"]
        self.state = state if state is not None else read_json(STATE, {"version": 1, "pages": {}})
        self.blog = blog if blog is not None else read_json("blogBase.json", {})
        self.batch = []

    def ready_pages(self):
        schema = self.notion.call("GET", "/data_sources/" + self.config["data_source_id"])
        types = {"title": "title", "status": "status", "tags": "multi_select", "date": "date",
                 "slug": "rich_text", "issue": "number", "url": "url", "result": "rich_text",
                 "synced": "date", "published": "checkbox"}
        for key, expected in types.items():
            if schema.get("properties", {}).get(self.p[key], {}).get("type") != expected:
                raise SyncError(f"Notion property {self.p[key]} must be {expected}")
        pages, cursor = [], None
        while True:
            body = {"page_size": 100, "filter": {"property": self.p["status"],
                      "status": {"equals": self.config["ready_status"]}}}
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
            title = property_text(page, self.p["title"]).strip()
            if not title or len(title) > 200 or "\n" in title or "\r" in title:
                raise SyncError(f"Ready page {pid} requires a title of 1–200 characters on one line")
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
            requested = property_text(page, self.p["slug"]).strip()
            if slug and requested and slug != requested:
                raise SyncError(f"{title}: keep the existing Slug {slug}; changing URLs requires a migration")
            slug = valid_slug(slug or requested or "notion-" + pid.replace("-", "")[:12])
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
                raise SyncError("Two Ready articles have the same backup filename")
            renderer = Renderer(self.notion, assets)
            markdown = renderer.render(renderer.children(pid))
            if not markdown.strip():
                raise SyncError(f"{title}: article body is empty")
            meta = source_config(issue.get("body")) if issue else {}
            date = page["properties"][self.p["date"]].get("date")
            if date:
                timestamp = dt.datetime.fromisoformat(date["start"].replace("Z", "+00:00"))
                if timestamp.tzinfo is None:
                    timestamp = timestamp.replace(tzinfo=dt.timezone(dt.timedelta(hours=self.site.get("UTC", 8))))
                meta["timestamp"] = int(timestamp.timestamp())
            # Keep enough metadata in the Issue to recover its URL even if the
            # response or the following state-file commit is interrupted.
            meta["notion_slug"] = slug
            body = markdown.replace("\r\n", "\n").replace("\n", "\r\n")
            body += f"\r\n\r\n<!-- notion-page:{pid} -->\r\n<!-- ##{json.dumps(meta, ensure_ascii=False)}## -->"
            if len(body.encode("utf-8")) > 60000:
                raise SyncError(f"{title}: article is too long for one GitHub Issue")
            latest = self.notion.call("GET", "/pages/" + pid)
            if latest["last_edited_time"] != page["last_edited_time"]:
                raise SyncError(f"{title}: content changed during export; rerun")
            prepared.append({"page_id": pid, "title": title, "file_title": file_title,
                             "body": body, "tags": tags, "slug": slug, "issue": number,
                             "old_issue": issue, "revision": latest["last_edited_time"]})
        return prepared

    def publish(self, prepared):
        labels = {x["name"] for x in self.github.pages(f"/repos/{self.repo}/labels")}
        for item in prepared:
            pid = item["page_id"]
            latest = self.notion.call("GET", "/pages/" + pid)
            if latest["last_edited_time"] != item["revision"] or status_name(latest, self.config) != self.config["ready_status"]:
                raise SyncError("A Ready article changed before publishing; rerun")
            for label in item["tags"]:
                if label not in labels:
                    self.github.call("POST", f"/repos/{self.repo}/labels", {"name": label, "color": "cfd3d7"})
                    labels.add(label)
            payload = {"title": item["title"], "body": item["body"], "labels": item["tags"]}
            if item["issue"]:
                current = self.github.call("GET", f"/repos/{self.repo}/issues/{item['issue']}")
                if current["updated_at"] != item["old_issue"]["updated_at"]:
                    raise SyncError("GitHub Issue changed during sync; rerun before overwriting")
                self.github.call("PATCH", f"/repos/{self.repo}/issues/{item['issue']}", payload)
            else:
                created = self.github.call("POST", f"/repos/{self.repo}/issues", payload)
                item["issue"] = created["number"]
            self.state["pages"][pid] = {"issue": item["issue"], "slug": item["slug"]}
            write_json(STATE, self.state)
            self.batch.append({"page_id": pid, "issue": item["issue"], "slug": item["slug"],
                               "fingerprint": article_digest(item["title"], item["body"], item["tags"]),
                               "revision": item["revision"]})
            write_json(BATCH, self.batch)
            updated = self.notion.call("PATCH", "/pages/" + pid, {"properties": {
                self.p["issue"]: {"number": item["issue"]}, self.p["slug"]: text_property(item["slug"]),
                self.p["result"]: text_property("已同步至 GitHub，等待網站部署")}})
            self.batch[-1]["revision"] = updated["last_edited_time"]
            write_json(BATCH, self.batch)
            print(f"Synced Issue #{item['issue']}; awaiting deployment")

    def finalize(self, succeeded):
        for item in read_json(BATCH, []):
            page = self.notion.call("GET", "/pages/" + item["page_id"])
            # Preserve edits made by the writer while Pages was building.
            if page.get("archived") or page.get("in_trash") or page["last_edited_time"] != item["revision"]:
                print("Notion page changed during deployment; left its status unchanged")
                continue
            if status_name(page, self.config) != self.config["ready_status"]:
                continue
            props = {self.p["result"]: text_property("網站部署失敗；修正後保持 Ready 並重新執行")}
            if succeeded:
                issue = self.github.call("GET", f"/repos/{self.repo}/issues/{item['issue']}")
                digest = article_digest(issue["title"], issue.get("body"), issue["labels"])
                if digest != item["fingerprint"]:
                    print("Issue changed during deployment; left Notion status unchanged")
                    continue
                props = {self.p["result"]: text_property("已成功發布至網站"),
                         self.p["status"]: {"status": {"name": self.config["published_status"]}},
                         self.p["published"]: {"checkbox": True},
                         self.p["synced"]: {"date": {"start": dt.datetime.now(dt.timezone.utc).isoformat()}},
                         self.p["url"]: {"url": self.site["homeUrl"].rstrip("/") + "/post/" + urllib.parse.quote(item["slug"], safe="") + ".html"}}
            self.notion.call("PATCH", "/pages/" + item["page_id"], {"properties": props})


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
    sync = Sync(notion, github, repo, config, site)
    if args.command.startswith("finalize-"):
        sync.finalize(args.command == "finalize-success")
        return
    write_json(BATCH, [])
    pages = sync.ready_pages()
    print(f"Found {len(pages)} Ready article(s)")
    if not pages:
        output("has_articles", "false")
        return
    prepared = sync.prepare(pages, preview=args.command == "preview")
    if args.command == "preview":
        PREVIEW.mkdir(parents=True, exist_ok=True)
        for item in prepared:
            (PREVIEW / (item["page_id"] + ".md")).write_text(item["body"], encoding="utf-8")
        write_json(PREVIEW / "plan.json", [{k: x[k] for k in ("page_id", "title", "issue", "slug", "tags")} for x in prepared])
        print("Preview generated. GitHub Issues and Notion were not modified.")
        return
    try:
        sync.publish(prepared)
    finally:
        output("has_articles", "true" if sync.batch else "false")


if __name__ == "__main__":
    try:
        main()
    except SyncError as exc:
        print("Sync stopped: " + str(exc), file=sys.stderr)
        sys.exit(1)
