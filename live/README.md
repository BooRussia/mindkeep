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

## MCP (Grok CLI)

```bash
grok mcp add --transport http mindkeep http://127.0.0.1:8787/mcp \
  --header "Authorization: Bearer dev-bot-token"
```

For grok.com, deploy the Worker (public HTTPS) and add that `/mcp` URL instead. Localhost will not reach the website.

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
| `merge_item` | Pete | Price observation |
| `set_target` | Pete | Buy line |
| `ping` | Pete | Now-alert |
| `get_repo` | Rig | One project |
| `merge_watch` | Rig | LAST WATCH |
| `post_briefing` | Post | Mailbag |
| `remove_item` | Pete | Hide from deck |

REST is the same names under `/v1/<tool>`.

## Do not

- Put `BOT_TOKEN` in the Pages JS or this git repo
- Let a bot replace all of `pirate.json`
- Scrape stores from the Worker
