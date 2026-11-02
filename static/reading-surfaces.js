/* Stable reading surfaces, refined glass controls. No continuous UI effects. */
document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
    if (document.getElementById('reading-surface-style')) return;
    if (document.querySelector('#postBody')) document.body.classList.add('reading-page');
    const style = document.createElement('style');
    style.id = 'reading-surface-style';
    style.textContent = `
        body {
            background: rgba(234,242,240,.94);
            backdrop-filter: none; -webkit-backdrop-filter: none;
            border: 1px solid rgba(255,255,255,.72);
            box-shadow: 0 18px 48px rgba(0,12,24,.22);
            color: #20343e;
        }
        body.reading-page { background: #eaf1ef; }
        #postBody, #postBody.markdown-body {
            background: transparent; color: #20343e; line-height: 1.95;
            overflow-wrap: break-word;
        }
        #postBody p { margin-top: 1em; margin-bottom: 1em; }
        #postBody :is(h1,h2,h3,h4,h5,h6) { color: #193b45; line-height: 1.5; }
        #postBody img { box-shadow: 0 3px 16px rgba(15,40,48,.08); }
        .SideNav {
            background: rgba(255,255,255,.3);
            backdrop-filter: none; -webkit-backdrop-filter: none;
            border-color: rgba(255,255,255,.7);
        }
        .SideNav-item { border-color: rgba(80,115,120,.13); }
        .article-preview { color: #405b63; font-size: 13px; line-height: 1.85; }
        #article-toc {
            background: linear-gradient(155deg,rgba(255,255,255,.9),rgba(224,239,235,.94));
            border: 1px solid rgba(255,255,255,.9);
            backdrop-filter: none; -webkit-backdrop-filter: none;
            box-shadow: 0 6px 22px rgba(15,44,53,.09), inset 0 1px 0 rgba(255,255,255,.9);
        }
        #article-toc summary { color: #204b53; border-radius: 8px; }
        #article-toc a { color: #35515a; }
        #article-toc a[aria-current="location"] {
            background: #d1e8e1; border-left-color: #377d70; color: #153e3c;
        }
        .reader-button, #header .btn, .pagination a, #starfield-toggle {
            color: #244d55;
            background: linear-gradient(165deg,rgba(255,255,255,.92),rgba(219,238,232,.76));
            border: 1px solid rgba(255,255,255,.88);
            box-shadow: 0 2px 7px rgba(19,56,61,.08), inset 0 1px 0 rgba(255,255,255,.96);
            backdrop-filter: blur(8px) saturate(110%); -webkit-backdrop-filter: blur(8px) saturate(110%);
            transition: background-color .12s ease, border-color .12s ease, box-shadow .12s ease;
            transform: none;
        }
        #header .btn, .pagination a { border-radius: 999px; }
        .reader-button:active, #header .btn:active, .pagination a:active, #starfield-toggle:active {
            background: #d3e9e1; box-shadow: inset 0 1px 3px rgba(19,56,61,.12);
        }
        .reader-button:focus-visible, #header .btn:focus-visible, .pagination a:focus-visible, #starfield-toggle:focus-visible {
            outline: 2px solid #28776a; outline-offset: 3px;
        }
        .reader-button:disabled { opacity: .45; box-shadow: none; }
        #image-viewer {
            background: #e8f0ed; backdrop-filter: none; -webkit-backdrop-filter: none;
            border-color: rgba(255,255,255,.85);
        }
        #image-viewer::backdrop { background: rgba(4,16,27,.84); backdrop-filter: none; }
        #image-viewer .viewer-toolbar { padding: 4px; border-radius: 12px; background: rgba(255,255,255,.3); }
        #image-viewer .viewer-stage { background: #132832; }
        #image-viewer .viewer-caption { color: #3e5b62; }
        @media (hover: hover) and (pointer: fine) {
            .reader-button:not(:disabled):not(:active):hover, #header .btn:not(:active):hover, .pagination a:not(:active):hover, #starfield-toggle:not(:active):hover {
                background: linear-gradient(165deg,#fff,rgba(218,239,232,.92));
                border-color: #a5cdc1;
                box-shadow: 0 4px 12px rgba(19,56,61,.12), inset 0 1px 0 #fff;
            }
            #article-toc summary:hover { background: rgba(255,255,255,.45); }
        }
        @media (max-width: 600px) {
            body { background: #eaf1ef; box-shadow: 0 8px 24px rgba(0,12,24,.18); }
            #article-toc { background: #e1ece7; box-shadow: 0 3px 10px rgba(15,44,53,.06); }
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
