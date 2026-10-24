"""Run upstream Gmeek with stable filenames for Notion-managed Issues."""
import ast
import os
from pathlib import Path
import shutil
import sys

from notion_sync import read_json, valid_slug, source_config, MARKER, SyncError


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
    tree.body.insert(matches[0] + 1, ast.parse("_install_fixed_slugs(GMEEK)").body[0])
    return ast.fix_missing_locations(tree)


def main():
    source_path = Path(sys.argv[1]).resolve()
    state = read_json(".notion-sync/state.json", {"pages": {}})
    # Running from the site checkout preserves static/ across docs/ rebuilds.
    shutil.copytree(source_path.parent / "templates", "templates", dirs_exist_ok=True)
    tree = adapted_tree(source_path.read_text(encoding="utf-8"))
    sys.argv = [str(source_path), os.environ["GITHUB_TOKEN"], os.environ["GITHUB_REPOSITORY"],
                "--issue_number", os.environ.get("ISSUE_NUMBER") or "0"]
    namespace = {"__name__": "__main__", "__file__": str(source_path),
                 "_install_fixed_slugs": lambda cls: install_fixed_slugs(cls, state)}
    exec(compile(tree, str(source_path), "exec"), namespace)


if __name__ == "__main__":
    main()
