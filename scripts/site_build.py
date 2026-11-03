"""Select a conservative static-resource refresh or a normal Gmeek build."""
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import sys

from font_pilot import font_head

RECEIPT = Path(".gmeek-build.json")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def snapshot():
    config = read_json("config.json")
    all_head = config.pop("allHead", "")
    renderer = {str(path.as_posix()): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in sorted(Path("scripts").glob("*.py"))}
    assets = {path.relative_to("static").as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
              for path in sorted(Path("static").rglob("*")) if path.is_file()}
    return {"version": 1, "config": config, "renderer": renderer,
            "allHead": all_head, "assets": assets}


def baseline():
    try:
        data = read_json(RECEIPT)
        if data.get("version") == 1:
            return data
    except (FileNotFoundError, ValueError):
        pass
    return {}


def site_exists():
    try:
        index = read_json("blogBase.json")
        outputs = ["docs/index.html", "docs/tag.html", "docs/rss.xml"]
        for name in ("postListJson", "singeListJson"):
            outputs.extend(post["htmlDir"] for post in index[name].values())
        return all(Path(path).is_file() for path in outputs)
    except (FileNotFoundError, ValueError, KeyError, TypeError):
        return False


def compatible(previous, current):
    return (previous.get("version") == 1 and
            previous.get("config") == current["config"] and
            previous.get("renderer") == current["renderer"] and site_exists())


# Match root-relative URLs in the configured script and stylesheet tags only.
ASSET_URL = re.compile(r"""(<(?:script|link)\b[^>]*?\s(?:src|href)=)(["'])(/[^"']+)\2""")


def version_assets(fragment, assets):
    def replace(match):
        prefix, quote, url = match.groups()
        resource, anchor, fragment_id = url.partition("#")
        path, _, query = resource.partition("?")
        digest = assets.get(path[1:])
        if not digest or Path(path).suffix.lower() not in (".js", ".css"):
            return match[0]
        params = [part for part in re.split(r"&(?:amp;)?", query)
                  if part and part.split("=", 1)[0] != "v"]
        params.append("v=" + digest[:16])
        url = path + "?" + "&amp;".join(params) + anchor + fragment_id
        return prefix + quote + url + quote

    return ASSET_URL.sub(replace, fragment)


def html_updates(previous, current, rendered=False):
    old_raw, new_raw = previous["allHead"], current["allHead"]
    old = version_assets(old_raw, previous["assets"])
    new = version_assets(new_raw, current["assets"])
    script = current["config"].get("script", "")
    old_script = version_assets(script, previous["assets"])
    new_script = version_assets(script, current["assets"])
    updates = {}
    refresh_head = old != new or (rendered and new_raw != new)
    if not refresh_head and old_script == new_script and not rendered:
        return updates
    if refresh_head and not old_raw:
        raise ValueError("No previous shared head to replace")
    for path in Path("docs").rglob("*.html"):
        html = path.read_text(encoding="utf-8")
        updated = html
        if refresh_head:
            head, separator, body = html.partition("</head>")
            candidates = (old, font_head(path, html, old))
            if rendered:
                candidates += (old_raw, font_head(path, html, old_raw))
            previous_head = next((item for item in candidates if head.count(item) == 1), None)
            if not separator or previous_head is None:
                raise ValueError(f"Cannot safely refresh shared head in {path}")
            updated = head.replace(previous_head, font_head(path, html, new), 1) + separator + body
        if old_script != new_script or (rendered and script != new_script):
            candidates = (old_script, script) if rendered else (old_script,)
            # Gmeek places the configured footer script immediately before </html>.
            for candidate in candidates:
                updated, count = re.subn(re.escape(candidate) + r"(?=\s*</html>\s*$)",
                                         lambda _: new_script, updated, count=1)
                if count:
                    break
        if updated != html:
            updates[path] = updated
    return updates


def version_rendered_pages():
    current = snapshot()
    for path, html in html_updates(current, current, rendered=True).items():
        path.write_text(html, encoding="utf-8")


def can_refresh():
    previous, current = baseline(), snapshot()
    if not compatible(previous, current):
        return False
    before, after = previous["assets"], current["assets"]
    changed = {path for path in before.keys() | after.keys() if before.get(path) != after.get(path)}
    if any(Path(path).suffix.lower() not in (".js", ".css") for path in changed):
        return False
    try:
        html_updates(previous, current)
    except ValueError:
        return False
    return True


def can_increment(copy_assets=False):
    previous, current = baseline(), snapshot()
    # An incremental article build must not certify stale site-wide settings.
    return (compatible(previous, current) and previous["allHead"] == current["allHead"] and
            ((previous["assets"].keys() <= current["assets"].keys() and
              all(previous["assets"].get(path) == digest for path, digest in current["assets"].items()
                  if Path(path).suffix.lower() in (".js", ".css"))) if copy_assets
             else previous["assets"] == current["assets"]))


def save_receipt():
    write_json(RECEIPT, snapshot())


def refresh():
    if not can_refresh():
        raise ValueError("Site inputs changed; use a full build")
    previous, current = baseline(), snapshot()
    updates = html_updates(previous, current)  # Validate every page before writing.
    for name in previous["assets"].keys() - current["assets"].keys():
        target = Path("docs") / name
        target.resolve().relative_to(Path("docs").resolve())
        target.unlink(missing_ok=True)
    if Path("static").is_dir():
        shutil.copytree("static", "docs", dirs_exist_ok=True)
    for path, html in updates.items():
        path.write_text(html, encoding="utf-8")
    index = read_json("blogBase.json")
    index["allHead"] = current["allHead"]
    write_json("blogBase.json", index)
    save_receipt()
    print(f"Static resource refresh complete; updated {len(updates)} HTML pages; article rendering skipped")


def choose():
    event = os.environ.get("EVENT", "")
    mode = os.environ.get("INPUT_MODE") or "build"
    if event == "schedule" and os.environ.get("EVENT_SCHEDULE") != "0 16 * * *":
        mode = "notion-publish"
    elif event == "push":
        mode = "assets" if can_refresh() else "build"
    if mode not in ("build", "assets", "notion-preview", "notion-publish"):
        raise ValueError("Unknown build mode")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"mode={mode}\n")
        output.write(f"build={str(mode in ('build', 'assets')).lower()}\n")
    print(f"Selected build mode: {mode}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as output:
            output.write(f"Build mode: **{mode}**\n")


if __name__ == "__main__":
    if sys.argv[1] == "choose":
        choose()
    elif sys.argv[1] == "refresh":
        refresh()
    else:
        raise ValueError("Unknown command")

