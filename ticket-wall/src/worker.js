import { createRemoteJWKSet, jwtVerify } from 'jose';

const fields = 'id, title_zh, title_original, rating, watched_on, poster_key, status, created_at, updated_at, published_at';
const mediaPath = /^\/media\/([a-f0-9-]{36})$/;
const adminMediaPath = /^\/api\/admin\/media\/([a-f0-9-]{36})$/;
const itemPath = /^\/api\/admin\/tickets\/([a-f0-9-]{36})$/;
const allowedMethods = 'GET, POST, PUT';
let keyset;
let keysetUrl;

function json(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function error(message, status) {
  return json({ error: message }, status);
}

function posterUrl(row, admin = false) {
  return { ...row, poster_url: row.poster_key
    ? `${admin ? '/api/admin' : ''}/media/${row.poster_key}` : null };
}

async function servePoster(env, key, admin = false) {
  if (!admin) {
    const published = await env.DB.prepare(
      "SELECT 1 FROM tickets WHERE poster_key = ? AND status = 'published' LIMIT 1"
    ).bind(key).first();
    if (!published) return error('找不到圖片', 404);
  }
  const object = await env.POSTERS.get(`posters/${key}`);
  if (!object) return error('找不到圖片', 404);
  return new Response(object.body, { headers: {
    'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
    'Cache-Control': admin ? 'no-store' : 'public, max-age=300',
    'X-Content-Type-Options': 'nosniff'
  } });
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateTicket(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('資料格式錯誤');
  const title_zh = String(input.title_zh ?? '').trim();
  const title_original = String(input.title_original ?? '').trim();
  if (title_zh.length > 120 || title_original.length > 160) throw new Error('片名過長');
  const rating = input.rating === '' || input.rating === null || input.rating === undefined
    ? null : Number(input.rating);
  if (rating !== null && (!Number.isFinite(rating) || rating < 0 || rating > 10 || Math.round(rating * 10) !== rating * 10)) {
    throw new Error('評分需為 0 至 10，最多一位小數');
  }
  const watched_on = input.watched_on || null;
  if (watched_on !== null && !validDate(watched_on)) throw new Error('日期格式錯誤');
  const poster_key = input.poster_key || null;
  if (poster_key !== null && (typeof poster_key !== 'string' || !/^[a-f0-9-]{36}$/.test(poster_key))) {
    throw new Error('圖片格式錯誤');
  }
  const status = input.status || 'draft';
  if (!['draft', 'published'].includes(status)) throw new Error('狀態格式錯誤');
  if (status === 'published' && (!title_zh || rating === null || !watched_on || !poster_key)) {
    throw new Error('發布前請填入中文片名、評分、日期與圖片');
  }
  return { title_zh, title_original, rating, watched_on, poster_key, status };
}

function imageType(bytes) {
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && String.fromCharCode(...bytes.slice(1, 4)) === 'PNG') return 'image/png';
  return null;
}

async function isAdmin(request, env) {
  const issuer = env.TEAM_DOMAIN?.replace(/\/$/, '');
  if (!issuer || !env.POLICY_AUD || !env.ADMIN_EMAIL) return false;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return false;
  try {
    const url = `${issuer}/cdn-cgi/access/certs`;
    if (!keyset || keysetUrl !== url) {
      keyset = createRemoteJWKSet(new URL(url));
      keysetUrl = url;
    }
    const { payload } = await jwtVerify(token, keyset, {
      issuer, audience: env.POLICY_AUD, algorithms: ['RS256']
    });
    return String(payload.email || '').toLowerCase() === env.ADMIN_EMAIL.toLowerCase();
  } catch {
    return false;
  }
}

async function limitedBody(request, limit) {
  if (Number(request.headers.get('Content-Length') || 0) > limit) throw new Error('資料過大');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error('資料過大');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readBody(request) {
  const body = new TextDecoder().decode(await limitedBody(request, 8_192));
  try { return JSON.parse(body); } catch { throw new Error('JSON 格式錯誤'); }
}

function safeOrigin(request) {
  return request.headers.get('Origin') === new URL(request.url).origin;
}

async function handleApi(request, env, path) {
  if (path === '/api/tickets' && request.method === 'GET') {
    const result = await env.DB.prepare(
      `SELECT ${fields} FROM tickets WHERE status = 'published' ORDER BY watched_on DESC, published_at DESC, id DESC`
    ).all();
    return json({ tickets: result.results.map(posterUrl) });
  }
  if (!path.startsWith('/api/admin/')) return error('找不到頁面', 404);
  if (!await isAdmin(request, env)) return error('請先登入管理員帳號', 401);
  if (request.method !== 'GET' && !safeOrigin(request)) return error('請從本網站操作', 403);

  const adminMedia = path.match(adminMediaPath);
  if (adminMedia && request.method === 'GET') return servePoster(env, adminMedia[1], true);

  if (path === '/api/admin/tickets' && request.method === 'GET') {
    const result = await env.DB.prepare(`SELECT ${fields} FROM tickets ORDER BY updated_at DESC`).all();
    return json({ tickets: result.results.map(row => posterUrl(row, true)) });
  }
  if (path === '/api/admin/tickets' && request.method === 'POST') {
    let ticket;
    try { ticket = validateTicket(await readBody(request)); }
    catch (cause) { return error(cause.message, 400); }
    if (ticket.poster_key && !await env.POSTERS.head(`posters/${ticket.poster_key}`)) return error('找不到圖片', 400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO tickets (${fields}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, ticket.title_zh, ticket.title_original, ticket.rating, ticket.watched_on,
        ticket.poster_key, ticket.status, now, now, ticket.status === 'published' ? now : null).run();
    return json({ id }, 201);
  }
  const match = path.match(itemPath);
  if (match && request.method === 'PUT') {
    const old = await env.DB.prepare(`SELECT ${fields} FROM tickets WHERE id = ?`).bind(match[1]).first();
    if (!old) return error('找不到票根', 404);
    let ticket;
    try { ticket = validateTicket(await readBody(request)); }
    catch (cause) { return error(cause.message, 400); }
    if (ticket.poster_key && ticket.poster_key !== old.poster_key &&
        !await env.POSTERS.head(`posters/${ticket.poster_key}`)) return error('找不到圖片', 400);
    const now = new Date().toISOString();
    const published_at = ticket.status === 'published' ? old.published_at || now : old.published_at;
    await env.DB.prepare(`UPDATE tickets SET title_zh=?, title_original=?, rating=?, watched_on=?, poster_key=?,
      status=?, updated_at=?, published_at=? WHERE id=?`)
      .bind(ticket.title_zh, ticket.title_original, ticket.rating, ticket.watched_on,
        ticket.poster_key, ticket.status, now, published_at, match[1]).run();
    return json({ id: match[1] });
  }
  if (path === '/api/admin/posters' && request.method === 'POST') {
    let body;
    try { body = await limitedBody(request, 3_000_000); }
    catch { return error('圖片超過 3 MB', 413); }
    const type = imageType(body);
    if (!type) return error('請上傳 JPEG、PNG 或 WebP 圖片', 400);
    const id = crypto.randomUUID();
    await env.POSTERS.put(`posters/${id}`, body, { httpMetadata: { contentType: type } });
    return json({ poster_key: id, poster_url: `/api/admin/media/${id}` }, 201);
  }
  return error('找不到頁面或不支援的方法', 404);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/admin' || path === '/admin.html') {
        if (!await isAdmin(request, env)) return error('請先登入管理員帳號', 401);
        return env.ASSETS.fetch(new Request(new URL('/admin.html', request.url), request));
      }
      if (path.startsWith('/api/')) return await handleApi(request, env, path);
      const media = path.match(mediaPath);
      if (media && request.method === 'GET') return servePoster(env, media[1]);
      if (path.startsWith('/media/')) return error('找不到圖片', 404);
      if (request.method !== 'GET' && request.method !== 'HEAD')
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: allowedMethods } });
      return env.ASSETS.fetch(request);
    } catch {
      return error('伺服器暫時無法處理，請稍後重試', 500);
    }
  }
};
