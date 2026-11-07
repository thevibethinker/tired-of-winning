import { useState } from 'react';
import { ArrowUpRight, MapPin } from 'lucide-react';
import states from '../lib/us-states.json';
import { stateSummary, type MapMode } from '../lib/map';
import { chamberNames, chance, type Chamber, type LiveRace } from '../lib/election';

const statuses = { waiting: 'Awaiting votes', unavailable: 'Comparison unavailable', leading: 'Leading · not called', trailing: 'Trailing · not called', tied: 'Tied · not called', won: 'Called win', lost: 'Called loss' };
const smallStates = ['VT', 'NH', 'MA', 'RI', 'CT', 'NJ', 'DE', 'MD'];

export default function ElectionMap({ races, onOpenState }: { races: LiveRace[]; onOpenState: (state: string, chamber: Chamber) => void }) {
  const [selected, setSelected] = useState('NC');
  const [chamber, setChamber] = useState<Chamber>('Senate');
  const [mode, setMode] = useState<MapMode>('live');
  const state = states.find(s => s.code === selected)!;
  const local = races.filter(r => r.state === selected && r.chamber === chamber).sort((a, b) => Math.abs((chance(a) ?? .5) - .5) - Math.abs((chance(b) ?? .5) - .5));
  const summary = stateSummary(local, mode);
  function selectState(code: string) {
    setSelected(code);
    if (window.matchMedia('(max-width: 720px)').matches) requestAnimationFrame(() => document.querySelector('.map-detail')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }));
  }
  return <section className="election-map" aria-label="Interactive United States election map">
    <div className="map-toolbar"><div className="map-segmented" aria-label="Map chamber">{(['Senate', 'House', 'Governor'] as Chamber[]).map(c => <button key={c} onClick={() => setChamber(c)} aria-pressed={chamber === c}>{c === 'Governor' ? 'Gov' : c}</button>)}</div><div className="map-segmented" aria-label="Map data layer"><button aria-pressed={mode === 'live'} onClick={() => setMode('live')}>Live calls</button><button aria-pressed={mode === 'forecast'} onClick={() => setMode('forecast')}>Frozen forecast</button></div></div>
    <div className="map-layout"><div className="map-canvas">
      <div className="map-mode-label">{mode === 'live' ? 'SOURCE CALLS · LEADS DO NOT COLOR THE MAP' : 'PRE-ELECTION OUTLOOK · NOT LIVE RESULTS'}</div>
      <svg viewBox="0 0 975 610" aria-label={`${chamber} ${mode === 'live' ? 'source calls' : 'frozen forecast'} by state`}>
        {states.map(s => {
          const localRaces = races.filter(r => r.state === s.code && r.chamber === chamber);
          const info = stateSummary(localRaces, mode);
          return <g key={s.code}>
            <path d={s.path} className={`map-state map-${info.tone}${selected === s.code ? ' selected' : ''}`} role="button" tabIndex={0} aria-pressed={selected === s.code} aria-label={`${s.name}: ${info.label}`} onClick={() => selectState(s.code)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectState(s.code); } }}><title>{s.name} · {info.label}</title></path>
            {!smallStates.includes(s.code) && <text x={s.center[0]} y={s.center[1] + 4} className="map-state-label" aria-hidden="true">{s.code}</text>}
          </g>;
        })}
      </svg>
      <div className="small-states" aria-label="Northeastern states">{smallStates.map(code => <button key={code} onClick={() => selectState(code)} aria-pressed={selected === code}>{code}</button>)}</div>
      <div className="map-legend"><span><i className="map-dem"/>{mode === 'live' ? 'D / I calls' : 'D / I favored'}</span><span><i className="map-gop"/>{mode === 'live' ? 'Other calls' : 'R favored'}</span><span><i className="map-mixed"/>{mode === 'live' ? 'Mixed calls' : 'Mixed / close'}</span>{mode === 'live' && <span><i className="map-waiting"/>No calls</span>}<span><i className="map-none"/>No race / unavailable</span></div>
      <p className="map-footnote">{mode === 'live' ? 'Color summarizes verified calls in this chamber, including partially called states. Uncalled races stay open.' : 'All races must exceed 60% for one side to color a state. Mixed delegations and closer races appear gold.'} Independents are grouped with the watchlist here, not assigned a caucus.</p>
    </div><div className="map-detail" role="region" aria-label="Selected state races">
      <label className="map-state-picker"><MapPin size={16}/><span className="sr-only">Choose a state</span><select aria-label="Choose a state" value={selected} onChange={e => selectState(e.target.value)}>{states.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></label>
      <div className="map-detail-heading"><span>{selected}</span><div><h3>{state.name}</h3><p>{local.length} {chamber === 'Governor' ? 'governor' : chamber} {local.length === 1 ? 'race' : 'races'}</p></div></div>
      <p className={`map-state-status tone-${summary.tone}`} aria-live="polite">{summary.label}</p>
      <div className="map-race-list">{local.slice(0, 3).map(r => <button key={r.id} onClick={() => onOpenState(selected, chamber)}><div><span>{r.chamber === 'House' ? r.label : r.chamber === 'Senate' ? 'SENATE' : 'GOVERNOR'} · {r.party}</span><b>{r.candidate === 'Not Contested' ? 'No Democratic candidate' : r.candidate}</b><small>{statuses[r.result.status]}</small></div><div className="map-race-odds"><strong>{chance(r) === null ? '—' : Math.round(chance(r)! * 100)}<small>%</small></strong><span>{r.probability === null ? 'market' : 'forecast'}</span></div></button>)}</div>
      {!local.length && <p className="map-empty">No {chamber === 'Governor' ? 'governor' : chamber} race in this state tonight. Switch chambers to explore its other races.</p>}
      {!!local.length && <button className="map-open" onClick={() => onOpenState(selected, chamber)}>Explore {local.length === 1 ? 'this race' : `all ${local.length} races`} <ArrowUpRight size={18}/></button>}
      <p className="map-source">Tap a state or use the selector.<br/>Calls: civicAPI · Forecast: Split Ticket (governors: Polymarket)<br/><a href="https://github.com/topojson/us-atlas" target="_blank" rel="noreferrer">Geography: U.S. Atlas / Census</a></p>
    </div></div>
  </section>;
}
