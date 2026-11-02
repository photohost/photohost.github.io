/* Stable reading surfaces, refined glass controls. No continuous UI effects. */
document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
    if (document.getElementById('reading-surface-style')) return;
    if (document.querySelector('#postBody')) document.body.classList.add('reading-page');
    const style = document.createElement('style');
    style.id = 'reading-surface-style';
    style.textContent = `
        body {
            background: rgba(240,240,240,.94);
            backdrop-filter: none; -webkit-backdrop-filter: none;
            border: 1px solid rgba(255,255,255,.72);
            box-shadow: 0 18px 48px rgba(10,10,10,.22);
            color: #303030;
        }
        body.reading-page { background: #efefef; }
        #postBody, #postBody.markdown-body {
            background: transparent; color: #303030; line-height: 1.95;
            overflow-wrap: break-word;
        }
        #postBody p { margin-top: 1em; margin-bottom: 1em; }
        #postBody :is(h1,h2,h3,h4,h5,h6) { color: #343434; line-height: 1.5; }
        #postBody img { box-shadow: 0 3px 16px rgba(35,35,35,.08); }
        .SideNav {
            background: rgba(255,255,255,.3);
            backdrop-filter: none; -webkit-backdrop-filter: none;
            border-color: rgba(255,255,255,.7);
        }
        .SideNav-item { border-color: rgba(108,108,108,.13); }
        .article-preview { color: #565656; font-size: 13px; line-height: 1.85; }
        #article-toc {
            background: linear-gradient(155deg,rgba(255,255,255,.9),rgba(236,236,236,.94));
            border: 1px solid rgba(255,255,255,.9);
            backdrop-filter: none; -webkit-backdrop-filter: none;
            box-shadow: 0 6px 22px rgba(38,38,38,.09), inset 0 1px 0 rgba(255,255,255,.9);
        }
        #article-toc summary { color: #424242; border-radius: 8px; }
        #article-toc a { color: #4c4c4c; }
        #article-toc a[aria-current="location"] {
            background: #e3e3e3; border-left-color: #6d6d6d; color: #353535;
        }
        .reader-button, #header .btn, .pagination a, #starfield-toggle {
            color: #454545;
            background: linear-gradient(165deg,rgba(255,255,255,.92),rgba(234,234,234,.76));
            border: 1px solid rgba(255,255,255,.88);
            box-shadow: 0 2px 7px rgba(48,48,48,.08), inset 0 1px 0 rgba(255,255,255,.96);
            backdrop-filter: blur(8px) saturate(110%); -webkit-backdrop-filter: blur(8px) saturate(110%);
            transition: background-color .12s ease, border-color .12s ease, box-shadow .12s ease;
            transform: none;
        }
        #header .btn, .pagination a { border-radius: 999px; }
        .reader-button:active, #header .btn:active, .pagination a:active, #starfield-toggle:active {
            background: #e4e4e4; box-shadow: inset 0 1px 3px rgba(48,48,48,.12);
        }
        .reader-button:focus-visible, #header .btn:focus-visible, .pagination a:focus-visible, #starfield-toggle:focus-visible {
            outline: 2px solid #656565; outline-offset: 3px;
        }
        .reader-button:disabled { opacity: .45; box-shadow: none; }
        #image-viewer {
            background: #eeeeee; backdrop-filter: none; -webkit-backdrop-filter: none;
            border-color: rgba(255,255,255,.85);
        }
        #image-viewer::backdrop { background: rgba(14,14,14,.84); backdrop-filter: none; }
        #image-viewer .viewer-toolbar { padding: 4px; border-radius: 12px; background: rgba(255,255,255,.3); }
        #image-viewer .viewer-stage { background: #242424; }
        #image-viewer .viewer-caption { color: #555555; }
        /* Scoped UI rules deliberately exclude Label/LabelTime/tag badges. */
        .SideNav-item, .SideNav-item .listTitle { color: #282828; }
        .SideNav-item:hover, .SideNav-item:focus-visible { background: #e4e4e4; }
        .SideNav-icon { color: #666 !important; }
        #header, #postBody { border-color: #d3d3d3; }
        .SideNav.border { border-color: #cfcfcf !important; }
        #header .octicon, .subnav-search-icon { color: #666; }
        #postBody :is(h1,h2,h3,h4,h5,h6) { border-color: #d0d0d0; }
        #postBody hr { background-color: #d0d0d0; border-color: #d0d0d0; }
        #postBody blockquote { color: #666; border-color: #bdbdbd; }
        #postBody :is(th,td) { border-color: #ccc; }
        #postBody table tr { background: #fafafa; border-color: #ccc; }
        #postBody table tr:nth-child(2n) { background: #f0f0f0; }
        #postBody code { background-color: #e6e6e6; }
        #postBody pre, #postBody .highlight pre { background-color: #e8e8e8; }
        #postBody pre code { background-color: transparent; }
        #footer a, #postBody a { color: #3a3a3a; }
        #footer a, #postBody a:not(.anchor) { text-decoration: underline; text-underline-offset: .18em; }
        #footer a:hover, #postBody a:hover { color: #111; }
        #postBody img:focus-visible, #article-toc a:focus-visible, #article-toc summary:focus-visible {
            outline-color: #555;
        }
        .form-control { color: #292929; background: #fafafa; border-color: #bbb; }
        .form-control:focus { border-color: #666; box-shadow: 0 0 0 3px rgba(0,0,0,.12); }
        .pagination :is(a,span,em):is(:hover,:focus) { border-color: #777; }
        #postBody .markdown-alert { color: #333; border-color: #888; background: #f4f4f4; }
        #postBody .markdown-alert .markdown-alert-title { color: #444; }
        /* Keep neighboring controls visually and physically separate. */
        #header .title-right { gap: 8px; }
        #header .title-right > .btn { margin: 0; }
        .paginate-container .pagination, .pagination { display: inline-flex; flex-wrap: wrap; justify-content: center; gap: 8px; }
        .pagination > :is(a,span,em) { margin: 0; }
        .pagination a:is(:hover,:focus,:active,:visited) { color: #333; }
        #article-toc > nav[aria-label="文章閱讀位置"] {
            display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-start;
        }
        @media (hover: hover) and (pointer: fine) {
            .reader-button:not(:disabled):not(:active):hover, #header .btn:not(:active):hover, .pagination a:not(:active):hover, #starfield-toggle:not(:active):hover {
                background: linear-gradient(165deg,#ffffff,rgba(234,234,234,.92));
                border-color: #c4c4c4;
                box-shadow: 0 4px 12px rgba(48,48,48,.12), inset 0 1px 0 #ffffff;
            }
            #article-toc summary:hover { background: rgba(255,255,255,.45); }
        }
        @media (max-width: 600px) {
            body { background: #efefef; box-shadow: 0 8px 24px rgba(10,10,10,.18); }
            #article-toc { background: #e9e9e9; box-shadow: 0 3px 10px rgba(38,38,38,.06); }
            .reader-button, #header .btn, .pagination a, #starfield-toggle {
                backdrop-filter: none; -webkit-backdrop-filter: none;
            }
        }
        @media (prefers-reduced-motion: reduce) {
            .reader-button, #header .btn, .pagination a, #starfield-toggle { transition: none; }
        }
    `;
    document.head.append(style);
}, 0));
