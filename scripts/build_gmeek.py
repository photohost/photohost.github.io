"""Run upstream Gmeek with stable filenames for Notion-managed Issues."""
import ast
import json
import os
import re
from pathlib import Path
import shutil
import sys
import time
import urllib.error
import urllib.request

from notion_sync import read_json, valid_slug, source_config, MARKER, BATCH, SyncError


def install_fixed_slugs(cls, state):
    filenames = {int(x["issue"]): valid_slug(x["slug"]) for x in state.get("pages", {}).values()}
    original = cls.createFileName

    def create_filename(self, issue, useLabel=False):
        if not useLabel and issue.number in filenames:
            return filenames[issue.number]
        if not useLabel and MARKER.search(getattr(issue, "body", None) or ""):
            slug = source_config(issue.body).get("notion_slug")
            if slug:
                return valid_slug(slug)
        return original(self, issue, useLabel)

    cls.createFileName = create_filename


def render_markdown(self, markdown):
    """Pace Markdown requests and retry transient failures without logging content."""
    request = urllib.request.Request("https://api.github.com/markdown",
        data=json.dumps({"text": markdown, "mode": "gfm"}).encode(),
        headers={"Authorization": "Bearer " + self.options.github_token,
                 "Content-Type": "application/json", "User-Agent": "notion-gmeek-build"})
    for attempt in range(4):
        time.sleep(1)  # GitHub recommends spacing sequential POSTs by at least 1s.
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                return response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            # Inspect only to distinguish throttling from a permissions error.
            body = exc.read(8192).decode("utf-8", errors="replace").lower()
            retry_after = exc.headers.get("Retry-After", "")
            remaining = exc.headers.get("X-RateLimit-Remaining", "")
            limited = exc.code == 429 or (exc.code == 403 and
                (retry_after or remaining == "0" or "rate limit" in body or "abuse" in body))
            delay = 60 * (attempt + 1) if limited else 2 ** (attempt + 1)
            if retry_after.isdigit():
                delay = max(delay, int(retry_after))
            reset = exc.headers.get("X-RateLimit-Reset", "")
            if remaining == "0" and reset.isdigit():
                delay = max(delay, int(reset) - time.time() + 1)
            if attempt < 3 and (limited or exc.code >= 500) and delay <= 180:
                print(f"GitHub Markdown HTTP {exc.code}; retrying in {delay:.0f}s", flush=True)
                time.sleep(delay)
                continue
            reason = "rate limit; retry after GitHub's cooldown" if limited else "request rejected"
            raise SyncError(f"GitHub Markdown HTTP {exc.code}: {reason}") from None
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt < 3:
                time.sleep(2 ** (attempt + 1))
                continue
            raise SyncError("GitHub Markdown network request failed after retries") from None


def install_incremental_build(cls, batch):
    """Retain published HTML and render only this Notion deployment's Issues."""
    original = cls.runAll
    deleted = [item for item in batch if item.get("action") == "delete"]
    issue_numbers = sorted({int(item["issue"]) for item in batch if item.get("action") != "delete"})
    if not batch or any(int(item["issue"]) <= 0 for item in batch):
        raise SyncError("Notion publishing requires a nonempty deployment batch")
    if any(item.get("action", "publish") not in ("publish", "delete") for item in batch):
        raise SyncError("Unknown Notion deployment action")
    if set(issue_numbers) & {int(item["issue"]) for item in deleted}:
        raise SyncError("Conflicting Notion deployment actions")

    def run_batch(self):
        previous = read_json("blogBase.json")
        if not previous or not (Path(self.root_dir) / "index.html").is_file():
            print("No existing site; building all articles", flush=True)
            return original(self)
        for name in ("postListJson", "singeListJson"):
            if not isinstance(previous.get(name), dict):
                raise SyncError("Existing blog index is invalid; run a full build to recover")
            self.blogBase[name] = previous[name]
        Path(self.backup_dir).mkdir(parents=True, exist_ok=True)
        Path(self.post_dir).mkdir(parents=True, exist_ok=True)
        if Path(self.static_dir).exists():
            shutil.copytree(self.static_dir, self.root_dir, dirs_exist_ok=True)
        for item in deleted:
            key = "P" + str(int(item["issue"]))
            slug = valid_slug(item["slug"])
            for collection in ("postListJson", "singeListJson"):
                post = self.blogBase[collection].pop(key, None)
                if post:
                    from notion_sync import existing_slug
                    if existing_slug(post) != slug:
                        raise SyncError("Deleted article URL disagrees with the deployment receipt")
                    filename = re.sub(r'[<>:/\\|?*"\x00-\x1f]', '-', post["postTitle"]) + ".md"
                    (Path(self.backup_dir) / filename).unlink(missing_ok=True)
            (Path(self.post_dir) / (slug + ".html")).unlink(missing_ok=True)
        if deleted:
            # Rebuild RSS from the remaining index, never reuse the pre-delete feed.
            self.oldFeedString = ""
            for path in Path(self.root_dir).glob("page*.html"):
                if re.fullmatch(r"page[0-9]+\.html", path.name):
                    path.unlink()  # A smaller index must not leave stale pagination.
            deleted_pages = {item.get("page_id") for item in deleted} - {None}
            for path in Path(self.backup_dir).glob("*.md"):
                if set(MARKER.findall(path.read_text(encoding="utf-8"))) & deleted_pages:
                    path.unlink()
        print(f"Incremental Notion build: {len(issue_numbers)} article(s)", flush=True)
        for number in issue_numbers:
            issue = self.repo.get_issue(number)
            if issue.state != "open":
                raise SyncError(f"Notion Issue #{number} was closed before the build")
            collection = self.addOnePostJson(issue)
            if collection not in ("postListJson", "singeListJson"):
                raise SyncError(f"Notion Issue #{number} cannot be published by Gmeek")
            key = "P" + str(number)
            other = "singeListJson" if collection == "postListJson" else "postListJson"
            self.blogBase[other].pop(key, None)
            self.createPostHtml(self.blogBase[collection][key])
        self.createPlistHtml()
        self.createFeedXml()

    cls.runAll = run_batch


def install_adapter(cls, state, batch=None):
    install_fixed_slugs(cls, state)
    cls.markdown2html = render_markdown
    if batch is not None:
        install_incremental_build(cls, batch)


def adapted_tree(source):
    tree = ast.parse(source)
    matches = [i for i, node in enumerate(tree.body) if isinstance(node, ast.ClassDef) and node.name == "GMEEK"]
    if len(matches) != 1:
        raise SyncError("Gmeek class changed; review the adapter before building")
    cls = tree.body[matches[0]]
    methods = {node.name: node for node in cls.body if isinstance(node, ast.FunctionDef)}
    method = methods.get("createFileName")
    if not method or [a.arg for a in method.args.args] != ["self", "issue", "useLabel"]:
        raise SyncError("Gmeek filename interface changed; review the adapter before building")
    for name, args in {"runAll": ["self"], "markdown2html": ["self", "mdstr"],
                       "addOnePostJson": ["self", "issue"], "createPostHtml": ["self", "issue"],
                       "createPlistHtml": ["self"], "createFeedXml": ["self"]}.items():
        method = methods.get(name)
        if not method or [a.arg for a in method.args.args] != args:
            raise SyncError(f"Gmeek {name} interface changed; review the adapter before building")
    tree.body.insert(matches[0] + 1, ast.parse("_install_fixed_slugs(GMEEK)").body[0])
    return ast.fix_missing_locations(tree)


def main():
    source_path = Path(sys.argv[1]).resolve()
    state = read_json(".notion-sync/state.json", {"pages": {}})
    batch = read_json(BATCH, []) if os.environ.get("SYNC_MODE") == "notion-publish" else None
    # Running from the site checkout preserves static/ across docs/ rebuilds.
    shutil.copytree(source_path.parent / "templates", "templates", dirs_exist_ok=True)
    tree = adapted_tree(source_path.read_text(encoding="utf-8"))
    sys.argv = [str(source_path), os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"],
                "--issue_number", os.environ.get("ISSUE_NUMBER") or "0"]
    namespace = {"__name__": "__main__", "__file__": str(source_path),
                 "_install_fixed_slugs": lambda cls: install_adapter(cls, state, batch)}
    exec(compile(tree, str(source_path), "exec"), namespace)


if __name__ == "__main__":
    main()
