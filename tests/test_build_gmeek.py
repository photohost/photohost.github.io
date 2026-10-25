import io
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from build_gmeek import install_incremental_build, render_markdown
from notion_sync import SyncError


class IncrementalBuildTests(unittest.TestCase):
    def setUp(self):
        self.old = Path.cwd()
        self.temp = tempfile.TemporaryDirectory()
        os.chdir(self.temp.name)
        self.addCleanup(self.cleanup)
        Path("docs/post").mkdir(parents=True)
        Path("docs/index.html").write_text("old index")
        Path("docs/post/legacy.html").write_text("unchanged HTML")
        self.previous = {"postListJson": {"P1": {"postTitle": "Legacy"}}, "singeListJson": {}}
        Path("blogBase.json").write_text(json.dumps(self.previous))

    def cleanup(self):
        os.chdir(self.old)
        self.temp.cleanup()

    def builder(self, batch):
        class Builder:
            root_dir, static_dir = "docs/", "static/"
            post_dir, backup_dir = "docs/post/", "backup/"
            def runAll(self): self.full_build()
            def addOnePostJson(self, issue):
                self.blogBase["postListJson"][f"P{issue.number}"] = {"postTitle": str(issue.number)}
                return "postListJson"
        install_incremental_build(Builder, batch)
        builder = Builder()
        builder.full_build = Mock()
        builder.blogBase = {"title": "Current config", "labelColorDict": {"New": "#abc"}}
        builder.repo = NS(get_issue=Mock(side_effect=lambda number: NS(number=number, state="open")))
        builder.createPostHtml, builder.createPlistHtml, builder.createFeedXml = Mock(), Mock(), Mock()
        return builder

    def test_only_changed_articles_rendered_old_html_and_images_preserved(self):
        Path("static/notion-assets").mkdir(parents=True)
        Path("static/notion-assets/image.png").write_bytes(b"image")
        builder = self.builder([{"issue": 205}, {"issue": 206}, {"issue": 205}])
        builder.runAll()
        self.assertEqual(builder.repo.get_issue.call_count, 2)
        self.assertEqual(builder.createPostHtml.call_count, 2)
        self.assertEqual(set(builder.blogBase["postListJson"]), {"P1", "P205", "P206"})
        self.assertEqual(Path("docs/post/legacy.html").read_text(), "unchanged HTML")
        self.assertEqual(Path("docs/notion-assets/image.png").read_bytes(), b"image")
        self.assertEqual(builder.blogBase["labelColorDict"], {"New": "#abc"})
        builder.createPlistHtml.assert_called_once()
        builder.createFeedXml.assert_called_once()
        builder.full_build.assert_not_called()

    def test_fresh_site_uses_full_build(self):
        Path("blogBase.json").unlink()
        builder = self.builder([{"issue": 205}])
        builder.runAll()
        builder.full_build.assert_called_once()
        builder.repo.get_issue.assert_not_called()

    def test_missing_site_uses_full_build(self):
        Path("docs/index.html").unlink()
        builder = self.builder([{"issue": 205}])
        builder.runAll()
        builder.full_build.assert_called_once()

    def test_closed_issue_stops_deployment(self):
        builder = self.builder([{"issue": 205}])
        builder.repo.get_issue.side_effect = lambda number: NS(number=number, state="closed")
        with self.assertRaisesRegex(SyncError, "closed"):
            builder.runAll()
        builder.createPostHtml.assert_not_called()

    def test_empty_batch_cannot_accidentally_trigger_full_build(self):
        with self.assertRaisesRegex(SyncError, "nonempty"):
            self.builder([])


class MarkdownRetryTests(unittest.TestCase):
    def render(self, outcomes):
        with patch("build_gmeek.urllib.request.urlopen", side_effect=outcomes) as request, \
             patch("build_gmeek.time.sleep") as sleep:
            result = render_markdown(NS(options=NS(github_token="private-test-token")), "Article")
            return result, request, sleep

    def error(self, code, headers=None, message=b"{}"):
        return HTTPError("https://api.github.com/markdown", code, "failure", headers or {}, io.BytesIO(message))

    def test_rate_limit_retries_then_returns_html(self):
        result, request, sleep = self.render([
            self.error(403, {"Retry-After": "75"}, b'{"message":"secondary rate limit"}'),
            io.BytesIO(b"<p>Article</p>")])
        self.assertEqual(result, "<p>Article</p>")
        self.assertEqual(request.call_count, 2)
        self.assertIn(unittest.mock.call(75), sleep.call_args_list)
        self.assertEqual(request.call_args.kwargs["timeout"], 45)

    def test_permission_error_is_not_retried_or_exposed(self):
        with patch("build_gmeek.urllib.request.urlopen", side_effect=self.error(403, message=b"private-test-token Article")) as request, \
             patch("build_gmeek.time.sleep"):
            with self.assertRaisesRegex(SyncError, "HTTP 403: request rejected") as exc:
                render_markdown(NS(options=NS(github_token="private-test-token")), "Article")
            self.assertNotIn("private-test-token", str(exc.exception))
            request.assert_called_once()

    def test_long_cooldown_fails_for_next_scheduled_retry(self):
        with patch("build_gmeek.urllib.request.urlopen", side_effect=self.error(429, {"Retry-After": "3600"})) as request, \
             patch("build_gmeek.time.sleep"):
            with self.assertRaisesRegex(SyncError, "cooldown"):
                render_markdown(NS(options=NS(github_token="test")), "Article")
            request.assert_called_once()

    def test_network_and_server_errors_retry(self):
        result, request, sleep = self.render([URLError("temporary"), self.error(502), io.BytesIO(b"ok")])
        self.assertEqual(result, "ok")
        self.assertEqual(request.call_count, 3)


if __name__ == "__main__":
    unittest.main()
