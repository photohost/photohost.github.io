import copy
import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import notion_sync as ns


def item(value, href=None, **flags):
    return {'type': 'text', 'plain_text': value, 'text': {'content': value, 'link': {'url': href} if href else None}, 'annotations': flags}


class RichTextTests(unittest.TestCase):
    def test_actual_number_parenthesis_strikethrough_case(self):
        result = ns.rich([item('150'), item('(用身高取名我好缺德)', strikethrough=True)])
        self.assertEqual(result, '150<del>(用身高取名我好缺德)</del>')

    def test_simple_markdown_styles_remain_readable(self):
        for flag, expected in [('bold', '**文字**'), ('italic', '*文字*'), ('strikethrough', '~~文字~~')]:
            self.assertEqual(ns.rich([item('文字', **{flag: True})]), expected)

    def test_identical_split_annotations_are_merged_without_mutating_input(self):
        runs = [item('用身高', strikethrough=True), item('取名', strikethrough=True)]
        original = copy.deepcopy(runs)
        self.assertEqual(ns.rich(runs), '~~用身高取名~~')
        self.assertEqual(runs, original)

    def test_mixed_neighbor_styles_do_not_collide(self):
        self.assertEqual(ns.rich([item('前', bold=True), item('後', bold=True, italic=True)]),
                         '<strong>前</strong><em><strong>後</strong></em>')

    def test_punctuation_boundaries_are_safe_for_bold_italic_and_strike(self):
        for flag, tag in [('bold', 'strong'), ('italic', 'em'), ('strikethrough', 'del')]:
            self.assertEqual(ns.rich([item('150'), item('(文字)', **{flag: True}), item('結尾')]),
                             f'150<{tag}>(文字)</{tag}>結尾')

    def test_underline_and_code_combined_annotations_survive(self):
        self.assertEqual(ns.rich([item('文字', underline=True)]), '<ins>文字</ins>')
        result = ns.rich([item('`code`', bold=True, italic=True, strikethrough=True, underline=True, code=True)])
        self.assertEqual(result, '<ins><del><em><strong>`` `code` ``</strong></em></del></ins>')

    def test_paragraph_heading_and_table_line_breaks_are_inline(self):
        rich = ns.rich([item('一\n二\n\n三', strikethrough=True)])
        self.assertEqual(rich, '<del>一<br> 二<br> <br> 三</del>')
        block = {'type': 'heading_2', 'heading_2': {'rich_text': [item('一\n二')]}}
        self.assertEqual(ns.Renderer(None, None).render([block]), '## 一<br> 二')
        class Notion:
            def call(self, *args):
                return {'results': [{'table_row': {'cells': [[item('一\n二')]]}}], 'has_more': False}
        table = {'id': 'table', 'type': 'table', 'table': {'table_width': 1, 'has_column_header': True}}
        self.assertEqual(ns.Renderer(Notion(), None).render([table]), '| 一<br> 二 |\n| --- |')

    def test_styled_link_keeps_url_and_text(self):
        result = ns.rich([item('(連結)', href='https://example.test/a(b)', strikethrough=True)])
        self.assertEqual(result, '[<del>(連結)</del>](https://example.test/a%28b%29)')

    def test_literal_markup_is_not_interpreted_or_executed(self):
        self.assertEqual(ns.rich([item('~~literal~~ <script>', bold=True)]),
                         '<strong>\\~\\~literal\\~\\~ &lt;script&gt;</strong>')
        with self.assertRaises(ns.SyncError):
            ns.rich([item('bad', href='javascript:alert(1)', strikethrough=True)])

    def test_inline_code_keeps_backticks_spaces_and_line_breaks(self):
        self.assertEqual(ns.rich([item('   ', code=True)]), '`   `')
        self.assertEqual(ns.rich([item('one\ntwo', code=True)]), '` one `<br> ` two `')

    def test_image_url_and_rich_caption_export_together(self):
        class Assets:
            def resolve(self, data): return ns.link_url(data['external']['url'])
        image = {'type': 'image', 'image': {'type': 'external', 'external': {'url': 'https://example.test/photo(1).png'},
                 'caption': [item('圖片'), item('(說明)', strikethrough=True)]}}
        result = ns.Renderer(None, Assets()).render([image])
        self.assertEqual(result, '![圖片(說明)](https://example.test/photo%281%29.png)\n\n圖片<del>(說明)</del>')

    def test_equations_and_unsupported_mentions_keep_existing_behavior(self):
        self.assertEqual(ns.rich([{'type': 'equation', 'equation': {'expression': 'x^2'}}]), '$x^2$')
        with self.assertRaises(ns.SyncError):
            ns.rich([{'type': 'mention'}])


if __name__ == '__main__': unittest.main()
