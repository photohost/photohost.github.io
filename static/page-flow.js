/* GSAP page feedback and progressive enhancement of Gmeek's numbered pages. */
(() => {
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    const gsap = window.gsap;
    const bar = document.createElement('div');
    bar.id = 'page-progress';
    bar.setAttribute('aria-hidden', 'true');
    // A direct html child keeps this viewport-fixed above the rounded body panel.
    document.documentElement.append(bar);
    let progress;
    let progressId = 0;
    let watchdog;

    function startProgress() {
        const id = ++progressId;
        progress?.kill();
        clearTimeout(watchdog);
        if (gsap && !motion.matches) {
            gsap.set(bar, { scaleX: 0, opacity: 1 });
            progress = gsap.timeline()
                .to(bar, { scaleX: .3, duration: .24, ease: 'power2.out' })
                .to(bar, { scaleX: .7, duration: 1.3, ease: 'power1.out' });
        }
        function finish() {
            if (id !== progressId) return;
            clearTimeout(watchdog);
            progress?.kill();
            if (gsap && !motion.matches) {
                progress = gsap.timeline()
                    .to(bar, { scaleX: 1, duration: .18, ease: 'power2.out' })
                    .to(bar, { opacity: 0, duration: .22, delay: .08 });
            } else {
                bar.style.opacity = '0';
            }
        }
        watchdog = setTimeout(finish, 16000);
        return finish;
    }

    function reveal(elements, stagger = .08) {
        if (!gsap || motion.matches || !elements.length) return;
        gsap.fromTo(elements, { opacity: 0, y: 14 }, {
            opacity: 1, y: 0, duration: .45, stagger, ease: 'power2.out',
            clearProps: 'opacity,transform', overwrite: 'auto'
        });
    }

    const finishInitial = startProgress();
    document.addEventListener('DOMContentLoaded', () => {
        const initial = [...document.querySelectorAll(
            '#header, .article-meta, #content > div:not(#postBody), #content > .SideNav > .SideNav-item, #postBody > :is(h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,pre,table,figure)'
        )].filter(element => element.getBoundingClientRect().top < innerHeight);
        // Initial content stays readable even if GSAP cannot load.
        reveal(initial);
        setTimeout(finishInitial, 450);
        setupFeed();
    });
    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest('a[href]');
        if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
        if (url.pathname === '/' || url.pathname.endsWith('.html')) startProgress();
    });
    window.addEventListener('pageshow', event => {
        if (!event.persisted) return;
        ++progressId;
        progress?.kill();
        clearTimeout(watchdog);
        bar.style.opacity = '0';
    });
    motion.addEventListener('change', () => {
        if (!motion.matches) return;
        progress?.kill();
        bar.style.opacity = '0';
    });

    function setupFeed() {
        if (document.documentElement.dataset.blogLayout !== 'list') return;
        const list = document.querySelector('#content > .SideNav');
        const pagination = document.querySelector('.paginate-container');
        if (!list || !pagination || !window.IntersectionObserver) return;
        const rows = () => [...list.querySelectorAll(':scope > .SideNav-item[href]')];
        const seen = new Set(rows().map(row => row.href));
        const visited = new Set([location.pathname]);
        const loaded = [];
        const storageKey = 'blog-feed:' + location.pathname;
        let busy = false;
        let failed = false;
        let restoring = false;

        function nextPage(doc) {
            const href = doc.querySelector('.pagination a.next_page[rel="next"]')?.getAttribute('href');
            if (!href) return null;
            const url = new URL(href, location.href);
            if (url.origin !== location.origin || !/^\/page\d+\.html$/.test(url.pathname)) throw new Error('Invalid next page');
            return url.pathname;
        }
        let next;
        try { next = nextPage(document); } catch { return; }
        if (!next) return;

        const loader = document.createElement('div');
        loader.className = 'feed-loader';
        const spinner = document.createElement('span');
        spinner.className = 'feed-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        spinner.hidden = true;
        const status = document.createElement('span');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        const retry = document.createElement('button');
        retry.className = 'feed-retry';
        retry.type = 'button';
        retry.textContent = '重新載入';
        retry.hidden = true;
        const fallback = document.createElement('a');
        fallback.textContent = '開啟下一頁';
        fallback.hidden = true;
        loader.append(spinner, status, retry, fallback);
        pagination.after(loader);
        pagination.hidden = true;
        // Keep a previous-page route for readers who opened a numbered URL directly.
        const previous = pagination.querySelector('a.previous_page');
        if (previous) {
            const back = previous.cloneNode(true);
            back.textContent = '上一頁';
            loader.prepend(back);
        }

        function updateLoader() {
            spinner.hidden = !busy;
            retry.hidden = !failed;
            fallback.hidden = !failed;
            if (next) fallback.href = next;
            status.textContent = busy ? '想看更多…' : failed ? '暫時無法載入，請再試一次。' : next ? '繼續往下，還有更多文章' : '已讀取所有文章';
            list.setAttribute('aria-busy', String(busy));
        }

        async function loadMore(animate = true) {
            if (busy || !next) return false;
            const path = next;
            busy = true;
            failed = false;
            updateLoader();
            const finish = startProgress();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);
            const started = performance.now();
            try {
                const response = await fetch(path, { signal: controller.signal, credentials: 'omit' });
                if (!response.ok) throw new Error('Page unavailable');
                const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
                const source = doc.querySelector('#content > .SideNav');
                if (!source) throw new Error('Missing article list');
                const following = nextPage(doc);
                if (visited.has(path) || (following && (following === path || visited.has(following)))) throw new Error('Repeated page');
                const additions = [];
                const batchLinks = new Set();
                for (const sourceRow of source.querySelectorAll(':scope > .SideNav-item[href]')) {
                    const url = new URL(sourceRow.getAttribute('href'), new URL(path, location.href));
                    if (url.origin !== location.origin || !url.pathname.startsWith('/post/')) continue;
                    if (seen.has(url.href) || batchLinks.has(url.href)) continue;
                    const row = document.importNode(sourceRow, true);
                    row.href = url.href;
                    row.querySelectorAll('script').forEach(script => script.remove());
                    row.querySelectorAll('a[href]').forEach(link => {
                        link.href = new URL(link.getAttribute('href'), new URL(path, location.href)).href;
                    });
                    row.querySelectorAll('.svgTop0, .svgTop1').forEach(icon => {
                        const key = icon.classList.contains('svgTop1') ? 'upload' : 'post';
                        icon.setAttribute('d', window.IconList?.[key] || '');
                    });
                    additions.push(row);
                    batchLinks.add(url.href);
                }
                if (!additions.length) throw new Error('No new articles');
                if (animate && !motion.matches) await new Promise(resolve => setTimeout(resolve, Math.max(0, 1000 - (performance.now() - started))));
                list.append(...additions);
                batchLinks.forEach(url => seen.add(url));
                visited.add(path);
                loaded.push(path);
                next = following;
                if (animate) reveal(additions, .12);
                return true;
            } catch {
                failed = true;
                return false;
            } finally {
                clearTimeout(timeout);
                busy = false;
                finish();
                updateLoader();
            }
        }

        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting) && !failed && !restoring) loadMore();
        }, { rootMargin: '0px 0px 80px 0px' });
        retry.addEventListener('click', () => loadMore());
        window.addEventListener('pagehide', () => {
            try { sessionStorage.setItem(storageKey, JSON.stringify({ pages: loaded, y: scrollY })); } catch { /* Storage can be disabled. */ }
        });

        async function restore() {
            const navigation = performance.getEntriesByType('navigation')[0]?.type;
            if (navigation !== 'back_forward' && navigation !== 'reload') return;
            let saved;
            try { saved = JSON.parse(sessionStorage.getItem(storageKey)); } catch { return; }
            if (!Array.isArray(saved?.pages) || !saved.pages.length) return;
            restoring = true;
            for (const path of saved.pages) {
                // Only follow the current site's actual pagination, never arbitrary stored URLs.
                if (path !== next || !await loadMore(false)) break;
            }
            restoring = false;
            if (Number.isFinite(saved.y)) requestAnimationFrame(() => scrollTo(0, saved.y));
        }
        updateLoader();
        restore().finally(() => observer.observe(loader));
    }
})();
