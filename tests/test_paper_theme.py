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


if __name__ == "__main__":
    unittest.main()
