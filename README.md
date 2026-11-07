---
created: 2026-11-03
last_edited: 2026-11-04
version: 1.14
provenance: con_47LNC7Xg2RhZRrRT; Zo site template
---
This file provides guidance when working with code in this repository. The README.md should ALWAYS serve as an accurate, comprehensive piece of documentation for this project. It should describe the broader goals and purpose of this repository along with the technical implementation details. If any aspect of the project changes, the README.md should be updated to reflect that.

# Project Notes

**Tired of Winning?** is a public, mobile-first progressive watch-party dashboard for the November 3, 2026 midterms. Campaign-poster typography, cream/navy/red, and an intentionally absurd exhaustion meter frame a factual results desk. The 59-seat scenario produces “NO MORE WINNING.”

## Current delivery

V explicitly authorized public access without sign-in on November 3. Staging preview: https://zite-51754-va.zo.computer, on 51754. Production copy: Sites/tired-of-winning, published port 54365, separate preview 51755. Public URL: https://tired-of-winning-va.zocomputer.io. Verified without authentication on November3. No external messages, trading, subscriptions, paid APIs, model calls, or extra workers were used.

One page (redesigned Nov 3 afternoon at V's request; the six-tab version is retired): sticky countdown ticker to the next poll closing → hero with the six-stage winning meter → Senate/House seat bars and a one-line model-vs-market scorecard → races grouped by poll-closing time (Contested = Split Ticket 5–95%, 15 Senate / 85 House; All = 35 / 435, capped at 60 rows until "Show more") → What if? (margin shift, 59-seat button, tappable stages, flip any of 35 races, independent opt-in). The map and the party room open as native dialog sheets from the action bar (bottom on screens under 820px; docked in the ticker above). See "Single-page redesign" below.

## Blowout view and sound on by default (Nov 3, ~10:30 PM ET)

V asked for a design-skill pass, sound on by default, general debugging, and a better view of contested races now that the night looked like a blowout.

- **What’s happening now:** once any votes are in, races default to a new “What’s happening now” order (`liveBucket`/`groupByBucket` in `src/lib/election.ts`, unit-tested). Groups, in order: Flipped (called GOP-held seats our side won), Long shots ahead (uncalled, our underdog leads), Nail-biters (uncalled, within 3 points), Favorites behind (uncalled, our favorite trails), Seats we lost (called), Too early to tell (under 25% of the vote in), Counting as expected, Called with no flip, No votes yet. Each race lands in exactly one group. Called groups use source calls only; uncalled groups say “Not called,” and status lines add “early” under 25% in. Chips with counts above the list jump to the newsworthy groups. Poll-closing order remains in the sort menu, and the countdown still jumps to it.
- **Design-skill pass (critique, arrange, clarify, harden, polish lenses; findings in the conversation workspace `design-pass-1104/`):** group order is now Flipped → Seats we lost → Nail-biters → Long shots ahead → Favorites behind → Too early → Counting → Called, no flip → No votes. Each group shows 6 rows on phones and 10 on desktop with its own “Show all” (the old 60-row cap cut off later groups). Long shots sort by % reporting, and counts 20+ points away from the model margin with under 75% in sink to the bottom with “far off the forecast” and a muted margin (`farOff`); early counts are muted too. Called wins under 50% odds say “· upset.” Contested now always includes called flips, so the Flipped chip matches the chamber cards. The legend and sort note fold into “How to read this,” and the Races button lands on the controls. The “Most contested” sort is now “Closest odds this morning.” The masthead pin says “As of” (“Checked” was clipped). Chips use singular titles.
- **Data fixes (read-only production health check):** `data/baseline-20261103/name-corrections-20261104.json` is a dated addendum (baseline untouched; the server refuses to start if a `from` no longer matches) for TN-07 (Darden Copeland), TX-32 (Dan Barrios), TX-12 (Angela Rodriguez Prilliman), MN-04 (Paul Wikstrom), AZ-03 (Jacob Parkman), CO-06 (Jason Clark) and CA-11 (Wiener spelling); it is included in /api/receipts. Uncontested seats and Democrat-vs-Democrat top-two seats now compare our side together against the strongest non-Democrat and can never count as a loss (`unopposedResult`), which restores 10 called Democratic seats that showed “No live data.” LA-02’s “Eventual Nominee” opponent is matched to the leading Republican; LA-03 to LA-06 have multi-candidate fields from both parties and stay unavailable with that reason. `topRepublican` remembers names seen with the Republican label (civicAPI relabeled New Mexico candidates “Nonpartisan” at 03:30Z). The South Dakota governor figures civicAPI showed 03:12–03:30Z looked party-swapped; the source corrected them by 03:40Z, so no hold was applied (noted in the addendum).
- **Pipeline line:** under the flip total, “Not called yet: ahead in N more GOP-held seats, behind in M of ours. If every one of those leads held: +X (level).” It uses uncalled counts with at least 25% in (`leadTally`), never moves the meter, and says leads aren’t calls.
- **House sounds in a blowout:** a House call now makes noise if the seat was contested (5–95% model) or the call is a flip or upset either way, including a withdrawn one (`audible(race, before)`). Previously a called upset in a seat the model rated under 5% was silent.
- **Sound on by default:** `src/lib/sound.ts` now stores preferences under `tow_sound_v2`; effects default on, and only an explicit off in v2 persists (v1 saved effects:false for every guest who never opted in, so it isn’t treated as a choice). Browsers still hold audio until the first tap each visit: gesture listeners cover pointerdown, pointerup, touchend, click and keydown (touch screens unlock on pointerup/touchend, not pointerdown), ignore synthetic events, and stay armed until the AudioContext is actually running. If iOS suspends audio, the pin returns to “Tap.” The old opt-in offer card is now a small fixed gold sticker above the action bar (“Sound’s on. Tap anywhere and he can hear you.” · Keep it quiet), shown only while audio is locked and hidden while a call pop-up shows, so nothing shifts when it goes. The first time audio runs with effects on, the page counts `sound_on` once, so host stats now count browsers that actually heard sound.

## Governors, flips meter and wider Contested (Nov 3, ~10 PM ET)

V asked to add the 36 governor races, replace the Senate-seat meter with one based on flips across all three offices (Senate, House and governors shown at the same level of the hierarchy), give governor calls the same Trump clips, and widen Contested because the night looked like a blowout.

- **Governors:** live results from civicAPI race 87535 (polled with the Senate and House feeds). Race definitions are in `data/baseline-20261103/governor-addendum-20261104.json`, built by `scripts/build_governor_addendum.py` from a saved feed snapshot plus `governors/governor-markets.json`. Market odds are Polymarket prices at or before 8 a.m. ET (34 party-level markets, plus candidate markets for CA Becerra and AK Kreiss-Tomkins), raw responses in `governors/polymarket-raw/`. No governor model could be proven to predate the cutoff (Split Ticket covers Senate and House only; the Wayback captures of Race to the WH are stale or unreadable), so model = null and the UI shows "—". Alaska's top-four ballot has three Republicans, so the race compares Kreiss-Tomkins (I) with the leading Republican by votes. Correction log: civicAPI's 02:54Z snapshot listed IA-03 candidates under South Dakota; the addendum was rebuilt from the corrected 03:13Z snapshot (both kept).
- **Prior holders:** Senate and House holders derive from Split Ticket's own predicted winner plus its flip flag (`heldBy`, unit-tested to give the known 13 D / 22 R Senate split, and 215 D / 220 R in the House). Governors: the 18 D / 18 R governors serving on Nov 3; 14 not up (6 D, 8 R).
- **Flips meter:** net flips = called GOP-held seats our listed D/I candidate won, minus called D-held seats lost, across all three offices. Leads never count. Six levels: Low energy (<5), Winning (5–14), Bigly (15–29), So much (30–44), Tired (45–59), No more (60+). This morning's odds implied about +34 net (Senate +5.8, House +24.4, governors from markets), which lands in So much winning. Three equal chamber cards (Senate, House, Governors) show net flips, gains and losses, called seats and a seat bar with the control line and the model or market expectation. Level sounds follow the flip tiers. The What if? keeps its Senate seat count and 59-seat button and now reports scenario Senate and House net flips; it has no level ladder.
- **Contested:** model or market win chance between 2% and 98%, an uncalled count within 10 points with votes in, or an upset in progress (our underdog leading or called, or our favorite trailing or called against). The list grows as results arrive. Before results: 21 Senate and 103 House races (was 15/85 at 5–95%).
- **Sounds:** governor calls are always audible and use the same clips as the Senate (win “WRONG!”, upset “You’re fired.”, loss “Sad.”, withdrawn “You are fake news.”); for governors, an upset is judged on the market odds.

## Single-page redesign (Nov 3, 2026, afternoon)

V asked to slim the site into an intuitive single page: drop the receipts page and the separate map page (map as a pop-out), add a countdown to when results start, show the order results arrive, and stop hiding non-competitive Senate races (show Contested vs All 35 rather than our own 25–90% band). Walkthrough, critique and audit notes are in the conversation workspace (`walk/WALKTHROUGH.md`). Skills applied in order: critique, distill, arrange, clarify, typeset, onboard, harden, adapt, audit, polish.

- **Removed from the UI, retained underneath:** the receipts page (GET /api/receipts still exports the record; observation logging unchanged), the DDHQ second-opinion link, the market "disagreement" teaser, the gauge, the ladder block, the party invite banner and the remaining-vote calculator. Race-level model and market odds now appear on every row; matched-cohort Brier scores appear as one scorecard line once races are called.
- **Poll-closing schedule:** `src/lib/schedule.ts`, all 50 states + DC in UTC, from The Hill, Oct 29, 2026 (https://thehill.com/homenews/campaign/6175621-midterm-elections-polls-close-results/). Nevada (7 p.m. PT = 10 p.m. ET) comes from state statute; The Hill omitted it. Groups use the time most of a state's polls close; split states (KY, IN, FL, NH, TX, MI, KS, ND, SD, ID, OR, AK) note the other time. Countdown uses the viewer's device clock.
- **Vocabulary:** Race cards explicitly label "Model win %" (Split Ticket) and "Market win %" (Polymarket frozen at 8 a.m. ET). These are predicted chances of the listed Democrat or independent winning, not vote share. Live count = counted margin + status ("Polls open", "Leads, not called · 22% in", "Called for Ossoff"). A lead is never shown as a call.
- **Race ordering:** "Sort by" defaults to poll-closing time, with closest model races first within each group. Other modes rank the entire filtered list: Most contested (model probability closest to 50%), Democratic-leaning first (highest D/I win chance), Republican-leaning first (lowest D/I win chance), Biggest model–market gap (absolute probability difference, missing market odds last), and State code A–Z (numeric district order). All modes work with Senate/House, Contested/All and candidate search; sort before the 60-row cap. Independents keep their party labels and are not assigned a caucus. Tapping the countdown restores poll-closing order before jumping to the relevant group.
- **Removed the old `focus` list** (Senate races with 25–90% probability). It produced the 10-state "A few states change everything" list and the four "ones to watch"; neither reflected reporting order.
- **Performance:** the map (114 KB geometry) is lazy-loaded on first open; first-load JS fell from 147 KB to 101 KB gzipped. Only the ticker re-renders each second.
- **Verification (staging):** 46 unit tests / 321 assertions (`bun test`, adds `tests/schedule.test.ts`), TypeScript, build; `node scripts/verify-redesign.mjs /abs/dir` 70/70 checks at 360/390/1280 px with faked clocks and browser-intercepted synthetic results (nothing written); `node scripts/verify-party.mjs /abs/dir` 26/26 (updated to the sheet UI); axe-core 4.10.2 zero violations on page, chat sheet, map sheet and expanded row; tablet 768, landscape 844×390, 320 px and 200% text zoom without overflow.
- `scripts/rehearse-browser.mjs` drives the retired six-tab UI and no longer applies; `scripts/rehearse-results.ts` (backend) still does. Use `verify-redesign.mjs` for the frontend.

## Twelve-hour party room

V requested public audience participation on November 3 in con_47LNC7Xg2RhZRrRT. The party room opens as a sheet from the Chat button and directly at `/#party`. Each browser automatically receives a random, HttpOnly, SameSite cookie; secure cookies are used on HTTPS. There are no accounts or device fingerprints. A different browser/private session or cleared cookie creates a different guest; these are browser identities, not verified unique humans. Handles use 2–24 letters/numbers/underscores, are case-insensitively unique, and persist while the cookie lasts. No IP addresses or raw session tokens are stored; hashed network keys are used briefly for join throttling.

The shared general board shows the newest 200 messages (500 characters each), identifies the author, and lets authors remove their own messages. Messages are plain text rendered through React escaping. A sent message keeps the author's handle at posting time. Every race has six emoji reactions and one changeable audience pick per browser; repeating the same choice does not inflate counts. Party sentiment is expressly not a forecast, verified-person poll, election result, or part of the market accuracy score.

`backend-lib/party.ts` supplies the API through `server.ts`; `src/components/party-room.tsx`, its CSS and `src/lib/party.ts` supply the interface. `data/party.sqlite` is a separate WAL database, excluded from election receipts and staging-to-production promotion. Keep its WAL and database together. The room closes for mutations 12 hours after this database is initialized; the persisted cutoff survives server restarts and is shown in Room details. **Extension (V, Nov 4 ~1:15 AM ET):** production now closes at 12:00 midnight ET at the end of Wednesday, Nov 4 (2026-11-05T05:00Z). Extend with `bun scripts/set_party_close.ts --db data/party.sqlite --until <ISO with offset> [--note …]` (dry run by default; `--apply` writes and logs to the `room_log` table), then republish so the server re-reads the close. Guest name-tag cookies last until the close plus 3 days, so later extensions keep identities. Tags issued before this change expired at the original 1:21 AM close; `--release-legacy-handles` (allowed only for the original 12-hour room, after its close) renamed those custom handles to `<handle>~expired_<id>` so returning guests can reclaim them. Comments keep the handle they were posted with. An open tab that finds itself without a name tag while the room is open rejoins once automatically (`rejoinTried` in `party-room.tsx`), so a cookie-blocked browser cannot loop on the shared-network join limit. Closing makes it read-only, not deleted. Existing comments and counts remain readable afterward. No scheduler or AI task is involved. Preserve the production database when republishing.

One shared frontend provider refreshes social state every 5 seconds while the tab is visible, including after the posting cutoff so host removals still reach read-only viewers. Failed refreshes visibly pause social writes and hide the banner's cached comments; recovery retains drafts and identity. Drafts also survive closing the sheet. Writes are serialized in-browser, comments carry idempotency receipts, server limits cap message frequency and requests, and mutations require a recognized same-site Origin plus a custom request header. Guests may remove their own comments; hosts can remove any comment. Public input never enters HTML, election tables, receipts or source forecasts.

### Group-chat banner and host moderation (Nov 3 final pass)

The navy strip beneath the poll countdown uses the same comments table and shared state as the room. It rotates through the newest 20 visible comments every 8 seconds; pause and next controls, hover/focus hold, and reduced-motion default pause keep it readable. Tapping a comment opens and highlights that exact post. Handles and comments are escaped text, with narrow-screen truncation; full content remains in the room. Users are told posts may appear in the banner. Removal from the table's visible set removes the post everywhere on the next successful 5-second poll.

Host controls live inside Chat. A private key unlocks a separate random HttpOnly, SameSite=Strict cookie for 24 hours. Guest handles and browser identities never imply host authority. Five login attempts per network per minute, origin/header guards, constant-time key comparison, hashed session tokens, expiry and server-side logout protect the moderation endpoints. Host search checks all active comments by handle or text, returning 200 at a time with older-page navigation. Hosts may remove a comment in the stream or directly from the banner and undo the latest removal. Removal is a soft delete with an action history; it does not destroy the stored message. Moderation continues after the 12-hour posting cutoff, without reopening posting, votes or reactions.

Run `bun scripts/setup-party-host.ts` separately in staging and production to create a unique `data/party-host-key.json` (mode 0600); the command never prints its value and never replaces an existing key. This file stays outside dist, is git-ignored and excluded from promotion with the rest of data. The server reads it at startup; missing or malformed keys disable host login without stopping the election dashboard. Never copy staging keys, host sessions, comments, or votes to production. The private production instructions in `Documents/Deliverables/tired-of-winning-host-access.md` link to the key file without embedding the credential; the instructions are outside both site trees. Do not publish or include that document in receipts.

`tests/party.test.ts` includes authorization, old-comment search, pagination, literal query handling, remove/undo, replay safety, host expiry/logout, rate limits and moderation after the posting cutoff. `scripts/verify-host.mjs /absolute/scratch-directory` exercises real staging browsers with labeled temporary comments and cleans up those comments and host sessions. It also covers banner rotation/pause, reduced motion, reconnecting, retained drafts, mobile host controls, and continued removal updates for read-only viewers. Public smoke checks must not post rehearsal messages or votes.

`bun test tests/party.test.ts` runs 13 API tests against in-memory databases, covering identity, replayed writes, handle collisions, ownership, size/rate/origin guards, reaction and pick counting, room expiry/restart and public response privacy. `node scripts/verify-party.mjs /absolute/scratch-directory` runs two independent real browser contexts against staging only, with clearly labeled synthetic messages; it removes its own comments and clears its reactions/picks afterward. November 3 verification passed 26 browser checks, plus the existing 27 map/dashboard browser checks at 360/390/768/1440 pixels, and all 38 unit tests (298 assertions). Screenshots and JSON evidence for this release are in the conversation workspace under `party-verification/`. No synthetic social activity was promoted to production.

## Event sounds, chat pings and visit counting (Nov 3, ~4 PM ET)

V asked for event-based Trump sound effects, off by default but visibly encouraged, with race calls made clear; a chat ping for guests who have posted, mutable inside the chat; and basic anonymous telemetry so the host can see how popular the site got.

- **Clips:** nine short MP3s in `public/sounds/` (served at `/sounds/*.mp3`, 212 KB total), cut with ffmpeg from Myinstants uploads of Trump's own voice and loudness-normalized to −16 LUFS. Contents were verified by a local faster-whisper transcription (no paid or cloud calls). Sources, timings and the parody rationale are in `docs/sound-sources.md`. Poll-closing bells and chat pings are synthesized with Web Audio (no Trump).
- **Events** (`src/lib/sound-events.ts`, pure and unit-tested): a Democrat/independent source call → “WRONG!”; an upset (model under 50%) → “You’re fired.”; a Republican call → “Sad.”; a withdrawn call → “You are fake news.”; each new Senate winning level → the next line of the 2016 “tired of winning” speech (51 “We’re going to win so much.”, 52 “We have to keep winning.”, 54 “We have to win more…”, 56 “…you may even get tired of winning!”, 59 “Please, please, it’s too much winning. We can’t take it anymore.”); poll closings → bell. Senate calls always count; House calls only in contested races (5–95%). The first update after page load never makes noise. One sound per update (highest priority), with “+N more” in the pop-up. A lead never makes noise.
- **Interface** (`src/components/sound-ui.tsx`/`.css`, engine `src/lib/sound.ts`): *Superseded at ~10:30 PM: sound is now on by default; see “Blowout view and sound on by default.”* Originally sound was off by default and stored per browser. A red “Sound OFF” pin in the masthead wiggles once on load; a dashed “Hear him take the L.” offer card sits below the hero until sound is on or dismissed for the session; every event shows a pop-up naming the call and the source (“Race called · source call”) and, when sound is off, a “Hear Trump react” button that turns it on and plays that clip. The soundboard sheet (offer card, footer) lists every event with tap-to-preview clips. Browsers require a tap before audio: returning guests with sound on see “Sound TAP” until any interaction. iOS uses `navigator.audioSession = 'playback'` where available.
- **“Sad.” on guest actions and the rising meme (Nov 3, ~4:15 PM ET):** with sound on, adding or changing your own emoji reaction, or posting a comment, plays “Sad.” (`sadFor` in `src/lib/sound.ts`, gate `sadAllowed` in `sound-events.ts`). Clearing a reaction stays quiet; posts stay quiet when chat sounds are muted; one “Sad.” per 2 seconds; it never cuts off a results clip (`play(id, { interrupt: false })`). Party picks stay silent. Every Trump clip that actually starts (results, “Sad.”, soundboard previews) sends a meme card up the screen: the 2025 official White House portrait (public domain, `public/images/trump-meme.webp`, 11 KB) with the clip's exact words as top/bottom meme text (`memeCaption`). `TrumpMeme` renders as a manual popover so it rises above open chat/soundboard sheets, is `aria-hidden` and pointer-transparent, alternates sides, clears after 3.6 seconds, and holds still under reduced motion (the site-wide rule removes all animation).
- **Chat pings:** state `auto` until the guest posts, then `on`; the chat sheet shows a Mute/Unmute row (`off` persists). Pings play only for other guests' new posts, throttled to one per 2.5 seconds, independent of the event-sound switch.
- **Visit counting** (`backend-lib/telemetry.ts`, client `src/lib/telemetry.ts`): POST `/api/t` stores only a random 32-hex browser ID (localStorage), event kind (`view`, 60-second visible `ping`, `sound_on`/`off`, `chat_open`, `map_open`, `soundboard_open`), device class and referrer hostname or `?via=` tag, in separate WAL database `data/telemetry.sqlite`. No IPs, user agents, handles, cookies or URLs. Same-site Origin required, 1 KB bodies, 20 events per browser per minute, 500,000-row cap. Global Privacy Control disables it; the footer discloses it. Host-only `GET /api/party/host-stats` adds room totals; the Chat → Host controls panel shows browsers, here now (2.5 min), peak at once (2-minute buckets), page loads, by-hour bars, devices, sources, sound/chat adoption, and refreshes every 30 seconds. The QR code uses `?via=qr`; use `?via=ig` for Instagram link stickers.
- **Verification (staging, Nov 3, meme release):** 67 unit tests; TypeScript; build; `verify-sound` 48/48 (adds reaction/post “Sad.”, cooldown, quiet clears, chat mute, sound-off silence, meme above sheets and fit at 320/360/1280); `verify-redesign` 70/70, `verify-party` 26/26, `verify-host` 32/32; axe clean in seven states, including with the meme showing (fixed 4.04:1 cream-on-red text on the two red sound buttons to white, 4.77:1).
- **Verification (staging, Nov 3, sound release):** 65 unit tests / 438 assertions including `tests/telemetry.test.ts` and `tests/sound-events.test.ts`; TypeScript; build; `node scripts/verify-sound.mjs /abs/dir` 36/36 (intercepted synthetic results, staging only, two labeled rehearsal comments); `verify-redesign` 70/70, `verify-party` 26/26, `verify-host` 32/32.
- **Marketing assets:** QR code, real-UI screenshots and three 3-panel Instagram story sets are in `Documents/Deliverables/tired-of-winning-instagram/` (outside the site trees).

## Data and boundaries

- **Results:** civicAPI national Senate 87528 and House 87524 endpoints. Two HTTP requests per minute, shared by all viewers, with validation and last-good-data fallback. The production-only process timer polls through November 6 at 12:00 UTC; browser demand can refresh thereafter. Staging refreshes on demand only. Screens check the shared server every 30 seconds; upstream fetches remain capped at once per 60 seconds per process. No separate scheduler. A viewer request waits at most 3 seconds for an in-flight upstream refresh, then gets the last good results (Nov 3 readiness fix: the upstream timeout is 20 seconds but the browser gives up at 15, so a slow civicAPI would otherwise have shown guests "The results desk didn't answer" despite good cached data). `scripts/rehearse-results.ts` checks this with a 6-second synthetic upstream delay. Source modification time and successful retrieval time are distinct. At verification, all vote counts were zero; these are real waiting states, not a simulation.
- **Forecast:** 470 frozen Split Ticket/The Argument rows from Datawrapper Senate Hus3x/20 and House Cy0fK/26. Source file timestamps are November 3 04:06 UTC; original files, retrieval metadata, hashes and normalized baseline are retained in data/baseline-20261103/. Expected seat totals sum probabilities, while scenarios count wins after an illustrative margin shift. They are different quantities.
- **Markets:** all 35 Senate candidate outcomes reconstructed from Polymarket historical samples at or before November 3 08:00 America/New_York (13:00 UTC), no more than 15 minutes old. They were retrieved later, not captured contemporaneously at 08:00. No House market coverage. Four verified identity matches are in an immutable addendum rather than overwriting the initial freeze. No executable quote or trading capability is implied.
- **Coverage:** all competitive candidate matchups verified; 29 safe/atypical House matchups currently cannot be matched safely. They remain in the 470-row forecast inventory and show unavailable live comparisons. National chamber totals still use civicAPI's aggregates.
- **Second opinion:** linked DDHQ November 2 Senate control probability, clearly separate from the race-level scoring dataset.
- **Semantics:** leading is not called; only the source winner flag creates an outcome. Counted-margin gaps are explicitly unadjusted for reporting geography and ballot type. New independent challengers do not automatically count as Democratic control. No original forecasts.
- **Scoring:** Brier probability error on exactly the same called Senate cohort for both model and market. Missing outcomes are unknown, never zero-error wins. Scores are provisional because source calls can be corrected. Scenarios are never persisted as real results.

## Files and operation

- **Feed freshness correction (Nov 3, evening):** the masthead's "Checked" time uses the older of the two successful chamber fetches, not dashboard response creation. Its accessible label and the delay notice give separate Senate/House receipt times; the tooltip distinguishes source modification times. The delay notice explains automatic retry. `node scripts/verify-freshness.mjs /absolute/scratch-directory` checks healthy, delayed, disconnected and recovered states at 320/390/1280px using intercepted responses and blocked writes. An optional public-site URL runs the same isolated browser test after deployment.
  The Retry control has a 44px minimum touch target. The redesign rehearsal now resets its intercepted pre-results fixture explicitly, so real returns and upstream errors cannot contaminate the simulated afternoon state.

- src/pages/election-night.tsx and election-night.css: complete responsive surface.
- src/lib/election.ts: candidate identity, result semantics, scoring, scenarios, fatigue copy.
- backend-lib/election.ts: polling, cache, API response and receipts export.
- backend-lib/source-validation.ts: election/date/coverage/vote guards.
- backend-lib/observations.ts: change-only append history, including reversions to older states.
- data/election.sqlite: append-only observations and fetch attempts (WAL). Preserve the database and its WAL together. Legacy snapshots are preserved; observations is canonical.
- scripts/freeze_sources.py: first freeze; refuses to overwrite baseline.json.
- scripts/verify_market_gaps.py: identity evidence and supplemental historical samples; refuses to overwrite its addendum.
- tests/election.test.ts: 19 semantic and provenance tests, 211 assertions.

GET /api/election returns the cached dashboard with at most one shared refresh per minute. GET /api/receipts downloads the baseline, addendum, all changed payloads and all fetch attempts. The audit is local evidence, not independently timestamped proof. Both endpoints are intentionally public in production under V's November3 authorization. Their contents are public election data and local observation receipts. Do not expose unrelated workspace data.

Public release verification: 25 semantic tests / 237 assertions, TypeScript, production build, and 27 browser checks run against the unauthenticated public URL. Widths 360/390/768/1440 passed without overflow, console warnings, or browser errors. Tested map layers, geographic clicks, keyboard selection, small-state shortcuts, Senate/House exact-state filters, 51/56/59 seat scenarios, and receipt download. Unattended production polling verified after the test browser closed: both feeds succeeded at16:12:26UTC. Evidence: N5/builds/tired-of-winning-20261103/public-release-verification.json.

## Public-map enhancement

Superseded Nov 3 ~10 PM: the six levels now count net flips across all offices (see "Governors, flips meter and wider Contested"). Originally they were Senate seats: Low Energy (<51), Winning (51), Bigly Winning (52–53), So Much Winning (54–55), Tired of Winning (56–58), No More Winning (59+).

The map uses U.S. Atlas3.0.1, Census2017 state shapes in Albers USA projection. Attribution: https://github.com/topojson/us-atlas; ISC license is public/us-atlas-LICENSE. Geometry: src/lib/us-states.json. Live colors summarize verified calls, retaining uncalled counts; forecasts require every race in a state above60% for one side, otherwise show mixed/close. Alaska/Hawaii are inset. State selector and Northeast shortcuts provide accessible alternatives to small shapes.

Reviewed civicAPI documentation https://civicapi.org/api-documentation and home page November3: free public/commercial use with attribution; provider advertises up-to-the-minute results, but no guaranteed latency was established. Live vote-update speed cannot be measured before returns arrive. AP Elections API https://developer.ap.org/ap-elections-api/ is a separate licensed/keyed alternative, not configured or purchased.

## Build and verification

### Isolated election-night rehearsal

Run `bun scripts/rehearse-results.ts /absolute/new/scratch-directory`, then `node scripts/rehearse-browser.mjs /absolute/new/scratch-directory`. The first command copies the actual backend and frozen inputs into a disposable runtime, intercepts all upstream requests, advances a simulated clock and records only to its own SQLite database. It refuses an existing output directory or a destination under Sites. The second command uses the existing staging preview and intercepts election/receipt responses inside its own browser. It exercises the real 30-second screen timer without changing the site or its real observations. Screenshots carry a synthetic-results banner. Browser verification uses the existing local Playwright installation; no dependency download or new service is needed.

November 3 rehearsal: 22 stages, 32 backend checks, 128 browser checks, zero browser exceptions. Covered batches and lead reversal, Senate/House calls, duplicate suppression, call withdrawal and opposite-winner correction, independent treatment, matched-cohort scoring, feed HTTP/JSON/timeout failures, malformed/test/wrong-election feed rejection, recovery, all winning tiers, forecast immutability, and populated layouts at 360/390/768/1440px. The original 25 semantic tests and TypeScript check passed. Evidence and labeled screenshots: `verification/rehearsal-20261103/`. This establishes application behavior under synthetic inputs, not actual civicAPI election-night latency, provider reliability, vendor access, or a load-test result. No production code or data was replaced.

Run `bunx tsc --noEmit`, `bun test tests/election.test.ts`, and `bun run build`. Zo owns process startup and ports; do not manually run dev/prod or restart it. **This project's preview serves dist assets in both environments. Run the build after frontend edits, then reload the browser.** API code still follows Zo's managed Bun hot reload. This avoids an observed Bun hot-reload failure while reinitializing Vite's bundled follow-redirects error constructors; production uses the same asset-serving path. No dependency or global runtime monkeypatch was installed.

Initial preview verification: 19 tests, type checking, production build, 21 browser checks, 360/390/768/1440px widths, search/filter/details, 59-seat scenario, keyboard slider, independent inclusion, absent scores, stale-source warning, connection failure, recovery and receipt export. Browser errors and console were empty. Evidence lives in N5/builds/tired-of-winning-20261103/verification.json; screenshots are conversation scratch references.

V's public-access instruction supersedes the earlier private-preview/passcode requirement. Publish only the dedicated production copy via Zo publish_site. Normal code promotion excludes zosite.json and data; preserve the production database and frozen evidence. Never overwrite production observations with staging data.


---

# Documentation

This is a **Zo Site** - a web application running on a user's Zo computer that combines:
- **Backend**: Bun + Hono server with API routes
- **Frontend**: React + Vite with client-side routing, shadcn/ui components, and Tailwind CSS 4
- **Single Process**: Bun serves APIs and prebuilt frontend assets (no separate dev server)

## Architecture

### File Structure

```
.
├── server.ts              # Main server (Hono + Vite middleware)
├── index.html             # HTML entry point for React
├── vite.config.ts         # Vite configuration
├── package.json           # Dependencies and scripts
├── zosite.json            # Zo deployment config (ports, env vars)
├── public/                # Static assets (images, fonts, favicon)
│   ├── favicon.svg        # Site favicon (replace with your own)
│   └── images/
│       └── pegasus.png    # Example image (loaded via <img src="/images/pegasus.png">)
├── backend-lib/
│   └── zo-api.ts         # Helper for calling Zo API
└── src/
    ├── main.tsx          # React entry point
    ├── App.tsx           # Router setup
    ├── styles.css        # Global styles
    └── pages/            # Page components
```

### Development vs Production

**Development Mode** (`bun run dev`):
- Single Bun process running `server.ts`
- Prebuilt Vite assets are served from dist; run the build after frontend edits
- API routes: `/api/*` handled by Hono
- React app: served from dist; Zo-managed Bun hot reload applies backend changes
- Client-side routing: any non-API, non-file route falls back to `index.html`
- **Environment**: Site runs at an internal authenticated URL accessible only to you (private site on your Zo computer)

**Production Mode** (Zo-managed `bun run prod`):
- Builds React app to `dist/` using Vite
- Bun serves static files from `dist/` via `hono/bun` serveStatic
- API routes still handled by Hono
- SPA fallback: all non-API routes serve `dist/index.html`
- **Environment**: Site is published and accessible to anyone on the internet at a public URL

NEVER use the scripts `bun run dev` or `bun run prod`. The Zo system handles running the site in the correct mode based on context. All process management of the server is handled by Zo. Never restart or stop the server manually.

## Viewing, Verification, and Debugging (agent-browser)

The `agent-browser` CLI tool lets you preview, navigate, and debug the site running at `http://localhost:$PORT` (PORT is set by Zo). Use it to verify UI changes, debug routing, or capture screenshots.

Core workflow:
1. Navigate to the site:
   ```bash
   agent-browser open http://localhost:$PORT
   ```
2. Snapshot the page to get interactive element refs:
   ```bash
   agent-browser snapshot -i
   ```
3. Interact with elements:
   ```bash
   agent-browser click @e1
   agent-browser fill @e2 "text"
   agent-browser hover @e3
   agent-browser get text @e1
   ```
4. Re-snapshot after page changes to get updated refs.

Taking screenshots:
```bash
agent-browser screenshot
agent-browser screenshot --full-page
agent-browser screenshot --filename debug.png
```

For the full list of commands and options, run:
```bash
agent-browser --help
```

Note: Do not tell the user to visit localhost; they already have access via the Zo preview iframe.

## Key Technologies

### ⚠️ IMPORTANT: This is BUN + HONO (NOT Node.js + Express)

This application uses:
- **Bun** as the runtime (NOT Node.js)
- **Hono** as the web framework (NOT Express)

Do not use Express patterns. Use Hono equivalents. For file system operations, see the section below.

### Bun Runtime
- JavaScript runtime (NOT Node.js or Deno)
- Use `bun add <package>` to install dependencies
- Built-in TypeScript support
- Built-in SQLite via `import { Database } from "bun:sqlite"`
- Process spawning: `Bun.spawn()` for running commands

### File System Operations

Bun has native APIs for file I/O but uses Node.js APIs for directory operations. Use the correct API for each operation:

| Operation | API | Example |
|-----------|-----|---------|
| Read file | `Bun.file()` | `await Bun.file("data.json").text()` |
| Write file | `Bun.write()` | `await Bun.write("out.txt", content)` |
| File exists | `Bun.file().exists()` | `await Bun.file("x.txt").exists()` |
| Read directory | `node:fs/promises` | `await readdir("./posts")` |
| Create directory | `node:fs/promises` | `await mkdir("dir", { recursive: true })` |
| Glob files | `Bun Glob` | `new Glob("**/*.md").scan(".")` |

**⚠️ Common Mistakes to Avoid:**

```ts
// ❌ WRONG - These do NOT exist:
Bun.readdir()        // No such API
Bun.readdirSync()    // No such API
Bun.mkdir()          // No such API
fs.readFileSync()    // Works but slower than Bun.file()

// ✅ CORRECT patterns:
import { readdir, mkdir } from "node:fs/promises";

// Reading a file
const content = await Bun.file("config.json").json();

// Writing a file
await Bun.write("output.txt", "Hello");

// Listing directory contents
const files = await readdir("./posts");

// Creating a directory
await mkdir("./uploads", { recursive: true });

// Finding files by pattern
import { Glob } from "bun";
const glob = new Glob("**/*.md");
for await (const file of glob.scan("./posts")) {
  console.log(file);
}
```

### Hono Framework
- Lightweight web framework designed for Bun
- Documentation: https://honojs.dev/llms-small.txt
- Import from `hono` for core, `hono/bun` for Bun-specific features like `serveStatic`

**Serving Static Files (Bun-specific):**

```ts
import { serveStatic } from 'hono/bun'

app.use('/static/*', serveStatic({ root: './' }))
app.use('/favicon.ico', serveStatic({ path: './favicon.ico' }))
app.get('*', serveStatic({ path: './static/fallback.txt' }))

// You can reach outside the project root to files in the user's workspace
app.get('/workspace-file', serveStatic({ path: '../some/dir/file.txt' }))
app.get('/absolute-file', serveStatic({ path: '/home/user/file.txt' }))

// Custom MIME types
app.get('/media/*', serveStatic({
  mimes: {
    m3u8: 'application/vnd.apple.mpegurl',
    ts: 'video/mp2t',
  },
}))
```

**Hono Routing:**

```ts
// REST API endpoints
app.get('/', (c) => c.json({ items: [] }))
app.post('/', (c) => c.json({ created: true }, 201))
app.get('/:id', (c) => c.json({ id: c.req.param('id') }))

// Middleware
import { basicAuth } from 'hono/basic-auth'
app.use('/admin/*', basicAuth({ username: 'admin', password: 'secret' }))

// Multiple middlewares are processed in order
app.use(logger())
app.use('/posts/*', cors())
app.post('/posts/*', basicAuth())
```

### React + Vite
- React for UI components
- Vite handles bundling and transforms
- Dependencies installed via `bun add` (NOT CDN imports) - all packages bundled by Vite
- React Router for client-side routing
- **Styling**: Tailwind CSS 4 configured with `@tailwindcss/vite` plugin
- **UI Components**: shadcn/ui on **Base UI** primitives (`@base-ui/react`, the `base-nova` style) already set up and configured - components can be added via `bunx shadcn@latest add <component-name>`. Base UI uses a `render` prop for composition, NOT Radix's `asChild` (e.g. `<DropdownMenuTrigger render={<Button variant="outline" />} />`); a trigger given a non-`<button>` element via `render` also needs `nativeButton={false}`. In Tailwind selectors prefer the `data-open:`/`data-closed:`/`data-checked:` variants (they match both Base UI and Radix state attributes) over `data-[state=...]`.
- **Icons**: Lucide React icons included and ready to use
- **React Compiler enabled** (via `babel-plugin-react-compiler` in `vite.config.ts`): components are auto-memoized, so do NOT add `useMemo`/`useCallback`/`React.memo` for performance. Follow the Rules of React strictly — no setState during render, no ref reads/writes during render, no `Date.now()`/`Math.random()` in render (derive them in event handlers or effects) — or the compiler skips the component.

## UI Quality

Rules for building interfaces that feel polished:

- **No state-driven layout shift.** When a hover/active/selected state changes an element's size (bold text, revealed actions), reserve the largest variant's space so neighbors don't reflow: keep revealed affordances mounted and toggle `opacity` (with `pointer-events-none`), and for text that bolds when active, stack an invisible bold copy in the same grid cell to hold the width.
- **Never nest `fixed`/`absolute` overlays inside blurred or transformed chrome.** An ancestor with `backdrop-filter`, `filter`, `transform`, or `contain: paint` becomes the containing block for `fixed`/`absolute` descendants, clamping drawers/menus to that ancestor's box. Render overlays as a sibling of the blurred/transformed element.
- **Don't hand-add `cursor-pointer`.** A base rule in `src/styles.css` gives every enabled interactive element the pointer cursor app-wide. A component needing a different cursor still wins with a `cursor-*` utility.
- **Semantic theme tokens only.** Use `bg-background`, `text-foreground`, `text-muted-foreground`, `border`, `bg-card`, etc. — never hard-coded colors like `text-zinc-500`. The palette lives in `src/theme.json` (source of truth) which generates the CSS variables in `src/styles.css`.
- **Keep the browser console clean** — zero errors AND zero warnings (hydration mismatches, React key warnings, failed fetches). Treat a warning as a bug. Verify with agent-browser after substantive UI changes.
- **Modern text wrapping**: `text-balance` on headings, `text-pretty` on body copy, and respect `prefers-reduced-motion` when adding animation.

## Site Kit (`src/components/kit/`)

Opinionated, reusable components layered on the `ui/` primitives. **See them all rendered live at `/_design`** — keep that page updated when you add or change a kit component. Prefer composing with these over hand-rolling one-offs:

- `Tooltip` — wrap any element to label it: `<Tooltip label="Copy"><Button …/></Tooltip>`. Never use the native `title` attribute.
- `Menu` / `MenuItem` / `MenuSection` / `MenuSeparator` / `MenuButton` / `ContextMenuTrigger` — popup + right-click menus with full keyboard support (react-aria-components). Items take `icon` (Lucide), `shortcut`, `selected`, and `variant="destructive"`. IMPORTANT: the click-menu trigger must be `<MenuTrigger><MenuButton>…</MenuButton><Menu>…</Menu></MenuTrigger>` — react-aria only wires open/close onto its own button, so the plain `ui/button` will not open the menu.
- `List` / `ListItem` / `ListSection` — keyboard-navigable interactive lists (arrows, type-ahead, Home/End). NOT for static nav links — use plain `<a>`/`<ul>` for navigation; a listbox is the wrong semantics there.
- `SegmentedControl` — the mode-switcher pill, always one selected, arrow-key navigable.
- `EmptyState` — the standard "nothing here yet" placeholder (icon chip, title, description, optional action). Use it for every empty list/panel.
- `Spinner` — font-drawn Braille loading glyph, colored by `currentColor`; drops into buttons and status text.
- `KeyHint` — keyboard shortcuts as key chips, e.g. `<KeyHint display="⌘K" />`.
- `ArrowLink` / `ProseLink` — standalone directional links (arrow nudges on hover) vs. links inside running text.
- `ThemedSurface` — re-theme a subtree by overriding semantic tokens (`{ background: …, foreground: … }`); children keep using `bg-background` etc.
- `Favicon` — third-party brand marks by domain with a globe fallback.

The kit is also published as the `@zo` shadcn registry (wired into this
project's `components.json`). Re-fetch a component after upstream fixes with
`bunx shadcn@latest add @zo/<name> --overwrite` (e.g. `@zo/menu`), or refresh
the whole kit with `bunx shadcn@latest add @zo/site-kit --overwrite`. The
catalog lives at https://zo.computer/r/registry.json. `--overwrite` replaces
the local file — if a kit component has been customized in this project, port
the upstream fix by hand instead of overwriting.

## Common Tasks

### Adding API Routes

Add routes in `server.ts` before the Vite middleware:

```ts
app.get("/api/example", async (c) => {
  return c.json({ data: "example" });
});
```

### Adding React Components

Create components in `src/`:

```tsx
// src/components/MyComponent.tsx
import React from "react";

export default function MyComponent() {
  return <div>Hello</div>;
}
```

Add routes in `src/App.tsx`:

```tsx
import MyPage from "./pages/MyPage";

<Routes>
  <Route path="/my-page" element={<MyPage />} />
</Routes>
```

### Calling Zo API from Backend

Use the helper in `backend-lib/zo-api.ts`:

```ts
import { callZo } from "./backend-lib/zo-api";

app.post("/api/ask-zo", async (c) => {
  const { question } = await c.req.json();

  const result = await callZo(question, {
    outputFormat: {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"]
    }
  });

  return c.json(result);
});
```

### Static Assets

There are two ways to include static assets like images, fonts, or JSON data:

#### Option 1: The `public/` Folder (Recommended for Most Cases)

Place files in the `public/` directory. They're served at the root URL path and work identically in dev and production.

```
public/
├── favicon.svg
├── images/
│   ├── logo.png
│   └── hero.jpg
├── fonts/
│   └── custom.woff2
└── og-image.jpg
```

Reference them with absolute paths:

```tsx
<img src="/images/logo.png" alt="Logo" />
<link rel="icon" href="/favicon.svg" />
```

In production, Vite copies the `public/` folder contents to `dist/` automatically.

**Use `public/` for**: favicons, Open Graph images, downloadable files, fonts, any asset that needs a stable/predictable URL.

#### Option 2: Import in Components (Bundled Assets)

Import assets directly in your React components. Vite handles bundling, optimization, and cache-busting via content hashes.

```tsx
// Images
import heroImage from '@/assets/hero.png';

function Hero() {
  return <img src={heroImage} alt="Hero" />;
}

// JSON data
import config from '@/data/config.json';

function Settings() {
  return <div>App version: {config.version}</div>;
}

// SVG as component (with ?react suffix)
import Logo from '@/assets/logo.svg?react';

function Header() {
  return <Logo className="h-8 w-8" />;
}
```

Place imported assets in `src/assets/` or alongside components:

```
src/
├── assets/
│   ├── hero.png
│   └── logo.svg
├── data/
│   └── config.json
└── components/
    └── Header.tsx
```

**Use imports for**: component-specific images, icons used in JSX, JSON configuration, any asset that benefits from bundling/tree-shaking.

#### Serving Files from the Workspace

For files outside the project (e.g., user's workspace files), create an API route:

```ts
app.get("/myfile", async (c) => {
  const file = Bun.file("/path/to/file");
  return new Response(file);
});
```

### Database

This application is database-agnostic and doesn't include a database by default. For most use cases, SQLite is recommended.

**Using Bun's Built-in SQLite:**

```ts
import { Database } from "bun:sqlite";

// Create/open database
const db = new Database("mydb.sqlite");

// Create table
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE
  )
`);

// Insert data
const insert = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
insert.run("John Doe", "john@example.com");

// Query data
const query = db.query("SELECT * FROM users WHERE name = ?");
const users = query.all("John Doe");

// Close when done
db.close();
```

**In a Hono route:**

```ts
app.get("/api/users", (c) => {
  const db = new Database("mydb.sqlite");
  const users = db.query("SELECT * FROM users").all();
  db.close();
  return c.json({ users });
});

app.post("/api/users", async (c) => {
  const { name, email } = await c.req.json();
  const db = new Database("mydb.sqlite");

  try {
    const insert = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)");
    insert.run(name, email);
    db.close();
    return c.json({ success: true }, 201);
  } catch (error) {
    db.close();
    return c.json({ error: "Failed to create user" }, 400);
  }
});
```

## Scripts

- `bunx tsc --noEmit` - Type check

## Important Notes

### Server-Side vs Client-Side

- **Server code**: `server.ts`, `backend-lib/` - runs on Bun
- **Client code**: `src/` - runs in browser, bundled by Vite
- Install ALL dependencies via `bun add` (React, etc.) - Vite bundles them

### Environment Variables

- `NODE_ENV=production` switches to production mode
- `ZO_CLIENT_IDENTITY_TOKEN` required for calling Zo API
- Access server vars via `process.env.VAR_NAME` in server code
- Access client vars prefixed with `VITE_` via `import.meta.env.VITE_VAR_NAME` in React code

### File System Access

The server runs on the user's Zo computer and can:
- Read/write any file on the system
- Execute commands via `Bun.spawn()`
- Access local databases

### Configuration

`zosite.json` defines:
```json
{
  "name": "My Site",
  "local_port": 12345,
  "entrypoint": "bun run dev",
  "publish": {
    "label": "My Site",
    "type": "http",
    "entrypoint": "bun run prod",
    "published_port": 12346,
    "env": {
      "NODE_ENV": "production",
      "ZO_CLIENT_IDENTITY_TOKEN": "none"
    }
  }
}
```

- Top-level `env`: Environment variables for **development mode**
- `publish.env`: Environment variables for **production mode**
- Variables prefixed with `VITE_` are exposed to client-side code via Vite
- `PORT` environment variable is automatically set to match `local_port` (or `published_port` in production)

### ⚠️ IMPORTANT: Do Not Edit `zosite.json` System Fields

**The `zosite.json` file is auto-generated by Zo. Most fields should not be manually edited.**

- `local_port` and `published_port` are assigned by the system when the site is created
- Ports are chosen using a hash-based algorithm to avoid conflicts
- The Zo system manages process lifecycle, tunneling, and URL routing based on these ports
- Editing ports or entrypoints will break the site's preview URL and publish functionality

**Safe to edit:**
- `name` - The display name for the site
- `env` and `publish.env` - Add or modify environment variables as needed

**Never edit:**
- `local_port`, `published_port` - System-assigned ports
- `entrypoint`, `publish.entrypoint` - Managed startup commands
- `label`, `type` - Service configuration

**Private vs Public Access:**
- **Private (default)**: Sites run in dev mode behind authentication. Only you can access them via the preview iframe in Zo. This is the normal development experience.
- **Public (published)**: Publishing creates a shareable URL that anyone on the internet can access without authentication.

To publish your site publicly, use the **Publish button** in the Zo UI or explicitly ask Zo to publish it (e.g., "publish this site", "make it public").

## Deployment

The site exports `{ fetch, port }` from `server.ts` for Zo's deployment system. The same code runs in both dev and production - mode is controlled by `NODE_ENV`.
