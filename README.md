# MindKeep

A private static command deck. It holds the things that would otherwise live in scattered Grok chats: price hunts, GitHub projects across one or more accounts, and agent briefings such as email.

**MindKeep is the product name.** Price Pirate is one bay, not the product.

Pete writes Price Pirate. Rig writes Shipyard. Post writes Mailbag. This site does not scrape retailers or Gmail. It renders vault JSON that agents commit, or JSON you paste.

## Run it

Serve the folder over HTTP. `file://` will fail fetches.

```bash
python3 -m http.server 4173
# open http://127.0.0.1:4173
```

Hash routing (`#/pirate`, `#/shipyard/...`) is used so GitHub Pages works with no server rewrite.

Live: https://boorussia.github.io/mindkeep/

Claude deck prototype (same vault, live overlay, scoring): https://boorussia.github.io/mindkeep/redesign/

Bots do not paste JSON on a timer. Pete / Rig / Post call a MindKeep MCP (or `POST /v1/<tool>`) with a Bearer token. The public page only **reads** `overlay.json`. See `live/README.md`.

## Folder map

```
index.html
css/app.css
js/
  app.js          boot, hash router, paste overlay
  vault.js        load published JSON + localStorage overlay
  grades.js       deal grades, stats, lastTool inference
  format.js       money / time / escape
  theme.js        presets from data/theme.json
  field.js        three.js background field
  views.js        Today, Pirate, Shipyard, Mailbag, Dispatch, Data
data/
  manifest.json
  theme.json
  bays/pirate.json
  bays/shipyard.json
  bays/mailbag.json
  inbox/example-pete.json
scripts/gen-demo.py
```

## How to add a bay

1. Add a row to `data/manifest.json` (`id`, `title`, `operator`, `href`, `renderer`, `file`).
2. Add `data/bays/[id].json` wrapped as:

```json
{
  "schemaVersion": "1.0.0",
  "bayId": "new-bay",
  "updatedAt": "2026-08-28T12:00:00Z",
  "operator": "Pete",
  "status": "ok",
  "alerts": [{ "level": "info", "title": "", "body": "", "href": "" }],
  "payload": {}
}
```

If `renderer` is not `pirate`, `shipyard`, or `mailbag`, the generic briefing list is used.

## Price Pirate command center

- Recurring watches (`daily` / `weekly` / `biweekly`) sit above one-time checks (`manual` / `once`).
- Name opens the item. The spark under the price expands like an X cashtag chart. The tape has 1M / 3M / 6M / 1Y / 2Y / 5Y / ALL (and calendar years when the history spans them).
- Remove hides the item. With a bot write token on **Data**, that hide is written to the live overlay so every device sees it. Without the token it only hides in this browser. Restore on **Data**. History in `/data` is not deleted.
- Product cutouts: transparent PNGs in `assets/products/[id].png`. When Pete `merge_item`s a **new** watch, the Worker asks Grok Imagine for a transparent cutout if `XAI_API_KEY` is set (`npx wrangler secret put XAI_API_KEY`). No key? The dashboard still knocks out a studio backdrop in-browser when you drop a PNG — no Grok key needed for that path.
- Price target is the buy line. The brief says buy now / wait / retarget when the old ATL is dead (new gen, supply shock — RAM/AI is the pattern).
- When live price ≤ target, MindKeep writes a Pete ping (Today queue + optional desktop notification). Pete can also paste a `kind: "alert"` envelope. This site does not scrape stores.

## Inbox envelope

Drops live in `data/inbox/*.json` (committed samples) or are pasted in the UI. Paste writes `localStorage` key `mindkeep-vault-v1` and overlays the published vault. Merge matches item/repo id, unions price history by `date + retailer`, and never deletes old history.

```json
{
  "schemaVersion": "1.0.0",
  "agent": "Pete",
  "bayId": "pirate",
  "at": "2026-08-28T12:00:00Z",
  "kind": "merge",
  "payload": {}
}
```

`agent`: Pete | Rig | Post  
`bayId`: pirate | shipyard | mailbag | today  
`kind`: merge | replace | alert

Reset the overlay on **Data**. Export dumps the merged vault.

## Theme tokens

All color is CSS variables, sourced from `data/theme.json`. Presets:

1. `default` — black + blue/pink
2. `paper` — off-white + same blue/pink
3. `dim` — same black, glow off

Choice is stored in `localStorage` (`mindkeep-prefs-v1`). Price down (good) is blue. Price up (bad) is pink. There is no green in the default theme.

## Effects

A full-viewport three.js canvas sits behind the HUD (`pointer-events: none`): faint floor grid, sparse dust, two low-intensity point lights (blue, pink) with a slow drift. Reduced-motion **or** the Data toggle turns it off.

## vgpu (optional later)

Not required to first-run. Official sources only:

- Install / repo: [https://vgpu.sh](https://vgpu.sh) · [https://github.com/vercel-labs/vgpu](https://github.com/vercel-labs/vgpu)
- `pnpm add vgpu`
- `npx vgpu docs`
- `npx vgpu examples pull <id> --out ./example`
- `npx skills add vercel-labs/vgpu`
- `npx -y add-mcp https://vgpu.sh/api/mcp -g`

Use only these examples if adding WebGPU later (tasteful light, not demos-as-product):

- Background wash: [https://vgpu.sh/examples/gradient](https://vgpu.sh/examples/gradient)
- Card / nav edge glow: [https://vgpu.sh/examples/triangle-led-hero](https://vgpu.sh/examples/triangle-led-hero)
- Wordmark / loader rim light: [https://vgpu.sh/examples/nextjs-logo-shader](https://vgpu.sh/examples/nextjs-logo-shader)
- Soft loading field: [https://vgpu.sh/examples/agent-radiance-cascades](https://vgpu.sh/examples/agent-radiance-cascades)
- Optional pointer light on a selected card: [https://vgpu.sh/examples/radiance-cascades](https://vgpu.sh/examples/radiance-cascades)
- If the canvas aliases: [https://vgpu.sh/examples/anti-aliasing](https://vgpu.sh/examples/anti-aliasing)

Do not ship: black hole, Earth, FFT ocean, fluids, 125k cubes, glass fractals.

## Do not commit tokens

No PATs, no Gmail OAuth, no retailer API keys. Optional live GitHub API (public repos only) is not wired. Never store a PAT in frontend source.
