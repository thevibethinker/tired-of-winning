import { chance, type LiveRace } from './election';

export type MapMode = 'live' | 'forecast';
export function stateSummary(races: LiveRace[], mode: MapMode) {
  if (!races.length) return { tone: 'none', label: 'No race this cycle' };
  if (mode === 'forecast') {
    if (races.every(r => (chance(r) ?? .5) > .6)) return { tone: 'dem', label: 'D / I favored in all races' };
    if (races.every(r => (chance(r) ?? .5) < .4)) return { tone: 'gop', label: 'Republicans favored in all races' };
    return { tone: 'mixed', label: 'Mixed outlook or competitive' };
  }
  const wins = races.filter(r => r.result.status === 'won').length;
  const losses = races.filter(r => r.result.status === 'lost').length;
  if (wins && losses) return { tone: 'mixed', label: `${wins} D / I wins, ${losses} other wins · ${races.length - wins - losses} uncalled` };
  if (wins) return { tone: 'dem', label: `${wins} D / I wins · ${races.length - wins} uncalled` };
  if (losses) return { tone: 'gop', label: `${losses} other wins · ${races.length - losses} uncalled` };
  if (races.every(r => r.result.status === 'unavailable')) return { tone: 'none', label: 'Live comparison unavailable' };
  return { tone: 'waiting', label: 'No verified calls yet' };
}
