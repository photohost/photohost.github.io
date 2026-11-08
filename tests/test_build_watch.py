import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from build_watch import movie, render


def row(status="Done", title="<b>測試</b>"):
    return {"id": "example", "properties": {
        "Status": {"status": {"name": status}},
        "名稱": {"title": [{"plain_text": title}]},
        "Cover": {"files": [{"id": "poster", "type": "file", "file": {"url": "https://example.com/poster.png"}}]},
        "日期": {"date": {"start": "2026-11-09"}},
        "評分": {"number": 7.5},
        "Type": {"select": {"name": "Movie"}},
    }}


class WatchWallTests(unittest.TestCase):
    def test_only_completed_records_are_public(self):
        self.assertIsNone(movie(row("Not started")))
        self.assertIsNone(movie(row("In progress")))
        self.assertEqual(movie(row())["rating"], 7.5)

    def test_title_is_escaped_in_card_and_preview_data(self):
        item = movie(row())
        item["image"] = "/watch-assets/example.webp"
        page = render([item])
        self.assertIn("&lt;b&gt;測試&lt;/b&gt;", page)
        self.assertNotIn("<b>測試</b>", page)
        self.assertIn("7.5 分", page)
        self.assertIn("2026", page)


if __name__ == "__main__":
    unittest.main()
