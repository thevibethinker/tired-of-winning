---
created: 2026-11-03
last_edited: 2026-11-03
version: 1.0
provenance: con_47LNC7Xg2RhZRrRT (critique skill, before implementing C)
---
# Critique: mockup A (screenprint) vs C (sticker bomb), 360×780

Decision (V, Nov 3): build C, borrow A's seat bar and short ladder labels, event-driven motion only.

## Measurements (360×780, bottom nav covers y ≥ ~705–720)

| | Current live | A | C |
|---|---|---|---|
| Senate seat count on first screen | No (board starts y=745) | Yes | Yes |
| Level ladder | 1 row, visible | 1 row, under nav | 2 rows (74px), 2nd row under nav |
| First race top | 1711 | 873 (mock, no House/scorecard/controls) | 815 (mock, same omissions) |
| Race card height | 178 | 120 | 143 |
| Horizontal overflow | 0 | 13px | 0 |
| Called marker | text + left rule | stamp, legible | star clips "civicAPI" text |

## Anti-patterns verdict
Both pass: specific parody concept, campaign ephemera, no gradients, glass or glow. Two tells to remove in C: the 52/41/7 button trio is the hero-metric template unless it is tied to the 51-seat threshold, and the slap-in uses overshoot (bounce) easing.

## Priority issues for the C build
1. **The hero hides the answer on small phones.** Compress the bumper and buttons so the ticket stub, level, Senate seats, the 51 bar and the ladder all clear the nav at 360×780. (arrange)
2. **The ladder wraps.** Use one fixed six-column strip with short labels; the current level is the only large, tilted sticker. (typeset, arrange)
3. **The seat buttons are decoration without the threshold.** Put A's seat bar with a labeled 51 marker directly under them. (clarify)
4. **The called star clips and celebrates GOP calls.** Star reads only "Called"; gold for our win, ink for a loss; the text status ("Called for Husted · civicAPI") remains the source of truth. (clarify, harden)
5. **Motion must not run for hours.** Slap-in once on load and when a race becomes called; no infinite wobble or spin; reduced-motion users get none. (animate)

## Minor
- The "9:42 LIVE" pin must say "Updated" and turn into "Delayed" when the feed is stale, and it doubles as refresh.
- Keep the ticket stub's state list (which polls close next); C dropped it.
- "GOP" at 9px on red fails contrast; use ≥12px.
- Keep race cards upright for scanning; tilt only the bumper, level sticker, current ladder step and call star.
