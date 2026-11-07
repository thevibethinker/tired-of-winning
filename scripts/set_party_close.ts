#!/usr/bin/env bun
/**
 * Extend the party room's persisted posting close. Dry run by default; pass --apply to write, then republish/restart the site.
 * Usage: bun scripts/set_party_close.ts --db data/party.sqlite --until 2026-11-05T00:00:00-05:00 [--release-legacy-handles] [--note "why"] [--apply]
 * Exit codes: 0 done (or dry run printed), 1 refused or failed, 2 bad arguments.
 */
import { Database } from 'bun:sqlite';
import { extendRoom } from '../backend-lib/party-admin';

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);
const et = (ms: number) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'medium' }) + ' ET';
const args = process.argv.slice(2);
const value = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
const dbPath = value('--db'), until = value('--until');
const known = new Set(['--db', '--until', '--note', '--apply', '--release-legacy-handles', '--help']);
if (args.includes('--help') || !dbPath || !until || args.some((a, i) => a.startsWith('--') && !known.has(a)) || !/[+-]\d\d:\d\d$|Z$/.test(until)) {
  console.error('Usage: bun scripts/set_party_close.ts --db <party.sqlite> --until <ISO time with offset> [--release-legacy-handles] [--note text] [--apply]');
  process.exit(args.includes('--help') ? 0 : 2);
}
const newCloses = Date.parse(until);
if (!Number.isFinite(newCloses)) { console.error(`Unreadable --until time: ${until}`); process.exit(2); }
try {
  const db = new Database(dbPath, { create: false, strict: false });
  db.exec('PRAGMA busy_timeout=3000');
  const apply = args.includes('--apply');
  const plan = extendRoom(db, newCloses, { now: Date.now(), apply, releaseLegacyHandles: args.includes('--release-legacy-handles'), note: value('--note') });
  log(`${apply ? 'APPLIED' : 'DRY RUN'} ${dbPath}`);
  log(`room opened ${et(plan.opened)}; close ${et(plan.oldCloses)} -> ${et(plan.newCloses)}`);
  for (const r of plan.releases) log(`release handle @${r.from} -> ${r.to}`);
  if (!plan.releases.length) log('no handles released');
  log(apply ? 'Restart the site (publish_site) so the server reads the new close.' : 'Nothing written. Re-run with --apply.');
  db.close();
} catch (error) { console.error(`${new Date().toISOString()} REFUSED: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); }
