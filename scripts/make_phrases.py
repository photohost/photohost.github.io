"""Build static/phrases.json: short sentence fragments from article excerpts.

The browser picks a different slice each calendar month, so this only needs
rerunning after new articles are published (not on every deploy).
"""
import json
import re
from pathlib import Path

SOURCE = Path("docs/postList.json")
TARGET = Path("static/phrases.json")
SPLIT = re.compile(r"[。！？!?；;\n]+")
MIN, MAX = 6, 22


def phrases(index):
    seen, out = set(), []
    for post in index.values():
        if not isinstance(post, dict):
            continue
        for part in SPLIT.split(str(post.get("excerpt", ""))):
            text = re.sub(r"\s+", "", part).strip("，,、.…—-（）()「」\"'")
            if not (MIN <= len(text) <= MAX) or "http" in text or "`" in text:
                continue
            if text not in seen:
                seen.add(text)
                out.append(text)
    return out


if __name__ == "__main__":
    items = phrases(json.loads(SOURCE.read_text(encoding="utf-8")))
    TARGET.write_text(json.dumps(items, ensure_ascii=False, indent=0), encoding="utf-8")
    print(f"{len(items)} phrases")
