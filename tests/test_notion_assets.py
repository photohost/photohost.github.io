from email.message import Message
import importlib.util
import io
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import notion_sync as ns


class Response(io.BytesIO):
    def __init__(self, data, mime):
        super().__init__(data)
        self.headers = Message()
        self.headers["Content-Type"] = mime


class AssetTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.assets = ns.Assets("https://example.test", preview=False)
        self.assets.root = Path(self.tmp.name)

    def resolve(self, data, mime, name="photo.heic"):
        obj = {"type": "file", "file": {"url": "https://prod-files-secure.s3.us-west-2.amazonaws.com/" + name}}
        with patch.object(ns.urllib.request, "build_opener") as opener:
            opener.return_value.open.return_value = Response(data, mime)
            return self.assets.resolve(obj)

    def test_heif_mime_and_generic_downloads_are_converted_before_naming(self):
        for mime, name in (("image/heic", "photo.heic"), ("image/heif", "photo.heif"),
                           ("image/heic-sequence", "photo.heics"),
                           ("application/octet-stream", "PHOTO.HEIC")):
            with self.subTest(mime=mime), patch.object(ns, "convert_heif", return_value=(b"jpeg bytes", ".jpg")):
                url = self.resolve(b"heif bytes", mime, name)
                self.assertTrue(url.endswith(".jpg"))
                self.assertEqual((self.assets.root / url.rsplit("/", 1)[-1]).read_bytes(), b"jpeg bytes")
        self.assertEqual(len(list(self.assets.root.iterdir())), 1)

    def test_existing_web_image_bytes_are_unchanged(self):
        with patch.object(ns, "convert_heif") as convert:
            url = self.resolve(b"existing JPEG", "image/jpeg", "photo.jpg")
        convert.assert_not_called()
        self.assertEqual((self.assets.root / url.rsplit("/", 1)[-1]).read_bytes(), b"existing JPEG")

    def test_conversion_failure_and_size_limit_do_not_write_partial_asset(self):
        with patch.object(ns, "convert_heif", side_effect=ns.SyncError("cannot decode")):
            with self.assertRaises(ns.SyncError):
                self.resolve(b"broken", "image/heic")
        with patch.object(ns, "MAX_FILE", 10), patch.object(ns, "convert_heif", return_value=(b"x" * 11, ".jpg")):
            with self.assertRaisesRegex(ns.SyncError, "20 MiB"):
                self.resolve(b"small", "image/heic")
        self.assertEqual(list(self.assets.root.iterdir()), [])

    def test_original_file_limit_checked_before_decoding(self):
        with patch.object(ns, "MAX_FILE", 10), patch.object(ns, "convert_heif") as convert:
            with self.assertRaisesRegex(ns.SyncError, "20 MiB"):
                self.resolve(b"x" * 11, "image/heic")
        convert.assert_not_called()


@unittest.skipUnless(importlib.util.find_spec("pillow_heif") and importlib.util.find_spec("PIL"),
                     "Install scripts/requirements-notion.txt for HEIF codec integration tests (installed in CI)")
class HeifCodecTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from PIL import Image
        from pillow_heif import register_heif_opener
        register_heif_opener(thumbnails=False)
        cls.Image = Image

    def encoded(self, mode="RGB", size=(32, 48), color="red", **options):
        stream = io.BytesIO()
        self.Image.new(mode, size, color).save(stream, format="HEIF", quality=95, **options)
        return stream.getvalue()

    def test_photo_converts_to_readable_jpeg_and_removes_camera_metadata(self):
        exif = self.Image.Exif()
        exif[315] = "Private camera owner"
        data = self.encoded(exif=exif.tobytes())
        jpeg, ext = ns.convert_heif(data)
        self.assertEqual(ext, ".jpg")
        with self.Image.open(io.BytesIO(jpeg)) as photo:
            self.assertEqual(photo.format, "JPEG")
            self.assertEqual(photo.size, (32, 48))
            self.assertFalse(photo.getexif())
            self.assertGreater(photo.getpixel((10, 10))[0], 240)

    def test_transparent_photo_keeps_alpha_in_png(self):
        data, ext = ns.convert_heif(self.encoded("RGBA", color=(255, 0, 0, 128)))
        self.assertEqual(ext, ".png")
        with self.Image.open(io.BytesIO(data)) as photo:
            self.assertEqual(photo.mode, "RGBA")
            self.assertAlmostEqual(photo.getpixel((10, 10))[3], 128, delta=2)

    def test_photo_orientation_is_applied_once(self):
        exif = self.Image.Exif()
        exif[274] = 6
        jpeg, _ = ns.convert_heif(self.encoded(exif=exif.tobytes()))
        with self.Image.open(io.BytesIO(jpeg)) as photo:
            self.assertEqual(photo.size, (48, 32))
            self.assertIsNone(photo.getexif().get(274))

    def test_primary_photo_selected_from_multiframe_file(self):
        primary = self.Image.new("RGB", (64, 32), "blue")
        data = self.encoded(save_all=True, append_images=[primary], primary_index=1)
        jpeg, _ = ns.convert_heif(data)
        with self.Image.open(io.BytesIO(jpeg)) as photo:
            self.assertEqual(photo.size, (64, 32))
            self.assertGreater(photo.getpixel((10, 10))[2], 240)

    def test_corrupt_heif_is_reported_as_sync_error(self):
        with self.assertRaisesRegex(ns.SyncError, "無法轉換"):
            ns.convert_heif(b"not a valid heic")


if __name__ == "__main__":
    unittest.main()
