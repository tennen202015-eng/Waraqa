// Waraqa API — Cloudflare Worker
// Serves the static app (ASSETS) and a small JSON API under /api/:
// accounts (email + password), per-user items (templates, letters, signatures) in D1,
// and per-user image files in R2 (binding FILES) or, when R2 is not bound, in D1.

const enc = new TextEncoder();
const DAY = 86400;
const SESSION_DAYS = 30;
const COOKIE = 'wq_s';
const KINDS = new Set(['template', 'letter', 'sig']);
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const MAX_ITEMS_PER_KIND = 500;
const MAX_FILE_BYTES = 2_000_000;
const MAX_FILES_PER_USER = 300;

class HttpErr extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

const now = () => Math.floor(Date.now() / 1000);
const b64u = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const randomId = (n = 16) => b64u(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async (s) => b64u(await crypto.subtle.digest('SHA-256', enc.encode(s)));

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return b64u(bits);
}

function safeEqual(a, b) {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(x, y);
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i];
  return r === 0;
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const sessionCookie = (token, maxAge) =>
  `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function readCookie(req) {
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)wq_s=([^;]+)/);
  return m ? m[1] : null;
}

async function readJson(req, max = 200_000) {
  const text = await req.text();
  if (text.length > max) throw new HttpErr(413, 'too_large');
  try { return JSON.parse(text || '{}'); } catch { throw new HttpErr(400, 'bad_json'); }
}

async function createSession(env, userId) {
  const token = randomId(32);
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, now() + SESSION_DAYS * DAY).run();
  return token;
}

async function currentUser(req, env) {
  const token = readCookie(req);
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT u.id, u.email, u.name, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'
  ).bind(await sha256(token)).first();
  if (!row || row.expires_at < now()) return null;
  return { id: row.id, email: row.email, name: row.name || '' };
}

function toBytes(data) {
  if (data == null) return null;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) return new Uint8Array(data);
  return null;
}

async function tooManyAttempts(env, email) {
  const row = await env.DB.prepare('SELECT count, first_at FROM login_attempts WHERE email = ?').bind(email).first();
  return !!(row && row.count >= 10 && now() - row.first_at < 900);
}

async function recordFailure(env, email) {
  const row = await env.DB.prepare('SELECT count, first_at FROM login_attempts WHERE email = ?').bind(email).first();
  if (!row || now() - row.first_at >= 900) {
    await env.DB.prepare('INSERT INTO login_attempts (email, count, first_at) VALUES (?, 1, ?) ON CONFLICT(email) DO UPDATE SET count = 1, first_at = excluded.first_at')
      .bind(email, now()).run();
  } else {
    await env.DB.prepare('UPDATE login_attempts SET count = count + 1 WHERE email = ?').bind(email).run();
  }
}

async function handleApi(req, env, url) {
  const path = url.pathname;
  const method = req.method;

  // Every state-changing request must carry this header. Browsers will not send a custom
  // header cross-site without a CORS preflight, which this API never approves.
  if (method !== 'GET' && method !== 'HEAD' && req.headers.get('x-waraqa') !== '1') throw new HttpErr(403, 'csrf');

  if (path === '/api/health') return json({ ok: true, files: env.FILES ? 'r2' : 'd1' });

  if (path === '/api/signup' && method === 'POST') {
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const name = String(b.name || '').trim().slice(0, 80);
    if (!EMAIL_RE.test(email)) throw new HttpErr(400, 'bad_email');
    if (password.length < 8 || password.length > 200) throw new HttpErr(400, 'weak_password');
    const exists = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (exists) throw new HttpErr(409, 'email_taken');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const id = randomId(12);
    await env.DB.prepare('INSERT INTO users (id, email, name, pass_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, email, name, await hashPassword(password, salt), b64u(salt), now()).run();
    const token = await createSession(env, id);
    return json({ user: { id, email, name } }, 200, { 'set-cookie': sessionCookie(token, SESSION_DAYS * DAY) });
  }

  if (path === '/api/login' && method === 'POST') {
    const b = await readJson(req);
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    if (!email || !password) throw new HttpErr(400, 'bad_credentials');
    if (await tooManyAttempts(env, email)) throw new HttpErr(429, 'locked');
    const user = await env.DB.prepare('SELECT id, email, name, pass_hash, salt FROM users WHERE email = ?').bind(email).first();
    const ok = user && safeEqual(await hashPassword(password, fromB64u(user.salt)), user.pass_hash);
    if (!ok) { await recordFailure(env, email); throw new HttpErr(401, 'bad_credentials'); }
    await env.DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email).run();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(user.id, now()).run();
    const token = await createSession(env, user.id);
    return json({ user: { id: user.id, email: user.email, name: user.name || '' } }, 200, { 'set-cookie': sessionCookie(token, SESSION_DAYS * DAY) });
  }

  if (path === '/api/logout' && method === 'POST') {
    const token = readCookie(req);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
  }

  const user = await currentUser(req, env);
  if (path === '/api/me') return user ? json({ user }) : json({ error: 'unauthorized' }, 401);
  if (!user) throw new HttpErr(401, 'unauthorized');

  if (path === '/api/password' && method === 'POST') {
    const b = await readJson(req);
    const row = await env.DB.prepare('SELECT pass_hash, salt FROM users WHERE id = ?').bind(user.id).first();
    if (!safeEqual(await hashPassword(String(b.old || ''), fromB64u(row.salt)), row.pass_hash)) throw new HttpErr(401, 'bad_credentials');
    const next = String(b.new || '');
    if (next.length < 8 || next.length > 200) throw new HttpErr(400, 'weak_password');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await env.DB.prepare('UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?').bind(await hashPassword(next, salt), b64u(salt), user.id).run();
    return json({ ok: true });
  }

  if (path === '/api/items' && method === 'GET') {
    const kind = url.searchParams.get('kind');
    if (!KINDS.has(kind)) throw new HttpErr(400, 'bad_kind');
    const { results } = await env.DB.prepare(
      'SELECT id, name, data, updated_at FROM items WHERE user_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT ?'
    ).bind(user.id, kind, MAX_ITEMS_PER_KIND).all();
    return json({ items: results.map((r) => ({ id: r.id, name: r.name, data: JSON.parse(r.data), updated_at: r.updated_at })) });
  }

  let m = path.match(/^\/api\/items\/([^/]+)$/);
  if (m) {
    const id = m[1];
    if (!ID_RE.test(id)) throw new HttpErr(400, 'bad_id');
    if (method === 'PUT') {
      const b = await readJson(req, 400_000);
      const kind = String(b.kind || '');
      if (!KINDS.has(kind)) throw new HttpErr(400, 'bad_kind');
      const name = String(b.name || '').slice(0, 120);
      const data = JSON.stringify(b.data ?? {});
      if (data.length > 300_000) throw new HttpErr(413, 'too_large');
      const existing = await env.DB.prepare('SELECT user_id FROM items WHERE id = ?').bind(id).first();
      if (existing && existing.user_id !== user.id) throw new HttpErr(404, 'not_found');
      if (!existing) {
        const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM items WHERE user_id = ? AND kind = ?').bind(user.id, kind).first();
        if (c.n >= MAX_ITEMS_PER_KIND) throw new HttpErr(409, 'limit');
      }
      const ts = Date.now();
      await env.DB.prepare(
        'INSERT INTO items (id, user_id, kind, name, data, updated_at) VALUES (?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name, data = excluded.data, updated_at = excluded.updated_at'
      ).bind(id, user.id, kind, name, data, ts).run();
      return json({ ok: true, updated_at: ts });
    }
    if (method === 'DELETE') {
      await env.DB.prepare('DELETE FROM items WHERE id = ? AND user_id = ?').bind(id, user.id).run();
      return json({ ok: true });
    }
  }

  if (path === '/api/files' && method === 'POST') {
    const type = (req.headers.get('content-type') || '').split(';')[0].trim();
    if (!/^image\/(png|jpeg|webp)$/.test(type)) throw new HttpErr(415, 'bad_type');
    const buf = await req.arrayBuffer();
    if (!buf.byteLength) throw new HttpErr(400, 'empty');
    if (buf.byteLength > MAX_FILE_BYTES) throw new HttpErr(413, 'too_large');
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM files WHERE user_id = ?').bind(user.id).first();
    if (c.n >= MAX_FILES_PER_USER) throw new HttpErr(409, 'limit');
    const id = randomId(12);
    if (env.FILES) {
      await env.FILES.put(`u/${user.id}/${id}`, buf, { httpMetadata: { contentType: type } });
      await env.DB.prepare('INSERT INTO files (id, user_id, type, size, data, created_at) VALUES (?, ?, ?, ?, NULL, ?)')
        .bind(id, user.id, type, buf.byteLength, now()).run();
    } else {
      await env.DB.prepare('INSERT INTO files (id, user_id, type, size, data, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, user.id, type, buf.byteLength, buf, now()).run();
    }
    return json({ id });
  }

  m = path.match(/^\/api\/files\/([^/]+)$/);
  if (m) {
    const id = m[1];
    if (!ID_RE.test(id)) throw new HttpErr(400, 'bad_id');
    const f = await env.DB.prepare('SELECT id, type, data FROM files WHERE id = ? AND user_id = ?').bind(id, user.id).first();
    if (!f) throw new HttpErr(404, 'not_found');
    if (method === 'GET') {
      let body = toBytes(f.data);
      if (!body && env.FILES) {
        const obj = await env.FILES.get(`u/${user.id}/${id}`);
        if (!obj) throw new HttpErr(404, 'not_found');
        body = obj.body;
      }
      if (!body) throw new HttpErr(404, 'not_found');
      return new Response(body, {
        headers: { 'content-type': f.type, 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' },
      });
    }
    if (method === 'DELETE') {
      if (env.FILES) await env.FILES.delete(`u/${user.id}/${id}`);
      await env.DB.prepare('DELETE FROM files WHERE id = ? AND user_id = ?').bind(id, user.id).run();
      return json({ ok: true });
    }
  }

  throw new HttpErr(404, 'not_found');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await handleApi(req, env, url);
    } catch (e) {
      if (e instanceof HttpErr) return json({ error: e.code }, e.status);
      console.error(e);
      return json({ error: 'server' }, 500);
    }
  },
};
