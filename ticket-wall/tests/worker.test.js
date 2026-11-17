import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import worker, { validateTicket } from '../src/worker.js';

const ready = {
  title_zh: '墜惡真相', title_original: 'Anatomie d’une chute',
  rating: 8.5, watched_on: '2026-11-18',
  poster_key: 'a6a6a6a6-a6a6-4a6a-8a6a-a6a6a6a6a6a6', status: 'published'
};

test('published ticket requires its visible details', () => {
  assert.deepEqual(validateTicket(ready), ready);
  assert.throws(() => validateTicket({ ...ready, poster_key: null }), /圖片/);
  assert.throws(() => validateTicket({ ...ready, rating: 11 }), /評分/);
  assert.throws(() => validateTicket({ ...ready, watched_on: '2026-02-30' }), /日期/);
});

test('unfinished ticket can be saved as a draft', () => {
  assert.deepEqual(validateTicket({ status: 'draft' }), {
    title_zh: '', title_original: '', rating: null,
    watched_on: null, poster_key: null, status: 'draft'
  });
});

test('public wall returns only published rows from the query', async () => {
  const rows = [{ ...ready, id: '1' }];
  let sql = '';
  const env = { DB: { prepare(query) { sql = query; return { all: async () => ({ results: rows }) }; } } };
  const response = await worker.fetch(new Request('https://watch.example/api/tickets'), env);
  assert.equal(response.status, 200);
  assert.match(sql, /WHERE status = 'published'/);
  const { tickets } = await response.json();
  assert.equal(tickets[0].poster_url, `/media/${ready.poster_key}`);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('editor and write API fail closed without Cloudflare Access', async () => {
  const env = { ASSETS: { fetch: () => { throw new Error('must not serve admin'); } } };
  for (const path of ['/admin', '/admin.html', '/api/admin/tickets', '/api/admin/posters']) {
    const response = await worker.fetch(new Request(`https://watch.example${path}`), env);
    assert.equal(response.status, 401, path);
  }
});

test('media rejects unknown identifiers', async () => {
  const response = await worker.fetch(new Request('https://watch.example/media/not-an-image-id'), {});
  assert.equal(response.status, 404);
});

test('authenticated editor can create, publish and revise a ticket', async t => {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const publicJwk = { ...await exportJWK(publicKey), kid: 'local-key', alg: 'RS256', use: 'sig' };
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ keys: [publicJwk] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const issuer = `http://127.0.0.1:${server.address().port}`;
  const token = await new SignJWT({ email: 'owner@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'local-key' })
    .setIssuer(issuer).setAudience('ticket-wall').setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const rows = new Map();
  const env = {
    TEAM_DOMAIN: issuer, POLICY_AUD: 'ticket-wall', ADMIN_EMAIL: 'owner@example.com',
    POSTERS: {
      head: async () => ({}),
      get: async () => ({ body: new Uint8Array([1, 2, 3]), httpMetadata: { contentType: 'image/webp' } })
    },
    DB: { prepare(sql) {
      return {
        bind(...values) {
          return {
            first: async () => sql.startsWith('SELECT 1')
              ? [...rows.values()].find(row => row.poster_key === values[0] && row.status === 'published') || null
              : rows.get(values[0]) || null,
            run: async () => {
              if (sql.startsWith('INSERT')) {
                rows.set(values[0], Object.fromEntries(
                  ['id', 'title_zh', 'title_original', 'rating', 'watched_on', 'poster_key',
                    'status', 'created_at', 'updated_at', 'published_at'].map((key, i) => [key, values[i]])
                ));
              } else {
                const old = rows.get(values[8]);
                Object.assign(old, Object.fromEntries(
                  ['title_zh', 'title_original', 'rating', 'watched_on', 'poster_key',
                    'status', 'updated_at', 'published_at'].map((key, i) => [key, values[i]])
                ));
              }
            }
          };
        },
        all: async () => ({ results: [...rows.values()] })
      };
    } }
  };
  const request = (path, method, body, origin = 'https://watch.example') => new Request(`https://watch.example${path}`, {
    method, headers: { Origin: origin, 'Content-Type': 'application/json',
      'Cf-Access-Jwt-Assertion': token }, body: JSON.stringify(body)
  });
  const draft = await worker.fetch(request('/api/admin/tickets', 'POST', { status: 'draft' }), env);
  assert.equal(draft.status, 201);
  const { id } = await draft.json();
  assert.equal(rows.get(id).status, 'draft');
  const draftWithImage = await worker.fetch(request(`/api/admin/tickets/${id}`, 'PUT', {
    ...ready, status: 'draft'
  }), env);
  assert.equal(draftWithImage.status, 200);
  const publicDraftImage = await worker.fetch(new Request(`https://watch.example/media/${ready.poster_key}`), env);
  assert.equal(publicDraftImage.status, 404);
  const adminDraftImage = await worker.fetch(request(`/api/admin/media/${ready.poster_key}`, 'GET'), env);
  assert.equal(adminDraftImage.status, 200);
  assert.equal(adminDraftImage.headers.get('Cache-Control'), 'no-store');
  const published = await worker.fetch(request(`/api/admin/tickets/${id}`, 'PUT', ready), env);
  assert.equal(published.status, 200);
  assert.equal(rows.get(id).status, 'published');
  const publicImage = await worker.fetch(new Request(`https://watch.example/media/${ready.poster_key}`), env);
  assert.equal(publicImage.status, 200);
  const revised = await worker.fetch(request(`/api/admin/tickets/${id}`, 'PUT', {
    ...ready, title_zh: '新標題'
  }), env);
  assert.equal(revised.status, 200);
  assert.equal(rows.get(id).title_zh, '新標題');
  const foreignOrigin = await worker.fetch(request(`/api/admin/tickets/${id}`, 'PUT', ready, 'https://bad.example'), env);
  assert.equal(foreignOrigin.status, 403);
});
