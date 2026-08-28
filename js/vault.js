const VAULT_KEY = "mindkeep-vault-v1";

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

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

function historyKey(row) {
  return `${String(row.date).slice(0, 10)}|${row.retailer || ""}`;
}

function unionHistory(oldList = [], nextList = []) {
  const map = new Map();
  for (const row of oldList) map.set(historyKey(row), row);
  for (const row of nextList) {
    const key = historyKey(row);
    if (!map.has(key)) map.set(key, row);
  }
  return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function rebuildRetailers(item) {
  const latest = {};
  for (const p of item.priceHistory || []) {
    if (!p?.retailer) continue;
    if (!latest[p.retailer] || p.date > latest[p.retailer].date) latest[p.retailer] = p;
  }
  if (item.currentBest?.retailer) {
    const r = item.currentBest.retailer;
    const prev = latest[r];
    if (!prev || (item.currentBest.observedAt && item.currentBest.observedAt >= prev.date)) {
      latest[r] = {
        date: item.currentBest.observedAt || prev?.date,
        price: item.currentBest.price,
        retailer: r,
      };
    }
  }
  const existing = new Map((item.retailers || []).map((row) => [row.retailer, row]));
  const rows = Object.entries(latest)
    .map(([retailer, p]) => {
      const old = existing.get(retailer) || {};
      return {
        retailer,
        price: p.price,
        url: old.url || item.currentBest?.url || "",
        inStock: old.inStock ?? true,
        shippingNote: old.shippingNote || "",
        lastSeenAt: p.date,
        isWinner: false,
        setAtl: old.setAtl || false,
      };
    })
    .sort((a, b) => a.price - b.price);
  if (rows[0]) rows[0].isWinner = true;
  item.retailers = rows;
  return item;
}

function mergeItem(base = {}, patch = {}) {
  const next = { ...base, ...patch };
  next.priceHistory = unionHistory(base.priceHistory, patch.priceHistory);
  next.log = [...(base.log || []), ...(patch.log || [])];
  next.saleEvents = patch.saleEvents || base.saleEvents;
  if (patch.currentBest) next.currentBest = { ...(base.currentBest || {}), ...patch.currentBest };
  if (patch.allTimeLow) next.allTimeLow = { ...(base.allTimeLow || {}), ...patch.allTimeLow };
  if (patch.identifiers) next.identifiers = { ...(base.identifiers || {}), ...patch.identifiers };
  if (patch.retailers) next.retailers = patch.retailers;
  return rebuildRetailers(next);
}

function mergePirate(bay, payload, kind) {
  const items = [...(bay.payload?.items || [])];
  const incoming = payload.items || [];
  for (const patch of incoming) {
    const idx = items.findIndex((it) => it.id === patch.id);
    if (idx === -1) {
      items.push(patch);
      continue;
    }
    if (kind === "replace") {
      const history = unionHistory(items[idx].priceHistory, patch.priceHistory);
      const log = [...(items[idx].log || []), ...(patch.log || [])];
      items[idx] = rebuildRetailers({ ...items[idx], ...patch, priceHistory: history, log });
    } else {
      items[idx] = mergeItem(items[idx], patch);
    }
  }
  return { ...bay, payload: { ...bay.payload, items }, updatedAt: new Date().toISOString() };
}

function mergeProject(base = {}, patch = {}) {
  const next = { ...base, ...patch };
  if (patch.recentCommits) {
    const seen = new Set((base.recentCommits || []).map((c) => c.sha));
    next.recentCommits = [...(base.recentCommits || [])];
    for (const c of patch.recentCommits) {
      if (!seen.has(c.sha)) next.recentCommits.unshift(c);
    }
    next.recentCommits = next.recentCommits.slice(0, 16);
  }
  if (patch.links) {
    const seen = new Set((base.links || []).map((l) => l.url));
    next.links = [...(base.links || [])];
    for (const l of patch.links) if (!seen.has(l.url)) next.links.push(l);
  }
  return next;
}

function mergeShipyard(bay, payload, kind) {
  const accounts = clone(bay.payload?.accounts || []);
  for (const accPatch of payload.accounts || []) {
    let acc = accounts.find((a) => a.id === accPatch.id || a.login === accPatch.login);
    if (!acc) {
      accounts.push(accPatch);
      continue;
    }
    acc.displayName = accPatch.displayName || acc.displayName;
    acc.host = accPatch.host || acc.host;
    for (const proj of accPatch.projects || []) {
      const idx = acc.projects.findIndex((p) => p.id === proj.id);
      if (idx === -1) acc.projects.push(proj);
      else if (kind === "replace") acc.projects[idx] = mergeProject(acc.projects[idx], proj);
      else acc.projects[idx] = mergeProject(acc.projects[idx], proj);
    }
  }
  return { ...bay, payload: { ...bay.payload, accounts }, updatedAt: new Date().toISOString() };
}

function mergeMailbag(bay, payload, kind) {
  if (kind === "replace") {
    const existing = new Map((bay.payload?.briefings || []).map((b) => [b.id, b]));
    const briefings = [...(payload.briefings || [])];
    for (const old of existing.values()) {
      if (!briefings.some((b) => b.id === old.id)) briefings.push(old);
    }
    return {
      ...bay,
      payload: { ...bay.payload, ...payload, briefings },
      updatedAt: new Date().toISOString(),
    };
  }
  const briefings = [...(bay.payload?.briefings || [])];
  for (const b of payload.briefings || []) {
    const idx = briefings.findIndex((x) => x.id === b.id);
    if (idx === -1) briefings.unshift(b);
    else briefings[idx] = { ...briefings[idx], ...b };
  }
  return {
    ...bay,
    payload: { ...bay.payload, ...payload, briefings },
    updatedAt: new Date().toISOString(),
  };
}

function applyDrop(bays, drop) {
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

export async function loadVault() {
  const manifest = await loadJson("./data/manifest.json");
  const bays = {};
  for (const row of manifest.bays) {
    bays[row.id] = await loadJson(`./${row.file}`);
  }
  const overlay = readOverlay();
  for (const drop of overlay.drops) applyDrop(bays, drop);
  return { manifest, bays, overlay };
}

export function appendDrop(envelope) {
  const overlay = readOverlay();
  overlay.drops = [...overlay.drops, envelope];
  writeOverlay(overlay);
  return overlay;
}

export function decorateItem(item, overlay = {}) {
  const next = { ...item };
  if (overlay.targets && overlay.targets[item.id] != null && overlay.targets[item.id] !== "") {
    next.targetPrice = Number(overlay.targets[item.id]);
  }
  if (overlay.itemImages?.[item.id]) {
    next.imageUrl = overlay.itemImages[item.id];
    next.imageSource = "import";
  } else if (!next.imageUrl) {
    next.imageUrl = `./assets/products/${item.id}.png`;
    if (next.imageSource === "monogram") next.imageSource = "imagine";
  }
  if (next.notifyOnTarget == null) next.notifyOnTarget = true;
  return next;
}

export function allItems(bays, overlay = null) {
  const items = bays.pirate?.payload?.items || [];
  if (!overlay) return items;
  return items.map((it) => decorateItem(it, overlay));
}

export function visibleItems(state) {
  const removed = new Set(state.overlay?.removedIds || []);
  return allItems(state.bays, state.overlay).filter((it) => !removed.has(it.id));
}

export function removedItems(state) {
  const removed = new Set(state.overlay?.removedIds || []);
  return allItems(state.bays, state.overlay).filter((it) => removed.has(it.id));
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
  const rank = { now: 0, soon: 1, info: 2 };
  const list = [];
  for (const [bayId, bay] of Object.entries(bays)) {
    if (!bay || typeof bay !== "object" || !bay.alerts) continue;
    for (const alert of bay.alerts || []) {
      list.push({ ...alert, bayId, operator: bay.operator });
    }
  }
  for (const ping of overlay.pings || []) {
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
