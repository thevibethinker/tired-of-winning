import { Database } from 'bun:sqlite';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import { emptyPartyRace, reactions, type PartyState, type Pick } from '../src/lib/party';

const lifetime = 12 * 60 * 60 * 1000;
/** Name tags outlive the posting window by 3 days so a host extension of the persisted close never orphans existing guests. */
const identityGrace = 3 * 24 * 60 * 60;
const cookieName = 'tow_party';
const hostCookie = 'tow_host';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
type Guest = { id: string; handle: string };
type Options = { now?: () => number; origins?: string[]; hostKey?: string; stats?: () => unknown };

export function createPartyApp(db: Database, raceIds: Set<string>, options: Options = {}) {
  const now = options.now ?? Date.now;
  const origins = new Set(options.origins ?? ['https://tired-of-winning-va.zocomputer.io', 'https://zite-51754-va.zo.computer', 'https://zite-51755-va.zo.computer', 'http://localhost:51754', 'http://localhost:51755', 'http://localhost:54365']);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id=1), opened INTEGER NOT NULL, closes INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS guests (id TEXT PRIMARY KEY, handle TEXT NOT NULL COLLATE NOCASE UNIQUE, seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS comments (id INTEGER PRIMARY KEY AUTOINCREMENT, guest TEXT NOT NULL, request_id TEXT NOT NULL, handle TEXT NOT NULL, body TEXT NOT NULL, at INTEGER NOT NULL, removed INTEGER NOT NULL DEFAULT 0, UNIQUE(guest,request_id));
    CREATE TABLE IF NOT EXISTS reactions (guest TEXT NOT NULL, race TEXT NOT NULL, emoji TEXT NOT NULL, PRIMARY KEY(guest,race));
    CREATE TABLE IF NOT EXISTS picks (guest TEXT NOT NULL, race TEXT NOT NULL, choice TEXT NOT NULL, PRIMARY KEY(guest,race));
    CREATE TABLE IF NOT EXISTS limits (key TEXT PRIMARY KEY, window INTEGER NOT NULL, count INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS host_sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS moderation (id INTEGER PRIMARY KEY AUTOINCREMENT, comment INTEGER NOT NULL, removed INTEGER NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS comments_guest_at ON comments(guest,at);
    CREATE INDEX IF NOT EXISTS guests_seen ON guests(seen);`);
  db.query('INSERT OR IGNORE INTO room VALUES(1,?,?)').run(now(), now() + lifetime);
  const closesAt = (db.query('SELECT closes FROM room WHERE id=1').get() as { closes: number }).closes;
  let swept = 0;
  function limited(key: string, max: number, ms = 60_000) {
    const at = now();
    if (at - swept > 60_000) { db.query('DELETE FROM limits WHERE window < ?').run(at - 120_000); swept = at; }
    return db.transaction(() => {
      const row = db.query('SELECT window,count FROM limits WHERE key=?').get(key) as { window: number; count: number } | null;
      if (!row || at - row.window >= ms) { db.query('INSERT OR REPLACE INTO limits VALUES(?,?,1)').run(key, at); return false; }
      if (row.count >= max) return true;
      db.query('UPDATE limits SET count=count+1 WHERE key=?').run(key); return false;
    })();
  }
  const app = new Hono<{ Variables: { guest: Guest | null; host: boolean } }>();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store'); c.header('Vary', 'Cookie');
    c.header('X-Content-Type-Options', 'nosniff');
    const token = getCookie(c, cookieName);
    const guest = token && /^[a-f0-9]{64}$/.test(token) ? db.query('SELECT id,handle FROM guests WHERE id=?').get(digest(token)) as Guest | null : null;
    c.set('guest', guest || null);
    const hostToken = getCookie(c, hostCookie);
    const host = Boolean(options.hostKey && hostToken && /^[a-f0-9]{64}$/.test(hostToken) && db.query('SELECT id FROM host_sessions WHERE id=? AND expires>?').get(digest(hostToken), now()));
    c.set('host', host);
    if (c.req.method !== 'GET') {
      if (!origins.has(c.req.header('Origin') || '') || c.req.header('X-Party-Request') !== '1') return c.json({ error: 'Open the party on this site to participate.' }, 403);
      if (!c.req.header('Content-Type')?.startsWith('application/json')) return c.json({ error: 'Send a JSON request.' }, 415);
      const moderationAction = ['host-login', 'host-logout', 'moderate-comment', 'remove-comment'].includes(c.req.path.split('/').at(-1) || '');
      if (now() >= closesAt && !moderationAction) return c.json({ error: 'Posting has closed. You can still read the room.' }, 410);
    }
    await next();
  });
  app.use('*', bodyLimit({ maxSize: 4096, onError: c => c.json({ error: 'That message is too large.' }, 413) }));
  function snapshot(guest: Guest | null, isHost = false): PartyState {
    const at = now();
    if (guest && at < closesAt) db.query('UPDATE guests SET seen=? WHERE id=?').run(at, guest.id);
    const rows = db.query('SELECT id,guest,handle,body,at FROM comments WHERE removed=0 ORDER BY id DESC LIMIT 201').all() as { id: number; guest: string; handle: string; body: string; at: number }[];
    const races: PartyState['races'] = {};
    const race = (id: string) => races[id] ??= emptyPartyRace();
    for (const row of db.query('SELECT race,emoji,count(*) AS n FROM reactions GROUP BY race,emoji').all() as { race: string; emoji: string; n: number }[]) race(row.race).reactions[row.emoji] = row.n;
    for (const row of db.query('SELECT race,choice,count(*) AS n FROM picks GROUP BY race,choice').all() as { race: string; choice: Pick; n: number }[]) { race(row.race).picks[row.choice] = row.n; race(row.race).totalPicks += row.n; }
    if (guest) {
      for (const row of db.query('SELECT race,emoji FROM reactions WHERE guest=?').all(guest.id) as { race: string; emoji: string }[]) race(row.race).myReaction = row.emoji;
      for (const row of db.query('SELECT race,choice FROM picks WHERE guest=?').all(guest.id) as { race: string; choice: Pick }[]) race(row.race).myPick = row.choice;
    }
    return { serverTime: at, closesAt, closed: at >= closesAt, me: guest ? { handle: guest.handle } : null, isHost,
      online: at >= closesAt ? 0 : (db.query('SELECT count(*) AS n FROM guests WHERE seen>?').get(at - 90_000) as { n: number }).n,
      comments: rows.slice(0, 200).map(row => ({ id: row.id, handle: row.handle, body: row.body, at: row.at, mine: row.guest === guest?.id })), hasOlder: rows.length > 200, races };
  }
  app.get('/', c => c.json(snapshot(c.get('guest'), c.get('host'))));
  app.get('/host-comments', c => {
    if (!c.get('host')) return c.json({ error: 'Unlock host controls first.' }, 403);
    const query = (c.req.query('q') || '').trim().slice(0, 500).toLowerCase();
    const before = Number(c.req.query('before') || Number.MAX_SAFE_INTEGER);
    if (!Number.isSafeInteger(before) || before < 1) return c.json({ error: 'Invalid message page.' }, 400);
    const rows = db.query('SELECT id,guest,handle,body,at FROM comments WHERE removed=0 AND id<? AND (instr(lower(handle),?)>0 OR instr(lower(body),?)>0) ORDER BY id DESC LIMIT 201').all(before, query, query) as { id: number; guest: string; handle: string; body: string; at: number }[];
    return c.json({ comments: rows.slice(0, 200).map(row => ({ id: row.id, handle: row.handle, body: row.body, at: row.at, mine: row.guest === c.get('guest')?.id })), hasOlder: rows.length > 200 });
  });
  app.get('/host-stats', c => {
    if (!c.get('host')) return c.json({ error: 'Unlock host controls first.' }, 403);
    const count = (sql: string) => (db.query(sql).get() as { n: number }).n;
    let traffic: unknown = null;
    try { traffic = options.stats?.() ?? null; } catch { console.error('Visit stats could not be read.'); }
    return c.json({ traffic, room: { guests: count('SELECT count(*) AS n FROM guests'), named: count("SELECT count(*) AS n FROM guests WHERE handle NOT LIKE 'guest\\_%' ESCAPE '\\'"), commenters: count('SELECT count(DISTINCT guest) AS n FROM comments'), comments: count('SELECT count(*) AS n FROM comments'), removed: count('SELECT count(*) AS n FROM comments WHERE removed=1'), reactions: count('SELECT count(*) AS n FROM reactions'), picks: count('SELECT count(*) AS n FROM picks') } });
  });
  app.post('/host-login', async c => {
    const network = digest(c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'local');
    if (limited('host:' + network, 5)) return c.json({ error: 'Too many attempts. Try again in a minute.' }, 429);
    let body: { key?: unknown };
    try { body = await c.req.json(); } catch { return c.json({ error: 'Enter your host key.' }, 400); }
    if (!options.hostKey || typeof body?.key !== 'string' || !timingSafeEqual(Buffer.from(digest(body.key.trim())), Buffer.from(digest(options.hostKey)))) return c.json({ error: 'That host key didn’t match.' }, 403);
    const token = randomBytes(32).toString('hex');
    const previous = getCookie(c, hostCookie);
    if (previous) db.query('DELETE FROM host_sessions WHERE id=?').run(digest(previous));
    db.query('DELETE FROM host_sessions WHERE expires<=?').run(now());
    db.query('INSERT INTO host_sessions VALUES(?,?)').run(digest(token), now() + 24 * 60 * 60 * 1000);
    setCookie(c, hostCookie, token, { httpOnly: true, sameSite: 'Strict', secure: (c.req.header('Origin') || '').startsWith('https:'), path: '/api/party', maxAge: 24 * 60 * 60 });
    return c.json(snapshot(c.get('guest'), true));
  });
  app.post('/host-logout', c => {
    const token = getCookie(c, hostCookie);
    if (token) db.query('DELETE FROM host_sessions WHERE id=?').run(digest(token));
    deleteCookie(c, hostCookie, { path: '/api/party' });
    return c.json(snapshot(c.get('guest')));
  });
  app.post('/moderate-comment', async c => {
    if (!c.get('host')) return c.json({ error: 'Unlock host controls first.' }, 403);
    let body: { id?: unknown; removed?: unknown };
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid message.' }, 400); }
    if (!body || !Number.isSafeInteger(body.id) || Number(body.id) < 1 || typeof body.removed !== 'boolean') return c.json({ error: 'Invalid message.' }, 400);
    const id = Number(body.id), removed = Number(body.removed);
    const found = db.transaction(() => {
      if (!db.query('SELECT id FROM comments WHERE id=?').get(id)) return false;
      const result = db.query('UPDATE comments SET removed=? WHERE id=? AND removed!=?').run(removed, id, removed);
      if (result.changes) db.query('INSERT INTO moderation(comment,removed,at) VALUES(?,?,?)').run(id, removed, now());
      return true;
    })();
    if (!found) return c.json({ error: 'That comment no longer exists.' }, 404);
    return c.json(snapshot(c.get('guest'), true));
  });
  app.post('/session', c => {
    const existing = c.get('guest');
    if (existing) return c.json(snapshot(existing, c.get('host')));
    const network = digest(c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() || 'local');
    if (limited('join:' + network, 60)) return c.json({ error: 'Too many new guests at once. Try again in a minute.' }, 429);
    const token = randomBytes(32).toString('hex');
    const guest = { id: digest(token), handle: 'guest_' + randomBytes(5).toString('hex') };
    db.query('INSERT INTO guests VALUES(?,?,?)').run(guest.id, guest.handle, now());
    setCookie(c, cookieName, token, { httpOnly: true, sameSite: 'Lax', secure: (c.req.header('Origin') || '').startsWith('https:'), path: '/api/party', maxAge: Math.ceil(Math.max(0, closesAt - now()) / 1000) + identityGrace });
    return c.json(snapshot(guest, c.get('host')));
  });
  app.post('/:action', async c => {
    const guest = c.get('guest');
    if (!guest) return c.json({ error: 'Your party identity is missing. Enable cookies and rejoin the room.' }, 401);
    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: 'That request could not be read.' }, 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return c.json({ error: 'Invalid request.' }, 400);
    if (limited('actions:' + guest.id, 90)) return c.json({ error: 'Give the room a moment. Try again in a minute.' }, 429);
    const action = c.req.param('action');
    if (action === 'handle') {
      const handle = typeof body.handle === 'string' ? body.handle.trim().replace(/^@/, '') : '';
      if (!/^[a-zA-Z0-9_]{2,24}$/.test(handle)) return c.json({ error: 'Use 2–24 letters, numbers, or underscores.' }, 400);
      const owner = db.query('SELECT id FROM guests WHERE handle=? COLLATE NOCASE').get(handle) as { id: string } | null;
      if (owner && owner.id !== guest.id) return c.json({ error: 'That handle is taken. Try another.' }, 409);
      db.query('UPDATE guests SET handle=? WHERE id=?').run(handle, guest.id);
      guest.handle = handle;
    } else if (action === 'comment') {
      const text = typeof body.body === 'string' ? body.body.trim() : '';
      if (!text || Array.from(text).length > 500 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) return c.json({ error: 'Write a message between 1 and 500 characters.' }, 400);
      if (typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId)) return c.json({ error: 'Missing message receipt. Please refresh.' }, 400);
      const previous = db.query('SELECT body FROM comments WHERE guest=? AND request_id=?').get(guest.id, body.requestId) as { body: string } | null;
      if (previous) return previous.body === text ? c.json(snapshot(guest, c.get('host'))) : c.json({ error: 'Message receipt already used.' }, 409);
      const last = db.query('SELECT at FROM comments WHERE guest=? ORDER BY at DESC LIMIT 1').get(guest.id) as { at: number } | null;
      if (last && now() - last.at < 3000 || limited('comment:' + guest.id, 12)) return c.json({ error: 'A little breathing room: wait a few seconds before posting again.' }, 429);
      db.query('INSERT INTO comments(guest,request_id,handle,body,at) VALUES(?,?,?,?,?)').run(guest.id, body.requestId, guest.handle, text, now());
    } else if (action === 'remove-comment') {
      if (!Number.isSafeInteger(body.id) || Number(body.id) < 1) return c.json({ error: 'Invalid message.' }, 400);
      const result = db.query('UPDATE comments SET removed=1 WHERE id=? AND guest=?').run(Number(body.id), guest.id);
      if (!result.changes) return c.json({ error: 'You can only remove your own messages.' }, 403);
    } else if (action === 'reaction' || action === 'pick') {
      if (typeof body.race !== 'string' || !raceIds.has(body.race)) return c.json({ error: 'That race is not on the watchlist.' }, 400);
      if (action === 'reaction') {
        if (body.emoji !== null && !reactions.some(r => r.emoji === body.emoji)) return c.json({ error: 'Choose one of the available reactions.' }, 400);
        if (body.emoji === null) db.query('DELETE FROM reactions WHERE guest=? AND race=?').run(guest.id, body.race);
        else db.query('INSERT INTO reactions VALUES(?,?,?) ON CONFLICT(guest,race) DO UPDATE SET emoji=excluded.emoji').run(guest.id, body.race, body.emoji as string);
      } else {
        if (body.choice !== null && !['candidate', 'opponent', 'other'].includes(body.choice as string)) return c.json({ error: 'Choose one of the available picks.' }, 400);
        if (body.choice === null) db.query('DELETE FROM picks WHERE guest=? AND race=?').run(guest.id, body.race);
        else db.query('INSERT INTO picks VALUES(?,?,?) ON CONFLICT(guest,race) DO UPDATE SET choice=excluded.choice').run(guest.id, body.race, body.choice as string);
      }
    } else return c.json({ error: 'Unknown party action.' }, 404);
    return c.json(snapshot(guest, c.get('host')));
  });
  app.onError((error, c) => { console.error('Party request failed:', error.name); return c.json({ error: 'The party room is temporarily unavailable. Please try again.' }, 503); });
  return app;
}
