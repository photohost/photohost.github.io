/* Shared typography and article reading controls. */
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
    const body = document.querySelector('#postBody');
    if (!body) return;

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
    const nav = document.createElement('nav');
    nav.id = 'reader-nav';
    nav.setAttribute('aria-label', '文章閱讀位置');
    function button(text, action, parent = nav) {
        const el = document.createElement('button');
        el.type = 'button'; el.className = 'reader-button'; el.textContent = text;
        el.addEventListener('click', action); parent.append(el); return el;
    }
    const behavior = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
    const end = document.createElement('div');
    end.id = 'article-reading-end';
    body.after(end);
    button('↓ 前往文末', () => end.scrollIntoView({block: 'end', behavior: behavior()}));
    body.before(nav);
    // Also available beside a wide-screen TOC while reading long articles.
    const toc = document.querySelector('#article-toc');
    if (toc) toc.append(nav.cloneNode(false));
    const tocNav = toc && toc.lastElementChild;
    if (tocNav && tocNav !== nav) {
        tocNav.removeAttribute('id');
        button('↑ 頂端', () => window.scrollTo({top:0,behavior:behavior()}), tocNav);
        button('↓ 文末', () => end.scrollIntoView({block:'end',behavior:behavior()}), tocNav);
    }
    // Bottom controls allow returning to the top without reopening the TOC.
    const bottomNav = document.createElement('nav');
    bottomNav.setAttribute('aria-label', '文末閱讀位置');
    bottomNav.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:16px';
    button('↑ 回到頂端', () => window.scrollTo({top:0,behavior:behavior()}), bottomNav);
    end.after(bottomNav);
    const dialog = document.createElement('dialog');
    dialog.id = 'image-viewer';
    dialog.setAttribute('aria-label', '文章圖片預覽');
    dialog.innerHTML = '<div class="viewer-toolbar"></div><div class="viewer-stage" tabindex="0" aria-label="放大圖片後可捲動查看"><div class="viewer-canvas"><img alt=""></div></div><p class="viewer-caption" aria-live="polite"></p>';
    document.body.append(dialog);
    const toolbar = dialog.querySelector('.viewer-toolbar');
    const stage = dialog.querySelector('.viewer-stage');
    const canvas = dialog.querySelector('.viewer-canvas');
    const image = dialog.querySelector('img');
    const caption = dialog.querySelector('.viewer-caption');
    let zoom = 1, fit = 1, opener, previousOverflow = '';
    const minus = button('−', () => changeZoom(zoom / 1.25), toolbar);
    minus.setAttribute('aria-label', '縮小圖片');
    const indicator = document.createElement('output');
    indicator.className = 'viewer-zoom'; indicator.setAttribute('aria-label','圖片縮放比例'); toolbar.append(indicator);
    const plus = button('＋', () => changeZoom(zoom * 1.25), toolbar);
    plus.setAttribute('aria-label', '放大圖片');
    button('適合視窗', () => { zoom = 1; layout(); }, toolbar);
    const close = button('關閉 ✕', () => dialog.close(), toolbar);
    close.classList.add('viewer-close');
    function layout() {
        fit = Math.min(1, (stage.clientWidth - 24) / image.naturalWidth, (stage.clientHeight - 24) / image.naturalHeight);
        if (!image.naturalWidth || !image.naturalHeight) return;
        const width = image.naturalWidth * fit * zoom, height = image.naturalHeight * fit * zoom;
        image.style.width = width + 'px'; image.style.height = height + 'px';
        canvas.style.width = Math.max(stage.clientWidth, width + 24) + 'px';
        canvas.style.height = Math.max(stage.clientHeight, height + 24) + 'px';
        indicator.textContent = Math.round(zoom * 100) + '%';
        minus.disabled = zoom <= .5; plus.disabled = zoom >= 4;
    }
    function changeZoom(value) {
        const old = zoom; zoom = Math.max(.5, Math.min(4, value));
        const cx = stage.scrollLeft + stage.clientWidth / 2, cy = stage.scrollTop + stage.clientHeight / 2;
        layout(); stage.scrollLeft = cx * zoom / old - stage.clientWidth / 2; stage.scrollTop = cy * zoom / old - stage.clientHeight / 2;
    }
    image.addEventListener('load', layout);
    image.addEventListener('error', () => { caption.textContent = '圖片暫時無法載入，請關閉後重試。'; });
    function open(target) {
        opener = target; zoom = 1;
        image.removeAttribute('src'); image.style.width = ''; image.style.height = '';
        image.alt = target.alt || '文章圖片';
        caption.textContent = target.alt && target.alt !== 'image' ? target.alt : '使用＋／−調整大小；放大後可捲動查看。Esc 關閉。';
        previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        dialog.showModal();
        image.src = target.dataset.originalSrc || target.currentSrc || target.src;
        if (image.complete) layout();
    }
    body.querySelectorAll('img').forEach(img => {
        img.tabIndex = 0; img.setAttribute('role', 'button'); img.setAttribute('aria-haspopup', 'dialog');
        img.setAttribute('aria-label', '預覽圖片：' + (img.alt || '文章圖片'));
        img.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(img); });
        img.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); open(img); }
        });
    });
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => {
        document.documentElement.style.overflow = previousOverflow; image.removeAttribute('src'); opener?.focus({preventScroll:true});
    });
    dialog.addEventListener('keydown', event => {
        if (event.target === close && event.key === 'Enter') return;
        if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(zoom * 1.25); }
        if (event.key === '-') { event.preventDefault(); changeZoom(zoom / 1.25); }
    });
    addEventListener('resize', () => { if (dialog.open) layout(); });
    }, 0);
});
