// Poll-closing times for Nov 3, 2026, in UTC. Source: The Hill, "2026 midterm elections:
// When polls close, when results are expected" (Oct 29, 2026). Nevada (7 p.m. PT) is set by
// state statute; The Hill's list omits it. `at` = when most of the state's polls close.
export const scheduleSource = 'https://thehill.com/homenews/campaign/6175621-midterm-elections-polls-close-results/';

const T = {
  '6:00': '2026-11-03T23:00:00Z',
  '7:00': '2026-11-04T00:00:00Z',
  '7:30': '2026-11-04T00:30:00Z',
  '8:00': '2026-11-04T01:00:00Z',
  '8:30': '2026-11-04T01:30:00Z',
  '9:00': '2026-11-04T02:00:00Z',
  '10:00': '2026-11-04T03:00:00Z',
  '11:00': '2026-11-04T04:00:00Z',
  '12:00': '2026-11-04T05:00:00Z',
  '1:00': '2026-11-04T06:00:00Z',
} as const;

type Close = { at: string; rest?: string; early?: string };
const c = (at: keyof typeof T, extra: { rest?: keyof typeof T; early?: keyof typeof T } = {}): Close => ({ at: T[at], rest: extra.rest && T[extra.rest], early: extra.early && T[extra.early] });

export const stateCloses: Record<string, Close> = {
  KY: c('6:00', { rest: '7:00' }), IN: c('6:00', { rest: '7:00' }),
  GA: c('7:00'), SC: c('7:00'), VT: c('7:00'), VA: c('7:00'), FL: c('7:00', { rest: '8:00' }), NH: c('7:00', { rest: '8:00' }),
  WV: c('7:30'), OH: c('7:30'), NC: c('7:30'),
  AL: c('8:00'), CT: c('8:00'), DE: c('8:00'), IL: c('8:00'), ME: c('8:00'), MD: c('8:00'), MA: c('8:00'), MS: c('8:00'), MO: c('8:00'), NJ: c('8:00'), OK: c('8:00'), PA: c('8:00'), RI: c('8:00'), TN: c('8:00'), DC: c('8:00'),
  TX: c('8:00', { rest: '9:00' }), MI: c('8:00', { rest: '9:00' }), KS: c('8:00', { rest: '9:00' }), ND: c('8:00', { rest: '9:00' }), SD: c('8:00', { rest: '9:00' }),
  AR: c('8:30'),
  AZ: c('9:00'), CO: c('9:00'), IA: c('9:00'), LA: c('9:00'), MN: c('9:00'), NE: c('9:00'), NM: c('9:00'), NY: c('9:00'), WI: c('9:00'), WY: c('9:00'),
  MT: c('10:00'), UT: c('10:00'), NV: c('10:00'), ID: c('10:00', { rest: '11:00' }),
  CA: c('11:00'), WA: c('11:00'), OR: c('11:00', { early: '10:00' }),
  HI: c('12:00'), AK: c('12:00', { rest: '1:00' }),
};

export const firstClose = T['6:00'];
export const lastClose = T['1:00'];

export function etTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).replace(' AM', ' a.m.').replace(' PM', ' p.m.') + ' ET';
}

export function closeFor(state: string): Close | null {
  return stateCloses[state] ?? null;
}

export function closeNote(state: string) {
  const close = closeFor(state);
  if (!close) return 'Poll-closing time unavailable.';
  if (close.rest) return `Most polls close ${etTime(close.at)}; the rest by ${etTime(close.rest)}.`;
  if (close.early) return `A few polls close ${etTime(close.early)}; most at ${etTime(close.at)}.`;
  return `Polls close ${etTime(close.at)}.`;
}

export function groupByClose<T extends { state: string }>(items: T[]) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const at = closeFor(item.state)?.at ?? 'unknown';
    groups.set(at, [...(groups.get(at) ?? []), item]);
  }
  return [...groups.entries()].sort(([a], [b]) => a === 'unknown' ? 1 : b === 'unknown' ? -1 : a.localeCompare(b)).map(([at, items]) => ({ at, items }));
}

export function nextClose(now: number, states: string[]) {
  const times = [...new Set(states.map(s => closeFor(s)?.at).filter((t): t is string => Boolean(t)))].sort();
  const at = times.find(t => Date.parse(t) > now);
  return at ? { at, states: states.filter(s => closeFor(s)?.at === at).sort(), first: at === times[0] } : null;
}

export function countdown(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function relative(ms: number) {
  if (ms <= 0) return 'closed';
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m ? `in ${h}h ${m}m` : `in ${h}h`;
}
