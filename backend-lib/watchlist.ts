const root = new URL('../data/baseline-20261103/', import.meta.url).pathname;

/** Every race the dashboard shows (frozen Senate/House baseline plus the dated governor addendum); the party room accepts reactions and picks only for these IDs. Read-only. */
export async function watchlistRaceIds(): Promise<Set<string>> {
  const baseline = await Bun.file(root + 'baseline.json').json();
  const governors = await Bun.file(root + 'governor-addendum-20261104.json').json();
  return new Set([...baseline.races, ...governors.races].map((race: { id: string }) => race.id));
}
