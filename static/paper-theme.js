/* Paper theme switch and monthly text columns. No network beyond the static phrases file. */
(() => {
    const KEY = 'paper-theme';
    const root = document.documentElement;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let saved = null;
    try { saved = localStorage.getItem(KEY); } catch {}
    root.dataset.paperTheme = saved === 'dark' ? 'dark' : 'light';

    function label(button) {
        const dark = root.dataset.paperTheme === 'dark';
        button.textContent = dark ? '夜晚' : '白天';
        button.setAttribute('aria-label', dark ? '目前為夜晚主題，切換為白天' : '目前為白天主題，切換為夜晚');
    }

    // Pick a slice of the phrase pool that changes once per calendar month.
    function monthSlice(phrases, count) {
        const now = new Date();
        const offset = ((now.getFullYear() * 12 + now.getMonth()) * 7) % phrases.length;
        return Array.from({ length: phrases.length }, (_, i) => phrases[(offset + i) % phrases.length]).slice(0, count);
    }

    function buildColumns(phrases) {
        const wrap = document.createElement('div');
        wrap.id = 'paper-columns';
        wrap.setAttribute('aria-hidden', 'true');
        const pool = monthSlice(phrases, 9);
        pool.forEach((text, i) => {
            const thick = i % 2 === 0;
            const col = document.createElement('div');
            col.className = `paper-col ${thick ? 'thick' : 'thin'}`;
            const run = document.createElement('div');
            run.className = `paper-run ${i % 2 === 0 ? 'up' : 'dn'}`;
            const line = `${text}　`.repeat(thick ? 12 : 26);
            run.textContent = line + line;
            col.append(run);
            wrap.append(col);
        });
        // Direct child of <html>: stays behind the sheet's own backgrounds instead of painting over them.
        document.documentElement.insertBefore(wrap, document.body);
        // Constant calm speed in px/s (distance of one loop / speed), so long text never races.
        const SPEED = { thick: 12, thin: 22 };
        wrap.querySelectorAll('.paper-run').forEach(run => {
            const kind = run.parentElement.classList.contains('thick') ? 'thick' : 'thin';
            const loop = run.scrollHeight / 2;
            if (loop > 0) run.style.animationDuration = `${Math.round(loop / SPEED[kind])}s`;
        });
    }

    document.addEventListener('visibilitychange', () => {
        root.dataset.paperMotion = document.hidden || motion.matches ? 'paused' : 'running';
    });

    document.addEventListener('DOMContentLoaded', () => {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = 'paper-theme-toggle';
        label(button);
        button.addEventListener('click', () => {
            const next = root.dataset.paperTheme === 'dark' ? 'light' : 'dark';
            root.dataset.paperTheme = next;
            try { localStorage.setItem(KEY, next); } catch {}
            label(button);
        });
        if (root.dataset.blogLayout === 'list') {
            // Text links instead of icon buttons, as in the approved B3 design.
            document.querySelectorAll('#header .title-right > a.btn').forEach(a => {
                const href = a.getAttribute('href') || '';
                const text = href.includes('movietckt') ? '觀影' : href.includes('about') ? '關於' : '';
                if (!text) return;
                const span = document.createElement('span');
                span.className = 'paper-nav-label';
                span.textContent = text;
                a.append(span);
                a.setAttribute('aria-label', a.getAttribute('title') || text);
            });
        }
        const slot = root.dataset.blogLayout === 'list' ? document.querySelector('#header .title-right') : null;
        (slot || document.body).append(button);

        if (root.dataset.blogLayout === 'list' && !motion.matches) {
            fetch('/phrases.json', { credentials: 'omit' })
                .then(response => (response.ok ? response.json() : []))
                .then(phrases => { if (phrases.length) buildColumns(phrases); })
                .catch(() => {});
        }
    });
})();
