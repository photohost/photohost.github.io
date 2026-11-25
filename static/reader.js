/* Article reading controls and paper-style lightbox with navigation. */
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
    const body = document.querySelector('#postBody');
    if (!body) return;

    /* ── Title typewriter ── */
    const title = document.querySelector('#header .postTitle');
    if (title && title.textContent.trim() && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const fullText = title.textContent;
        const characters = typeof Intl.Segmenter === 'function'
            ? Array.from(new Intl.Segmenter(undefined, {granularity: 'grapheme'}).segment(fullText), part => part.segment)
            : Array.from(fullText);
        const original = document.createElement('span');
        original.style.opacity = '0';
        original.textContent = fullText;
        const typed = document.createElement('span');
        typed.setAttribute('aria-hidden', 'true');
        original.style.gridArea = typed.style.gridArea = '1 / 1';
        const layers = document.createElement('span');
        layers.style.display = 'grid';
        layers.append(original, typed);
        title.replaceChildren(layers);
        let count = 0;
        function typeTitle() {
            typed.textContent += characters[count++];
            if (count < characters.length) setTimeout(typeTitle, 65);
            else title.textContent = fullText;
        }
        typeTitle();
    }

    /* ── Bottom navigation ── */
    const behavior = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    const end = document.createElement('div');
    end.id = 'article-reading-end';
    body.after(end);

    const bottomNav = document.createElement('nav');
    bottomNav.setAttribute('aria-label', '文末閱讀位置');
    bottomNav.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:16px';
    function button(text, action, parent) {
        const el = document.createElement('button');
        el.type = 'button'; el.className = 'reader-button'; el.textContent = text;
        el.addEventListener('click', action); parent.append(el); return el;
    }
    button('↑ 回到頂端', () => window.scrollTo({top:0,behavior:behavior()}), bottomNav);
    end.after(bottomNav);

    /* ══════════════════════════════════════════════════════════
       Paper-style lightbox: translucent overlay, framed image,
       prev/next, thumbnails, keyboard, swipe, zoom, drag.
       ══════════════════════════════════════════════════════════ */
    const allImages = Array.from(body.querySelectorAll('img'));
    if (!allImages.length) return;

    const dialog = document.createElement('dialog');
    dialog.id = 'image-viewer';
    dialog.setAttribute('aria-label', '文章圖片預覽');
    dialog.innerHTML = `
<div class="viewer-top">
    <span class="viewer-counter"></span>
    <span class="viewer-sep">·</span>
    <span class="viewer-section-title"></span>
    <span class="viewer-spacer"></span>
    <button type="button" class="viewer-btn" data-action="zoomOut" aria-label="縮小">−</button>
    <output class="viewer-zoom" aria-label="縮放比例">100%</output>
    <button type="button" class="viewer-btn" data-action="zoomIn" aria-label="放大">＋</button>
    <button type="button" class="viewer-btn" data-action="fitOriginal">原尺寸</button>
    <button type="button" class="viewer-btn viewer-close" data-action="close">關閉</button>
</div>
<div class="viewer-body">
    <button type="button" class="viewer-nav viewer-prev" aria-label="上一張">‹ 上一張</button>
    <div class="viewer-stage" tabindex="0"><div class="viewer-canvas"><img alt=""></div></div>
    <button type="button" class="viewer-nav viewer-next" aria-label="下一張">下一張 ›</button>
</div>
<p class="viewer-caption" aria-live="polite"></p>
<div class="viewer-thumbs" aria-label="縮圖列表"></div>`;
    document.body.append(dialog);

    const els = {
        counter: dialog.querySelector('.viewer-counter'),
        sectionTitle: dialog.querySelector('.viewer-section-title'),
        stage: dialog.querySelector('.viewer-stage'),
        canvas: dialog.querySelector('.viewer-canvas'),
        image: dialog.querySelector('.viewer-stage img'),
        caption: dialog.querySelector('.viewer-caption'),
        zoom: dialog.querySelector('.viewer-zoom'),
        thumbs: dialog.querySelector('.viewer-thumbs'),
        prev: dialog.querySelector('.viewer-prev'),
        next: dialog.querySelector('.viewer-next'),
    };

    let currentIndex = 0, zoom = 1, fit = 1, savedScroll = 0, opener = null;

    /* ── thumbnails ── */
    const thumbEls = allImages.map((img, i) => {
        const thumb = document.createElement('button');
        thumb.type = 'button';
        thumb.className = 'viewer-thumb';
        thumb.setAttribute('aria-label', (img.alt && img.alt !== 'image' ? img.alt : '圖片 ' + (i + 1)));
        const tImg = document.createElement('img');
        tImg.src = img.dataset.originalSrc || img.currentSrc || img.src;
        tImg.alt = '';
        tImg.loading = 'lazy';
        thumb.append(tImg);
        thumb.addEventListener('click', () => goTo(i));
        els.thumbs.append(thumb);
        return thumb;
    });

    /* ── find section title for an image ── */
    function findSectionTitle(img) {
        let el = img;
        while (el && el !== body) {
            el = el.previousElementSibling || el.parentElement;
            if (el && /^H[1-6]$/.test(el.tagName)) return el.textContent.trim();
        }
        return '';
    }

    /* ── layout ── */
    function layout() {
        const img = els.image;
        if (!img.naturalWidth || !img.naturalHeight) return;
        fit = Math.min(1, (els.stage.clientWidth - 32) / img.naturalWidth, (els.stage.clientHeight - 32) / img.naturalHeight);
        const w = img.naturalWidth * fit * zoom, h = img.naturalHeight * fit * zoom;
        img.style.width = w + 'px'; img.style.height = h + 'px';
        els.canvas.style.width = Math.max(els.stage.clientWidth, w + 32) + 'px';
        els.canvas.style.height = Math.max(els.stage.clientHeight, h + 32) + 'px';
        els.zoom.textContent = Math.round(zoom * 100) + '%';
    }

    function changeZoom(value) {
        const old = zoom; zoom = Math.max(.25, Math.min(5, value));
        const cx = els.stage.scrollLeft + els.stage.clientWidth / 2;
        const cy = els.stage.scrollTop + els.stage.clientHeight / 2;
        layout();
        els.stage.scrollLeft = cx * zoom / old - els.stage.clientWidth / 2;
        els.stage.scrollTop = cy * zoom / old - els.stage.clientHeight / 2;
    }

    /* ── preload neighbours ── */
    function preload(index) {
        [index - 1, index + 1].forEach(i => {
            if (i >= 0 && i < allImages.length) {
                const src = allImages[i].dataset.originalSrc || allImages[i].currentSrc || allImages[i].src;
                const p = new Image(); p.src = src;
            }
        });
    }

    /* ── go to image ── */
    function goTo(index) {
        if (index < 0 || index >= allImages.length) return;
        currentIndex = index;
        const src = allImages[index];
        zoom = 1;
        els.image.removeAttribute('src');
        els.image.style.width = ''; els.image.style.height = '';
        els.image.alt = src.alt || '文章圖片';
        els.image.src = src.dataset.originalSrc || src.currentSrc || src.src;
        if (els.image.complete) layout();
        els.counter.textContent = String(index + 1).padStart(2, '0') + ' / ' + String(allImages.length).padStart(2, '0');
        els.sectionTitle.textContent = findSectionTitle(src);
        els.caption.textContent = src.alt && src.alt !== 'image' ? src.alt : '';
        els.prev.disabled = index === 0;
        els.next.disabled = index === allImages.length - 1;
        thumbEls.forEach((t, i) => t.classList.toggle('is-active', i === index));
        const activeThumb = thumbEls[index];
        if (activeThumb) activeThumb.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        preload(index);
    }

    /* ── open / close ── */
    function open(index, openerEl) {
        opener = openerEl;
        savedScroll = window.scrollY;
        document.documentElement.style.overflow = 'hidden';
        dialog.showModal();
        goTo(index);
    }

    function close() {
        dialog.close();
    }

    dialog.addEventListener('close', () => {
        document.documentElement.style.overflow = '';
        els.image.removeAttribute('src');
        window.scrollTo({ top: savedScroll, behavior: 'instant' });
        opener?.focus({ preventScroll: true });
    });

    /* ── image click/keyboard to open ── */
    allImages.forEach((img, index) => {
        img.tabIndex = 0;
        img.setAttribute('role', 'button');
        img.setAttribute('aria-haspopup', 'dialog');
        img.setAttribute('aria-label', '預覽圖片：' + (img.alt || '文章圖片'));
        img.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); open(index, img); });
        img.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); open(index, img); }
        });
    });

    els.image.addEventListener('load', layout);
    els.image.addEventListener('error', () => { els.caption.textContent = '圖片暫時無法載入，請關閉後重試。'; });

    /* ── toolbar actions ── */
    dialog.addEventListener('click', e => {
        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'zoomOut') changeZoom(zoom / 1.25);
        else if (action === 'zoomIn') changeZoom(zoom * 1.25);
        else if (action === 'fitOriginal') { zoom = 1 / fit; layout(); }
        else if (action === 'close') close();
        else if (e.target === dialog) close();
    });
    els.prev.addEventListener('click', () => goTo(currentIndex - 1));
    els.next.addEventListener('click', () => goTo(currentIndex + 1));

    /* ── keyboard ── */
    dialog.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(currentIndex - 1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); goTo(currentIndex + 1); }
        else if (e.key === '+' || e.key === '=') { e.preventDefault(); changeZoom(zoom * 1.25); }
        else if (e.key === '-') { e.preventDefault(); changeZoom(zoom / 1.25); }
    });

    /* ── swipe (horizontal for prev/next, down to close) ── */
    let touchStart = null;
    els.stage.addEventListener('touchstart', e => {
        if (e.touches.length === 1) touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    }, { passive: true });
    els.stage.addEventListener('touchend', e => {
        if (!touchStart || e.changedTouches.length !== 1) return;
        const dx = e.changedTouches[0].clientX - touchStart.x;
        const dy = e.changedTouches[0].clientY - touchStart.y;
        const dt = Date.now() - touchStart.t;
        touchStart = null;
        if (dt > 500) return;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
            if (dx < 0) goTo(currentIndex + 1); else goTo(currentIndex - 1);
        } else if (dy > 80 && Math.abs(dy) > Math.abs(dx) * 2) {
            close();
        }
    }, { passive: true });

    /* ── double-click zoom ── */
    let lastTap = 0;
    els.image.addEventListener('click', e => {
        const now = Date.now();
        if (now - lastTap < 350) {
            e.preventDefault();
            if (zoom > 1.1) { zoom = 1; layout(); }
            else changeZoom(2);
        }
        lastTap = now;
    });

    /* ── drag when zoomed ── */
    let drag = null;
    els.stage.addEventListener('pointerdown', e => {
        if (zoom <= 1 || e.button !== 0) return;
        drag = { x: e.clientX, y: e.clientY, sl: els.stage.scrollLeft, st: els.stage.scrollTop };
        els.stage.setPointerCapture(e.pointerId);
        els.stage.style.cursor = 'grabbing';
    });
    els.stage.addEventListener('pointermove', e => {
        if (!drag) return;
        els.stage.scrollLeft = drag.sl - (e.clientX - drag.x);
        els.stage.scrollTop = drag.st - (e.clientY - drag.y);
    });
    els.stage.addEventListener('pointerup', () => { drag = null; els.stage.style.cursor = ''; });
    els.stage.addEventListener('pointercancel', () => { drag = null; els.stage.style.cursor = ''; });

    addEventListener('resize', () => { if (dialog.open) layout(); });
    }, 0);
});
