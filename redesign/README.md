# MindKeep — deck (redesign prototype)

A working alternate front end for MindKeep. Open it at `/redesign/` next to the live app
and A/B them.

```bash
python3 -m http.server 4173 --bind 127.0.0.1
# app       http://127.0.0.1:4173/
# redesign  http://127.0.0.1:4173/redesign/
```

Nothing is mocked. It reads the same `../data/*.json`, polls the same `overlay.json`, and
imports the real scoring out of `../js/` — `grades.js`, `brief.js`, `format.js`. Whatever
`buildBrief()` decides here is what the app decides. Anything in this folder can be lifted
into the app without porting logic.

## The design law

**Gray is normal. Color is signal.**

Chrome — nav, borders, buttons, labels, cards, the wordmark — is grayscale, always. There
is no blue primary button, no glowing nav underline, no accent-colored heading. Blue and
pink are spent only where data moved:

| Signal | Where |
|---|---|
| Blue | price falling, at/under target, buy verdict, chart line + buy zone, live pulse |
| Pink | price rising, blocked repo, retarget verdict, needs-reply mail, alert tick |
| Everything else | gray |

That's the ISA-101 / flight-deck convention: pre-attentive "pop" only works if color is
rare. Spending blue on a nav underline is spending your alarm budget on furniture.

Every state is coded in **two channels minimum** — never color alone. A blocked repo is a
pink tick *and* the word `BLOCKED`. A buy is a blue chip *and* the words `BUY NOW`. It
survives colorblindness and a grayscale screenshot.

## What's new here

- **Verdict on every row.** `buildBrief().call` — buy / good / hold / retarget / need data
  — already existed but only appeared on the detail page. It's the most useful computed
  field in the app, so it's now on the list, the deck, and the command palette.
- **Target meter.** A rail per item: shaded buy zone, white tick at your target, glowing
  dot at today's price, and the signed gap (`−$30`, `+$297`, `at line`). No arithmetic.
- **Seasonal call that answers the question.** Instead of listing past Black Friday prints,
  it says *"Hold for Black Friday — 90 days out. Last BF printed $1,096, 27% under today."*
  It forecasts from the **most recent** print, not the all-time low, and says so when the
  floor has drifted up — so it can't contradict a `retarget` brief.
- **Chart as the neon showpiece.** Custom SVG drawn at real pixel size (no viewBox squash):
  buy-zone gradient under the target line, dashed target, dotted floor, sale-event diamonds
  on their true calendar dates, glowing price line, hover crosshair. Time range is a
  dropdown + pills (1M through ALL, plus calendar years).
- **Retailers sorted by price** with the cheapest marked and the rest shown as `+$x over`.
- **Agents page replaces Dispatch.** MCP endpoint, connection state, copy-the-Grok-command,
  a paste-a-URL box that writes the instruction for your bot, the tool list, and a live
  write feed. JSON paste is demoted to a collapsed fallback.
- **Telemetry strip.** Always-on status line: wire state, revision, watch count, at-target,
  repos needing you, replies, last write. One settle-flash when an agent writes — never a
  strobe (WCAG 2.3.1).
- **⌘K palette** over items, repos, mail and commands.
- **Mobile that works.** Header no longer overflows; all five sections in the bottom dock;
  the price table collapses to a real card (~190px tall instead of ~750px).

## Accessibility

Verified in-browser, not assumed:

- Text: `--text` 19.5:1, `--dim` 7.3:1, `--dimmer` 4.8:1, blue 7.4:1, pink 6.7:1 — all pass
  AA on both `--bg` and `--surface`.
- Interactive borders use `--line-ctl` at 3.17:1, meeting WCAG 1.4.11 for UI components.
  `--line-2` stays low-contrast because it is decorative hairline only.
- Focus ring is 2px `--text` (19.5:1) at 2px offset.
- Touch targets go to 44px under `@media (pointer: coarse)`.
- Inputs are 16px so iOS doesn't zoom on focus.
- Palette is a `listbox` with arrow-key + Enter + Esc; overlays close on Esc.
- `prefers-reduced-motion` kills all animation.

## Not carried over

- **Themes.** The app has `default` / `paper` / `dim` presets from `data/theme.json`. This
  prototype is dark-only. The tokens are all in `:root` in `deck.css`, so wiring the
  presets back in is a token swap, not a rewrite.
- **The three.js field.** Deliberately dropped — the telemetry strip and the chart carry
  the "this thing is alive" job now, at no framerate cost.
- **Remove-item / PNG import.** Remove writes `removed` locally and, when a bot token is
  saved, calls `remove_item` on the live overlay so the hide survives a refresh on every
  device. PNG import still lives on the original app (`/` item page).

## Files

```
redesign/
  index.html   shell: header, telemetry strip, dock, palette, sheet
  deck.css     tokens + every component
  deck.js      loader, derived intelligence, views, chart, router
```

`deck.js` imports `../js/format.js`, `../js/grades.js`, `../js/brief.js` — unmodified.
