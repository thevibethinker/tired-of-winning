/**
 * Exports the party room's final emoji reaction counts per race to data/final/, for the frozen page.
 * Reads data/party.sqlite read-only. Writes counts only: no guest IDs, handles, comments or picks.
 *
 * Usage: bun scripts/export_reactions.ts            (dry run: prints the record)
 *        bun scripts/export_reactions.ts --write    (writes data/final/reactions-<room close date>.json; never overwrites)
 */
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { reactions } from '../src/lib/party';

const log = (message: string) => console.log(`${new Date().toISOString()} ${message}`);
const write = process.argv.includes('--write');
const data = new URL('../data/', import.meta.url).pathname;
if (!existsSync(data + 'party.sqlite')) { console.error('data/party.sqlite not found'); process.exit(2); }

const db = new Database(data + 'party.sqlite', { readonly: true });
const room = db.query('SELECT closes FROM room WHERE id=1').get() as { closes: number } | null;
if (!room || room.closes > Date.now()) { console.error('Refusing to export: the room has not closed, so counts could still change.'); process.exit(3); }
const allowed = new Set<string>(reactions.map(r => r.emoji));
const rows = db.query('SELECT race, emoji, count(*) AS n FROM reactions GROUP BY race, emoji ORDER BY race, emoji').all() as { race: string; emoji: string; n: number }[];
const unknown = rows.filter(r => !allowed.has(r.emoji));
if (unknown.length) { console.error(`Refusing to export: ${unknown.length} rows use emoji outside the allowed set.`); process.exit(4); }
const counts: Record<string, Record<string, number>> = {};
for (const row of rows) (counts[row.race] ??= {})[row.emoji] = row.n;

const closedAt = new Date(room.closes).toISOString();
const record = {
  schema: 'tow-reactions-v1',
  exportedAt: new Date().toISOString(),
  roomClosedAt: closedAt,
  source: 'Party room emoji reactions (one per browser per race), counted after the room closed. Browser identities are not verified people.',
  emojis: reactions,
  total: rows.reduce((s, r) => s + r.n, 0),
  counts,
};
const day = new Date(room.closes - 1).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replaceAll('-', '');
const path = `${data}final/reactions-${day}.json`;
log(`${record.total} reactions across ${Object.keys(counts).length} races; room closed ${closedAt}.`);
if (!write) { console.log(JSON.stringify(record, null, 1)); log(`Dry run. Re-run with --write to create ${path}.`); process.exit(0); }
if (existsSync(path)) { console.error(`Refusing to overwrite ${path}`); process.exit(5); }
mkdirSync(data + 'final', { recursive: true });
writeFileSync(path + '.tmp', JSON.stringify(record, null, 1) + '\n', { flag: 'wx' });
renameSync(path + '.tmp', path);
const check = await Bun.file(path).json();
if (check.total !== record.total) { console.error('Verification failed after write'); process.exit(6); }
log(`Wrote and verified ${path}`);
