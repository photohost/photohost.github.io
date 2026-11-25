/* D1 "Book Page" article layout: tick TOC on the left + reading progress bar.
   On wide screens: a narrow left rail shows tick marks (01, 02 …) for each heading.
   Hovering a tick reveals the section title in a tooltip that never overlaps the article.
   Current section is accented. A thin progress line at the top tracks reading position.
   On narrow screens the tick rail hides and falls back to a collapsible TOC above the article. */
document.addEventListener('DOMContentLoaded', () => {
    const body = document.querySelector('#postBody');
    if (!body || document.querySelector('#article-toc')) return;
    document.querySelectorAll('.toc, .toc-icon').forEach(el => el.remove());
    const headings = Array.from(body.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(el => el.textContent.trim());
    if (!headings.length) return;

    /* ── progress bar ── */
    const progress = document.createElement('div');
    progress.id = 'reading-progress';
    progress.setAttribute('aria-hidden', 'true');
    document.body.append(progress);

    /* ── ensure heading IDs ── */
    headings.forEach((heading, index) => {
        if (!heading.id) {
            let id = 'article-section-' + (index + 1);
            while (document.getElementById(id)) id += '-section';
            heading.id = id;
        }
    });

    /* ── tick TOC (left rail on wide, collapsible on narrow) ── */
    const rail = document.createElement('nav');
    rail.id = 'article-toc';
    rail.setAttribute('aria-label', '文章章節');
    const minLevel = Math.min(...headings.map(h => Number(h.tagName[1])));

    const entries = headings.map((heading, index) => {
        const tick = document.createElement('a');
        tick.href = '#' + encodeURIComponent(heading.id);
        tick.className = 'toc-tick';
        tick.dataset.depth = Number(heading.tagName[1]) - minLevel;
        const num = document.createElement('span');
        num.className = 'toc-num';
        num.textContent = String(index + 1).padStart(2, '0');
        const label = document.createElement('span');
        label.className = 'toc-label';
        label.textContent = heading.textContent.trim();
        tick.append(num, label);
        tick.addEventListener('click', () => {
            for (let p = heading.parentElement; p && p !== body; p = p.parentElement)
                if (p.tagName === 'DETAILS') p.open = true;
        });
        rail.append(tick);
        return { heading, tick };
    });

    /* Narrow-screen collapsible wrapper: wraps the rail in a <details> */
    const details = document.createElement('details');
    details.id = 'article-toc-mobile';
    const summary = document.createElement('summary');
    summary.textContent = '文章目錄';
    details.append(summary);

    body.before(rail);
    body.before(details);
    document.body.classList.add('has-article-toc');

    /* Clone tick links into the mobile details wrapper */
    entries.forEach(e => {
        const clone = e.tick.cloneNode(true);
        clone.addEventListener('click', () => {
            for (let p = e.heading.parentElement; p && p !== body; p = p.parentElement)
                if (p.tagName === 'DETAILS') p.open = true;
        });
        details.append(clone);
        e.mobileTick = clone;
    });

    /* ── scroll tracking ── */
    let scheduled = false;
    function update() {
        scheduled = false;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const pct = docHeight > 0 ? Math.min(1, Math.max(0, window.scrollY / docHeight)) : 0;
        progress.style.transform = 'scaleX(' + pct + ')';
        let current = entries[0];
        for (const entry of entries) {
            if (entry.heading.getClientRects().length && entry.heading.getBoundingClientRect().top <= 100)
                current = entry;
        }
        for (const entry of entries) {
            const active = entry === current;
            entry.tick.classList.toggle('is-active', active);
            if (entry.mobileTick) entry.mobileTick.classList.toggle('is-active', active);
        }
    }
    addEventListener('scroll', () => {
        if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
    }, { passive: true });
    addEventListener('resize', update);
    update();

    /* ── heading scroll-margin ── */
    const style = document.createElement('style');
    style.textContent = '#postBody :is(h1,h2,h3,h4,h5,h6) { scroll-margin-top: 32px; }';
    document.head.append(style);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
        document.documentElement.style.scrollBehavior = 'smooth';
});
