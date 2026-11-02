/* Responsive article table of contents. */
document.addEventListener('DOMContentLoaded', () => {
    const body = document.querySelector('#postBody');
    if (!body || document.querySelector('#article-toc')) return;
    document.querySelectorAll('.toc, .toc-icon').forEach(el => el.remove());
    const headings = Array.from(body.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(el => el.textContent.trim());
    if (!headings.length) return;
    const style = document.createElement('style');
    style.textContent = `
        #article-toc { margin: 0 0 28px; padding: 14px; border: 1px solid rgba(255,255,255,.5);
            border-radius: 14px; background: rgba(237,244,242,.72); color: #183744;
            backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
            box-shadow: 0 8px 28px rgba(0,12,24,.12); }
        #article-toc summary { cursor: pointer; font-size: 14px; font-weight: 600; padding: 4px; }
        #article-toc nav { max-height: min(60vh,600px); overflow: auto; overscroll-behavior: contain; margin-top: 12px; }
        #article-toc a { display: block; padding: 8px 10px; padding-left: calc(10px + var(--toc-depth,0) * 12px);
            border-radius: 8px; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere;
            color: #254451; text-decoration: none; border-left: 2px solid transparent; }
        #article-toc a:hover, #article-toc a:focus-visible { background: rgba(204,242,239,.65); }
        #article-toc a[aria-current="location"] { background: rgba(204,242,239,.85); border-left-color: #34766f; font-weight: 600; }
        #article-toc a:focus-visible, #article-toc summary:focus-visible { outline: 2px solid #34766f; outline-offset: 2px; }
        #postBody :is(h1,h2,h3,h4,h5,h6) { scroll-margin-top: 28px; }
        #postBody h1 { display: block; background: transparent; color: inherit; padding: 0 0 .3em; font-size: 1.6em; border-radius: 0; }
        @media (min-width: 1280px) {
            body.has-article-toc { max-width: 1200px; width: calc(100% - 48px); overflow: visible; }
            .has-article-toc #content { display: grid; grid-template-columns: minmax(0,1fr) 230px; gap: 24px 32px; align-items: start; }
            .has-article-toc #postBody { grid-column: 1; grid-row: 1; min-width: 0; }
            .has-article-toc #content > :not(#article-toc) { grid-column: 1; }
            .has-article-toc #header { margin-right: 262px; }
            .has-article-toc #footer { width: calc(100% - 262px); }
            #article-toc { grid-column: 2; grid-row: 1; position: sticky; top: 24px; margin: 0; min-width: 0; z-index: 10; }
            #article-toc nav { max-height: calc(100vh - 150px); }
        }
        @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
    `;
    document.head.append(style);
    const toc = document.createElement('details');
    toc.id = 'article-toc';
    const summary = document.createElement('summary');
    summary.textContent = '文章目錄';
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', '文章章節');
    toc.append(summary, nav);
    const minLevel = Math.min(...headings.map(h => Number(h.tagName[1])));
    const entries = headings.map((heading, index) => {
        if (!heading.id) {
            let id = 'article-section-' + (index + 1);
            while (document.getElementById(id)) id += '-section';
            heading.id = id;
        }
        const link = document.createElement('a');
        link.href = '#' + encodeURIComponent(heading.id);
        // GitHub heading markup can contain anchor icons; only use readable text.
        link.textContent = heading.textContent.trim();
        link.style.setProperty('--toc-depth', Number(heading.tagName[1]) - minLevel);
        nav.append(link);
        link.addEventListener('click', () => {
            // Expand any enclosing Notion toggle before the native anchor jump.
            for (let parent = heading.parentElement; parent && parent !== body; parent = parent.parentElement) {
                if (parent.tagName === 'DETAILS') parent.open = true;
            }
        });
        return { heading, link };
    });
    body.before(toc);
    document.body.classList.add('has-article-toc');
    const wide = matchMedia('(min-width: 1280px)');
    const setLayout = () => { toc.open = wide.matches; };
    setLayout();
    wide.addEventListener('change', setLayout);
    let scheduled = false;
    function update() {
        scheduled = false;
        let current = entries[0];
        for (const entry of entries) {
            if (entry.heading.getClientRects().length && entry.heading.getBoundingClientRect().top <= 100) current = entry;
        }
        for (const entry of entries) {
            if (entry === current) entry.link.setAttribute('aria-current', 'location');
            else entry.link.removeAttribute('aria-current');
        }
        // Scroll only the nav panel, never scroll the article while tracking it.
        if (toc.open) {
            const top = current.link.offsetTop - nav.offsetTop;
            if (top < nav.scrollTop || top + current.link.offsetHeight > nav.scrollTop + nav.clientHeight)
                nav.scrollTop = Math.max(0, top - nav.clientHeight / 2);
        }
    }
    addEventListener('scroll', () => {
        if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
    }, { passive: true });
    addEventListener('resize', update);
    update();
});
