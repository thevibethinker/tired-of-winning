import type { Database } from 'bun:sqlite';

const originalWindow = 12 * 60 * 60 * 1000;
export type Release = { guest: string; from: string; to: string };
export type ExtendPlan = { opened: number; oldCloses: number; newCloses: number; releases: Release[]; applied: boolean };
type Options = { now: number; apply: boolean; releaseLegacyHandles?: boolean; note?: string };

/**
 * Plans, and with `apply` performs, a host extension of the persisted party close (read once at server start, so restart afterwards).
 * `releaseLegacyHandles` frees custom handles of guests whose name tags were issued under the original rule (cookie expires at the
 * original 12-hour close). It is allowed only while the room still has its original close and that close has passed, which proves
 * every such name tag has expired. Released guests keep their rows, comments keep the handle they were posted with, and every change
 * is logged in room_log.
 */
export function extendRoom(db: Database, newCloses: number, options: Options): ExtendPlan {
  const room = db.query('SELECT opened, closes FROM room WHERE id=1').get() as { opened: number; closes: number } | null;
  if (!room) throw new Error('This database has no party room.');
  if (!Number.isSafeInteger(newCloses) || newCloses <= options.now) throw new Error('The new close must be in the future.');
  if (newCloses <= room.closes) throw new Error('The new close must be later than the current close.');
  let releases: Release[] = [];
  if (options.releaseLegacyHandles) {
    if (room.closes !== room.opened + originalWindow) throw new Error('Handles can only be released for the original 12-hour room; later name tags outlive extensions.');
    if (options.now < room.closes + 2000) throw new Error('Legacy name tags expire at the original close; release handles after it has passed.');
    const named = db.query("SELECT id, handle FROM guests WHERE handle NOT LIKE 'guest\\_%' ESCAPE '\\'").all() as { id: string; handle: string }[];
    releases = named.map(row => ({ guest: row.id, from: row.handle, to: `${row.handle}~expired_${row.id.slice(0, 6)}` }));
  }
  const plan = { opened: room.opened, oldCloses: room.closes, newCloses, releases, applied: false };
  if (!options.apply) return plan;
  db.transaction(() => {
    db.exec('CREATE TABLE IF NOT EXISTS room_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL)');
    const log = db.query('INSERT INTO room_log(at, action, detail) VALUES(?,?,?)');
    for (const release of releases) {
      db.query('UPDATE guests SET handle=? WHERE id=? AND handle=?').run(release.to, release.guest, release.from);
      log.run(options.now, 'release-handle', JSON.stringify(release));
    }
    db.query('UPDATE room SET closes=? WHERE id=1 AND closes=?').run(newCloses, room.closes);
    log.run(options.now, 'extend-close', JSON.stringify({ from: room.closes, to: newCloses, note: options.note ?? '' }));
  })();
  const after = (db.query('SELECT closes FROM room WHERE id=1').get() as { closes: number }).closes;
  if (after !== newCloses) throw new Error(`Close did not update (found ${after}).`);
  return { ...plan, applied: true };
}
