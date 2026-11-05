"""Make bounded, locally served reading copies of older public article images."""
from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from html import escape, unescape
from io import BytesIO
from pathlib import Path
import re
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from PIL import Image, ImageOps
from image_reading import IMAGE_TAG, ATTRIBUTE

HOSTS = {
    "github.com", "raw.githubusercontent.com", "objects.githubusercontent.com",
    "cdn.jsdelivr.net", "i.imgur.com", "1.bp.blogspot.com", "telegra.ph",
    "img.harunoji.one", "img.icepm.top", "i.postimg.cc", "pbs.twimg.com",
    "p2.bahamut.com.tw", "6ff7c07b.telegraph-image-8st.pages.dev",
}
DEST = Path("docs/legacy-image-variants")
MAX_INPUT = 8 * 1024 * 1024


class RestrictedRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        target = urlsplit(newurl)
        if target.scheme != "https" or target.hostname not in HOSTS:
            raise ValueError("Image redirect is outside approved image hosts")
        return super().redirect_request(request, fp, code, msg, headers, newurl)


def optimize(url):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.hostname not in HOSTS:
        return None
    key = sha256(url.encode()).hexdigest()[:24]
    existing = sorted(DEST.glob(key + "-*.webp"))
    if existing:
        options = sorted((("/legacy-image-variants/" + path.name, int(path.stem.rsplit("-", 1)[1]))
                          for path in existing), key=lambda item: item[1])
        return options
    try:
        opener = build_opener(RestrictedRedirect())
        with opener.open(Request(url, headers={"User-Agent": "Gmeek image optimizer"}), timeout=10) as response:
            if not response.headers.get("Content-Type", "").lower().startswith("image/"):
                return None
            data = response.read(MAX_INPUT + 1)
        if len(data) > MAX_INPUT:
            return None
        with Image.open(BytesIO(data)) as original:
            if getattr(original, "is_animated", False):
                return None
            image = ImageOps.exif_transpose(original)
            if image.width < 200 or image.height < 50:
                return None
            image = image.convert("RGBA" if "A" in image.getbands() or "transparency" in image.info else "RGB")
            options = []
            for width in sorted({min(image.width, 720), min(image.width, 1440)}):
                resized = image.resize((width, max(1, round(image.height * width / image.width))), Image.Resampling.LANCZOS)
                output = BytesIO()
                resized.save(output, "WEBP", quality=75, method=4)
                if len(output.getbuffer()) >= len(data):
                    continue
                DEST.mkdir(parents=True, exist_ok=True)
                target = DEST / f"{key}-{width}.webp"
                target.write_bytes(output.getvalue())
                options.append(("/legacy-image-variants/" + target.name, width))
            return options or None
    except (OSError, ValueError, Image.DecompressionBombError):
        return None


def prepare_legacy_images():
    pages = list(Path("docs/post").glob("*.html"))
    sources = set()
    for page in pages:
        for tag in IMAGE_TAG.findall(page.read_text(encoding="utf-8")):
            attrs = {match[1].lower(): unescape(match[2] or match[3] or match[4] or "")
                     for match in ATTRIBUTE.finditer(tag)}
            if "data-original-src" in attrs or "data-legacy-optimized" in attrs:
                continue
            url = attrs.get("data-canonical-src") or attrs.get("src", "")
            if urlsplit(url).hostname in HOSTS:
                sources.add(url)
    with ThreadPoolExecutor(max_workers=8) as pool:
        optimized = dict(zip(sources, pool.map(optimize, sources)))
    changed = 0
    for page in pages:
        html = page.read_text(encoding="utf-8")
        first = True

        def replace(match):
            nonlocal first, changed
            tag = match.group()
            attrs = {item[1].lower(): unescape(item[2] or item[3] or item[4] or "")
                     for item in ATTRIBUTE.finditer(tag)}
            if "data-original-src" in attrs or "data-legacy-optimized" in attrs:
                first = False
                return tag
            url = attrs.get("data-canonical-src") or attrs.get("src", "")
            options = optimized.get(url)
            if not first:
                attrs["loading"] = "lazy"
            attrs["decoding"] = "async"
            first = False
            if not options:
                return "<img " + " ".join(f'{key}="{escape(value, quote=True)}"' for key, value in attrs.items()) + ">"
            with Image.open(DEST / options[0][0].rsplit("/", 1)[1]) as reading:
                attrs["width"], attrs["height"] = str(reading.width), str(reading.height)
            attrs["data-legacy-optimized"] = "true"
            attrs.pop("data-canonical-src", None)
            attrs["src"] = options[0][0]
            attrs["srcset"] = ", ".join(f"{source} {width}w" for source, width in options)
            attrs["sizes"] = "(max-width: 640px) 100vw, 900px"
            changed += 1
            return "<img " + " ".join(f'{key}="{escape(value, quote=True)}"' for key, value in attrs.items()) + ">"

        updated = IMAGE_TAG.sub(replace, html)
        if updated != html:
            page.write_text(updated, encoding="utf-8")
    print(f"Legacy images: {changed} optimized references, {len(sources)} source URLs", flush=True)
