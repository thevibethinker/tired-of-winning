import type { Chamber, Region, Candidate } from '../src/lib/election';

export type Feed = { election_name: string; election_date: string; test_data: boolean; last_updated: string; candidates: Candidate[]; region_results: Record<string, Region> };

export function validateFeed(data: Feed, chamber: Chamber) {
  const seats = { Senate: 100, House: 435, Governor: 50 }[chamber];
  if (data.test_data !== false || !data.election_date?.startsWith('2026-11-03') || !Array.isArray(data.candidates) || !Number.isFinite(Date.parse(data.last_updated)) || !data.region_results || Object.keys(data.region_results).length < { Senate: 35, House: 435, Governor: 36 }[chamber]) throw new Error('Results feed failed date, test-data, or coverage checks');
  if (data.candidates.some(c => !Number.isInteger(c.seats) || c.seats! < 0) || data.candidates.reduce((s,c) => s + c.seats!, 0) > seats) throw new Error('Invalid chamber seat totals');
  for (const region of Object.values(data.region_results)) {
    if (!Array.isArray(region.candidates) || !Number.isFinite(region.percent_reporting) || region.percent_reporting < 0 || region.percent_reporting > 100 || region.candidates.some(c => !c.name || !Number.isFinite(c.votes) || c.votes < 0 || typeof c.winner !== 'boolean') || region.candidates.filter(c => c.winner).length > 1) throw new Error('Malformed race data');
  }
}
