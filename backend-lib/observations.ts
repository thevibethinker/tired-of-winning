import type { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';

export function appendObservation(db: Database, chamber: string, sourceUpdatedAt: string, fetchedAt: string, data: unknown) {
  const payload = JSON.stringify(data);
  const hash = createHash('sha256').update(payload).digest('hex');
  const previous = db.query('SELECT hash FROM observations WHERE chamber=? ORDER BY id DESC LIMIT 1').get(chamber) as { hash: string } | null;
  if (previous?.hash === hash) return false;
  db.query('INSERT INTO observations(chamber, observed_at, fetched_at, hash, payload) VALUES(?,?,?,?,?)').run(chamber, sourceUpdatedAt, fetchedAt, hash, payload);
  return true;
}
