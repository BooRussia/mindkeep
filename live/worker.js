import { bumpLive, emptyLive, mergeItem, mergeProject } from "../js/merge.js";
import { binSlug, defaultBinLabel, listBinsFromItems } from "../js/bins.js";

const KEY = "mindkeep-live-v1";

const TOOLS = [
  {
    name: "get_queue",
    description: "Today's attention queue: target hits, live pings, and published alerts from all bays.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "list_items",
    description: "Price Pirate watch list with live overlay applied. Compact.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_item",
    description: "One Price Pirate item after live overlay. Pete uses this before merge_item.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "merge_item",
    description:
      "Merge a price observation into an item. Unions history by date+retailer. Never deletes old prints. Pass id plus price/retailer or a full patch. Include bin (slug) when creating a watch.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Slug, e.g. lg-c5-65. Reused on every later check." },
        name: { type: "string", description: "Required when creating a new watch." },
        variant: { type: "string" },
        category: { type: "string" },
        cadence: { type: "string", enum: ["daily", "weekly", "biweekly", "manual"] },
        currency: { type: "string" },
        why: { type: "string", description: "Why this is being watched." },
        price: { type: "number" },
        retailer: { type: "string" },
        url: { type: "string" },
        inStock: { type: "boolean" },
        notes: { type: "string" },
        observedAt: { type: "string" },
        targetPrice: { type: "number" },
        status: { type: "string" },
        productUrls: {
          type: "array",
          description: "[{retailer, url}] — every storefront to check on later runs.",
          items: {
            type: "object",
            properties: { retailer: { type: "string" }, url: { type: "string" } },
          },
        },
        saleEvents: {
          type: "array",
          description:
            "Historic sale prints: [{type: black_friday|cyber_monday|prime_day, name, year, price, retailer, notes}]. Backfill these so the deck can answer wait-or-buy.",
          items: { type: "object" },
        },
        allTimeLow: { type: "object" },
        allTimeHigh: { type: "object" },
        identifiers: { type: "object", description: "{asin, upc, model, sku}" },
        currentBest: { type: "object" },
        priceHistory: { type: "array" },
        log: { type: "array" },
        bin: {
          type: "string",
          description:
            "Cargo bin slug, lowercase kebab-case. One per watch. Reuse a slug from list_bins, or pick daily, home, compute, range, drone, audio, kitchen. Empty/missing → unsorted.",
        },
        binLabel: { type: "string", description: "Display name for the bin. Optional; the deck titles the slug if omitted." },
      },
      required: ["id"],
    },
  },
  {
    name: "list_bins",
    description:
      "Named Price Pirate cargo bins after the live overlay. Excludes removed watches. Pete reuses these slugs on merge_item / set_bin.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "set_bin",
    description:
      "Move a watch into a named bin. Creates the bin if the slug is new. History stays. Required: id + bin.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        bin: {
          type: "string",
          description: "Slug, lowercase kebab-case. Reuse list_bins or pick daily, home, compute, range, drone, audio, kitchen.",
        },
        binLabel: { type: "string", description: "Display name. Optional." },
      },
      required: ["id", "bin"],
    },
  },
  {
    name: "set_target",
    description: "Set the watch target for an item. This is the buy line Pete pings on.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        targetPrice: { type: "number" },
      },
      required: ["id", "targetPrice"],
    },
  },
  {
    name: "ping",
    description: "Push a now-alert onto the deck (target hit, needs you, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        href: { type: "string" },
        level: { type: "string", enum: ["now", "soon", "info"] },
        itemId: { type: "string" },
      },
      required: ["title"],
    },
  },
  {
    name: "get_repo",
    description: "One Shipyard project after live overlay.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "merge_watch",
    description: "Update a Shipyard project's LAST WATCH. Rig uses this.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        lastBriefing: { type: "string" },
        needsMe: { type: "boolean" },
        status: { type: "string" },
        nextAction: { type: "string" },
        lastTool: { type: "string" },
        lastToolEvidence: { type: "string" },
        lastCommit: { type: "object" },
      },
      required: ["id"],
    },
  },
  {
    name: "post_briefing",
    description: "Add or update a Mailbag briefing. Post uses this. No Gmail API.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        subject: { type: "string" },
        bullets: { type: "array", items: { type: "string" } },
        severity: { type: "string" },
        needsReply: { type: "boolean" },
        source: { type: "string" },
        body: { type: "string" },
        threadCount: { type: "number" },
        at: { type: "string" },
      },
      required: ["id", "subject"],
    },
  },
  {
    name: "remove_item",
    description: "Hide a Price Pirate item from the deck on the live overlay so every client sees it gone. History stays.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "restore_item",
    description: "Un-hide a Price Pirate item previously passed to remove_item.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "ensure_cutout",
    description:
      "Generate a product PNG via Grok Imagine and publish it at /cutout/<id>.png. Safe to call on every watch, including ones that already exist. Pass name + variant so Imagine has facts even if the item is not in pirate.json yet. Needs XAI_API_KEY on the Worker. Never pass a retailer CDN as the display image — those 403 in the browser.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string", description: "Product name. Pete should pass this every time." },
        variant: { type: "string" },
        prompt: { type: "string", description: "Optional Imagine prompt override." },
        force: { type: "boolean", description: "Regenerate even if a cutout already exists." },
      },
      required: ["id"],
    },
  },
];

const memory = new Map();
const cutoutMem = new Map();

async function putCutout(env, id, bytes, type = "image/png") {
  if (env.VAULT) await env.VAULT.put(`cutout:${id}`, bytes);
  else cutoutMem.set(id, { bytes, type });
}

async function getCutout(env, id) {
  if (env.VAULT) {
    const buf = await env.VAULT.get(`cutout:${id}`, { type: "arrayBuffer" });
    if (!buf) return null;
    return { bytes: buf, type: "image/png" };
  }
  return cutoutMem.get(id) || null;
}

function cutoutPublicUrl(origin, id) {
  return `${origin.replace(/\/$/, "")}/cutout/${encodeURIComponent(id)}.png`;
}

function usableThumb(url) {
  const s = String(url || "");
  if (!s) return false;
  if (s.startsWith("data:image/")) return true;
  if (s.includes("/cutout/")) return true;
  if (s.startsWith("./") || s.startsWith("assets/")) return true;
  return false;
}

async function fetchImageBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`image fetch ${res.status}`);
  const type = res.headers.get("content-type") || "image/png";
  const bytes = await res.arrayBuffer();
  return { bytes, type };
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/**
 * Grok Imagine: studio product shot on black (matches the dark deck).
 * If the item already has an official photo URL, edit that instead of generating.
 * Requires Worker secret XAI_API_KEY.
 *   npx wrangler secret put XAI_API_KEY
 */
async function imagineCutout(env, item) {
  const key = env.XAI_API_KEY;
  if (!key) return { skipped: "no-xai-key" };
  const model = env.XAI_IMAGE_MODEL || "grok-imagine-image-2.0";
  const name = item.name || item.id;
  const variant = item.variant ? `, ${item.variant}` : "";
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const prompt =
    item.imaginePrompt ||
    `Professional studio product photograph of ${name}${variant}. Single product only, three-quarter view, even soft lighting, solid pure black backdrop, no floor, no shadow, no text overlay, no watermark, no props, no people.`;

  const official = item.imageUrl;
  if (official && /^https?:\/\//i.test(official) && !official.includes("/cutout/")) {
    try {
      const editRes = await fetch("https://api.x.ai/v1/images/edits", {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          prompt:
            "Place this exact product on a solid pure black background. Keep the product unchanged. No floor, no shadow, no extra props, no watermark.",
          image: { url: official, type: "image_url" },
        }),
      });
      if (editRes.ok) {
        const editJson = await editRes.json();
        const edit = editJson.data?.[0] || editJson;
        const src = edit.url || (edit.b64_json ? `data:image/png;base64,${edit.b64_json}` : null);
        if (src) {
          if (src.startsWith("data:")) {
            const b64 = src.split(",")[1] || "";
            return { bytes: b64ToBytes(b64), type: "image/png", source: "imagine-edit" };
          }
          const fetched = await fetchImageBytes(src);
          return { ...fetched, source: "imagine-edit" };
        }
      }
    } catch {
      /* fall through to generate */
    }
  }

  const genRes = await fetch("https://api.x.ai/v1/images/generations", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      prompt,
      n: 1,
    }),
  });
  if (!genRes.ok) {
    const err = await genRes.text();
    throw new Error(`Imagine generate failed (${genRes.status}): ${err.slice(0, 240)}`);
  }
  const genJson = await genRes.json();
  const gen = genJson.data?.[0] || genJson;
  const src = gen.url || (gen.b64_json ? `data:image/png;base64,${gen.b64_json}` : null);
  if (!src) throw new Error("Imagine generate returned no image");

  let finalUrl = src;
  try {
    const editRes = await fetch("https://api.x.ai/v1/images/edits", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        prompt:
          "Place this exact product on a solid pure black background. Keep the product unchanged. No floor, no shadow, no extra props, no watermark.",
        image: { url: src, type: "image_url" },
      }),
    });
    if (editRes.ok) {
      const editJson = await editRes.json();
      const edit = editJson.data?.[0] || editJson;
      if (edit.url) finalUrl = edit.url;
      else if (edit.b64_json) finalUrl = `data:image/png;base64,${edit.b64_json}`;
    }
  } catch {
    /* keep the studio shot; the deck's built-in knockout will finish it */
  }

  if (finalUrl.startsWith("data:")) {
    const b64 = finalUrl.split(",")[1] || "";
    return { bytes: b64ToBytes(b64), type: "image/png", source: "imagine" };
  }
  const fetched = await fetchImageBytes(finalUrl);
  return { ...fetched, source: "imagine" };
}

async function ensureItemCutout(env, id, origin, { force = false, name, variant, prompt } = {}) {
  if (!force) {
    const existing = await getCutout(env, id);
    if (existing) return { id, imageUrl: cutoutPublicUrl(origin, id), existed: true };
  }
  const live = await loadLive(env);
  const pirate = await fetchBay(env, "pirate").catch(() => null);
  const published = (pirate?.payload?.items || []).find((it) => it.id === id) || { id };
  const extras = {};
  if (name) extras.name = name;
  if (variant) extras.variant = variant;
  if (prompt) extras.imaginePrompt = prompt;
  if (Object.keys(extras).length) {
    live.items[id] = mergeItem(live.items[id] || { id }, extras);
    await saveLive(env, live);
  }
  const item = mergeItem(published, live.items[id] || {});
  const result = await imagineCutout(env, item);
  if (result.skipped) {
    live.items[id] = mergeItem(live.items[id] || { id }, { needsCutout: true });
    await saveLive(env, live);
    return { id, skipped: result.skipped, needsCutout: true };
  }
  await putCutout(env, id, result.bytes, result.type);
  const imageUrl = cutoutPublicUrl(origin, id);
  live.items[id] = mergeItem(live.items[id] || { id }, {
    id,
    imageUrl,
    imageSource: "imagine",
    needsCutout: false,
  });
  await saveLive(env, live);
  return { id, imageUrl, generated: true };
}

async function backfillMissingCutouts(env, origin) {
  if (!env.XAI_API_KEY) return;
  const live = await loadLive(env);
  const pirate = await fetchBay(env, "pirate").catch(() => null);
  const items = mergedItems(pirate, live);
  const removed = new Set(live.removedIds || []);
  const attempted = { ...(live.cutoutAttempted || {}) };
  const jobs = [];
  for (const it of items) {
    if (!it?.id || removed.has(it.id)) continue;
    if (usableThumb(it.imageUrl)) continue;
    const last = Number(attempted[it.id] || 0);
    if (last && Date.now() - last < 30 * 60 * 1000) continue;
    const existing = await getCutout(env, it.id);
    if (existing) continue;
    jobs.push(it);
    if (jobs.length >= 3) break;
  }
  if (!jobs.length) return;
  live.cutoutAttempted = attempted;
  for (const it of jobs) live.cutoutAttempted[it.id] = Date.now();
  await saveLive(env, live);
  for (const it of jobs) {
    await ensureItemCutout(env, it.id, origin, { name: it.name, variant: it.variant }).catch(() => null);
  }
}

function cors(headers = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Accept",
    ...headers,
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: cors({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }),
  });
}

function authorized(request, env) {
  const token = env.BOT_TOKEN || "";
  if (!token) return false;
  const header = request.headers.get("Authorization") || "";
  const got = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return Boolean(got) && got === token;
}

async function loadLive(env) {
  try {
    const raw = env.VAULT ? await env.VAULT.get(KEY) : memory.get(KEY);
    if (!raw) return emptyLive();
    return { ...emptyLive(), ...JSON.parse(raw) };
  } catch {
    return emptyLive();
  }
}

async function saveLive(env, live) {
  const next = bumpLive(live);
  const text = JSON.stringify(next);
  try {
    if (env.VAULT) await env.VAULT.put(KEY, text);
    else memory.set(KEY, text);
  } catch {
    memory.set(KEY, text);
  }
  return next;
}

async function fetchBay(env, bayId) {
  const base = (env.PAGES_BASE || "https://boorussia.github.io/mindkeep").replace(/\/$/, "");
  const res = await fetch(`${base}/data/bays/${bayId}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${bayId} from ${base}`);
  return res.json();
}

// identity/metadata a bot must be able to set when it creates a watch.
// These used to be dropped silently, so a bot could only ever make a nameless row.
const ITEM_FIELDS = [
  "name",
  "variant",
  "category",
  "cadence",
  "currency",
  "status",
  "why",
  "productUrls",
  "saleEvents",
  "allTimeLow",
  "allTimeHigh",
  "identifiers",
  "bin",
  "binLabel",
];

/**
 * The published vault UNION anything that only exists in the live overlay.
 * Iterating just the published items meant a watch a bot created over MCP was
 * invisible to get_queue / list_items — so its target hits never fired and the
 * bot could not find its own item on the next run.
 */
function mergedItems(pirate, live) {
  const published = pirate?.payload?.items || [];
  const seen = new Set(published.map((it) => it.id));
  const out = published.map((it) => mergeItem(it, live.items[it.id] || {}));
  for (const [id, patch] of Object.entries(live.items || {})) {
    if (!seen.has(id)) out.push(mergeItem({ id }, patch));
  }
  for (const it of out) {
    if (live.targets[it.id] != null) it.targetPrice = Number(live.targets[it.id]);
  }
  return out;
}

function applyItemPatch(args) {
  const id = args.id;
  const observedAt = args.observedAt || new Date().toISOString();
  const patch = { id };
  for (const key of ITEM_FIELDS) {
    if (args[key] != null) patch[key] = args[key];
  }
  if (patch.bin != null) patch.bin = binSlug(patch.bin);
  if (patch.binLabel != null) {
    const label = String(patch.binLabel).trim();
    if (label) patch.binLabel = label;
    else delete patch.binLabel;
  }
  if (args.targetPrice != null) patch.targetPrice = args.targetPrice;
  if (args.currentBest) patch.currentBest = args.currentBest;
  if (args.priceHistory) patch.priceHistory = args.priceHistory;
  if (args.log) patch.log = args.log;
  if (args.price != null && args.retailer) {
    patch.currentBest = {
      price: args.price,
      retailer: args.retailer,
      url: args.url || "",
      inStock: args.inStock !== false,
      observedAt,
      notes: args.notes || "",
    };
    patch.priceHistory = [
      ...(patch.priceHistory || []),
      { date: observedAt, price: args.price, retailer: args.retailer, source: "agent" },
    ];
    patch.log = [
      ...(patch.log || []),
      {
        at: observedAt,
        actor: "pete",
        kind: "check",
        text: `${args.retailer} ${args.price}${args.notes ? ` — ${args.notes}` : ""}`,
      },
    ];
  }
  return patch;
}

async function callTool(name, args, env, ctx = null, origin = "") {
  const live = await loadLive(env);
  args = args || {};
  const workerOrigin = origin || env.PUBLIC_BASE || "";

  if (name === "get_queue") {
    const pirate = await fetchBay(env, "pirate").catch(() => null);
    const ship = await fetchBay(env, "shipyard").catch(() => null);
    const mail = await fetchBay(env, "mailbag").catch(() => null);
    const removed = new Set(live.removedIds || []);
    const items = mergedItems(pirate, live).filter((it) => !removed.has(it.id));
    const hits = items
      .filter((it) => it.targetPrice != null && it.currentBest?.price <= it.targetPrice)
      .map((it) => ({
        id: it.id,
        name: it.name,
        price: it.currentBest?.price,
        retailer: it.currentBest?.retailer,
        target: it.targetPrice,
      }));
    const alerts = [
      ...(live.pings || []).map((p) => ({ ...p, source: "live" })),
      ...(pirate?.alerts || []),
      ...(ship?.alerts || []),
      ...(mail?.alerts || []),
    ];
    return { revision: live.revision, updatedAt: live.updatedAt, hits, alerts: alerts.slice(0, 20) };
  }

  if (name === "list_items") {
    const pirate = await fetchBay(env, "pirate").catch(() => ({ payload: { items: [] } }));
    const items = mergedItems(pirate, live).map((merged) => {
      const bin = binSlug(merged.bin);
      return {
        id: merged.id,
        name: merged.name,
        price: merged.currentBest?.price,
        retailer: merged.currentBest?.retailer,
        target: merged.targetPrice,
        cadence: merged.cadence,
        status: merged.status,
        bin,
        binLabel: merged.binLabel || defaultBinLabel(bin),
        hidden: (live.removedIds || []).includes(merged.id),
      };
    });
    return { revision: live.revision, items };
  }

  if (name === "list_bins") {
    const pirate = await fetchBay(env, "pirate").catch(() => ({ payload: { items: [] } }));
    const removed = new Set(live.removedIds || []);
    const items = mergedItems(pirate, live).filter((it) => !removed.has(it.id));
    return { revision: live.revision, bins: listBinsFromItems(items) };
  }

  if (name === "set_bin") {
    if (!args.id || args.bin == null || String(args.bin).trim() === "") throw new Error("id and bin required");
    const bin = binSlug(args.bin);
    const patch = { id: args.id, bin };
    if (args.binLabel != null && String(args.binLabel).trim()) patch.binLabel = String(args.binLabel).trim();
    live.items[args.id] = mergeItem(live.items[args.id] || { id: args.id }, patch);
    const saved = await saveLive(env, live);
    return { revision: saved.revision, item: saved.items[args.id] };
  }

  if (name === "get_item") {
    if (!args.id) throw new Error("id required");
    const pirate = await fetchBay(env, "pirate");
    const base = (pirate.payload?.items || []).find((it) => it.id === args.id) || { id: args.id };
    const item = mergeItem(base, live.items[args.id] || {});
    if (live.targets[args.id] != null) item.targetPrice = live.targets[args.id];
    return { revision: live.revision, item };
  }

  if (name === "merge_item") {
    if (!args.id) throw new Error("id required");
    const patch = applyItemPatch(args);
    const isNewToOverlay = !live.items[args.id];
    const publishedHas = await fetchBay(env, "pirate")
      .then((b) => (b.payload?.items || []).some((it) => it.id === args.id))
      .catch(() => true);
    const isBrandNew = isNewToOverlay && !publishedHas;
    live.items[args.id] = mergeItem(live.items[args.id] || { id: args.id }, patch);
    if (args.targetPrice != null) live.targets[args.id] = args.targetPrice;
    const mergedNow = live.items[args.id];
    const existingCutout = await getCutout(env, args.id);
    if (existingCutout && workerOrigin) {
      mergedNow.imageUrl = cutoutPublicUrl(workerOrigin, args.id);
      mergedNow.imageSource = "imagine";
      mergedNow.needsCutout = false;
    }
    const lastTry = Number((live.cutoutAttempted || {})[args.id] || 0);
    const recentlyTried = lastTry && Date.now() - lastTry < 30 * 60 * 1000;
    const needsThumb = !usableThumb(mergedNow.imageUrl) && !existingCutout;
    if (needsThumb) mergedNow.needsCutout = true;
    if (needsThumb && !recentlyTried) {
      live.cutoutAttempted = { ...(live.cutoutAttempted || {}), [args.id]: Date.now() };
    }
    const saved = await saveLive(env, live);

    // A watch with no name renders as a blank row. Tell the agent rather than
    // accepting it silently — but never fail the write over it.
    let warning;
    if (isBrandNew && !args.name && !saved.items[args.id].name) {
      warning = `No item "${args.id}" exists yet and no name was given, so it will render as a blank row. Call merge_item again with name (and ideally variant, category, cadence, productUrls).`;
    }
    if (isBrandNew && !args.bin) {
      const binNote = `No bin given — landed in "unsorted". Call set_bin or merge_item with a bin slug (list_bins to reuse one).`;
      warning = warning ? `${warning} ${binNote}` : binNote;
    }

    let cutout = null;
    if (needsThumb && !recentlyTried && workerOrigin) {
      const run = () =>
        ensureItemCutout(env, args.id, workerOrigin, {
          name: saved.items[args.id]?.name,
          variant: saved.items[args.id]?.variant,
        }).catch((err) => ({ error: String(err.message || err) }));
      if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(run());
      else cutout = await run();
    }

    return {
      revision: saved.revision,
      item: saved.items[args.id],
      target: saved.targets[args.id],
      ...(warning ? { warning } : {}),
      ...(cutout ? { cutout } : {}),
      ...(needsThumb && !cutout
        ? { cutoutQueued: Boolean(env.XAI_API_KEY), needsXaiKey: !env.XAI_API_KEY }
        : {}),
    };
  }

  if (name === "set_target") {
    if (!args.id || args.targetPrice == null) throw new Error("id and targetPrice required");
    live.targets[args.id] = Number(args.targetPrice);
    if (!live.items[args.id]) live.items[args.id] = { id: args.id };
    live.items[args.id].targetPrice = Number(args.targetPrice);
    const saved = await saveLive(env, live);
    return { revision: saved.revision, id: args.id, targetPrice: saved.targets[args.id] };
  }

  if (name === "ping") {
    const ping = {
      id: `ping-${Date.now()}`,
      at: new Date().toISOString(),
      title: args.title,
      body: args.body || "",
      href: args.href || (args.itemId ? `#/pirate/${args.itemId}` : "#/"),
      level: args.level || "now",
      itemId: args.itemId || "",
    };
    live.pings = [ping, ...(live.pings || [])].slice(0, 40);
    live.alerts = [
      { level: ping.level, title: ping.title, body: ping.body, href: ping.href },
      ...(live.alerts || []),
    ].slice(0, 40);
    const saved = await saveLive(env, live);
    return { revision: saved.revision, ping };
  }

  if (name === "get_repo") {
    if (!args.id) throw new Error("id required");
    const ship = await fetchBay(env, "shipyard");
    let found = null;
    for (const acc of ship.payload?.accounts || []) {
      found = (acc.projects || []).find((p) => p.id === args.id);
      if (found) break;
    }
    const project = mergeProject(found || { id: args.id }, live.projects[args.id] || {});
    return { revision: live.revision, project };
  }

  if (name === "merge_watch") {
    if (!args.id) throw new Error("id required");
    const { id, ...rest } = args;
    live.projects[id] = mergeProject(live.projects[id] || { id }, rest);
    const saved = await saveLive(env, live);
    return { revision: saved.revision, project: saved.projects[id] };
  }

  if (name === "post_briefing") {
    const id = args.id;
    live.briefings[id] = {
      ...(live.briefings[id] || {}),
      ...args,
      operator: "Post",
      at: args.at || new Date().toISOString(),
    };
    const saved = await saveLive(env, live);
    return { revision: saved.revision, briefing: saved.briefings[id] };
  }

  if (name === "remove_item") {
    if (!args.id) throw new Error("id required");
    live.removedIds = [...new Set([...(live.removedIds || []), args.id])];
    const saved = await saveLive(env, live);
    return { revision: saved.revision, removedIds: saved.removedIds };
  }

  if (name === "restore_item") {
    if (!args.id) throw new Error("id required");
    live.removedIds = (live.removedIds || []).filter((id) => id !== args.id);
    const saved = await saveLive(env, live);
    return { revision: saved.revision, removedIds: saved.removedIds };
  }

  if (name === "ensure_cutout") {
    if (!args.id) throw new Error("id required");
    if (!workerOrigin) throw new Error("Worker origin unknown — cannot mint a public cutout URL.");
    return ensureItemCutout(env, args.id, workerOrigin, {
      force: Boolean(args.force),
      name: args.name,
      variant: args.variant,
      prompt: args.prompt,
    });
  }

  throw new Error(`Unknown tool ${name}`);
}

function mcpResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function mcpError(id, message, code = -32000) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMcp(body, env, ctx = null, origin = "") {
  const method = body?.method;
  const id = body?.id ?? null;
  if (method === "initialize") {
    return mcpResult(id, {
      protocolVersion: "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "mindkeep-live", version: "1.0.0" },
    });
  }
  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }
  if (method === "ping") {
    return mcpResult(id, {});
  }
  if (method === "tools/list") {
    return mcpResult(id, { tools: TOOLS });
  }
  if (method === "tools/call") {
    const name = body.params?.name;
    const args = body.params?.arguments || {};
    try {
      const data = await callTool(name, args, env, ctx, origin);
      return mcpResult(id, {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        structuredContent: data,
      });
    } catch (err) {
      return mcpResult(id, {
        content: [{ type: "text", text: String(err.message || err) }],
        isError: true,
      });
    }
  }
  return mcpError(id, `Unknown method ${method}`, -32601);
}

export async function handleRequest(request, env = {}, ctx = null) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }

  const cutoutMatch = url.pathname.match(/^\/cutout\/([^/]+?)(?:\.png)?$/);
  if (request.method === "GET" && cutoutMatch) {
    const id = decodeURIComponent(cutoutMatch[1]);
    const hit = await getCutout(env, id);
    if (!hit) return json({ error: "No cutout" }, 404);
    return new Response(hit.bytes, {
      status: 200,
      headers: cors({
        "Content-Type": hit.type || "image/png",
        "Cache-Control": "public, max-age=86400",
      }),
    });
  }

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    const live = await loadLive(env);
    return json({
      ok: true,
      name: "mindkeep-live",
      revision: live.revision,
      updatedAt: live.updatedAt,
      overlay: "/overlay.json",
      mcp: "/mcp",
    });
  }

  if (request.method === "GET" && (url.pathname === "/overlay.json" || url.pathname === "/overlay")) {
    try {
      if (ctx && typeof ctx.waitUntil === "function" && env.XAI_API_KEY) {
        ctx.waitUntil(backfillMissingCutouts(env, url.origin).catch(() => null));
      }
      return json(await loadLive(env));
    } catch (err) {
      return json({ ...emptyLive(), error: String(err.message || err) }, 200);
    }
  }

  const writePath =
    url.pathname === "/mcp" ||
    url.pathname.startsWith("/v1/") ||
    url.pathname === "/rpc";
  if (request.method === "POST" && writePath) {
    if (!authorized(request, env)) {
      return json({ error: "Unauthorized. Bot token required." }, 401);
    }
    const body = await request.json().catch(() => null);
    if (url.pathname.startsWith("/v1/")) {
      const name = url.pathname.replace("/v1/", "");
      try {
        const data = await callTool(name, body || {}, env, ctx, url.origin);
        return json(data);
      } catch (err) {
        return json({ error: String(err.message || err) }, 400);
      }
    }
    const rpc = await handleMcp(body, env, ctx, url.origin);
    if (rpc == null) return new Response(null, { status: 202, headers: cors() });
    const accept = request.headers.get("Accept") || "";
    if (accept.includes("text/event-stream")) {
      const sse = `event: message\ndata: ${JSON.stringify(rpc)}\n\n`;
      return new Response(sse, {
        status: 200,
        headers: cors({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }),
      });
    }
    return json(rpc);
  }

  return json({ error: "Not found" }, 404);
}

export default {
  fetch: (request, env, ctx) => handleRequest(request, env, ctx),
};
