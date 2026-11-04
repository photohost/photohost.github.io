/* Homepage search uses the published index; no article bodies are downloaded. */
document.addEventListener('DOMContentLoaded', () => {
    if (document.documentElement.dataset.blogLayout !== 'list') return;
    const oldButton = document.querySelector('#buttonSearch');
    const header = document.querySelector('#header');
    const content = document.querySelector('#content');
    const feed = content?.querySelector(':scope > .SideNav');
    if (!oldButton || !header || !feed) return;

    const form = document.createElement('form');
    form.className = 'inline-search';
    form.setAttribute('role', 'search');
    form.setAttribute('aria-label', '搜尋文章');
    form.innerHTML = '<input id="inline-search-input" type="search" placeholder="搜尋標題或標籤…" aria-label="搜尋標題或標籤" autocomplete="off" disabled><button class="search-clear" type="button" aria-label="清除搜尋" hidden>×</button><button id="buttonSearch" type="button" aria-label="展開搜尋" aria-expanded="false" aria-controls="inline-search-input search-options search-results"></button>';
    const button = form.querySelector('#buttonSearch');
    const icon = oldButton.querySelector('svg')?.cloneNode(true);
    if (icon) { icon.setAttribute('aria-hidden', 'true'); button.append(icon); }
    oldButton.replaceWith(form);
    const input = form.querySelector('input');
    const clear = form.querySelector('.search-clear');
    const options = document.createElement('div');
    options.id = 'search-options';
    options.hidden = true;
    options.innerHTML = '<label><input type="checkbox"> 僅搜尋標籤（tags）</label><span>搜尋全部文章的標題與標籤</span>';
    header.after(options);
    const tagsOnly = options.querySelector('input');
    const panel = document.createElement('section');
    panel.id = 'search-results';
    panel.hidden = true;
    panel.setAttribute('aria-label', '搜尋結果');
    panel.innerHTML = '<p role="status" aria-live="polite"></p><button type="button" class="feed-retry" hidden>重新搜尋</button><nav class="SideNav border" aria-label="符合的文章"></nav>';
    feed.before(panel);
    const status = panel.querySelector('[role=status]');
    const retry = panel.querySelector('button');
    const results = panel.querySelector('nav');
    const key = 'blog-search:' + location.pathname;
    let opened = false;
    let active = false;
    let composing = false;
    let version = 0;
    let timer;
    let indexPromise;
    let originalY = 0;
    const normalize = text => String(text).normalize('NFKC').toLocaleLowerCase().trim();

    function expand() {
        opened = true;
        header.classList.add('search-expanded');
        form.classList.add('is-expanded');
        options.hidden = false;
        input.disabled = false;
        button.setAttribute('aria-expanded', 'true');
        button.setAttribute('aria-label', '搜尋文章');
        input.focus({ preventScroll: true });
    }
    function collapse() {
        opened = false;
        header.classList.remove('search-expanded');
        form.classList.remove('is-expanded');
        options.hidden = true;
        input.disabled = true;
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-label', '展開搜尋');
    }
    function setActive(value) {
        if (active === value) return;
        active = value;
        if (value) originalY = scrollY;
        content.classList.toggle('is-searching', value);
        document.documentElement.dataset.searchActive = String(value);
        panel.hidden = !value;
        document.dispatchEvent(new Event('blog:search-change'));
        if (!value) requestAnimationFrame(() => scrollTo(0, originalY));
    }
    async function getIndex() {
        if (!indexPromise) {
            indexPromise = (async () => {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 12000);
                try {
                    const response = await fetch('/postList.json', { signal: controller.signal, credentials: 'omit', cache: 'no-cache' });
                    if (!response.ok) throw new Error('Index unavailable');
                    const data = await response.json();
                    if (!data || !data.labelColorDict) throw new Error('Invalid index');
                    const posts = Object.values(data).filter(post => Array.isArray(post?.labels) && typeof post.postTitle === 'string' && typeof post.postUrl === 'string');
                    posts.sort((a, b) => String(b.createdDate).localeCompare(String(a.createdDate)));
                    return { posts, colors: data.labelColorDict };
                } finally { clearTimeout(timeout); }
            })().catch(error => { indexPromise = null; throw error; });
        }
        return indexPromise;
    }
    function makeRow(post, colors) {
        const url = new URL(post.postUrl, location.origin + '/');
        if (url.origin !== location.origin || !url.pathname.startsWith('/post/')) return null;
        const row = document.createElement('a');
        row.className = 'SideNav-item d-flex flex-items-center flex-justify-between';
        row.href = url.href;
        const title = document.createElement('span');
        title.className = 'listTitle';
        title.textContent = post.postTitle;
        const labels = document.createElement('div');
        labels.className = 'listLabels';
        const badge = (text, color, type) => {
            const element = document.createElement('span');
            element.className = 'Label ' + type;
            element.textContent = text;
            element.style.backgroundColor = color || '#666';
            labels.append(element);
        };
        post.labels.forEach(tag => badge(tag, colors[tag], 'LabelName'));
        badge(post.createdDate, post.dateLabelColor, 'LabelTime');
        row.append(title, labels);
        return row;
    }
    async function search() {
        clearTimeout(timer);
        const current = ++version;
        const query = normalize(input.value);
        clear.hidden = !input.value;
        retry.hidden = true;
        setActive(Boolean(query));
        if (!query) { panel.removeAttribute('aria-busy'); return; }
        status.textContent = '正在搜尋…';
        panel.setAttribute('aria-busy', 'true');
        results.replaceChildren();
        try {
            const { posts, colors } = await getIndex();
            if (current !== version) return;
            const words = query.split(/\s+/);
            const matched = posts.filter(post => {
                const haystack = normalize((tagsOnly.checked ? [] : [post.postTitle]).concat(post.labels).join(' '));
                return words.every(word => haystack.includes(word));
            });
            const rows = matched.map(post => makeRow(post, colors)).filter(Boolean);
            results.replaceChildren(...rows);
            status.textContent = rows.length ? `找到 ${rows.length} 篇文章` : '找不到符合的文章，請換個關鍵字或取消「僅搜尋標籤」。';
        } catch {
            if (current !== version) return;
            status.textContent = '暫時無法讀取文章索引，請重試，或清除搜尋繼續瀏覽。';
            retry.hidden = false;
        } finally {
            if (current === version) panel.removeAttribute('aria-busy');
        }
    }
    button.addEventListener('click', () => { if (!opened) expand(); else { search(); input.focus(); } });
    form.addEventListener('submit', event => { event.preventDefault(); if (!composing) search(); });
    input.addEventListener('compositionstart', () => { composing = true; clearTimeout(timer); });
    input.addEventListener('compositionend', () => { composing = false; search(); });
    input.addEventListener('input', () => {
        clear.hidden = !input.value;
        ++version;
        clearTimeout(timer);
        if (!composing) timer = setTimeout(search, 180);
    });
    tagsOnly.addEventListener('change', () => {
        input.placeholder = tagsOnly.checked ? '搜尋標籤…' : '搜尋標題或標籤…';
        input.setAttribute('aria-label', input.placeholder.replace('…', ''));
        options.querySelector('span').textContent = tagsOnly.checked ? '只比對文章標籤' : '搜尋全部文章的標題與標籤';
        search();
    });
    clear.addEventListener('click', () => { input.value = ''; search(); input.focus(); });
    retry.addEventListener('click', search);
    document.addEventListener('focusin', event => {
        if (opened && !input.value.trim() && !form.contains(event.target) && !options.contains(event.target)) collapse();
    });
    document.addEventListener('pointerdown', event => {
        if (opened && !input.value.trim() && !form.contains(event.target) && !options.contains(event.target)) collapse();
    });
    input.addEventListener('blur', () => requestAnimationFrame(() => {
        if (!input.value.trim() && !form.contains(document.activeElement) && !options.contains(document.activeElement)) collapse();
    }));
    [form, options].forEach(element => element.addEventListener('keydown', event => {
        if (event.key !== 'Escape' || event.isComposing) return;
        event.preventDefault();
        input.value = '';
        search();
        collapse();
        button.focus();
    }));
    window.addEventListener('pagehide', () => {
        try { sessionStorage.setItem(key, JSON.stringify({ query: input.value, tagsOnly: tagsOnly.checked })); } catch { /* Optional restoration. */ }
    });
    const navigation = performance.getEntriesByType('navigation')[0]?.type;
    if (navigation === 'back_forward' || navigation === 'reload') {
        try {
            const saved = JSON.parse(sessionStorage.getItem(key));
            if (saved?.query) { input.value = saved.query; tagsOnly.checked = Boolean(saved.tagsOnly); expand(); tagsOnly.dispatchEvent(new Event('change')); }
        } catch { /* Ignore unavailable or outdated storage. */ }
    }
});
