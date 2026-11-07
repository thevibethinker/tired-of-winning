---
created: 2026-11-03
last_edited: 2026-11-07
version: 2.0
provenance: con_47LNC7Xg2RhZRrRT; rewritten for the public repo when the site was frozen (election-night notes moved to docs/election-night-log.md)
---
# Tired of Winning?

A one-night, phone-first watch-party dashboard for the November 3, 2026 U.S. midterms, built for a room of progressive friends and family. It takes the piss out of Trump's 2016 promise that "you're going to get so tired of winning": the more seats Democrats and left-leaning independents flipped, the more exhausted the meter got.

**Live (frozen) page:** https://tired-of-winning-va.zocomputer.io

Since the election the page has been a frozen record. It keeps checking for late calls until it locks, then serves the locked final numbers with no further outside calls.

## What it showed

- **One meter for the whole night: net flips.** GOP-held seats our listed candidate won, minus our seats lost, across the Senate, House and governors. Six levels: Low energy (under 5), Winning (5–14), Bigly winning (15–29), So much winning (30–44), Tired of winning (45–59), No more winning (60+). Only source calls count; a lead never moves the meter.
- **Senate, House and governor cards** side by side, each with net flips and a seat bar against the forecast.
- **Model vs. market.** Every Senate race carried a model probability (Split Ticket) and a market probability (Polymarket), both frozen at 8 a.m. ET on election day. As races were called, the page scored both with the same Brier score over exactly the same races. As of Nov 7, across 33 called Senate races, the model (0.033) edged the market (0.038). Lower is better.
- **Races grouped by what happened:** flipped, seats lost, nail-biters, long shots ahead, favorites behind and so on, with a Contested/All switch, sorting and search across all 506 races.
- **A state map**, separating source calls from the frozen forecast.
- **Sounds.** Each call played a short Trump clip (a Democratic win got "WRONG!"; an upset got "You're fired") and sent his public-domain official portrait up the screen with the quote.

Election night also had a party room: browser-specific handles, one comment stream in a rotating banner, emoji reactions, crowd picks, and host moderation. It closed at midnight on Nov 4 and is retired. The frozen page keeps only the per-race emoji counts. Comments, handles and picks are not served or published.

## Sources

| What | Source | Notes |
|---|---|---|
| Results and race calls | [civicAPI](https://civicapi.org) national Senate (87528), House (87524) and governor (87535) feeds | Source calls, not certification |
| Forecast | [Split Ticket / The Argument](https://www.theargumentmag.com/p/split-ticket-2026-midterms-model) Senate and House model | Frozen the morning of Nov 3; no governor model |
| Market odds | [Polymarket](https://polymarket.com) | Last price at or before 8 a.m. ET, Nov 3. A historical probability, not a tradable quote |
| Poll-closing times | [The Hill](https://thehill.com/homenews/campaign/6175621-midterm-elections-polls-close-results/) | Used for the election-night countdown |
| Meme image | 2025 official presidential portrait (White House) | U.S. government work, public domain |
| Sound clips | Trump's own recorded words, via Myinstants | **Not included in this repo.** Sources and cut points are in `docs/sound-sources.md` |

Everything frozen before polls opened lives in `data/baseline-20261103/` with retrieval metadata. Later corrections (governor odds, candidate names) are dated addenda next to the baseline, never edits to it.

## How the lock works

`backend-lib/final.ts` locks the count once every race with live data has a source call, or at midnight ET ending Friday Nov 20, 2026, whichever comes first. Until then the server checks civicAPI hourly and on visits. At the lock it writes `data/final/final-results-<date>.json` (written once, never overwritten). From then on the server serves that file and never opens the results log again. Races still uncalled at the lock stay uncalled; they are never guessed.

`data/final/reactions-20261104.json` holds the party room's final emoji counts per race (counts only), exported by `scripts/export_reactions.ts`.

## Repository history

- **`election-night` tag**: the code exactly as it ran on Nov 3–4, including the party room, what-if scenarios, poll-closing countdown and minute-by-minute polling. The browser checks and rehearsal tools from that night are in `scripts/election-night/` and run against that version.
- **`main`**: the frozen final page.

Not included: runtime databases (the results log alone passed 1.4 GB), the host moderation key, guest handles and comments, visit counts, and the audio clips.

## Run it locally

Requires [Bun](https://bun.sh).

```bash
bun install
bun test             # unit tests
bunx tsc --noEmit    # type check
bun run build        # builds the page into dist/
PORT=3000 bun server.ts
```

Without a `data/final/` results file the server fetches civicAPI on demand. With one, it runs fully offline from the locked record. Sound buttons stay silent unless you add your own MP3s under `public/sounds/` using the file names in `docs/sound-sources.md`.

`node scripts/verify-final.mjs /absolute/evidence-dir <base-url> [--locked]` runs the browser checks for the frozen page.

## Built with

Built in one day on [Zo Computer](https://zo.computer) with Claude Code: Bun, Hono, React, Vite and Tailwind. `docs/election-night-log.md` has the working notes from the night. `docs/zo-site-guide.md` covers the Zo site template the project started from.
