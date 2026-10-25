import ast
import copy
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import notion_sync as ns
from build_gmeek import adapted_tree, install_fixed_slugs

CONFIG = json.loads((ROOT / "notion-sync.json").read_text(encoding="utf-8"))
PID = "11111111-1111-4111-8111-111111111111"
SITE = {"homeUrl": "https://example.test", "UTC": 8, "singlePage": ["link"]}


def text(value):
    return [{"type": "text", "plain_text": value, "text": {"content": value}, "annotations": {}}]


def article(status="Published"):
    return {"id": PID, "last_edited_time": "revision-0", "properties": {
        "Title": {"type": "title", "title": text("Sample")},
        "Status": {"type": "status", "status": {"name": status}},
        "Tags": {"type": "multi_select", "multi_select": [{"name": "Diary"}]},
        "日期": {"type": "date", "date": {"start": "2026-10-25"}},
        "Slug": {"type": "rich_text", "rich_text": []},
        "Issue 編號": {"type": "number", "number": None},
        "網站連結": {"type": "url", "url": None},
        "同步結果": {"type": "rich_text", "rich_text": []},
        "最後同步": {"type": "date", "date": None},
        "Published": {"type": "checkbox", "checkbox": False}}}


def issue(number=42, body="Original", title="Sample"):
    return {"number": number, "node_id": f"I_{number}", "title": title, "body": body, "state": "open",
            "updated_at": "issue-revision-0", "labels": [{"name": "Diary"}]}


class Notion:
    def __init__(self):
        self.page = article()
        self.blocks = [{"id": "block-1", "type": "paragraph", "paragraph": {"rich_text": text("Hello **literal** <script>")}}]
        self.mutations = []

    def call(self, method, path, data=None):
        if path.startswith("/data_sources/") and method == "GET":
            return {"properties": self.page["properties"]}
        if path.endswith("/query"):
            wanted = [x["status"]["equals"] for x in data["filter"]["or"]]
            rows = [self.page] if ns.status_name(self.page, CONFIG) in wanted else []
            return {"results": copy.deepcopy(rows), "has_more": False}
        if "/children?" in path:
            return {"results": copy.deepcopy(self.blocks), "has_more": False}
        if path == "/pages/" + PID:
            if method == "PATCH":
                self.mutations.append(copy.deepcopy(data))
                for name, value in data["properties"].items():
                    self.page["properties"][name].update(value)
                self.page["last_edited_time"] = f"revision-{len(self.mutations)}"
            return copy.deepcopy(self.page)
        raise AssertionError((method, path, data))


class GitHub:
    def __init__(self, issues=None):
        self.issues = {i["number"]: copy.deepcopy(i) for i in issues or []}
        self.mutations = []

    def pages(self, path):
        return copy.deepcopy(list(self.issues.values())) if "/issues?" in path else [{"name": "Diary"}]

    def call(self, method, path, data=None):
        if method == "GET":
            if path == "/user": return {"login": "owner"}
            if path == "/repos/owner/repo": return {"full_name": "owner/repo", "permissions": {"admin": True}}
            number = int(path.rsplit("/", 1)[-1])
            if number not in self.issues: raise ns.APIError(method, path, 410)
            return copy.deepcopy(self.issues[number])
        self.mutations.append((method, path, copy.deepcopy(data)))
        if path == "/graphql":
            del self.issues[int(data["variables"]["id"].split("_")[1])]
            return {"data": {"deleteIssue": {"repository": {"nameWithOwner": "owner/repo"}}}}
        if method == "POST" and path.endswith("/issues"):
            number = max(list(self.issues) + [0]) + 1
            self.issues[number] = issue(number, data["body"], data["title"])
        elif method == "PATCH":
            number = int(path.rsplit("/", 1)[-1])
            self.issues[number].update(data)
            self.issues[number]["updated_at"] = f"issue-revision-{len(self.mutations)}"
        else:
            raise AssertionError((method, path, data))
        return copy.deepcopy(self.issues[number])


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.previous = Path.cwd()
        os.chdir(self.tmp.name)
        self.notion = Notion()
        self.github = GitHub()

    def tearDown(self):
        os.chdir(self.previous)
        self.tmp.cleanup()

    def sync(self, state=None, blog=None):
        return ns.Sync(self.notion, self.github, "owner/repo", CONFIG, SITE,
                       state if state is not None else {"pages": {}}, blog if blog is not None else {}, delete_github=self.github)

    def prepare(self, sync):
        return sync.prepare(sync.publish_pages(), preview=True)

    def test_only_published_is_selected(self):
        for status in ("Draft", "Ready"):
            self.notion.page = article(status)
            self.assertEqual(self.sync().publish_pages(), [])
        self.notion.page = article("Published")
        self.assertEqual(len(self.sync().publish_pages()), 1)
        self.assertEqual(self.notion.mutations + self.github.mutations, [])

    def test_preview_is_remote_read_only_and_escapes_literal_markup(self):
        plan = self.prepare(self.sync())
        self.assertIn(r"\*\*literal\*\*", plan[0]["body"])
        self.assertIn("&lt;script&gt;", plan[0]["body"])
        self.assertEqual(self.notion.mutations + self.github.mutations, [])
        self.assertEqual(ns.source_config(plan[0]["body"])["timestamp"], 1792857600)

    def test_create_deploy_then_update_same_issue(self):
        sync = self.sync()
        sync.publish(self.prepare(sync))
        self.assertEqual(ns.status_name(self.notion.page, CONFIG), "Published")
        self.assertFalse(self.notion.page["properties"]["Published"]["checkbox"])
        sync.finalize(True)
        self.assertEqual(ns.status_name(self.notion.page, CONFIG), "Published")
        self.assertTrue(self.notion.page["properties"]["Published"]["checkbox"])
        self.notion.page["properties"]["Title"]["title"] = text("Renamed")
        self.notion.page["properties"]["Status"]["status"]["name"] = "repost"
        second = self.sync(state=sync.state)
        second.publish(self.prepare(second))
        self.assertEqual(len(self.github.issues), 1)
        self.assertEqual(self.github.issues[1]["title"], "Renamed")
        self.assertEqual(self.notion.page["properties"]["網站連結"]["url"],
                         "https://example.test/post/notion-111111111111.html")

    def test_recovery_uses_marker_if_notion_writeback_and_state_were_lost(self):
        self.github = GitHub([issue(body=f"old\r\n<!-- notion-page:{PID} -->")])
        sync = self.sync()
        sync.publish(self.prepare(sync))
        self.assertEqual(len(self.github.issues), 1)
        self.assertEqual(self.notion.page["properties"]["Issue 編號"]["number"], 42)

    def test_existing_issue_keeps_unicode_url_and_custom_metadata(self):
        self.github = GitHub([issue(body='old\r\n<!-- ##{"style":"abc","timestamp":1}## -->')])
        self.notion.page["properties"]["Issue 編號"]["number"] = 42
        sync = self.sync(blog={"postListJson": {"P42": {"postUrl": "post/%E6%97%A5%E8%A8%98.html"}}})
        plan = self.prepare(sync)[0]
        self.assertEqual(plan["slug"], "日記")
        self.assertEqual(ns.source_config(plan["body"])["style"], "abc")

    def test_slug_change_and_collision_are_rejected(self):
        self.github = GitHub([issue()])
        self.notion.page["properties"]["Issue 編號"]["number"] = 42
        self.notion.page["properties"]["Slug"]["rich_text"] = text("different")
        with self.assertRaises(ns.SyncError):
            self.prepare(self.sync(state={"pages": {PID: {"issue": 42, "slug": "original"}}}))
        self.notion.page["properties"]["Issue 編號"]["number"] = None
        self.github = GitHub()
        with self.assertRaises(ns.SyncError):
            self.prepare(self.sync(blog={"postListJson": {"P9": {"postUrl": "post/different.html"}}}))

    def test_closed_issue_and_mapping_to_other_page_are_rejected(self):
        closed = issue()
        closed["state"] = "closed"
        self.github = GitHub([closed])
        self.notion.page["properties"]["Issue 編號"]["number"] = 42
        with self.assertRaises(ns.SyncError):
            self.prepare(self.sync())
        self.github = GitHub([issue(body="<!-- notion-page:22222222-2222-4222-8222-222222222222 -->")])
        with self.assertRaises(ns.SyncError):
            self.prepare(self.sync())

    def test_unsupported_block_stops_before_remote_writes(self):
        self.notion.blocks = [{"id": "b", "type": "child_database", "child_database": {"title": "Private"}}]
        with self.assertRaises(ns.SyncError):
            self.prepare(self.sync())
        self.assertEqual(self.notion.mutations + self.github.mutations, [])

    def test_publish_detects_edit_since_preview(self):
        sync = self.sync()
        plan = self.prepare(sync)
        self.notion.page["last_edited_time"] = "user-edited"
        with self.assertRaises(ns.SyncError):
            sync.publish(plan)
        self.assertEqual(self.github.mutations, [])

    def test_deployment_failure_keeps_published_for_retry(self):
        sync = self.sync()
        sync.publish(self.prepare(sync))
        sync.finalize(False)
        self.assertEqual(ns.status_name(self.notion.page, CONFIG), "Published")
        self.assertNotIn("deployed_fingerprint", sync.state["pages"][PID])
        self.assertFalse(self.notion.page["properties"]["Published"]["checkbox"])
        self.assertIsNone(self.notion.page["properties"]["網站連結"]["url"])

    def test_edit_during_build_preserves_writer_status(self):
        sync = self.sync()
        sync.publish(self.prepare(sync))
        self.notion.page["last_edited_time"] = "user-edited"
        self.notion.page["properties"]["Status"]["status"]["name"] = "Draft"
        count = len(self.notion.mutations)
        sync.finalize(True)
        self.assertEqual(len(self.notion.mutations), count)
        self.assertEqual(ns.status_name(self.notion.page, CONFIG), "Draft")

    def test_issue_edit_during_build_does_not_mark_published(self):
        sync = self.sync()
        sync.publish(self.prepare(sync))
        self.github.issues[1]["body"] = "Edited on GitHub"
        sync.finalize(True)
        self.assertFalse(self.notion.page["properties"]["Published"]["checkbox"])
        self.assertNotIn("deployed_fingerprint", sync.state["pages"][PID])

    def test_title_change_during_build_does_not_mark_published(self):
        sync = self.sync()
        sync.publish(self.prepare(sync))
        self.github.issues[1]["title"] = "Changed externally"
        sync.finalize(True)
        self.assertFalse(self.notion.page["properties"]["Published"]["checkbox"])
        self.assertNotIn("deployed_fingerprint", sync.state["pages"][PID])

    def test_github_newline_normalization_is_accepted(self):
        sync = self.sync()
        sync.publish(self.prepare(sync))
        self.github.issues[1]["body"] = self.github.issues[1]["body"].replace("\r\n", "\n")
        sync.finalize(True)
        self.assertEqual(ns.status_name(self.notion.page, CONFIG), "Published")

    def test_duplicate_marker_is_rejected(self):
        body = f"<!-- notion-page:{PID} -->"
        self.github = GitHub([issue(41, body), issue(42, body)])
        with self.assertRaises(ns.SyncError):
            self.prepare(self.sync())

    def test_missing_tags_is_rejected(self):
        self.notion.page["properties"]["Tags"]["multi_select"] = []
        with self.assertRaises(ns.SyncError):
            self.prepare(self.sync())

    def test_repeated_poll_after_deployment_is_noop_including_writeback(self):
        sync = self.sync()
        sync.publish(self.prepare(sync))
        sync.finalize(True)
        saved = ns.read_json(ns.STATE)
        self.assertIn("deployed_fingerprint", saved["pages"][PID])
        counts = (len(self.notion.mutations), len(self.github.mutations))
        second = self.sync(state=saved)
        plan = self.prepare(second)
        self.assertFalse(plan[0]["needs_sync"])
        second.publish(plan)
        self.assertEqual(second.batch, [])
        self.assertEqual((len(self.notion.mutations), len(self.github.mutations)), counts)

    def test_updated_content_retries_failed_deployment_without_patching_issue_again(self):
        sync = self.sync()
        sync.publish(self.prepare(sync))
        sync.finalize(True)
        previous_digest = sync.state["pages"][PID]["deployed_fingerprint"]
        self.notion.blocks[0]["paragraph"]["rich_text"] = text("Updated body")
        self.notion.page["properties"]["Status"]["status"]["name"] = "repost"
        second = self.sync(state=ns.read_json(ns.STATE))
        second.publish(self.prepare(second))
        second.finalize(False)
        self.assertEqual(second.state["pages"][PID]["deployed_fingerprint"], previous_digest)
        mutations = len(self.github.mutations)
        retry = self.sync(state=ns.read_json(ns.STATE))
        self.assertTrue(self.prepare(retry)[0]["needs_sync"])
        retry.publish(self.prepare(retry))
        self.assertEqual(len(self.github.mutations), mutations)
        self.assertEqual(len(retry.batch), 1)
        retry.finalize(True)
        self.assertFalse(self.prepare(self.sync(state=ns.read_json(ns.STATE)))[0]["needs_sync"])
        self.assertEqual(len(self.github.issues), 1)

    def test_legacy_mapping_without_receipt_deploys_once(self):
        sync = self.sync()
        sync.publish(self.prepare(sync))
        legacy_state = copy.deepcopy(sync.state)
        retry = self.sync(state=legacy_state)
        self.assertTrue(self.prepare(retry)[0]["needs_sync"])
        retry.publish(self.prepare(retry))
        retry.finalize(True)
        self.assertFalse(self.prepare(retry)[0]["needs_sync"])
        self.assertEqual(len(self.github.issues), 1)

    def test_switch_to_draft_before_publish_stops_writes(self):
        sync = self.sync()
        plan = self.prepare(sync)
        self.notion.page["properties"]["Status"]["status"]["name"] = "Draft"
        with self.assertRaises(ns.SyncError):
            sync.publish(plan)
        self.assertEqual(self.github.mutations + self.notion.mutations, [])

    def test_report_error_is_visible_and_does_not_repeat_or_overwrite_edits(self):
        sync = self.sync()
        sync.report_error(sync.publish_pages(), "Unsupported Notion block")
        self.assertIn("Unsupported", ns.property_text(self.notion.page, "同步結果"))
        self.assertEqual(ns.status_name(self.notion.page, CONFIG), "Published")
        count = len(self.notion.mutations)
        sync.report_error(sync.publish_pages(), "Unsupported Notion block")
        self.assertEqual(len(self.notion.mutations), count)
        pages = sync.publish_pages()
        self.notion.page["last_edited_time"] = "user-edited"
        sync.report_error(pages, "A new error")
        self.assertEqual(len(self.notion.mutations), count)

    def test_external_issue_edit_also_requires_explicit_repost(self):
        sync = self.sync()
        sync.publish(self.prepare(sync))
        sync.finalize(True)
        self.github.issues[1]["body"] = "Changed externally"
        self.assertFalse(self.prepare(sync)[0]["needs_sync"])
        self.notion.page["properties"]["Status"]["status"]["name"] = "repost"
        self.assertTrue(self.prepare(sync)[0]["needs_sync"])

    def deployed(self):
        sync = self.sync()
        sync.publish(self.prepare(sync))
        sync.finalize(True)
        return sync

    def set_status(self, value):
        self.notion.page["properties"]["Status"]["status"]["name"] = value

    def test_edit_published_does_not_export_blocks_or_upload_attachments(self):
        sync = self.deployed()
        self.notion.blocks = [{"type": "unsupported_private_draft"}]
        count = len(self.github.mutations)
        sync.publish(self.prepare(sync))
        self.assertEqual(len(self.github.mutations), count)

    def test_repost_without_content_changes_acknowledges_and_returns_published(self):
        sync = self.deployed()
        self.set_status("repost")
        second = self.sync(state=sync.state)
        count = len(self.github.mutations)
        second.publish(self.prepare(second))
        self.assertEqual(len(second.batch), 1)
        self.assertEqual(len(self.github.mutations), count)
        second.finalize(True)
        self.assertEqual(ns.status_name(self.notion.page, CONFIG), "Published")

    def test_delete_removes_issue_then_reports_only_after_successful_deployment(self):
        sync = self.deployed()
        self.set_status("delete")
        self.notion.blocks = [{"type": "unsupported_private_draft"}]
        second = self.sync(state=sync.state)
        second.publish(self.prepare(second))
        self.assertEqual(self.github.issues, {})
        self.assertTrue(self.notion.page["properties"]["Published"]["checkbox"])
        second.finalize(True)
        self.assertFalse(self.notion.page["properties"]["Published"]["checkbox"])
        self.assertIsNone(self.notion.page["properties"]["網站連結"]["url"])
        self.assertIsNone(self.notion.page["properties"]["Issue 編號"]["number"])
        self.assertEqual(ns.status_name(self.notion.page, CONFIG), "delete")
        self.assertTrue(second.state["pages"][PID]["deletion_deployed"])
        third = self.sync(state=ns.read_json(ns.STATE))
        third.publish(self.prepare(third))
        self.assertEqual(third.batch, [])
        self.set_status("Published")
        third.publish(self.prepare(third))
        self.assertEqual(self.github.issues, {})

    def test_failed_delete_deployment_retries_without_redeleting_issue(self):
        sync = self.deployed()
        self.set_status("delete")
        second = self.sync(state=sync.state)
        second.publish(self.prepare(second))
        second.finalize(False)
        self.assertIn("保持 delete", ns.property_text(self.notion.page, "同步結果"))
        count = len(self.github.mutations)
        third = self.sync(state=ns.read_json(ns.STATE))
        third.publish(self.prepare(third))
        self.assertEqual(len(self.github.mutations), count)
        third.finalize(True)
        self.assertTrue(third.state["pages"][PID]["deletion_deployed"])

    def test_delete_response_lost_recovers_using_existing_mapping(self):
        sync = self.deployed()
        self.set_status("delete")
        self.github.issues.clear()
        second = self.sync(state=sync.state)
        second.publish(self.prepare(second))
        self.assertEqual(second.batch[0]["action"], "delete")

    def test_delete_requires_token_and_exact_notion_marker(self):
        sync = self.deployed()
        self.set_status("delete")
        second = self.sync(state=sync.state)
        second.delete_github = None
        with self.assertRaisesRegex(ns.SyncError, "NOTION_DELETE_TOKEN"):
            second.publish(self.prepare(second))
        self.assertEqual(len(self.github.issues), 1)
        self.github.issues[1]["body"] = "Another article"
        with self.assertRaisesRegex(ns.SyncError, "唯一對應標記"):
            self.prepare(second)

    def test_delete_wrong_number_or_changed_status_never_deletes(self):
        sync = self.deployed()
        self.set_status("delete")
        second = self.sync(state=sync.state)
        self.notion.page["properties"]["Issue 編號"]["number"] = 99
        with self.assertRaises(ns.SyncError): self.prepare(second)
        self.notion.page["properties"]["Issue 編號"]["number"] = 1
        plan = self.prepare(second)
        self.set_status("Draft")
        with self.assertRaises(ns.SyncError): second.publish(plan)
        self.assertEqual(len(self.github.issues), 1)


class RenderingAndBuildTests(unittest.TestCase):
    def test_paginated_block_children(self):
        class Paginated:
            def call(self, method, path):
                if "start_cursor=next" in path:
                    return {"results": [2], "has_more": False}
                return {"results": [1], "has_more": True, "next_cursor": "next"}
        self.assertEqual(ns.Renderer(Paginated(), None).children("id"), [1, 2])

    def test_code_fences_survive_backticks(self):
        block = {"type": "code", "code": {"language": "markdown", "rich_text": text("```\ncode\n```")}}
        result = ns.Renderer(None, None).render([block])
        self.assertTrue(result.startswith("````markdown"))
        self.assertTrue(result.endswith("````"))

    def test_asset_host_and_slug_validation(self):
        self.assertTrue(ns.asset_host("https://prod-files-secure.s3.us-west-2.amazonaws.com/a.png?secret=x"))
        for url in ("http://127.0.0.1/a", "https://amazonaws.com.attacker.test/a", "file:///secret"):
            self.assertFalse(ns.asset_host(url))
        for slug in ("../x", "a/b", "https://site", "name.html", ""):
            with self.assertRaises(ns.SyncError):
                ns.valid_slug(slug)

    def test_adapter_changes_only_notion_regular_posts(self):
        source = '''class GMEEK:
    def createFileName(self, issue, useLabel=False):
        return "single-page" if useLabel else issue.title
    def runAll(self): pass
    def markdown2html(self, mdstr): pass
    def addOnePostJson(self, issue): pass
    def createPostHtml(self, issue): pass
    def createPlistHtml(self): pass
    def createFeedXml(self): pass
instance = GMEEK()
'''
        namespace = {"_install_fixed_slugs": lambda cls: install_fixed_slugs(cls, {"pages": {PID: {"issue": 42, "slug": "fixed"}}})}
        exec(compile(adapted_tree(source), "fixture", "exec"), namespace)
        builder = namespace["instance"]
        self.assertEqual(builder.createFileName(SimpleNamespace(number=42, title="Changed")), "fixed")
        self.assertEqual(builder.createFileName(SimpleNamespace(number=9, title="Existing")), "Existing")
        self.assertEqual(builder.createFileName(SimpleNamespace(number=42, title="Changed"), True), "single-page")
        recovered = SimpleNamespace(number=43, title="New title", body=f'<!-- notion-page:{PID} -->\r\n<!-- ##{{"notion_slug":"recover-url"}}## -->')
        self.assertEqual(builder.createFileName(recovered), "recover-url")

    def test_changed_upstream_interface_fails_closed(self):
        with self.assertRaises(ns.SyncError):
            adapted_tree("class GMEEK:\n    def createFileName(self, issue): pass\n")


if __name__ == "__main__":
    unittest.main()
