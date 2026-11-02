/* Lightweight local starfield: no images, libraries or network requests. */
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('starfield')) return;
    const style = document.createElement('style');
    style.textContent = `
        html { background: #07111d !important; }
        body { position: relative; z-index: 1; }
        #starfield { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 0; pointer-events: none; }
        #starfield-toggle { display: block; position: relative; margin: 12px auto; z-index: 2; border: 1px solid rgba(255,255,255,.35);
            border-radius: 18px; padding: 6px 10px; color: #e2eeef; background: rgba(14,33,46,.7);
            backdrop-filter: blur(12px); font-family: 'Noto Serif TC', 'Noto Serif JP', serif; font-size: 11px; cursor: pointer; }
        #starfield-toggle:focus-visible { outline: 2px solid #bde6df; outline-offset: 3px; }
        @media print { #starfield, #starfield-toggle { display: none; } }
    `;
    document.head.append(style);
    const canvas = document.createElement('canvas');
    canvas.id = 'starfield'; canvas.setAttribute('aria-hidden', 'true');
    // Outside body: its backdrop-filter would otherwise contain a fixed canvas.
    document.documentElement.insertBefore(canvas, document.body);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) { canvas.remove(); return; }
    const toggle = document.createElement('button');
    toggle.id = 'starfield-toggle'; toggle.type = 'button';
    (document.getElementById('footer') || document.body).append(toggle);
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let paused = reduced.matches;
    let width = 0, height = 0, stars = [], frame = 0, last = 0;
    function reset(star, initial = false) {
        star.x = Math.random() * 2 - 1; star.y = Math.random() * 2 - 1;
        star.z = initial ? .15 + Math.random() * .85 : 1;
    }
    function resize() {
        width = innerWidth; height = innerHeight;
        const ratio = Math.min(devicePixelRatio || 1, width < 600 ? 1.25 : 1.5, Math.sqrt(2200000 / Math.max(1,width * height)));
        canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
        ctx.setTransform(ratio,0,0,ratio,0,0);
        stars = Array.from({length: width < 600 ? 100 : 240}, () => { const star = {}; reset(star,true); return star; });
        draw(0);
    }
    function draw(delta) {
        ctx.fillStyle = '#07111d'; ctx.fillRect(0,0,width,height);
        const focal = Math.min(width,height) * .75;
        for (const star of stars) {
            const oldZ = star.z;
            star.z -= delta * .00011;
            if (star.z <= .06) { reset(star); continue; }
            const x = width/2 + star.x*focal/star.z, y = height/2 + star.y*focal/star.z;
            if (x < 0 || x > width || y < 0 || y > height) { reset(star); continue; }
            const radius = Math.min(2.1, .35 + (1-star.z)*1.4);
            ctx.strokeStyle = ctx.fillStyle = 'rgba(220,239,246,' + (.3 + .65*(1-star.z)) + ')';
            if (delta && star.z < .55) {
                const px = width/2 + star.x*focal/oldZ, py = height/2 + star.y*focal/oldZ;
                ctx.lineWidth = radius*.75; ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(x,y); ctx.stroke();
            }
            ctx.beginPath(); ctx.arc(x,y,radius,0,Math.PI*2); ctx.fill();
        }
    }
    function tick(time) {
        frame = 0;
        if (paused || document.hidden) return;
        if (!last || time-last >= 33) { draw(last ? Math.min(60,time-last) : 0); last=time; }
        frame = requestAnimationFrame(tick);
    }
    function sync() {
        cancelAnimationFrame(frame); frame=0; last=0;
        toggle.textContent = paused ? '播放星空' : '暫停星空';
        toggle.setAttribute('aria-label', paused ? '播放星空背景動畫' : '暫停星空背景動畫');
        if (!paused && !document.hidden) frame=requestAnimationFrame(tick);
    }
    toggle.addEventListener('click', () => { paused=!paused; sync(); });
    reduced.addEventListener('change', () => { paused=reduced.matches; sync(); });
    document.addEventListener('visibilitychange', sync);
    addEventListener('resize', () => { resize(); sync(); });
    resize(); sync();
});
