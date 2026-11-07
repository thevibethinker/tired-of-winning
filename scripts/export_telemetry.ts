/**
 * Exports the site's visit telemetry for the public repo (V, Nov 7: "save the actual telemetry over the night").
 * Reads a telemetry.sqlite read-only. Every event is kept with its time, kind, device class and source.
 * The only change: each random browser ID becomes a visitor number in order of first visit (v01, v02, ...),
 * so the export carries no value that a browser's local storage could be matched against.
 *
 * Usage: bun scripts/export_telemetry.ts <path/to/telemetry.sqlite>           (dry run: prints the summary)
 *        bun scripts/export_telemetry.ts <path/to/telemetry.sqlite> --write   (writes data/telemetry/; never overwrites)
 */
import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';

type Row = { visitor: string; kind: string; at: number; device: string; via: string };
const log = (message: string) => console.error(`${new Date().toISOString()} ${message}`);
const source = process.argv[2];
const write = process.argv.includes('--write');
if (!source || source.startsWith('--') || !existsSync(source)) { console.error('Usage: bun scripts/export_telemetry.ts <telemetry.sqlite> [--write]'); process.exit(2); }

const db = new Database(source, { readonly: true });
const rows = db.query('SELECT visitor, kind, at, device, via FROM events ORDER BY at, id').all() as Row[];
db.close();
if (!rows.length) { console.error('No events to export.'); process.exit(3); }

const numbers = new Map<string, string>();
const width = String(new Set(rows.map(r => r.visitor)).size).length;
for (const row of rows) if (!numbers.has(row.visitor)) numbers.set(row.visitor, 'v' + String(numbers.size + 1).padStart(Math.max(2, width), '0'));

const et = (ms: number, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', hourCycle: 'h23', ...options }).format(ms);
const day = (ms: number) => et(ms, { year: 'numeric', month: '2-digit', day: '2-digit' });
const hour = (ms: number) => `${day(ms)} ${et(ms, { hour: '2-digit' })}:00`;
const distinct = (list: Row[]) => new Set(list.map(r => r.visitor)).size;
const group = (list: Row[], key: (r: Row) => string) => {
  const out = new Map<string, Row[]>();
  for (const row of list) out.set(key(row), [...(out.get(key(row)) ?? []), row]);
  return out;
};
const views = rows.filter(r => r.kind === 'view');
const buckets = [...group(rows, r => String(Math.floor(r.at / 120_000)))].map(([bucket, list]) => ({ at: Number(bucket) * 120_000, visitors: distinct(list) }));
const peak = buckets.sort((a, b) => b.visitors - a.visitors || a.at - b.at)[0];

const summary = {
  schema: 'tow-telemetry-v1',
  exportedAt: new Date().toISOString(),
  first: new Date(rows[0].at).toISOString(),
  last: new Date(rows.at(-1)!.at).toISOString(),
  method: 'Random per-browser IDs chosen by the page, renumbered here as v01, v02, ... in order of first visit. No IPs, user agents, handles, cookies or URLs were ever collected. Browsers with Global Privacy Control sent nothing. One person on two devices counts twice; a cleared browser counts as new.',
  kinds: { view: 'page opened', ping: 'page still open and visible (once a minute)', sound_on: 'sound switched on', sound_off: 'sound switched off', chat_open: 'party room opened', map_open: 'map opened', soundboard_open: 'soundboard opened' },
  totals: { events: rows.length, visitors: numbers.size, views: views.length },
  peak: { visitors: peak.visitors, window: '2 minutes', startsAtEt: `${day(peak.at)} ${et(peak.at, { hour: '2-digit', minute: '2-digit' })}` },
  byEventKind: Object.fromEntries([...group(rows, r => r.kind)].map(([k, list]) => [k, { events: list.length, visitors: distinct(list) }])),
  visitorsByDevice: Object.fromEntries([...group(rows, r => r.device)].map(([k, list]) => [k, distinct(list)])),
  visitorsBySource: Object.fromEntries([...group(views, r => r.via)].map(([k, list]) => [k, distinct(list)])),
  byDayEt: Object.fromEntries([...group(rows, r => day(r.at))].map(([k, list]) => [k, { visitors: distinct(list), views: list.filter(r => r.kind === 'view').length }])),
  byHourEt: Object.fromEntries([...group(rows, r => hour(r.at))].map(([k, list]) => [k, { visitors: distinct(list), views: list.filter(r => r.kind === 'view').length }])),
};

const csv = ['event,at_utc,visitor,kind,device,source', ...rows.map((r, i) => [i + 1, new Date(r.at).toISOString().replace(/\.\d{3}Z$/, 'Z'), numbers.get(r.visitor), r.kind, r.device, r.via].join(','))].join('\n') + '\n';
if (/[a-f0-9]{32}/.test(csv)) { console.error('Refusing to export: a raw browser ID survived renumbering.'); process.exit(4); }

const stamp = day(Date.now()).replaceAll('-', '');
const dir = new URL('../data/telemetry/', import.meta.url).pathname;
const files = { csv: `${dir}visit-events-${stamp}.csv`, summary: `${dir}visit-summary-${stamp}.json` };
log(`${rows.length} events from ${numbers.size} visitors (${views.length} views), ${summary.first} to ${summary.last}.`);
if (!write) { console.log(JSON.stringify(summary, null, 1)); log(`Dry run. Re-run with --write to create ${files.csv} and ${files.summary}.`); process.exit(0); }
for (const path of Object.values(files)) if (existsSync(path)) { console.error(`Refusing to overwrite ${path}`); process.exit(5); }
mkdirSync(dir, { recursive: true });
for (const [path, body] of [[files.csv, csv], [files.summary, JSON.stringify(summary, null, 1) + '\n']] as const) {
  writeFileSync(path + '.tmp', body, { flag: 'wx' });
  renameSync(path + '.tmp', path);
}
const lines = (await Bun.file(files.csv).text()).trim().split('\n').length - 1;
const check = await Bun.file(files.summary).json();
if (lines !== rows.length || check.totals.events !== rows.length) { console.error('Verification failed after write'); process.exit(6); }
log(`Wrote and verified ${files.csv} (${lines} events) and ${files.summary}`);
