/* Subsets cover generated content; load full coverage only for additional text. */
document.addEventListener('DOMContentLoaded', () => {
    const metadata = document.querySelector('meta[name="blog-font-characters"]');
    const fallback = document.querySelector('meta[name="blog-font-fallback"]')?.content;
    if (!metadata || !fallback) return;
    let url;
    try { url = new URL(fallback); } catch { return; }
    if (url.origin !== 'https://fonts.googleapis.com' || url.pathname !== '/css2') return;
    const known = new Set(metadata.content);
    let requested = false;
    const excluded = node => node.parentElement?.closest('script,style,noscript');
    const missing = text => [...text].some(char => !/\s/u.test(char) && !known.has(char));
    function loadFullFonts() {
        if (requested) return;
        requested = true;
        observer.disconnect();
        const link = document.createElement('link');
        link.id = 'full-font-fallback';
        link.rel = 'stylesheet';
        link.href = url.href;
        link.addEventListener('error', () => {
            requested = false;
            link.remove();
            observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        }, { once: true });
        document.head.append(link);
    }
    function inspect(node) {
        if (requested || excluded(node)) return;
        if (node.nodeType === Node.TEXT_NODE) {
            if (missing(node.textContent)) loadFullFonts();
            return;
        }
        if (node.nodeType !== Node.ELEMENT_NODE || node.matches('script,style,noscript')) return;
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        while (!requested && walker.nextNode()) {
            if (!excluded(walker.currentNode) && missing(walker.currentNode.textContent)) loadFullFonts();
        }
    }
    const observer = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'characterData') inspect(record.target);
            else record.addedNodes.forEach(inspect);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    document.addEventListener('input', event => {
        if (typeof event.target.value === 'string' && missing(event.target.value)) loadFullFonts();
    });
    inspect(document.body);
});
