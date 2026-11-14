import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import type { LiveRace } from '../src/lib/election';

/** The page locks at midnight ET ending Friday Nov 20, 2026, or earlier once every race with live data is called (V, Nov 7). */
export const FREEZE_BY = '2026-11-21T05:00:00.000Z';
export const FREEZE_RULE = 'Locked when every race with live data had a source call, or at midnight ET ending Friday Nov 20, 2026, whichever came first. Races still uncalled at the lock are shown as uncalled, never guessed.';
/** 'archived': V ended the count early with one last pull on Nov 13, 2026, when the page moved to a static GitHub Pages archive. */
export const ARCHIVE_RULE = 'Locked at one last results pull on Nov 13, 2026, when the page moved to a static archive on GitHub Pages (earlier than the planned Nov 20 lock). Races still uncalled at the lock are shown as uncalled, never guessed.';
export type FreezeReason = 'all-called' | 'deadline' | 'archived';
export type FinalInfo = { frozenAt: string; reason: FreezeReason; uncalled: number; rule: string };
type Dashboard = { races: LiveRace[] };
export type FinalRecord<D extends Dashboard = Dashboard> = { schema: 'tow-final-v1'; final: FinalInfo; dashboard: D };

const FINAL_FILE = /^final-results-\d{8}\.json$/;

/** Races that could still get a call: everything except called races and seats with no live data (placeholders, uncontested). */
export const pendingRaces = (races: LiveRace[]) => races.filter(r => !['won', 'lost', 'unavailable'].includes(r.result.status));

export function freezeReason(races: LiveRace[], now: number): FreezeReason | null {
  if (now >= Date.parse(FREEZE_BY)) return 'deadline';
  if (races.length && !pendingRaces(races).length) return 'all-called';
  return null;
}

const etDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).replaceAll('-', '');

function check<D extends Dashboard>(record: FinalRecord<D>, file: string): FinalRecord<D> {
  if (record?.schema !== 'tow-final-v1' || !Array.isArray(record.dashboard?.races) || !record.final?.frozenAt || Number.isNaN(Date.parse(record.final.frozenAt))) throw new Error(`Final results file ${file} is not a valid tow-final-v1 record`);
  return record;
}

/** Newest locked record in `dir`, or null while the count is still open. A malformed file stops startup instead of silently reopening the count. */
export async function loadFinal<D extends Dashboard = Dashboard>(dir: string): Promise<FinalRecord<D> | null> {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir).filter(name => FINAL_FILE.test(name)).sort().at(-1);
  return file ? check<D>(await Bun.file(dir + file).json(), file) : null;
}

/** Writes the lock once (temp file, then rename). Never overwrites an existing record for the same day. */
export function writeFinal<D extends Dashboard>(dir: string, dashboard: D, reason: FreezeReason, frozenAt: string, rule: string = FREEZE_RULE): { record: FinalRecord<D>; path: string } {
  mkdirSync(dir, { recursive: true });
  const path = `${dir}final-results-${etDate(frozenAt)}.json`;
  if (existsSync(path)) throw new Error(`Refusing to overwrite ${path}`);
  const record: FinalRecord<D> = { schema: 'tow-final-v1', final: { frozenAt, reason, uncalled: pendingRaces(dashboard.races).length, rule }, dashboard };
  writeFileSync(path + '.tmp', JSON.stringify(record, null, 1) + '\n', { flag: 'wx' });
  renameSync(path + '.tmp', path);
  return { record, path };
}
