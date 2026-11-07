---
created: 2026-11-03
last_edited: 2026-11-03
version: 1.0
provenance: con_47LNC7Xg2RhZRrRT
---
# Guest walkthrough — Tired of Winning (staging, 1:30 PM ET, pre-results)

Phone 390×844 and desktop 1440. Tonight page = 5,976 px tall on phone (~7 screens). Races 7,079 px.

| # | Section | What a guest sees / notices | Where eyes should go | Verdict |
|---|---|---|---|---|
| 1 | Red party-line strip + masthead | Brand three times before content (strip, TOW wordmark, hero). Green dot unlabeled on phone. | Nothing — it's chrome. | Replace strip with countdown ticker. |
| 2 | Hero "ARE WE TIRED OF WINNING?" | Great joke, big. "Waiting on the votes" whisper. No answer to "when does anything happen?" | Headline then the time results start. | Keep, smaller; add countdown. |
| 3 | Exhaustion gauge | Needle at zero. Cute. Duplicates ladder below. | Stage name. | Merge with ladder into one meter. |
| 4 | Party invite banner | Third CTA competing on screen 2. | — | Replace with persistent chat bar. |
| 5 | Six-stage ladder | Six big tiles. Tapping teleports to another tab (surprise). | Current stage. | Fold into meter as pips. |
| 6 | "Night at a glance" ticker | "No races called" — no information. | — | Delete (countdown ticker replaces). |
| 7 | Map | 1.7 phone screens, two toggles, 8 small-state buttons, legend, footnote, picker. All one color before calls. | — pre-results nothing to see. | Pop-out sheet. |
| 8 | Chamber board | The real answer (34–31, need 51, expect 52.4) — buried at screen 4–5. | This is the hero. | Move to top, compact. |
| 9 | "Beating expectations?" | Placeholder sentence. | — | Merge into scorecard line. |
| 10 | Ones to watch (4 cards) | ~1 screen per card; repeated labels. Chosen by closeness to 50/50 (25–90% band), not by reporting order. | Who's up next. | Replace with races grouped by poll-close time. |
| 11 | Market teaser | Second giant headline; 3 disagreements; link to receipts. | Model vs market numbers. | Put forecast/market on every race row; drop section. |
| 12 | Footer | Fine, sources. | — | Keep (attribution rule). |
| 13 | 6-tab bottom nav | Map duplicates Tonight; Receipts niche; tiny labels. | — | Single page + small action bar (Races / Chat / What if / Map). |
| R | Races tab | Headline eats screen; 5 filter chips + sort + search + chamber; 15 tall cards. | Race list. | Contested/All toggle + search; compact rows. |
| P | Party tab | Big headline, composer at screen 2. | Composer + messages. | Slide-up sheet, composer first. |
| W | What if? | Slider, 59 button, outcome gauge, ladder again, only 10 toggle states, remaining-vote calculator. | Seat result. | Keep slider, 59 button, all-35 toggles; drop calculator. |
| X | Receipts | Brier scoreboard + rules + ledger. | — | Dropped per V; keep backend logging + 1-line market scorecard. |

## Aggregate feeling
A magazine of six sections, each opening with its own giant joke headline, before reaching the point. The same fact (how much winning) is drawn five ways: gauge, ladder, map, chamber board, scenario outcome. The core questions — when do results start, how many seats, which races report next, what's the room saying — are answered on screen 4–5 or not at all.

## Eye-path target
1. Countdown to next poll close → 2. Senate seats vs 51 + winning stage → 3. Races in reporting order → 4. Room chat (always one tap away) → 5. What-if levers.

## Why only 10 states in "A few states change everything"
`focus` = Senate races with Split Ticket win probability 25–90%, sorted by closeness to 50%. Ones-to-watch = first 4 of that list. Neither reflects reporting order. Split Ticket's own 5–95% band gives 15 contested races.

## Critique (critique skill)

**Anti-patterns verdict: mostly pass.** Distinctive palette and condensed display type; not generic AI. Tells present: identical card grids (race cards, ladder tiles), hero-metric layout in chamber board, cards everywhere (gauge card, race cards, scenario result card), repeated information (meter drawn 5 ways; "Split Ticket"/"Polymarket" labels on every card), every section has a primary-weight headline.

**Overall:** The joke lands; the answers are buried. Biggest opportunity: make the page answer "when, how many, what's next" in the first screen and let everything else be one tap away.

**Working:** (1) Campaign-placard identity — red/cream/navy + condensed caps is memorable. (2) Honesty labels (lead ≠ call, frozen vs live). (3) Emoji reactions per race — social, cheap, fun.

**Priority issues**
1. Hierarchy inverted — scoreboard on screen 4–5; hero, gauge, invite, ladder, ticker, map come first. Fix: scoreboard + stage meter as first screen. → arrange, distill
2. No time dimension — nothing says when results start or what reports next; races sorted by closeness. Fix: countdown ticker + races grouped by poll-close time. → onboard, harden
3. Redundancy — meter ×5, giant headline ×6, tabs that duplicate (Map). Fix: one meter, one hero headline, single page. → distill, typeset
4. Race cards too heavy — ~400px each, 3 stat columns + baseline + gap* + details + reactions. Fix: compact row; details on demand. → arrange, clarify
5. Coverage choice hidden — 10 of 35 states, our 25–90% band. Fix: Contested (Split Ticket 5–95%, 15) vs All 35, labeled. → clarify

**Minor:** green status dot unlabeled on phone; "Baseline D+1.4 · gap*" jargon; ladder tiles navigate away unexpectedly; small-state button grid on map eats a screen; remaining-vote calculator is two sliders of assumptions with low payoff.

## Audit (audit skill) — staging after distill/arrange/clarify/typeset/onboard/harden/adapt

**Anti-patterns verdict: pass.** One purposeful card (the meter); race rows use rules, not cards; numbers are real data; no gradients/glass/AI palette.

Axe-core 4.10.2 on phone, desktop, chat sheet, map sheet, expanded row: 0 critical, 2 serious, 1 moderate.

| Sev | Where | Issue | Fix (command) |
|---|---|---|---|
| High | `.ticker-what` | White at 95% opacity on red = 4.43:1 (WCAG 1.4.3 needs 4.5) | Drop opacity (polish) |
| High | `.num-r` "GOP" label | #d72f27 on paper at 14px = 4.33:1 | Small text in --red-ink; keep large number red (3:1 large-text OK) (polish) |
| Medium | Map sheet `aside` | Complementary landmark nested in dialog | Use div role=region (polish) |
| Medium | Main bundle 438 KB (map paths 114 KB JSON) | Map is now optional but ships in the first load | Lazy-load map on first open (optimize, within polish) |
| Low | Sheet backdrop/shadow, button hover | Hard-coded rgba/hex | Acceptable; tokenize later |

Positive: native dialogs (focus, Esc, backdrop), aria-pressed/expanded everywhere, 44px targets verified, no overflow at 320 px / 200% zoom, list capped at 60 rows, 1 s timer isolated to the ticker.
