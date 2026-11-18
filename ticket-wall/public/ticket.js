export function ticketElement(data, { preview = false } = {}) {
  const card = document.createElement('article');
  card.className = `ticket${preview ? ' ticket--preview' : ''}`;
  const art = document.createElement('div');
  art.className = 'ticket-art';
  if (data.poster_url) {
    const img = document.createElement('img');
    img.src = data.poster_url;
    img.alt = data.title_zh ? `${data.title_zh} 電影圖片` : '電影圖片';
    img.loading = preview ? 'eager' : 'lazy';
    img.decoding = 'async';
    art.append(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'ticket-placeholder';
    placeholder.textContent = '電影圖片';
    art.append(placeholder);
  }
  const details = document.createElement('div');
  details.className = 'ticket-details';
  const names = document.createElement('div');
  names.className = 'ticket-names';
  if (data.kind === 'movie' || data.kind === 'drama') {
    const kind = document.createElement('span');
    kind.className = 'ticket-kind';
    kind.lang = 'en';
    kind.textContent = data.kind === 'movie' ? 'Movie' : 'Drama';
    names.append(kind);
  }
  const title = document.createElement('h3');
  title.textContent = data.title_zh || '中文電影名';
  const original = document.createElement('p');
  original.textContent = data.title_original || (preview ? '原文電影名' : '');
  names.append(title, original);
  const facts = document.createElement('div');
  facts.className = 'ticket-facts';
  for (const [label, value] of [
    ['評分', data.rating === null || data.rating === undefined || data.rating === '' ? '—' : `${data.rating} / 10`],
    ['日期', data.watched_on || '—']
  ]) {
    const group = document.createElement('div');
    const small = document.createElement('span');
    small.textContent = label;
    const strong = document.createElement('strong');
    strong.textContent = value;
    group.append(small, strong);
    facts.append(group);
  }
  details.append(names, facts);
  card.append(art, details);
  return card;
}
