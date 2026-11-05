import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from content_excerpts import excerpt, publish_excerpts
from legacy_images import prepare_legacy_images


class ContentPerformanceTests(unittest.TestCase):
    def setUp(self):
        self.old = Path.cwd()
        self.tmp = tempfile.TemporaryDirectory()
        os.chdir(self.tmp.name)
        Path("docs/post").mkdir(parents=True)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        os.chdir(self.old)
        self.tmp.cleanup()

    def test_excerpt_excludes_code_and_stays_in_post_body(self):
        html = '<div id="postBody"><h2>標題</h2><p>正文 <b>文字</b></p><pre>秘密程式</pre><p>結尾</p></div><footer>頁尾</footer>'
        self.assertEqual(excerpt(html), '標題 正文 文字 結尾')

    def test_index_refreshes_edited_article_and_skips_other_paths(self):
        Path("docs/post/a.html").write_text('<div id="postBody"><p>新內容</p></div>', encoding="utf-8")
        Path("docs/postList.json").write_text(json.dumps({"P1": {"postUrl": "post/a.html", "excerpt": "舊內容"},
            "P2": {"postUrl": "https://other.test/post/b.html"}, "labelColorDict": {}}), encoding="utf-8")
        publish_excerpts()
        data = json.loads(Path("docs/postList.json").read_text(encoding="utf-8"))
        self.assertEqual(data["P1"]["excerpt"], "新內容")
        self.assertNotIn("excerpt", data["P2"])

    def test_old_image_gets_local_copy_and_lazy_load(self):
        src = "https://i.imgur.com/example.jpg"
        from PIL import Image
        Path("docs/legacy-image-variants").mkdir()
        Image.new("RGB", (720, 480)).save("docs/legacy-image-variants/photo-720.webp")
        Path("docs/post/a.html").write_text(f'<div id="postBody"><img src="{src}" alt="x"><img src="{src}"></div>', encoding="utf-8")
        with patch("legacy_images.optimize", return_value=[("/legacy-image-variants/photo-720.webp", 720)]):
            prepare_legacy_images()
        html = Path("docs/post/a.html").read_text(encoding="utf-8")
        self.assertEqual(html.count('src="/legacy-image-variants/photo-720.webp"'), 2)
        self.assertIn('data-legacy-optimized="true"', html)
        self.assertNotIn(src, html)
        self.assertIn('width="720" height="480"', html)
        self.assertIn('loading="lazy"', html)
        with patch("legacy_images.optimize") as image:
            prepare_legacy_images()
            image.assert_not_called()


if __name__ == "__main__":
    unittest.main()
