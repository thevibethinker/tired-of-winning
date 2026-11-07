import { Database } from 'bun:sqlite';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

/** Anonymous visit counting. Stores a random browser ID chosen by the client, an event kind,
 *  a device class and the referring hostname (or a ?via= tag). Never IPs, user agents, handles or URLs. */
const kinds = new Set(['view', 'ping', 'sound_on', 'sound_off', 'chat_open', 'map_open', 'soundboard_open']);
const devices = new Set(['phone', 'tablet', 'desktop']);
const defaultOrigins = ['https://tired-of-winning-va.zocomputer.io', 'https://zite-51754-va.zo.computer', 'https://zite-51755-va.zo.computer', 'http://localhost:51754', 'http://localhost:51755', 'http://localhost:54365'];
type Options = { now?: () => number; origins?: string[]; maxRows?: number };

export function createTelemetry(db: Database, options: Options = {}) {
  const now = options.now ?? Date.now;
  const origins = new Set(options.origins ?? defaultOrigins);
  const maxRows = options.maxRows ?? 500_000;
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, visitor TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, device TEXT NOT NULL, via TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS events_at ON events(at);
    CREATE INDEX IF NOT EXISTS events_kind ON events(kind, visitor);`);
  let rows = (db.query('SELECT count(*) AS n FROM events').get() as { n: number }).n;
  const windows = new Map<string, { start: number; count: number }>();
  const insert = db.query('INSERT INTO events(visitor,kind,at,device,via) VALUES(?,?,?,?,?)');

  const app = new Hono();
  app.use('*', bodyLimit({ maxSize: 1024, onError: c => c.json({ error: 'Event too large.' }, 413) }));
  app.post('/', async c => {
    c.header('Cache-Control', 'no-store');
    if (!origins.has(c.req.header('Origin') || '')) return c.json({ error: 'Unknown origin.' }, 403);
    let body: Record<string, unknown>;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Unreadable event.' }, 400); }
    if (!body || typeof body !== 'object') return c.json({ error: 'Unreadable event.' }, 400);
    const { visitor, kind, device, via } = body as Record<string, unknown>;
    if (typeof visitor !== 'string' || !/^[a-f0-9]{32}$/.test(visitor) || typeof kind !== 'string' || !kinds.has(kind) || typeof device !== 'string' || !devices.has(device)) return c.json({ error: 'Invalid event.' }, 400);
    const source = typeof via === 'string' && (via === '(direct)' || /^via:[a-z0-9-]{1,16}$/.test(via) || /^[a-z0-9.-]{1,60}$/.test(via)) ? via : '(other)';
    const at = now();
    const slot = windows.get(visitor);
    if (slot && at - slot.start < 60_000) { if (++slot.count > 20) return c.json({ error: 'Slow down.' }, 429); }
    else windows.set(visitor, { start: at, count: 1 });
    if (windows.size > 50_000) for (const [key, value] of windows) if (at - value.start >= 60_000) windows.delete(key);
    if (rows >= maxRows) return c.json({ error: 'Counter is full.' }, 503);
    insert.run(visitor, kind, at, device, source);
    rows++;
    return c.body(null, 204);
  });

  function stats() {
    const at = now();
    const one = <T,>(sql: string, ...params: (string | number)[]) => db.query(sql).get(...params) as T;
    const peak = one<{ n: number | null; bucket: number | null }>('SELECT count(DISTINCT visitor) AS n, at/120000 AS bucket FROM events GROUP BY bucket ORDER BY n DESC, bucket ASC LIMIT 1') ?? { n: 0, bucket: null };
    return {
      visitors: one<{ n: number }>('SELECT count(DISTINCT visitor) AS n FROM events').n,
      views: one<{ n: number }>("SELECT count(*) AS n FROM events WHERE kind='view'").n,
      liveNow: one<{ n: number }>('SELECT count(DISTINCT visitor) AS n FROM events WHERE at > ?', at - 150_000).n,
      peak: { visitors: peak.n ?? 0, at: peak.bucket === null ? null : peak.bucket * 120_000 },
      hours: (db.query('SELECT (at/3600000)*3600000 AS at, count(DISTINCT visitor) AS visitors FROM events GROUP BY at/3600000 ORDER BY at').all() as { at: number; visitors: number }[]),
      devices: Object.fromEntries((db.query('SELECT device, count(DISTINCT visitor) AS n FROM events GROUP BY device ORDER BY n DESC').all() as { device: string; n: number }[]).map(r => [r.device, r.n])),
      sources: db.query("SELECT via, count(DISTINCT visitor) AS visitors FROM events WHERE kind='view' GROUP BY via ORDER BY visitors DESC, via LIMIT 8").all() as { via: string; visitors: number }[],
      soundOn: one<{ n: number }>("SELECT count(DISTINCT visitor) AS n FROM events WHERE kind='sound_on'").n,
      chatOpens: one<{ n: number }>("SELECT count(DISTINCT visitor) AS n FROM events WHERE kind='chat_open'").n,
      since: one<{ at: number | null }>('SELECT min(at) AS at FROM events').at,
    };
  }
  return { app, stats };
}
