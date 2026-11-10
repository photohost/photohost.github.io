document.addEventListener('DOMContentLoaded', () => {
  const word = document.getElementById('watch-typewriter');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (word && !reduced.matches) {
    const letters = Array.from(word.textContent);
    word.textContent = '';
    let index = 0;
    let timer;
    const type = () => {
      if (document.hidden) return;
      word.textContent += letters[index++];
      if (index < letters.length) timer = setTimeout(type, 140);
    };
    timer = setTimeout(type, 140);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && index < letters.length && !reduced.matches) {
        clearTimeout(timer);
        timer = setTimeout(type, 140);
      }
    });
    reduced.addEventListener('change', () => {
      if (reduced.matches) {
        clearTimeout(timer);
        word.textContent = letters.join('');
      }
    });
  }
  const preview = document.getElementById('watch-preview');
  if (!preview) return;
  const image = preview.querySelector('.watch-lightbox-image');
  const backdrop = preview.querySelector('.watch-lightbox-backdrop');
  const title = preview.querySelector('strong');
  const rating = preview.querySelector('.watch-lightbox-info span');
  const closeButton = preview.querySelector('.watch-close');
  let activeCard = null;
  let animation = null;
  let closing = false;

  // The frame may letterbox a poster. Animate the visible image, not its frame.
  const visibleRect = element => {
    const box = element.getBoundingClientRect();
    const width = element.naturalWidth || Number(element.getAttribute('width'));
    const height = element.naturalHeight || Number(element.getAttribute('height'));
    if (!box.width || !box.height || !width || !height) return box;
    const scale = Math.min(box.width / width, box.height / height);
    const fittedWidth = width * scale;
    const fittedHeight = height * scale;
    return {left: box.left + (box.width - fittedWidth) / 2,
      top: box.top + (box.height - fittedHeight) / 2,
      width: fittedWidth, height: fittedHeight};
  };
  const transformFrom = (rect, base) =>
    `translate(${rect.left - base.left}px, ${rect.top - base.top}px) scale(${rect.width / base.width}, ${rect.height / base.height})`;

  const moveImage = (from, to, duration = 550) => {
    if (animation) animation.cancel();
    const base = visibleRect(image);
    if (reduced.matches || !base.width || !base.height || !from.width || !to.width) {
      return Promise.resolve();
    }
    animation = image.animate([
      {transform: transformFrom(from, base)},
      {transform: transformFrom(to, base)}
    ], {duration, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'both'});
    return animation.finished.catch(() => {});
  };

  const finishClose = card => {
    preview.hidden = true;
    preview.classList.remove('is-open');
    image.removeAttribute('src');
    image.style.visibility = '';
    activeCard = null;
    closing = false;
    if (animation) animation.cancel();
    animation = null;
    card.focus({preventScroll: true});
  };

  const closePreview = async () => {
    if (!activeCard || closing) return;
    closing = true;
    const card = activeCard;
    const current = visibleRect(image);
    const origin = visibleRect(card.querySelector('.watch-poster img'));
    preview.classList.remove('is-open');
    if (image.style.visibility !== 'hidden') await moveImage(current, origin, 320);
    finishClose(card);
  };

  const openPreview = async card => {
    if (activeCard) return;
    activeCard = card;
    image.style.visibility = 'hidden';
    image.src = card.dataset.image;
    image.alt = `${card.dataset.title} 海報`;
    title.textContent = card.dataset.title;
    rating.textContent = card.dataset.rating;
    preview.hidden = false;
    try { await image.decode(); } catch (_) { /* The browser can still show the alt text. */ }
    if (activeCard !== card || closing) return;
    const origin = visibleRect(card.querySelector('.watch-poster img'));
    const destination = visibleRect(image);
    image.style.visibility = '';
    preview.offsetWidth;
    preview.classList.add('is-open');
    closeButton.focus({preventScroll: true});
    await moveImage(origin, destination);
  };

  document.querySelectorAll('.watch-card').forEach(card =>
    card.addEventListener('click', () => openPreview(card)));
  closeButton.addEventListener('click', closePreview);
  preview.addEventListener('click', event => {
    if (event.target === backdrop || event.target === image || event.target === preview) closePreview();
  });
  document.addEventListener('keydown', event => {
    if (!activeCard) return;
    if (event.key === 'Escape') { event.preventDefault(); closePreview(); }
    if (event.key === 'Tab') { event.preventDefault(); closeButton.focus(); }
  });
});
