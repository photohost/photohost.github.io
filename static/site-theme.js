document.addEventListener('DOMContentLoaded', () => {
    if (document.documentElement.dataset.blogLayout !== 'search') return;
    const input = document.querySelector('.subnav-search-input');
    const button = document.querySelector('button.btn.float-left');
    input?.addEventListener('keyup', event => {
        if (event.key === 'Enter') button?.click();
    });
});
/* Frosted panels and public article previews, 2026-11-02. */
document.addEventListener('DOMContentLoaded', () => {
    const cache = new Map();
    async function excerpt(url) {
        if (!cache.has(url)) {
            const pending = (async () => {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 8000);
                try {
                    const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
                    if (!response.ok) throw new Error('Article unavailable');
                    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
                    const body = doc.querySelector('#postBody');
                    if (!body) throw new Error('Article body unavailable');
                    body.querySelectorAll('script, style, pre, noscript, .anchor').forEach(el => el.remove());
                    const text = body.textContent.replace(/\s+/g, ' ').trim();
                    return text ? Array.from(text).slice(0, 160).join('') + (Array.from(text).length > 160 ? '…' : '') : '這篇文章以圖片或程式碼為主，點擊閱讀完整內容。';
                } finally { clearTimeout(timeout); }
            })();
            cache.set(url, pending);
            pending.catch(() => cache.delete(url));
        }
        return cache.get(url);
    }
    function attach(row) {
        if (row.dataset.previewReady) return;
        const url = new URL(row.getAttribute('href'), location.href);
        if (url.origin !== location.origin || !url.pathname.startsWith('/post/')) return;
        row.dataset.previewReady = 'true';
        const preview = document.createElement('span');
        preview.className = 'article-preview';
        row.append(preview);
        let timer;
        let loaded = false;
        function open() {
            clearTimeout(timer);
            row.classList.add('is-preview-open');
            if (loaded) return;
            preview.textContent = '正在讀取文章摘要…';
            timer = setTimeout(async () => {
                try { preview.textContent = await excerpt(url.href); loaded = true; }
                catch { preview.textContent = '暫時無法取得摘要，點擊閱讀完整文章。'; }
            }, 180);
        }
        function close() {
            clearTimeout(timer);
            row.classList.remove('is-preview-open');
        }
        row.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') open(); });
        row.addEventListener('pointerleave', () => { if (!row.contains(document.activeElement)) close(); });
        row.addEventListener('focusin', open);
        row.addEventListener('focusout', event => { if (!row.contains(event.relatedTarget)) close(); });
        row.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
    }
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') document.querySelectorAll('.is-preview-open').forEach(row => row.classList.remove('is-preview-open'));
    });
    document.querySelectorAll('.SideNav-item[href]').forEach(attach);
    const content = document.querySelector('#content');
    if (content) new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.matches('.SideNav-item[href]')) attach(node);
            node.querySelectorAll('.SideNav-item[href]').forEach(attach);
        }
    }).observe(content, { childList: true, subtree: true });
});
