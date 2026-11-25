import json
import unittest
from pathlib import Path


class PaperThemeTests(unittest.TestCase):
    def test_starfield_removed_and_theme_loaded(self):
        head = json.loads(Path("config.json").read_text(encoding="utf-8"))["allHead"]
        self.assertNotIn("starfield", head)
        self.assertIn("/paper-theme.js", head)
        self.assertIn("/paper-theme.css", head)
        self.assertFalse(Path("static/starfield.js").exists())

    def test_phrase_pool_is_short_clean_sentences(self):
        phrases = json.loads(Path("static/phrases.json").read_text(encoding="utf-8"))
        self.assertGreater(len(phrases), 10)
        for text in phrases:
            self.assertTrue(6 <= len(text) <= 22, text)
            self.assertNotIn("http", text)

    def test_home_uses_two_column_sheet_and_calm_column_speed(self):
        css = Path("static/paper-theme.css").read_text(encoding="utf-8")
        js = Path("static/paper-theme.js").read_text(encoding="utf-8")
        self.assertIn("grid-template-columns: 220px", css)
        self.assertIn("writing-mode: vertical-rl", css)
        # Columns are children of <html> so they stay behind the sheet.
        self.assertIn("insertBefore(wrap, document.body)", js)
        # Speed is px/s derived from loop length, not a fixed 11s/6s loop of a very tall run.
        self.assertIn("SPEED = { thick: 12, thin: 22 }", js)
        self.assertNotIn("animation-duration: 11s", css)
        self.assertNotIn("animation-duration: 6s", css)


if __name__ == "__main__":
    unittest.main()
