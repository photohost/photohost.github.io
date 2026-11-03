"""Prepare smaller reading images from local Notion uploads."""
from html import escape, unescape
from pathlib import Path
import re
from urllib.parse import urlsplit

from PIL import Image, ImageOps

IMAGE_TAG = re.compile(r"""<img\b(?:[^"'<>]|"[^"]*"|'[^']*')*>""", re.I)
ATTRIBUTE = re.compile(r"""\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))""")
ASSET_PATH = re.compile(r"/notion-assets/([a-f0-9]{64}\.(?:png|jpg|gif|webp|avif))")


def prepare_images(home_url):
    home = urlsplit(home_url)
    variants = Path("docs/notion-image-variants")
    processed = {}

    def reading_image(name):
        path = Path("static/notion-assets") / name
        if not path.is_file():
            return None
        try:
            with Image.open(path) as original:
                if getattr(original, "is_animated", False):
                    return original.width, original.height, []
                image = ImageOps.exif_transpose(original)
                width, height = image.size
                mode = "RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB"
                image = image.convert(mode)
                variants.mkdir(parents=True, exist_ok=True)
                options = []
                for size in sorted({min(width, limit) for limit in (480, 960, 1440)}):
                    target = variants / f"{name}-{size}.webp"
                    if not target.exists():
                        resized = image.resize((size, max(1, round(height * size / width))), Image.Resampling.LANCZOS)
                        resized.save(target, "WEBP", quality=80)
                    if target.stat().st_size < path.stat().st_size:
                        options.append((f"/notion-image-variants/{target.name}", size))
                return width, height, options
        except (OSError, ValueError, Image.DecompressionBombError):
            return None

    for page in Path("docs/post").glob("*.html"):
        original = page.read_text(encoding="utf-8")
        first = True

        def replace(match):
            nonlocal first
            tag = match.group()
            attrs = {attribute[1].lower(): unescape(attribute[2] or attribute[3] or attribute[4] or "")
                     for attribute in ATTRIBUTE.finditer(tag)}
            if "data-original-src" in attrs:
                first = False
                return tag
            try:
                url = urlsplit(attrs.get("data-canonical-src") or attrs.get("src", ""))
            except ValueError:
                return tag
            if (url.scheme, url.netloc) not in (("", ""), (home.scheme, home.netloc)):
                return tag
            asset = ASSET_PATH.fullmatch(url.path)
            if not asset:
                return tag
            name = asset[1]
            if name not in processed:
                processed[name] = reading_image(name)
            if processed[name] is None:
                return tag
            width, height, options = processed[name]
            attrs.update(src=options[0][0] if options else url.path,
                         width=str(width), height=str(height), decoding="async")
            attrs["data-original-src"] = url.path
            attrs.pop("data-canonical-src", None)
            if not first:
                attrs["loading"] = "lazy"
            first = False
            if options:
                attrs["srcset"] = ", ".join(f"{source} {size}w" for source, size in options)
                attrs["sizes"] = "(max-width: 640px) 100vw, 900px"
            return "<img " + " ".join(f'{key}="{escape(value, quote=True)}"' for key, value in attrs.items()) + ">"

        updated = IMAGE_TAG.sub(replace, original)
        if updated != original:
            page.write_text(updated, encoding="utf-8")
