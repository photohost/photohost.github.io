/* D1 article chrome: top bar (back, title, 目錄, theme), figures with captions.
   Previous/next links and reading time are written into the page by the site build. */
document.addEventListener('DOMContentLoaded', () => {
    const root = document.documentElement;
    if (root.dataset.blogLayout !== 'post') return;
    const body = document.querySelector('#postBody');
    if (!body) return;

    /* ── figures: an image-only paragraph becomes <figure>; a following paragraph that repeats
          the image's alt text (how Notion image captions are published) becomes <figcaption> ── */
    const GENERIC_ALT = new Set(['', 'image', 'file', 'img']);
    function lonelyImage(p) {
        const imgs = p.querySelectorAll('img');
        if (imgs.length !== 1) return null;
        const clone = p.cloneNode(true);
        clone.querySelectorAll('img').forEach(i => i.remove());
        clone.querySelectorAll('a').forEach(a => { if (!a.textContent.trim()) a.remove(); });
        return clone.textContent.trim() === '' ? imgs[0] : null;
    }
    Array.from(body.querySelectorAll(':scope > p')).forEach(p => {
        const img = lonelyImage(p);
        if (!img) return;
        const figure = document.createElement('figure');
        figure.className = 'post-figure';
        p.replaceWith(figure);
        figure.append(...p.childNodes);
        const alt = (img.getAttribute('alt') || '').trim();
        const next = figure.nextElementSibling;
        if (!GENERIC_ALT.has(alt.toLowerCase()) && next && next.tagName === 'P' &&
            next.textContent.trim().replace(/\s+/g, ' ') === alt.replace(/\s+/g, ' ')) {
            const caption = document.createElement('figcaption');
            caption.append(...next.childNodes);
            figure.append(caption);
            next.remove();
        }
    });

    /* ── top bar ── */
    const homeLink = document.querySelector('#buttonHome');
    const homeHref = homeLink ? homeLink.getAttribute('href') : '/';
    const siteName = (document.querySelector('#footer1 a') || {}).textContent || '首頁';
    const bar = document.createElement('header');
    bar.className = 'post-topbar';
    bar.setAttribute('role', 'banner');
    const back = document.createElement('a');
    back.className = 'post-topbar-back';
    back.href = homeHref;
    back.textContent = '← ' + siteName.trim();
    back.setAttribute('aria-label', '回到' + siteName.trim() + '首頁');
    const title = document.createElement('span');
    title.className = 'post-topbar-title';
    title.textContent = document.title;
    const actions = document.createElement('div');
    actions.className = 'post-topbar-actions';
    bar.append(back, title, actions);

    const headings = Array.from(body.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(h => h.id && h.textContent.trim());
    let panel = null, toggle = null;
    function closePanel() {
        if (!panel) return;
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
    }
    if (headings.length) {
        toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'post-topbar-btn';
        toggle.textContent = '目錄';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', 'post-toc-panel');
        panel = document.createElement('nav');
        panel.id = 'post-toc-panel';
        panel.setAttribute('aria-label', '文章目錄');
        panel.hidden = true;
        const minLevel = Math.min(...headings.map(h => Number(h.tagName[1])));
        headings.forEach(h => {
            const link = document.createElement('a');
            link.href = '#' + encodeURIComponent(h.id);
            link.dataset.depth = Number(h.tagName[1]) - minLevel;
            const num = document.createElement('span');
            num.textContent = h.dataset.num || '';
            link.append(num, document.createTextNode(h.textContent.trim()));
            link.addEventListener('click', closePanel);
            panel.append(link);
        });
        toggle.addEventListener('click', () => {
            panel.hidden = !panel.hidden;
            toggle.setAttribute('aria-expanded', String(!panel.hidden));
        });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) { closePanel(); toggle.focus(); } });
        document.addEventListener('click', e => {
            if (!panel.hidden && !panel.contains(e.target) && e.target !== toggle) closePanel();
        });
        actions.append(toggle);
    }
    document.body.before(bar);
    if (panel) bar.append(panel);

    /* The theme switch is created by paper-theme.js; adopt it once that script has run. */
    setTimeout(() => {
        const theme = document.querySelector('#paper-theme-toggle');
        if (theme) actions.append(theme);
    }, 0);

    /* ── bar fade: rule appears after the first scroll; the title once the page title has left ── */
    const pageTitle = document.querySelector('#header .postTitle');
    let ticking = false;
    function update() {
        ticking = false;
        bar.classList.toggle('is-scrolled', window.scrollY > 8);
        const gone = pageTitle ? pageTitle.getBoundingClientRect().bottom < 56 : window.scrollY > 120;
        bar.classList.toggle('is-titled', gone);
    }
    addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    addEventListener('resize', update);
    update();
});
