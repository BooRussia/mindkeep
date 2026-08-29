import { applyLiveOverlay, mergeMailbag, mergePirate, mergeShipyard } from "./merge.js";

const VAULT_KEY = "mindkeep-vault-v1";
const LIVE_CFG = "./data/live.json";

async function loadJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${path} (${res.status})`);
  return res.json();
}

function emptyOverlay() {
  return {
    drops: [],
    removedIds: [],
    targets: {},
    itemImages: {},
    bins: {},
    pings: [],
    notifiedTargets: {},
  };
}

export function readOverlay() {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (!raw) return emptyOverlay();
    const parsed = JSON.parse(raw);
    return { ...emptyOverlay(), ...parsed, drops: Array.isArray(parsed.drops) ? parsed.drops : [] };
  } catch {
    return emptyOverlay();
  }
}

export function patchOverlay(mutator) {
  const overlay = readOverlay();
  mutator(overlay);
  writeOverlay(overlay);
  return overlay;
}

export function writeOverlay(overlay) {
  localStorage.setItem(
    VAULT_KEY,
    JSON.stringify({ ...overlay, savedAt: new Date().toISOString() })
  );
}

export function resetOverlay() {
  localStorage.removeItem(VAULT_KEY);
}

export function validateEnvelope(raw) {
  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, error: "JSON is not parseable." };
    }
  }
  if (!data || typeof data !== "object") return { ok: false, error: "Envelope must be an object." };
  if (!data.schemaVersion) return { ok: false, error: "Missing schemaVersion." };
  if (!["Pete", "Rig", "Post"].includes(data.agent)) {
    return { ok: false, error: "agent must be Pete, Rig, or Post." };
  }
  if (!["pirate", "shipyard", "mailbag", "today"].includes(data.bayId)) {
    return { ok: false, error: "bayId must be pirate, shipyard, mailbag, or today." };
  }
  if (!data.at) return { ok: false, error: "Missing at (ISO-8601)." };
  if (!["merge", "replace", "alert"].includes(data.kind)) {
    return { ok: false, error: "kind must be merge, replace, or alert." };
  }
  if (data.kind !== "alert" && (data.payload == null || typeof data.payload !== "object")) {
    return { ok: false, error: "payload must be an object." };
  }
  return { ok: true, envelope: data };
}

export function applyEnvelope(bays, drop) {
  const bay = bays[drop.bayId];
  if (!bay) {
    if (drop.bayId === "today" && drop.kind === "alert") {
      bays.today = bays.today || {
        schemaVersion: "1.0.0",
        bayId: "today",
        operator: drop.agent,
        status: "ok",
        alerts: [],
        payload: {},
      };
      bays.today.alerts = [
        {
          level: drop.payload?.level || "info",
          title: drop.payload?.title || "Inbox alert",
          body: drop.payload?.body || "",
          href: drop.payload?.href || "#/",
        },
        ...(bays.today.alerts || []),
      ];
    }
    return;
  }
  if (drop.kind === "alert") {
    bay.alerts = [
      {
        level: drop.payload?.level || "info",
        title: drop.payload?.title || "Inbox alert",
        body: drop.payload?.body || "",
        href: drop.payload?.href || `#/${drop.bayId}`,
      },
      ...(bay.alerts || []),
    ];
    return;
  }
  if (drop.bayId === "pirate") bays.pirate = mergePirate(bay, drop.payload, drop.kind);
  else if (drop.bayId === "shipyard") bays.shipyard = mergeShipyard(bay, drop.payload, drop.kind);
  else if (drop.bayId === "mailbag") bays.mailbag = mergeMailbag(bay, drop.payload, drop.kind);
}

export async function loadLiveConfig() {
  try {
    return await loadJson(LIVE_CFG);
  } catch {
    return { overlayUrl: "", pollMs: 4000 };
  }
}

export async function fetchLiveOverlay(url) {
  if (!url) return null;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Live overlay ${res.status}`);
  return res.json();
}

export async function loadVault(liveUrl) {
  const manifest = await loadJson("./data/manifest.json");
  const bays = {};
  for (const row of manifest.bays) {
    bays[row.id] = await loadJson(`./${row.file}`);
  }
  let live = null;
  let liveError = null;
  if (liveUrl) {
    try {
      live = await fetchLiveOverlay(liveUrl);
      applyLiveOverlay(bays, live);
    } catch (err) {
      liveError = err.message;
    }
  }
  try {
    const inbox = await loadJson("./data/inbox/index.json");
    const files = inbox.files || [];
    const drops = [];
    for (const file of files) {
      try {
        drops.push(await loadJson(`./data/inbox/${file}`));
      } catch {
        /* skip missing */
      }
    }
    drops.sort((a, b) => String(a.at).localeCompare(String(b.at)));
    for (const drop of drops) applyEnvelope(bays, drop);
  } catch {
    /* no inbox index */
  }
  const overlay = readOverlay();
  for (const drop of overlay.drops) applyEnvelope(bays, drop);
  return { manifest, bays, overlay, live, liveError };
}

export function appendDrop(envelope) {
  const overlay = readOverlay();
  overlay.drops = [...overlay.drops, envelope];
  writeOverlay(overlay);
  return overlay;
}

export function localProductSrc(id) {
  return `./assets/products/${id}.png`;
}

/** Retailer CDNs 403/hotlink in the browser. Only same-origin, data, or Worker cutouts display. */
export function isUsableThumb(url) {
  const s = String(url || "");
  if (!s) return false;
  if (s.startsWith("data:image/")) return true;
  if (s.includes("/cutout/")) return true;
  if (s.startsWith("./") || s.startsWith("assets/") || s.startsWith("/")) return true;
  return false;
}

export function decorateItem(item, overlay = {}, live = null) {
  const next = { ...item };
  const target =
    overlay.targets?.[item.id] ??
    live?.targets?.[item.id] ??
    null;
  if (target != null && target !== "") {
    next.targetPrice = Number(target);
  }
  if (overlay.bins?.[item.id]?.bin) {
    next.bin = overlay.bins[item.id].bin;
    if (overlay.bins[item.id].binLabel) next.binLabel = overlay.bins[item.id].binLabel;
  }
  const liveUrl = live?.items?.[item.id]?.imageUrl;
  if (overlay.itemImages?.[item.id]) {
    next.imageUrl = overlay.itemImages[item.id];
    next.imageSource = "import";
  } else if (isUsableThumb(liveUrl)) {
    next.imageUrl = liveUrl;
    next.imageSource = "imagine";
  } else {
    next.imageUrl = localProductSrc(item.id);
    if (!next.imageSource || next.imageSource === "monogram" || next.imageSource === "official") {
      next.imageSource = "imagine";
    }
  }
  if (next.notifyOnTarget == null) next.notifyOnTarget = true;
  return next;
}

export function allItems(bays, overlay = null, live = null) {
  const items = bays.pirate?.payload?.items || [];
  if (!overlay && !live) return items;
  return items.map((it) => decorateItem(it, overlay || {}, live));
}

export function visibleItems(state) {
  const removed = new Set([
    ...(state.overlay?.removedIds || []),
    ...(state.live?.removedIds || []),
  ]);
  return allItems(state.bays, state.overlay, state.live).filter((it) => !removed.has(it.id));
}

export function removedItems(state) {
  const removed = new Set([
    ...(state.overlay?.removedIds || []),
    ...(state.live?.removedIds || []),
  ]);
  return allItems(state.bays, state.overlay, state.live).filter((it) => removed.has(it.id));
}

export function isRecurring(item) {
  return ["daily", "weekly", "biweekly"].includes(item.cadence);
}

export function allProjects(bays) {
  const out = [];
  for (const acc of bays.shipyard?.payload?.accounts || []) {
    for (const p of acc.projects || []) out.push({ ...p, account: acc });
  }
  return out;
}

export function allAlerts(state) {
  const bays = state.bays || state;
  const overlay = state.overlay || {};
  const live = state.live || {};
  const rank = { now: 0, soon: 1, info: 2 };
  const list = [];
  for (const [bayId, bay] of Object.entries(bays)) {
    if (!bay || typeof bay !== "object" || !bay.alerts) continue;
    for (const alert of bay.alerts || []) {
      list.push({ ...alert, bayId, operator: bay.operator });
    }
  }
  for (const ping of [...(live.pings || []), ...(overlay.pings || [])]) {
    list.push({
      level: "now",
      title: ping.title,
      body: ping.body,
      href: ping.href,
      bayId: "pirate",
      operator: "Pete",
      ping: true,
    });
  }
  return list.sort((a, b) => (rank[a.level] ?? 9) - (rank[b.level] ?? 9));
}

export function exportVault(state) {
  return {
    schemaVersion: "1.0.0",
    exportedAt: new Date().toISOString(),
    overlay: state.overlay,
    bays: state.bays,
  };
}
