import { bumpLive, emptyLive, mergeItem, mergeProject } from "../js/merge.js";

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
      "Merge a price observation into an item. Unions history by date+retailer. Never deletes old prints. Pass id plus price/retailer or a full patch.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        price: { type: "number" },
        retailer: { type: "string" },
        url: { type: "string" },
        inStock: { type: "boolean" },
        notes: { type: "string" },
        observedAt: { type: "string" },
        targetPrice: { type: "number" },
        status: { type: "string" },
        why: { type: "string" },
        currentBest: { type: "object" },
        priceHistory: { type: "array" },
        log: { type: "array" },
      },
      required: ["id"],
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
    description: "Hide a Price Pirate item from the deck. History stays.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];

const memory = new Map();

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
  const raw = env.VAULT ? await env.VAULT.get(KEY) : memory.get(KEY);
  if (!raw) return emptyLive();
  try {
    return { ...emptyLive(), ...JSON.parse(raw) };
  } catch {
    return emptyLive();
  }
}

async function saveLive(env, live) {
  const next = bumpLive(live);
  const text = JSON.stringify(next);
  if (env.VAULT) await env.VAULT.put(KEY, text);
  else memory.set(KEY, text);
  return next;
}

async function fetchBay(env, bayId) {
  const base = (env.PAGES_BASE || "https://boorussia.github.io/mindkeep").replace(/\/$/, "");
  const res = await fetch(`${base}/data/bays/${bayId}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not load ${bayId} from ${base}`);
  return res.json();
}

function applyItemPatch(args) {
  const id = args.id;
  const observedAt = args.observedAt || new Date().toISOString();
  const patch = { id };
  if (args.status) patch.status = args.status;
  if (args.why) patch.why = args.why;
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

async function callTool(name, args, env) {
  const live = await loadLive(env);
  args = args || {};

  if (name === "get_queue") {
    const pirate = await fetchBay(env, "pirate").catch(() => null);
    const ship = await fetchBay(env, "shipyard").catch(() => null);
    const mail = await fetchBay(env, "mailbag").catch(() => null);
    const items = [...(pirate?.payload?.items || [])].map((it) => mergeItem(it, live.items[it.id] || {}));
    for (const it of items) {
      if (live.targets[it.id] != null) it.targetPrice = live.targets[it.id];
    }
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
    const items = [...(pirate.payload?.items || [])].map((it) => {
      const merged = mergeItem(it, live.items[it.id] || {});
      if (live.targets[merged.id] != null) merged.targetPrice = live.targets[merged.id];
      return {
        id: merged.id,
        name: merged.name,
        price: merged.currentBest?.price,
        retailer: merged.currentBest?.retailer,
        target: merged.targetPrice,
        cadence: merged.cadence,
        status: merged.status,
        hidden: (live.removedIds || []).includes(merged.id),
      };
    });
    return { revision: live.revision, items };
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
    live.items[args.id] = mergeItem(live.items[args.id] || { id: args.id }, patch);
    if (args.targetPrice != null) live.targets[args.id] = args.targetPrice;
    const saved = await saveLive(env, live);
    return { revision: saved.revision, item: saved.items[args.id], target: saved.targets[args.id] };
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

  throw new Error(`Unknown tool ${name}`);
}

function mcpResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function mcpError(id, message, code = -32000) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMcp(body, env) {
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
      const data = await callTool(name, args, env);
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

export async function handleRequest(request, env = {}) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
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
    return json(await loadLive(env));
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
        const data = await callTool(name, body || {}, env);
        return json(data);
      } catch (err) {
        return json({ error: String(err.message || err) }, 400);
      }
    }
    const rpc = await handleMcp(body, env);
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
  fetch: (request, env) => handleRequest(request, env),
};
