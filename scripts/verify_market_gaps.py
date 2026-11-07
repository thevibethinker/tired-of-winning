import datetime as dt
import json
import unicodedata
import urllib.parse
from freeze_sources import CUTOFF, DEST, fetch


def normalize(value: str) -> str:
    """Normalize accents and whitespace while preserving candidate identity."""
    return ' '.join(''.join(c for c in unicodedata.normalize('NFD', value) if not unicodedata.combining(c)).lower().split())


def main() -> None:
    """Write an immutable verification addendum without replacing the first freeze."""
    out = DEST / 'verified-market-addendum.json'
    if out.exists():
        raise SystemExit('Addendum already exists; refusing to overwrite.')
    baseline = json.loads((DEST / 'baseline.json').read_text())
    regions = json.loads((DEST / 'senate-initial-results.json').read_text())['region_results']
    verified = {}
    for gap in baseline['marketGaps']:
        race = next(r for r in baseline['races'] if r['id'] == gap['id'])
        events = json.loads((DEST / (race['id'] + '-markets.json')).read_text())['events']
        slug = race['label'].lower().replace(' ', '-') + '-senate-election-winner'
        event = next(e for e in events if e['slug'] == slug)
        party = 'Independent' if race['party'] == 'I' else 'Democratic'
        candidates = [c for c in regions[race['key']]['candidates'] if c['party'] == party]
        if len(candidates) != 1 or normalize(candidates[0]['name']) != normalize(race['candidate']):
            raise ValueError('Ambiguous party contract: ' + race['id'])
        surname = normalize(race['candidate']).split()[-1]
        market = next((m for m in event['markets'] if surname in normalize(m.get('groupItemTitle', ''))), None)
        if market is None:
            title = 'Independent' if party == 'Independent' else 'Democrat'
            market = next(m for m in event['markets'] if m.get('groupItemTitle') == title)
        token = json.loads(market['clobTokenIds'])[json.loads(market['outcomes']).index('Yes')]
        body, meta = fetch('https://clob.polymarket.com/prices-history?' + urllib.parse.urlencode({'market': token, 'startTs': CUTOFF - 3600, 'endTs': CUTOFF, 'fidelity': 1}), race['id'] + '-verified-history.json')
        points = [x for x in json.loads(body)['history'] if CUTOFF - 900 <= x['t'] <= CUTOFF and 0 <= x['p'] <= 1]
        point = max(points, key=lambda x: x['t'])
        verified[race['id']] = {'probability': point['p'], 'observedAt': dt.datetime.fromtimestamp(point['t'], dt.timezone.utc).isoformat(), 'retrievedAt': meta['retrievedAt'], 'source': 'Polymarket', 'question': market['question'], 'url': 'https://polymarket.com/event/' + event['slug'], 'marketId': market['id'], 'tokenId': token, 'identityEvidence': f'Only {party} candidate in civicAPI frozen roster: {candidates[0]["name"]}; accented names normalized.'}
    out.write_text(json.dumps({'verifiedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'markets': verified}, indent=2))
    print(json.dumps({k: {'probability': v['probability'], 'observedAt': v['observedAt']} for k, v in verified.items()}, indent=2))


if __name__ == '__main__':
    main()
