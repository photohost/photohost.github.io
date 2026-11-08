document.addEventListener('DOMContentLoaded', () => {
  const dialog = document.getElementById('watch-preview');
  if (!dialog) return;
  const image = dialog.querySelector('img');
  const title = dialog.querySelector('strong');
  const rating = dialog.querySelector('span');
  const close = dialog.querySelector('.watch-close');
  document.querySelectorAll('.watch-card').forEach(card => card.addEventListener('click', () => {
    image.src = card.dataset.image;
    image.alt = `${card.dataset.title} 海報`;
    title.textContent = card.dataset.title;
    rating.textContent = card.dataset.rating;
    dialog.showModal();
  }));
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => { image.removeAttribute('src'); });
});
