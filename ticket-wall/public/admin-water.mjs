const canvas = document.querySelector('#admin-water');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const context = canvas?.getContext('2d');

if (context) startWater(canvas, context);

function startWater(surface, ctx) {
  const artwork = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!artwork) return;

  const INTERVAL = 1000 / 40;
  const DECAY = 0.96;
  let width, height, current, previous, base, frame;
  let request = 0;
  let idle = 0;
  let aliveUntil = 0;
  let lastTick = 0;
  let lastPointer = null;
  let active = false;

  function prepare() {
    const scale = Math.min(0.35, 280 / innerWidth, 240 / innerHeight);
    width = Math.max(12, Math.round(innerWidth * scale));
    height = Math.max(12, Math.round(innerHeight * scale));
    surface.width = artwork.canvas.width = width;
    surface.height = artwork.canvas.height = height;
    current = new Float32Array(width * height);
    previous = new Float32Array(width * height);
    frame = ctx.createImageData(width, height);

    const palette = getComputedStyle(document.documentElement);
    const ink = palette.getPropertyValue('--ink').trim();
    const line = palette.getPropertyValue('--line').trim();
    const paper = palette.getPropertyValue('--paper').trim();
    const gradient = artwork.createRadialGradient(width * 0.53, height * 0.45, 0,
      width * 0.53, height * 0.45, Math.max(width, height) * 0.73);
    gradient.addColorStop(0, paper);
    gradient.addColorStop(0.55, line);
    gradient.addColorStop(1, ink);
    artwork.fillStyle = gradient;
    artwork.fillRect(0, 0, width, height);

    // Draw once. Ripples then bend this text and ticket artwork together.
    const unit = Math.max(27, Math.min(width * 0.29, height * 0.4, 65));
    artwork.save();
    artwork.translate(width * 0.5, height * 0.5);
    artwork.rotate(-0.24);
    artwork.lineWidth = Math.max(0.6, unit * 0.022);
    artwork.strokeStyle = ink;
    artwork.fillStyle = ink;
    artwork.font = 'bold ' + (unit * 0.16) + 'px "Noto Serif TC", "PMingLiU", serif';
    const columns = Math.ceil(Math.hypot(width, height) / (unit * 1.9));
    const rows = Math.ceil(Math.hypot(width, height) / (unit * 1.25));
    for (let row = -rows; row <= rows; row++) {
      for (let col = -columns; col <= columns; col++) {
        const x = (col + (row % 2) * 0.5) * unit * 1.9;
        const y = row * unit * 1.25;
        artwork.globalAlpha = 0.28;
        artwork.strokeRect(x, y, unit * 1.38, unit * 0.82);
        artwork.strokeRect(x + unit * 0.09, y + unit * 0.12, unit * 1.2, unit * 0.58);
        artwork.globalAlpha = 0.46;
        artwork.fillText('映畫鑑賞', x + unit * 0.18, y + unit * 0.49);
      }
    }
    artwork.restore();
    base = artwork.getImageData(0, 0, width, height);
    ctx.putImageData(base, 0, 0);
    surface.hidden = false;
    lastPointer = null;
  }

  function step() {
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        previous[i] = ((current[i - 1] + current[i + 1] + current[i - width] + current[i + width]) * 0.5 - previous[i]) * DECAY;
      }
    }
    [current, previous] = [previous, current];
  }

  function refract() {
    const source = base.data;
    const out = frame.data;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const dx = current[i + (x < width - 1 ? 1 : 0)] - current[i - (x > 0 ? 1 : 0)];
        const dy = current[i + (y < height - 1 ? width : 0)] - current[i - (y > 0 ? width : 0)];
        const sx = Math.max(0, Math.min(width - 1, Math.round(x + dx * 2.5)));
        const sy = Math.max(0, Math.min(height - 1, Math.round(y + dy * 2.5)));
        const from = (sy * width + sx) * 4;
        const to = i * 4;
        const light = Math.max(-44, Math.min(44, (dx + dy) * 14));
        out[to] = source[from] + light;
        out[to + 1] = source[from + 1] + light;
        out[to + 2] = source[from + 2] + light;
        out[to + 3] = 255;
      }
    }
    ctx.putImageData(frame, 0, 0);
  }

  function tick(now) {
    request = 0;
    if (!active) return;
    if (now >= aliveUntil) {
      current.fill(0);
      previous.fill(0);
      ctx.putImageData(base, 0, 0);
      return;
    }
    if (now - lastTick >= INTERVAL) {
      lastTick = now - ((now - lastTick) % INTERVAL);
      step();
      refract();
    }
    request = requestAnimationFrame(tick);
  }

  function drop(x, y, radius, strength) {
    if (!active || document.hidden) return;
    x = Math.round(x);
    y = Math.round(y);
    for (let py = Math.max(1, y - radius); py <= Math.min(height - 2, y + radius); py++) {
      for (let px = Math.max(1, x - radius); px <= Math.min(width - 2, x + radius); px++) {
        const distance = Math.hypot(px - x, py - y) / (radius + 1);
        if (distance >= 1) continue;
        const i = py * width + px;
        current[i] -= strength * (1 - distance);
        previous[i] -= strength * (1 - distance);
      }
    }
    aliveUntil = performance.now() + 2400;
    if (!request) {
      lastTick = performance.now();
      request = requestAnimationFrame(tick);
    }
  }

  function place(event) {
    return { x: event.clientX * width / innerWidth, y: event.clientY * height / innerHeight };
  }

  function scheduleIdle() {
    clearTimeout(idle);
    if (!active || document.hidden) return;
    idle = setTimeout(() => {
      drop(width * (0.09 + Math.random() * 0.82), height * (0.10 + Math.random() * 0.80), 3, 6);
      scheduleIdle();
    }, 5500 + Math.random() * 4500);
  }

  window.addEventListener('pointermove', event => {
    if (!active || event.pointerType === 'touch') return;
    const point = place(event);
    const gap = lastPointer ? Math.hypot(point.x - lastPointer.x, point.y - lastPointer.y) : 0;
    if (lastPointer && gap < 3) return;
    const count = Math.max(1, Math.min(8, Math.floor(gap / 4)));
    const from = lastPointer || point;
    for (let i = 1; i <= count; i++) {
      drop(from.x + (point.x - from.x) * i / count,
        from.y + (point.y - from.y) * i / count, 1, 1.45);
    }
    lastPointer = point;
    scheduleIdle();
  }, { passive: true });

  window.addEventListener('pointerdown', event => {
    if (!active || event.button !== 0) return;
    const point = place(event);
    drop(point.x, point.y, 4, 12);
    scheduleIdle();
  }, { passive: true });

  function sync() {
    if (request) cancelAnimationFrame(request);
    request = 0;
    active = !motion.matches && !document.hidden;
    surface.hidden = !active;
    if (active) prepare();
    scheduleIdle();
  }

  window.addEventListener('resize', sync, { passive: true });
  document.addEventListener('visibilitychange', sync);
  motion.addEventListener('change', sync);
  sync();
}
