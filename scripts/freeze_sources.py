import concurrent.futures
import csv
import datetime as dt
import hashlib
import io
import json
import pathlib
import re
import urllib.parse
import requests

ROOT = pathlib.Path(__file__).resolve().parents[1]
DEST = ROOT / 'data' / 'baseline-20261103'
CUTOFF = int(dt.datetime.fromisoformat('2026-11-03T13:00:00+00:00').timestamp())


def fetch(url: str, name: str) -> tuple[str, dict]:
    """Preserve each public response with retrieval time and source metadata."""
    with requests.get(url, timeout=30) as response:
        response.raise_for_status()
        body = response.content
        meta = {'url': url, 'retrievedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'sourceModifiedAt': response.headers.get('Last-Modified'),
                'sha256': hashlib.sha256(body).hexdigest()}
    (DEST / name).write_bytes(body)
    (DEST / (name + '.meta.json')).write_text(json.dumps(meta, indent=2))
    return body.decode(), meta


def main() -> None:
    """Create one immutable baseline; refuse to overwrite a completed freeze."""
    if (DEST / 'baseline.json').exists():
        raise SystemExit('Baseline already frozen; refusing to overwrite.')
    DEST.mkdir(parents=True, exist_ok=True)
    sources = {}
    forecasts = {}
    national = {}
    for chamber, chart, race_id in [('Senate', 'Hus3x', 87528), ('House', 'Cy0fK', 87524)]:
        html, _ = fetch(f'https://datawrapper.dwcdn.net/{chart}/', f'{chart}-redirect.html')
        match = re.search(rf'https://datawrapper.dwcdn.net/{chart}/(\d+)/', html)
        if not match:
            raise ValueError('No current chart version found')
        url = f'https://datawrapper.dwcdn.net/{chart}/{match[1]}/dataset.csv'
        body, meta = fetch(url, f'{chamber.lower()}-forecast.csv')
        sources[chamber] = meta
        forecasts[chamber] = list(csv.DictReader(io.StringIO(body)))
        body, meta = fetch(f'https://civicapi.org/api/v2/race/{race_id}', f'{chamber.lower()}-initial-results.json')
        national[chamber] = json.loads(body)
        if national[chamber].get('test_data') is not False or len(national[chamber].get('region_results', {})) < (35 if chamber == 'Senate' else 435):
            raise ValueError('Incomplete or test results feed')
    state_codes = {v['name']: k.upper() for k, v in national['Senate']['region_results'].items()}
    races = []
    for chamber, rows in forecasts.items():
        for row in rows:
            key = state_codes[row['State']].lower() if chamber == 'Senate' else row['cd'].lower()
            region = national[chamber]['region_results'].get(key)
            name = re.sub(r'\s*\(Ind\)', '', row['dem_name']).strip()
            independent = '(Ind)' in row['dem_name']
            races.append({'id': chamber.lower() + '-' + key, 'key': key, 'chamber': chamber,
                          'label': row.get('State', row.get('cd')), 'state': key.split('-')[0].upper(),
                          'candidate': name, 'opponent': row['rep_name'].rstrip('*'), 'party': 'I' if independent else 'D',
                          'probability': float(row['win_prob_d']) / 100, 'margin': -float(row['raw_prediction']),
                          'rating': row['bucket'], 'forecastFlip': row['flip'] == 'Y',
                          'raceId': region.get('election_id') if region else None, 'market': None})
    failures = []

    def market(race: dict) -> None:
        try:
            state = race['label']
            body, _ = fetch('https://gamma-api.polymarket.com/public-search?' + urllib.parse.urlencode({'q': f'{state} Senate winner 2026', 'limit_per_type': 10}), race['id'] + '-markets.json')
            events = json.loads(body).get('events', [])
            event = next((e for e in events if re.fullmatch(re.escape(state.lower().replace(' ', '-')) + r'-senate-(?:election-)?winner(?:-2026)?(?:-\d+)?', e['slug'])), None)
            if event is None:
                raise ValueError('No exact statewide Senate winner market')
            lastname = race['candidate'].split()[-1].lower()
            market = next((m for m in event['markets'] if lastname in m.get('groupItemTitle', '').lower()), None)
            if market is None:
                raise ValueError('No matching candidate contract')
            outcomes = json.loads(market['outcomes'])
            token = json.loads(market['clobTokenIds'])[outcomes.index('Yes')]
            body, meta = fetch('https://clob.polymarket.com/prices-history?' + urllib.parse.urlencode({'market': token, 'startTs': CUTOFF - 3600, 'endTs': CUTOFF, 'fidelity': 1}), race['id'] + '-history.json')
            history = [x for x in json.loads(body).get('history', []) if CUTOFF - 900 <= x['t'] <= CUTOFF and 0 <= x['p'] <= 1]
            if not history:
                raise ValueError('No observation within 15 minutes before cutoff')
            point = max(history, key=lambda x: x['t'])
            race['market'] = {'probability': point['p'], 'observedAt': dt.datetime.fromtimestamp(point['t'], dt.timezone.utc).isoformat(),
                              'retrievedAt': meta['retrievedAt'], 'source': 'Polymarket', 'question': market['question'],
                              'url': 'https://polymarket.com/event/' + event['slug'], 'marketId': market['id'], 'tokenId': token}
        except Exception as error:
            failures.append({'id': race['id'], 'reason': str(error)})

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(market, [r for r in races if r['chamber'] == 'Senate']))
    baseline = {'frozenAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'cutoff': '2026-11-03T13:00:00Z',
                'forecastSource': 'Split Ticket / The Argument', 'forecastUrl': 'https://www.theargumentmag.com/p/split-ticket-2026-midterms-model',
                'sources': sources, 'races': races, 'marketGaps': failures,
                'senateNotUp': {'democraticCaucus': 34, 'republican': 31},
                'scope': 'All 35 Senate and 435 House forecasts; Polymarket candidate history attempted for all 35 Senate races. No House market coverage.'}
    (DEST / 'baseline.json').write_text(json.dumps(baseline, indent=2))
    print(json.dumps({'races': len(races), 'markets': sum(r['market'] is not None for r in races), 'gaps': failures, 'sources': sources}, indent=2))


if __name__ == '__main__':
    main()
