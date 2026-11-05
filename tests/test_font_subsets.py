import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from urllib.parse import unquote

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from font_pilot import font_head, PageCharacters
from site_build import save_receipt, refresh, version_rendered_pages

HEAD = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@400..700&amp;display=swap">'


class FontSubsetTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = Path.cwd()
        os.chdir(self.directory.name)
        for name in ('docs/post', 'static', 'scripts'):
            Path(name).mkdir(parents=True)
        self.addCleanup(self.cleanup)

    def cleanup(self):
        os.chdir(self.previous)
        self.directory.cleanup()

    def test_article_and_ui_characters_preserved(self):
        Path('static/ui.js').write_text("const label='關閉';", encoding='utf-8')
        page = '<html><body><strong>繁體</strong><em>日本語</em><p>English &amp; text</p><img alt="照片"></body></html>'
        head = font_head(Path('docs/post/test.html'), page, HEAD)
        parsed = PageCharacters()
        parsed.feed(head)
        self.assertTrue(set('繁體日本語English&照片關閉').issubset(parsed.existing_characters))
        self.assertIn('wght@400..700', head)
        self.assertIn('blog-font-fallback', head)

    def test_list_contains_unloaded_titles_and_tags(self):
        Path('docs/postList.json').write_text(json.dumps({'P1': {'postTitle': '未載入標題', 'labels': ['分類']}}))
        result = font_head(Path('docs/index.html'), '<body>首頁</body>', HEAD)
        self.assertTrue(set('未載入標題分類').issubset(unquote(result)))

    def test_large_subset_keeps_full_fonts(self):
        page = '<body>' + ''.join(chr(i) for i in range(0x4e00, 0x5600)) + '</body>'
        self.assertEqual(font_head(Path('docs/post/long.html'), page, HEAD), HEAD)

    def test_refresh_matches_existing_subset_after_ui_and_index_change(self):
        Path('config.json').write_text(json.dumps({'allHead': HEAD}))
        Path('static/ui.js').write_text("'舊';", encoding='utf-8')
        Path('blogBase.json').write_text(json.dumps({'allHead': HEAD, 'postListJson': {'P1': {'htmlDir': 'docs/post/test.html'}}, 'singeListJson': {}}))
        for p in ('docs/index.html', 'docs/tag.html', 'docs/post/test.html'):
            Path(p).write_text('<html><head>' + HEAD + '</head><body>文章</body></html>', encoding='utf-8')
        Path('docs/rss.xml').write_text('feed')
        version_rendered_pages()
        save_receipt()
        Path('static/ui.js').write_text("'新';", encoding='utf-8')
        # Asset versioning causes a shared-head refresh; this must also accept old glyph metadata.
        config = {'allHead': HEAD + '<script src="/ui.js" defer></script>'}
        Path('config.json').write_text(json.dumps(config))
        refresh()
        html = Path('docs/post/test.html').read_text(encoding='utf-8')
        parser = PageCharacters(); parser.feed(html)
        self.assertIn('新', parser.existing_characters)
        self.assertEqual(html.count('name="blog-font-characters"'), 1)
        refresh()
        self.assertEqual(Path('docs/post/test.html').read_text(encoding='utf-8'), html)


if __name__ == '__main__':
    unittest.main()
