/* Homepage title typewriter. One timer, no libraries or network requests. */
document.addEventListener('DOMContentLoaded', () => {
    const original = document.querySelector('.title-left .blogTitle');
    if (!original || document.getElementById('homepage-title')) return;
    document.getElementById('avatarImg')?.remove();
    const title = document.createElement('h1');
    title.id = 'homepage-title';
    title.setAttribute('aria-label', '終末孤寂');
    const text = document.createElement('span');
    text.setAttribute('aria-hidden', 'true');
    title.append(text);
    original.replaceWith(title);
    const style = document.createElement('style');
    style.textContent = `
        #header:has(#homepage-title) { align-items: center; gap: 16px; }
        #homepage-title { margin: 0; font-size: 40px; font-weight: 700; line-height: 1.5; min-height: 1.5em; color: #303030; white-space: nowrap; }
        #homepage-title::after { content: ''; display: inline-block; height: 1em; margin-left: 4px; border-right: 2px solid #555; vertical-align: -.1em; animation: title-caret 1s steps(1) infinite; }
        .title-left:has(#homepage-title) { flex: 1; min-width: 0; }
        #header:has(#homepage-title) .title-right { flex-shrink: 0; }
        @keyframes title-caret { 0%,49% { opacity: 1; } 50%,100% { opacity: 0; } }
        @media (max-width: 600px) { #homepage-title { font-size: 22px; } }
        @media (max-width: 360px) { #homepage-title { font-size: 20px; } }
        @media (prefers-reduced-motion: reduce) { #homepage-title::after { animation: none; } }
    `;
    document.head.append(style);
    const words = ['終末孤寂', '我是誰？', '孤獨', '獨行俠', '404 ERROR', 'server not found'];
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const TYPE = 140, ERASE = 85, HOLD = 3000, GAP = 200;
    let index = 0, count = 0, deleting = false, timer;
    function schedule(delay) {
        clearTimeout(timer);
        if (!document.hidden && !reduced.matches) timer = setTimeout(step, delay);
    }
    function step() {
        if (document.hidden || reduced.matches) return;
        const chars = Array.from(words[index]);
        if (!deleting) {
            count++;
            text.textContent = chars.slice(0, count).join('');
            if (count === chars.length) { deleting = true; schedule(HOLD); }
            else schedule(TYPE);
        } else {
            count--;
            text.textContent = chars.slice(0, count).join('');
            if (count === 0) { deleting = false; index = (index + 1) % words.length; schedule(GAP); }
            else schedule(ERASE);
        }
    }
    function reset() {
        clearTimeout(timer);
        index = 0; count = 0; deleting = false;
        text.textContent = reduced.matches ? words[0] : '';
        schedule(TYPE);
    }
    reduced.addEventListener('change', reset);
    document.addEventListener('visibilitychange', () => {
        clearTimeout(timer);
        if (!document.hidden && !reduced.matches) schedule(deleting && count === Array.from(words[index]).length ? HOLD : deleting ? ERASE : TYPE);
    });
    reset();
});
