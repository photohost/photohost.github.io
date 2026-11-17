import { ticketElement } from './ticket.js';

const wall = document.getElementById('wall');
const count = document.getElementById('count');
const error = document.getElementById('error');

try {
  const response = await fetch('/api/tickets', { cache: 'no-store' });
  if (!response.ok) throw new Error('無法讀取票根');
  const { tickets } = await response.json();
  count.textContent = `已收藏 ${tickets.length} 張票根`;
  if (!tickets.length) {
    wall.textContent = '目前還沒有已發布的票根。';
  } else {
    const groups = new Map();
    for (const ticket of tickets) {
      const year = ticket.watched_on.slice(0, 4);
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(ticket);
    }
    for (const [year, entries] of groups) {
      const section = document.createElement('section');
      section.className = 'year-group';
      const heading = document.createElement('h2');
      heading.textContent = year;
      const grid = document.createElement('div');
      grid.className = 'ticket-grid';
      entries.forEach(ticket => grid.append(ticketElement(ticket)));
      section.append(heading, grid);
      wall.append(section);
    }
  }
} catch (cause) {
  count.textContent = '';
  error.textContent = `${cause.message}，請稍後重新整理。`;
  error.hidden = false;
}
