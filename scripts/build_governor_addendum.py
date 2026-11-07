"""Builds data/baseline-20261103/governor-addendum-20261104.json (V request, Nov 3 2026 ~9:50 PM ET, con_47LNC7Xg2RhZRrRT).

Candidates come from the civicAPI governors feed (race 87535) snapshot saved beside the addendum.
Prior holders are the governors serving on Nov 3 2026 (18 D, 18 R among the 36 races; 14 seats not up: 6 D, 8 R).
Market odds, when supplied, are Polymarket prices at or before 2026-11-03T13:00Z retrieved from price history.
No model forecast covers governors (Split Ticket publishes Senate and House only), so probability and margin stay null.
Usage: python3 scripts/build_governor_addendum.py <feed snapshot> [governor-markets.json]
"""
import json, sys, datetime, pathlib

HELD_D = 'az ca co ct hi il ks ma md me mi mn nm ny or pa ri wi'.split()
HELD_R = 'ak al ar fl ga ia id ne nh nv oh ok sc sd tn tx vt wy'.split()
NAMES = {'ak': 'Alaska', 'al': 'Alabama', 'ar': 'Arkansas', 'az': 'Arizona', 'ca': 'California', 'co': 'Colorado', 'ct': 'Connecticut', 'fl': 'Florida', 'ga': 'Georgia', 'hi': 'Hawaii', 'ia': 'Iowa', 'id': 'Idaho', 'il': 'Illinois', 'ks': 'Kansas', 'ma': 'Massachusetts', 'md': 'Maryland', 'me': 'Maine', 'mi': 'Michigan', 'mn': 'Minnesota', 'ne': 'Nebraska', 'nh': 'New Hampshire', 'nm': 'New Mexico', 'nv': 'Nevada', 'ny': 'New York', 'oh': 'Ohio', 'ok': 'Oklahoma', 'or': 'Oregon', 'pa': 'Pennsylvania', 'ri': 'Rhode Island', 'sc': 'South Carolina', 'sd': 'South Dakota', 'tn': 'Tennessee', 'tx': 'Texas', 'vt': 'Vermont', 'wi': 'Wisconsin', 'wy': 'Wyoming'}
LEFT_INDEPENDENT = {'ak': 'Jonathan S. "JKT" Kreiss-Tomkins'}
CORRECTIONS = [{'loggedAt': '2026-11-04T03:15:00Z', 'race': 'gov-sd', 'detail': 'civicAPI snapshot 2026-11-04T02:54:42Z listed Iowa 3rd District House candidates (Sarah Trone Garriott, Zach Nunn) under South Dakota governor; the source corrected it by 03:13:51Z to Dan Ahlers (D) vs Larry Rhoden (R). Candidates rebuilt from the corrected snapshot; both snapshots are kept here, and every feed observation is retained in election.sqlite.'}]

feed_path = pathlib.Path(sys.argv[1])
feed = json.loads(feed_path.read_text())
markets = json.loads(pathlib.Path(sys.argv[2]).read_text()) if len(sys.argv) > 2 else {'markets': {}, 'gaps': []}
assert feed['election_type'] == 'Governor' and feed['test_data'] is False and len(feed['region_results']) == 36
assert sorted(HELD_D + HELD_R) == sorted(feed['region_results']) and len(HELD_D) == 18
races = []
for key, region in sorted(feed['region_results'].items()):
    dems = [c for c in region['candidates'] if c['party'] == 'Democratic']
    reps = [c for c in region['candidates'] if c['party'] == 'Republican']
    if key in LEFT_INDEPENDENT:
        candidate, party = LEFT_INDEPENDENT[key], 'I'
    else:
        assert len(dems) == 1, key
        candidate, party = dems[0]['name'], 'D'
    opponent = reps[0]['name'] if len(reps) == 1 else ''
    races.append({'id': f'gov-{key}', 'key': key, 'chamber': 'Governor', 'label': NAMES[key], 'state': key.upper(), 'candidate': candidate, 'opponent': opponent,
                  'party': party, 'probability': None, 'margin': None, 'rating': 'No model', 'forecastFlip': False, 'raceId': region['election_id'],
                  'market': markets['markets'].get(f'gov-{key}'), 'held': 'D' if key in HELD_D else 'R'})
out = {'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'provenance': 'con_47LNC7Xg2RhZRrRT; V requested governor races on election night',
       'feed': {'source': 'civicAPI', 'raceId': 87535, 'snapshot': feed_path.name, 'lastUpdated': feed['last_updated']},
       'heldNote': 'Prior holder = party of the governor serving on Nov 3 2026. 14 governorships not up: 6 D (DE, KY, NJ, NC, VA, WA), 8 R (IN, LA, MS, MO, MT, ND, UT, WV).',
       'notUp': {'democratic': 6, 'republican': 8},
       'opponentNote': 'Empty opponent = several Republicans on a top-four ballot (Alaska); the leading Republican by votes is compared live.',
       'corrections': CORRECTIONS,
       'modelNote': 'No probabilistic governor model was frozen; Split Ticket covers Senate and House only.',
       'marketsMeta': {k: v for k, v in markets.items() if k != 'markets'},
       'races': races}
dest = pathlib.Path(__file__).resolve().parent.parent / 'data/baseline-20261103/governor-addendum-20261104.json'
dest.write_text(json.dumps(out, indent=1) + '\n')
print(dest, len(races), 'races,', sum(1 for r in races if r['market']), 'with market odds')
