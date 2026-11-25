/* D1 "Book Page" article layout: numbered headings, tick TOC on the left, reading progress bar.
   The left rail shows a tick (01, 02 …) per heading. Hovering or focusing a tick shows the section
   title in one floating tip whose width is measured against the article card, so it can never
   touch the article text. Narrow screens hide the rail; the top bar's 目錄 button lists sections. */
document.addEventListener('DOMContentLoaded', () => {
    const body = document.querySelector('#postBody');
    if (!body || document.querySelector('#article-toc')) return;
    document.querySelectorAll('.toc, .toc-icon').forEach(el => el.remove());
    const headings = Array.from(body.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(el => el.textContent.trim());

    /* ── progress bar (all articles) ── */
    const progress = document.createElement('div');
    progress.id = 'reading-progress';
    progress.setAttribute('aria-hidden', 'true');
    document.body.append(progress);

    /* ── heading ids and numbers ── */
    headings.forEach((heading, index) => {
        if (!heading.id) {
            let id = 'article-section-' + (index + 1);
            while (document.getElementById(id)) id += '-section';
            heading.id = id;
        }
        heading.dataset.num = String(index + 1).padStart(2, '0');
    });

    /* ── tick rail ── */
    const minLevel = headings.length ? Math.min(...headings.map(h => Number(h.tagName[1]))) : 1;
    const rail = document.createElement('nav');
    rail.id = 'article-toc';
    rail.setAttribute('aria-label', '文章章節');
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
    if (entries.length) {
        body.before(rail);
        document.body.classList.add('has-article-toc');
    }

    /* ── floating title tip: one element, outside the scrolling rail ── */
    const tip = document.createElement('div');
    tip.id = 'toc-tip';
    tip.setAttribute('aria-hidden', 'true');
    document.body.append(tip);
    const GAP = 16; // minimum clear space between the tip and the article card
    function showTip(tick) {
        const card = document.body.getBoundingClientRect();
        const box = tick.getBoundingClientRect();
        const left = box.right + 8;
        const room = card.left - GAP - left;
        if (room < 96) return hideTip();
        tip.textContent = tick.querySelector('.toc-label').textContent;
        tip.style.maxWidth = Math.min(280, room) + 'px';
        tip.style.left = left + 'px';
        tip.style.top = (box.top + box.height / 2) + 'px';
        tip.classList.add('is-visible');
    }
    function hideTip() { tip.classList.remove('is-visible'); }
    rail.addEventListener('mouseover', e => { const t = e.target.closest('.toc-tick'); if (t) showTip(t); });
    rail.addEventListener('mouseleave', hideTip);
    rail.addEventListener('focusin', e => { const t = e.target.closest('.toc-tick'); if (t) showTip(t); });
    rail.addEventListener('focusout', hideTip);
    rail.addEventListener('scroll', hideTip, { passive: true });

    /* ── scroll tracking ── */
    let scheduled = false;
    function update() {
        scheduled = false;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        const pct = docHeight > 0 ? Math.min(1, Math.max(0, window.scrollY / docHeight)) : 0;
        progress.style.transform = 'scaleX(' + pct + ')';
        if (!entries.length) return;
        let current = entries[0];
        for (const entry of entries) {
            if (entry.heading.getClientRects().length && entry.heading.getBoundingClientRect().top <= 100)
                current = entry;
        }
        for (const entry of entries) entry.tick.classList.toggle('is-active', entry === current);
    }
    addEventListener('scroll', () => {
        if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
    }, { passive: true });
    addEventListener('resize', () => { hideTip(); update(); });
    update();

    /* ── heading scroll-margin (clears the fixed top bar) ── */
    const style = document.createElement('style');
    style.textContent = '#postBody :is(h1,h2,h3,h4,h5,h6) { scroll-margin-top: 72px; }';
    document.head.append(style);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
        document.documentElement.style.scrollBehavior = 'smooth';
});
