# MindKeep live overlay

Pete / Rig / Post talk to this Worker. The public dashboard **only reads**.

```
Bots  --Bearer token-->  POST /mcp  or  POST /v1/<tool>
Page  --no token------>  GET  /overlay.json   (poll ~4s)
```

Published JSON in `/data` is the snapshot. The overlay is the live wire. Merge still unions price history by date+retailer and never deletes old prints.

## Run locally

Need the Pages app on 4173 (so `get_item` can read the published vault):

```bash
python3 -m http.server 4173 --bind 127.0.0.1
node live/dev-server.mjs
```

- Overlay: http://127.0.0.1:8787/overlay.json
- Dev token: `dev-bot-token`
- On localhost the dashboard picks this overlay automatically.

Smoke a Pete write:

```bash
curl -s -X POST http://127.0.0.1:8787/v1/merge_item \
  -H 'Authorization: Bearer dev-bot-token' \
  -H 'Content-Type: application/json' \
  -d '{"id":"dyson-v15-detect-extra","price":419,"retailer":"Amazon","notes":"live ping test"}'
```

The Dyson card should move to $419 within a few seconds. No JSON paste.

## Attach (Pete / grok.com)

`mindkeep-live.boorussia.workers.dev` does **not** exist. Do not use it.

Public Worker (this is the URL Pete can reach):

- Overlay (read, no token): https://mindkeep-live.recent-satellite.workers.dev/overlay.json
- MCP (write): https://mindkeep-live.recent-satellite.workers.dev/mcp

```bash
grok mcp add --transport http mindkeep https://mindkeep-live.recent-satellite.workers.dev/mcp \
  --header "Authorization: Bearer <BOT_TOKEN>"
```

The token is the Wrangler `BOT_TOKEN` var on that Worker. It is not in git.

Localhost is only for a Grok CLI on this machine. grok.com cannot see `127.0.0.1`.

## MCP (Grok CLI on this computer)

```bash
grok mcp add --transport http mindkeep http://127.0.0.1:8787/mcp \
  --header "Authorization: Bearer dev-bot-token"
```

## Deploy to Cloudflare

```bash
npx wrangler login
npx wrangler kv namespace create VAULT
# paste the id into wrangler.toml
npx wrangler secret put BOT_TOKEN
npx wrangler deploy
```

Then on **Data**, save:

`https://mindkeep-live.<your-subdomain>.workers.dev/overlay.json`

Commit that URL into `data/live.json` `overlayUrl` if you want every visitor to poll it (the URL is public on purpose — it has no write key).

## Tools

| Tool | Agent | Purpose |
|---|---|---|
| `get_queue` | all | Hits + alerts |
| `list_items` | Pete | Compact watch list |
| `get_item` | Pete | One item + live overlay |
| `merge_item` | Pete | Price observation (`bin` / `binLabel` persist) |
| `list_bins` | Pete | Named cargo bins `{ id, label, count, itemIds }` |
| `set_bin` | Pete | Move a watch into a bin (creates the slug if new) |
| `set_target` | Pete | Buy line |
| `ping` | Pete | Now-alert |
| `get_repo` | Rig | One project |
| `merge_watch` | Rig | LAST WATCH |
| `post_briefing` | Post | Mailbag |
| `remove_item` | Pete | Hide from deck (persists on the overlay) |
| `restore_item` | Pete | Un-hide a removed watch |
| `ensure_cutout` | Pete | Generate a transparent product PNG via Grok Imagine |

REST is the same names under `/v1/<tool>`.

Bins are one kebab-case slug per watch (`daily`, `home`, `compute`, `range`, `drone`, `audio`, `kitchen`, or a new one). Missing → `unsorted`. Pete should `list_bins` before creating a watch, pass `bin` on `merge_item`, and `set_bin` to move one later. History is never deleted.

## Product cutouts (Grok Imagine)

When Pete `merge_item`s a **new** watch, the Worker queues a Grok Imagine job that generates a studio shot and edits it to a transparent PNG. The deck then loads `/cutout/<id>.png`.

This needs an xAI API key on the Worker — **not** in the Pages JS:

```bash
npx wrangler secret put XAI_API_KEY
# optional override, default grok-imagine-image-2.0
# npx wrangler secret put XAI_IMAGE_MODEL
```

Locally:

```bash
set XAI_API_KEY=xai-...
node live/dev-server.mjs
```

If the key is missing, the item is flagged `needsCutout`. The dashboard still knocks out a studio backdrop in-browser (no key) when you drop a PNG, so the page stays clean either way.

## Owner writes from the dashboard

Remove / restore / set-target in the UI only persist across devices if you paste the same `BOT_TOKEN` into **Data → Bot write token** (stored in this browser's localStorage). Without it, those actions stay local.

## Do not

- Put `BOT_TOKEN` in the Pages JS or this git repo
- Let a bot replace all of `pirate.json`
- Scrape stores from the Worker
