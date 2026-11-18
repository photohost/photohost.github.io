import { ticketElement } from './ticket.js';

const wall = document.getElementById('wall');
const count = document.getElementById('count');
const error = document.getElementById('error');
const end = document.getElementById('wall-end');
const loading = document.getElementById('wall-loading');
const more = document.getElementById('wall-more');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const grids = new Map();
const rendered = new Set();
let next;
let pending = false;
let animation;

const observer = 'IntersectionObserver' in window
  ? new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadPage();
    })
  : null;

function appendTickets(tickets) {
  const cards = [];
  for (const ticket of tickets) {
    if (rendered.has(ticket.id)) continue;
    const year = ticket.watched_on.slice(0, 4);
    if (!grids.has(year)) {
      const section = document.createElement('section');
      section.className = 'year-group';
      const heading = document.createElement('h2');
      heading.textContent = year;
      const grid = document.createElement('div');
      grid.className = 'ticket-grid';
      section.append(heading, grid);
      wall.append(section);
      grids.set(year, grid);
    }
    const card = ticketElement(ticket);
    grids.get(year).append(card);
    rendered.add(ticket.id);
    cards.push(card);
  }
  return cards;
}

function loadAnimation() {
  animation ??= new Promise(resolve => {
    const script = document.createElement('script');
    script.src = '/vendor/gsap.min.js';
    script.onload = () => resolve(window.gsap);
    script.onerror = () => resolve(null);
    document.head.append(script);
  });
  return animation;
}

async function requestPage(cursor) {
  const query = new URLSearchParams({ view: 'wall' });
  if (cursor) query.set('before', cursor);
  const response = await fetch(`/api/tickets?${query}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('無法讀取票根');
  return response.json();
}

async function loadPage() {
  if (pending || next === null) return;
  pending = true;
  observer?.unobserve(end);
  error.hidden = true;
  more.hidden = true;
  const initial = next === undefined;
  loading.hidden = initial;
  let failed = false;
  try {
    const [page, gsap] = await Promise.all([
      requestPage(next),
      initial || motion.matches ? null : loadAnimation(),
      initial ? null : new Promise(resolve => setTimeout(resolve, 1000))
    ]);
    if (initial) {
      count.textContent = `已收藏 ${page.total} 張票根`;
      if (!page.tickets.length) wall.textContent = '目前還沒有已發布的票根。';
    }
    const cards = appendTickets(page.tickets);
    next = page.next;
    if (gsap && cards.length && !motion.matches) {
      gsap.from(cards, { y: 24, opacity: 0, stagger: 0.12, duration: 0.4, ease: 'power2.out', clearProps: 'transform,opacity' });
    }
  } catch {
    failed = true;
    if (initial) count.textContent = '';
    error.textContent = '無法讀取票根，請重試。';
    error.hidden = false;
    more.textContent = '重試載入';
    more.hidden = false;
  } finally {
    pending = false;
    loading.hidden = true;
    if (!failed && next) {
      if (observer) observer.observe(end);
      else {
        more.textContent = '載入更多票根';
        more.hidden = false;
      }
    }
  }
}

more.addEventListener('click', loadPage);
loadPage();
