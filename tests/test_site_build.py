import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from site_build import can_increment, can_refresh, choose, refresh, save_receipt, version_rendered_pages


class SiteBuildTests(unittest.TestCase):
    def setUp(self):
        self.old = Path.cwd()
        self.temp = tempfile.TemporaryDirectory()
        os.chdir(self.temp.name)
        self.addCleanup(self.cleanup)
        for directory in ("docs/post", "static", "scripts"):
            Path(directory).mkdir(parents=True)
        self.config = {"title": "Blog", "UTC": 8, "allHead": "<script src='/reader.js?v=1'></script>"}
        self.write("config.json", self.config)
        Path("scripts/build_gmeek.py").write_text("renderer-v1")
        Path("static/reader.js").write_text("old script")
        Path("docs/reader.js").write_text("old script")
        self.body = "<article>Existing content and date</article>"
        html = "<html><head>" + self.config["allHead"] + "</head><body>" + self.body + "</body></html>"
        for filename in ("index.html", "tag.html", "post/old.html", "post/new.html"):
            Path("docs", filename).write_text(html)
        Path("docs/rss.xml").write_text("existing feed")
        self.write("blogBase.json", {"allHead": self.config["allHead"],
                                    "postListJson": {"P1": {"htmlDir": "docs/post/old.html"},
                                                     "P2": {"htmlDir": "docs/post/new.html"}},
                                    "singeListJson": {}})
        version_rendered_pages()
        save_receipt()

    def cleanup(self):
        os.chdir(self.old)
        self.temp.cleanup()

    def write(self, path, value):
        Path(path).write_text(json.dumps(value))

    def update_head(self):
        self.config["allHead"] = "<script src='/reader.js?v=2'></script>"
        self.write("config.json", self.config)

    def test_frontend_refresh_preserves_bodies_feed_and_index_data(self):
        Path("static/reader.js").write_text("new script")
        self.update_head()
        self.assertTrue(can_refresh())
        refresh()
        self.assertEqual(Path("docs/reader.js").read_text(), "new script")
        self.assertEqual(Path("docs/rss.xml").read_text(), "existing feed")
        for path in Path("docs").rglob("*.html"):
            content = path.read_text()
            self.assertIn(self.body, content)
            self.assertIn("reader.js?v=" + hashlib.sha256(b"new script").hexdigest()[:16], content)
            self.assertNotIn("reader.js?v=1", content)
        self.assertEqual(len(json.loads(Path("blogBase.json").read_text())["postListJson"]), 2)
        snapshot = {str(p): p.read_bytes() for p in Path("docs").rglob("*") if p.is_file()}
        refresh()
        self.assertEqual(snapshot, {str(p): p.read_bytes() for p in Path("docs").rglob("*") if p.is_file()})

    def test_asset_only_refresh_updates_head_and_footer(self):
        path = Path("docs/index.html")
        self.config["script"] = "<script src='/reader.js?mode=test&amp;v=old#fragment'></script>"
        self.write("config.json", self.config)
        path.write_text(path.read_text().replace("</html>", self.config["script"] + "</html>"))
        version_rendered_pages()
        save_receipt()
        old_version = hashlib.sha256(b"old script").hexdigest()[:16]
        self.assertEqual(path.read_text().count("v=" + old_version), 2)
        Path("static/reader.js").write_text("new script")
        self.assertFalse(can_increment(copy_assets=True))
        self.assertTrue(can_refresh())
        refresh()
        new_version = hashlib.sha256(b"new script").hexdigest()[:16]
        html = path.read_text()
        self.assertEqual(html.count("v=" + new_version), 2)
        self.assertIn("mode=test&amp;v=" + new_version + "#fragment", html)
        self.assertNotIn(old_version, html)

    def test_initial_or_incomplete_site_requires_full_build(self):
        Path(".gmeek-build.json").unlink()
        self.assertFalse(can_refresh())
        self.assertFalse(can_increment())
        save_receipt()
        Path("docs/post/old.html").unlink()
        self.assertFalse(can_refresh())

    def test_renderer_and_non_head_config_changes_require_full_build(self):
        Path("scripts/build_gmeek.py").write_text("renderer-v2")
        self.assertFalse(can_refresh())
        self.assertFalse(can_increment())
        save_receipt()
        self.config["UTC"] = 9
        self.write("config.json", self.config)
        self.assertFalse(can_refresh())
        self.assertFalse(can_increment())

    def test_missing_head_replacement_is_checked_before_writes(self):
        self.update_head()
        Path("static/reader.js").write_text("new script")
        Path("docs/post/new.html").write_text("<html><head></head><body>Unexpected template</body></html>")
        self.assertFalse(can_refresh())
        with self.assertRaises(ValueError):
            refresh()
        self.assertEqual(Path("docs/reader.js").read_text(), "old script")
        self.assertIn("reader.js?v=" + hashlib.sha256(b"old script").hexdigest()[:16],
                      Path("docs/index.html").read_text())

    def test_resource_removal_does_not_delete_generated_pages(self):
        Path("static/reader.js").unlink()
        self.assertTrue(can_refresh())
        self.assertFalse(can_increment())
        refresh()
        self.assertFalse(Path("docs/reader.js").exists())
        self.assertTrue(Path("docs/post/old.html").exists())

    def test_notion_new_image_can_increment_but_cannot_use_frontend_refresh(self):
        Path("static/photo.jpg").write_bytes(b"image")
        self.assertFalse(can_refresh())
        self.assertTrue(can_increment(copy_assets=True))
        self.assertFalse(can_increment())
        self.update_head()
        self.assertFalse(can_increment())
        # An incrementally updated index is not proof that older article heads were updated.
        index = json.loads(Path("blogBase.json").read_text())
        index["allHead"] = self.config["allHead"]
        self.write("blogBase.json", index)
        self.assertFalse(can_increment())

    def test_shared_head_text_in_article_content_is_preserved(self):
        original = Path("docs/post/old.html").read_text().replace(self.body, self.config["allHead"])
        Path("docs/post/old.html").write_text(original)
        self.update_head()
        refresh()
        self.assertIn("<body><script src='/reader.js?v=1'></script></body>",
                      Path("docs/post/old.html").read_text())

    def test_modes_keep_manual_full_build_and_notion_commands(self):
        for event, input_mode, schedule, expected in (
            ("push", "", "", "assets"),
            ("workflow_dispatch", "build", "", "build"),
            ("issues", "", "", "build"),
            ("workflow_dispatch", "notion-publish", "", "notion-publish"),
            ("workflow_dispatch", "notion-preview", "", "notion-preview"),
            ("schedule", "", "0 16 * * *", "build"),
            ("schedule", "", "2,7,12 * * * *", "notion-publish"),
        ):
            Path("outputs").write_text("")
            with patch.dict(os.environ, {"EVENT": event, "INPUT_MODE": input_mode,
                                         "EVENT_SCHEDULE": schedule, "GITHUB_OUTPUT": "outputs",
                                         "GITHUB_STEP_SUMMARY": ""}):
                choose()
            self.assertIn("mode=" + expected + "\n", Path("outputs").read_text())


if __name__ == "__main__":
    unittest.main()
