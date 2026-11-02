document.addEventListener('DOMContentLoaded', function() {    
    let currentUrl = window.location.pathname;
    //let currentHost = window.location.hostname;

    //主页主题------------------------------------------------------------------------------
    
    if (currentUrl == '/' || currentUrl.includes('/index.html') || currentUrl.includes('/page')) {
        console.log('应用主页主题');
        let style = document.createElement("style");
        style.innerHTML = `
        html {    
            background: #101010;
            background-size: cover;
        }

        /* 主体布局 */
        body {
            min-width: 200px;
            max-width: 920px;
            margin: 30px auto;   /*设置所有外边距离 */
            font-size: 16px;
            font-family: sans-serif;
            line-height: 1.25;
            background: rgba(238,238,238, 0.84); 
            border-radius: 10px; /* 圆角边框 */
            box-shadow: 0 0 10px rgba(0,0,0, 0.5); /* 添加阴影 */
            overflow: auto;
        }

        /* 主页博客列表圆角边框 */
        .SideNav {
            background: rgba(255,255,255, 0.6); /* 白色背景，透明度60% */
            border-radius: 10px; /* 圆角边框 */
            min-width: unset;
        }

        /* 鼠标放到博客标题后会高亮 */
        .SideNav-item:hover {
            background-color: #dddddd;
            border-radius: 10px;
            transform: scale(1.04);
            box-shadow: 0 0 5px rgba(0,0,0, 0.5);
        }

        .SideNav-item {
            transition: 0.1s;
        }

        /* 分页条 */
        .pagination a:hover, .pagination a:focus, .pagination span:hover, .pagination span:focus, .pagination em:hover, .pagination em:focus {
            border-color: #777;
        `;
        document.head.appendChild(style);}


    //文章页主题------------------------------------------------------------------------------
    
    else if (currentUrl.includes('/post/') || currentUrl.includes('/link.html') || currentUrl.includes('/about.html')) {
        console.log('文章页主题');

        let style = document.createElement("style");
        style.innerHTML = `

        html {    
            background: #101010;
            background-size: cover;
        }

        /* 主体布局 */
        body {
            min-width: 200px;
            max-width: 920px;
            margin: 30px auto;   /*设置所有外边距离 */
            font-size: 16px;
            font-family: sans-serif;
            line-height: 1.25;
            background: rgba(238,238,238, 0.84); 
            border-radius: 10px; /* 圆角边框 */
            box-shadow: 0 0 10px rgba(0,0,0, 0.5); /* 添加阴影 */
            overflow: auto;
        }

        /* markdown内容 */
        /* 图片圆角 */
        .markdown-body img {
            border-radius: 8px;
            border: 1px solid rgba(255,255,255, 0.78); 
        }
        
        /* notice、caution、warning等提示信息的圆角 */
        .markdown-alert {
            border-radius: 8px;
        }
        
        /* 代码块 */
        .markdown-body .highlight pre, .markdown-body pre {
            color: rgb(0,0,0);          /* 代码块内代码颜色 */
            background-color: rgba(244,244,244, 0.967);       /* 代码块内框颜色 */
            box-shadow: 0 10px 30px 0 rgba(218,218,218, 0.4);
            padding-top: 20px; 
            border-radius: 8px;
        }

        /* 标题橙色包裹 */
        .markdown-body h1{
          display: inline-block;
          font-size: 1.3rem;
          font-weight: bold;
          background: rgb(156,156,156);
          color: #ffffff;
          padding: 3px 10px ;
          border-radius: 8px;
          margin-right: 2px;
        } 
        `;
        document.head.appendChild(style);
    } 


    // 搜索页主题--------------------------------------------------------------------
    
    else if (currentUrl.includes('/tag')) {
        console.log('应用搜索页主题');
        let style = document.createElement("style");
        style.innerHTML = `
        
        html {    
            background: #101010;
            background-size: cover;
        }

        /* 主体布局 */
        body {
            min-width: 200px;
            max-width: 920px;
            margin: 30px auto;   /*设置所有外边距离 */
            font-size: 16px;
            font-family: sans-serif;
            line-height: 1.25;
            background: rgba(238,238,238, 0.84); 
            border-radius: 10px; /* 圆角边框 */
            box-shadow: 0 0 10px rgba(0,0,0, 0.5); /* 添加阴影 */
            overflow: auto;
        }
        
        .SideNav {
            background: rgba(255,255,255, 0.6); /* 白色背景，透明度60% */
            border-radius: 10px; /* 圆角边框 */
            min-width: unset;
        }
        
        .SideNav-item:hover {
            background-color: #dddddd;
            border-radius: 10px;
            transform: scale(1.02);
            box-shadow: 0 0 5px rgba(0,0,0, 0.5);
        }
        
        .SideNav-item {
            transition: 0.1s;
        }
        
        .subnav-search-input {
            border-radius: 2em;
            float: unset !important;
        }
        
        .subnav-search-icon {
            top: 9px;
        }
        
        button.btn.float-left {
            display: none;
        }
        
        .subnav-search {
            width: unset; 
            height: 36px;
        }
        `;
        document.head.appendChild(style);
    
        // 搜索框回车触发
        let input = document.getElementsByClassName("form-control subnav-search-input float-left")[0];
        let button = document.getElementsByClassName("btn float-left")[0];
        input.addEventListener("keyup", function(event) {
            event.preventDefault();
            if (event.keyCode === 13) {
                button.click();
            }
        });
    }
})

/* Frosted panels and public article previews, 2026-11-02. */
document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
        body {
            background: rgba(242,242,242, .52);
            -webkit-backdrop-filter: blur(20px) saturate(120%);
            backdrop-filter: blur(20px) saturate(120%);
            border: 1px solid rgba(255,255,255, .48);
            box-shadow: 0 16px 48px rgba(10,10,10, .24);
            color: #292929;
        }
        .SideNav {
            background: rgba(255,255,255, .20);
            border: 1px solid rgba(255,255,255, .38);
            border-radius: 12px;
            min-width: 0;
        }
        .SideNav-item {
            flex-wrap: wrap;
            border-color: rgba(255,255,255, .28);
            color: #292929;
            transition: background-color .18s, box-shadow .18s;
        }
        .SideNav-item:hover, .SideNav-item:focus-visible {
            background: rgba(234,234,234, .65);
            transform: none;
            border-radius: 9px;
            box-shadow: inset 0 0 0 1px rgba(255,255,255, .55);
        }
        .SideNav-item:focus-visible { outline: 2px solid #626262; outline-offset: 2px; }
        .article-preview {
            flex: 0 0 100%;
            min-width: 0;
            max-height: 0;
            overflow: hidden;
            opacity: 0;
            font-size: 12px;
            font-weight: 400;
            line-height: 1.7;
            color: #474747;
            white-space: normal;
            overflow-wrap: anywhere;
            transition: max-height .18s ease, opacity .18s ease, margin .18s ease;
        }
        .is-preview-open > .article-preview {
            max-height: 7em;
            margin-top: 8px;
            padding-left: 32px;
            opacity: 1;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
        }
        @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
            body { background: rgba(242,242,242, .92); }
        }
        @media (max-width: 600px) {
            body { margin: 12px 10px; }
            .SideNav-item { gap: 4px; }
            .SideNav-item > .d-flex { flex: 1; }
            .is-preview-open > .article-preview { padding-left: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
            .SideNav-item, .article-preview { transition: none; }
        }
    `;
    document.head.append(style);
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
