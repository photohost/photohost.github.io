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
    options.setAttribute('aria-label', '文章標籤');
    options.innerHTML = '<span role="status">正在載入標籤…</span><button type="button" class="feed-retry" hidden>重新載入標籤</button><div class="search-tags"></div>';
    header.after(options);
    const tagStatus = options.querySelector('[role=status]');
    const tagRetry = options.querySelector('button');
    const tagList = options.querySelector('.search-tags');
    const panel = document.createElement('section');
    panel.id = 'search-results';
    panel.hidden = true;
    panel.setAttribute('aria-label', '搜尋結果');
    panel.innerHTML = '<p role="status" aria-live="polite"></p><button type="button" class="feed-retry" hidden>重新搜尋</button><nav class="SideNav border" aria-label="符合的文章"></nav>';
    feed.before(panel);
    const status = panel.querySelector('[role=status]');
    const retry = panel.querySelector('button');
    const results = panel.querySelector('nav');
    let selectedTag = new URLSearchParams(location.search).get('tag') || '';
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
        input.disabled = false;
        button.setAttribute('aria-expanded', 'true');
        button.setAttribute('aria-label', '搜尋文章');
        input.focus({ preventScroll: true });
    }
    function collapse() {
        opened = false;
        header.classList.remove('search-expanded');
        form.classList.remove('is-expanded');
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
    function updateTags() {
        tagList.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item.dataset.tag === selectedTag)));
    }
    function updateUrl(push = false) {
        const url = new URL(location.href);
        for (const [name, value] of [['tag', selectedTag], ['q', input.value.trim()]]) {
            if (value) url.searchParams.set(name, value); else url.searchParams.delete(name);
        }
        if (url.href !== location.href) history[push ? 'pushState' : 'replaceState'](null, '', url);
    }
    function chooseTag(tag) {
        selectedTag = tag;
        input.value = '';
        updateUrl(true);
        search();
    }
    async function loadTags() {
        tagRetry.hidden = true;
        tagStatus.hidden = false;
        tagStatus.textContent = '正在載入標籤…';
        try {
            const { posts, colors } = await getIndex();
            const counts = new Map();
            posts.forEach(post => post.labels.forEach(tag => counts.set(tag, (counts.get(tag) || 0) + 1)));
            const fragment = document.createDocumentFragment();
            for (const tag of ['', ...[...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b))]) {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'Label search-tag';
                item.dataset.tag = tag;
                item.textContent = tag || '全部文章';
                if (tag) item.style.backgroundColor = colors[tag] || '#666';
                item.addEventListener('click', () => chooseTag(tag));
                fragment.append(item);
            }
            tagList.replaceChildren(fragment);
            updateTags();
            tagStatus.hidden = true;
        } catch {
            tagStatus.textContent = '暫時無法載入標籤。';
            tagRetry.hidden = false;
        }
    }
    function makeRow(post, colors) {
        const url = new URL(post.postUrl, location.origin + '/');
        if (url.origin !== location.origin || !url.pathname.startsWith('/post/')) return null;
        const row = document.createElement('a');
        row.className = 'SideNav-item d-flex flex-items-center flex-justify-between';
        row.href = url.href;
        // Match Gmeek's homepage row structure so shared spacing and previews apply.
        const center = document.createElement('div');
        center.className = 'd-flex flex-items-center';
        const source = [...feed.querySelectorAll(':scope > .SideNav-item')].find(item => item.href === url.href);
        let icon = source?.querySelector('.SideNav-icon')?.cloneNode(true);
        if (!icon) {
            icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            icon.setAttribute('class', 'SideNav-icon octicon');
            icon.style.width = '16px';
            icon.style.height = '16px';
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', window.IconList?.post || '');
            icon.append(path);
        }
        icon.setAttribute('aria-hidden', 'true');
        const title = document.createElement('span');
        title.className = 'listTitle';
        title.textContent = post.postTitle;
        const labels = document.createElement('div');
        labels.className = 'listLabels';
        const badge = (text, color, type) => {
            const element = document.createElement('span');
            element.className = 'Label ' + type;
            if (type === 'LabelName') {
                const wrapper = document.createElement('object');
                const link = document.createElement('a');
                link.href = '/?tag=' + encodeURIComponent(text);
                link.style.color = '#fff';
                link.textContent = text;
                wrapper.append(link);
                element.append(wrapper);
            } else {
                element.textContent = text;
            }
            element.style.backgroundColor = color || '#666';
            labels.append(element);
        };
        post.labels.forEach(tag => badge(tag, colors[tag], 'LabelName'));
        badge(post.createdDate, post.dateLabelColor, 'LabelTime');
        center.append(icon, title);
        row.append(center, labels);
        return row;
    }
    async function search() {
        clearTimeout(timer);
        const current = ++version;
        const query = normalize(input.value);
        clear.hidden = !input.value && !selectedTag;
        retry.hidden = true;
        updateUrl();
        updateTags();
        setActive(Boolean(query || selectedTag));
        if (!query && !selectedTag) { panel.removeAttribute('aria-busy'); return; }
        status.textContent = '正在搜尋…';
        panel.setAttribute('aria-busy', 'true');
        results.replaceChildren();
        try {
            const { posts, colors } = await getIndex();
            if (current !== version) return;
            const words = query.split(/\s+/);
            const matched = posts.filter(post => {
                if (selectedTag && !post.labels.includes(selectedTag)) return false;
                const haystack = normalize([post.postTitle].concat(post.labels).join(' '));
                return words.every(word => haystack.includes(word));
            });
            const rows = matched.map(post => makeRow(post, colors)).filter(Boolean);
            results.replaceChildren(...rows);
            status.textContent = rows.length ? `${selectedTag ? selectedTag + ' · ' : ''}找到 ${rows.length} 篇文章` : '找不到符合的文章，請換個關鍵字或點選「全部文章」。';
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
    clear.addEventListener('click', () => { chooseTag(''); input.focus(); });
    retry.addEventListener('click', search);
    tagRetry.addEventListener('click', loadTags);
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
        selectedTag = '';
        search();
        collapse();
        button.focus();
    }));
    function restoreUrl() {
        const params = new URLSearchParams(location.search);
        selectedTag = params.get('tag') || '';
        input.value = params.get('q') || '';
        if (input.value) expand();
        search();
    }
    window.addEventListener('popstate', restoreUrl);
    // Keep homepage badge clicks in place, including rows appended by infinite scroll.
    document.addEventListener('click', event => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target.closest('a[href]');
        if (!link) return;
        const url = new URL(link.href, location.href);
        if (url.origin !== location.origin || !['/', '/index.html'].includes(url.pathname) || !url.searchParams.has('tag')) return;
        event.preventDefault();
        chooseTag(url.searchParams.get('tag'));
        header.scrollIntoView({ block: 'start' });
    }, true);
    loadTags();
    restoreUrl();
});
