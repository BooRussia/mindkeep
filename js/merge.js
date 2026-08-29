export function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

export function emptyLive() {
  return {
    schemaVersion: "1.0.0",
    updatedAt: null,
    revision: 0,
    items: {},
    projects: {},
    briefings: {},
    alerts: [],
    targets: {},
    removedIds: [],
    pings: [],
  };
}

/**
 * Key on the FULL timestamp, not the day. Keying by day meant a second check of
 * the same retailer on the same date was silently dropped — which is exactly
 * when it matters (lightning deals, doorbusters, an intraday drop). Re-importing
 * an identical row still dedups, because identical rows share a timestamp.
 */
function historyKey(row) {
  return `${String(row.date)}|${row.retailer || ""}`;
}

export function unionHistory(oldList = [], nextList = []) {
  const map = new Map();
  const put = (row) => {
    const key = historyKey(row);
    const prev = map.get(key);
    // same retailer, same instant, two prices → keep the better one
    if (!prev || Number(row.price) < Number(prev.price)) map.set(key, row);
  };
  for (const row of oldList) put(row);
  for (const row of nextList) put(row);
  return [...map.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function rebuildRetailers(item) {
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

  /**
   * currentBest must mean "the cheapest place you can buy it right now", not
   * "whatever the agent happened to check last". Without this, a routine check
   * of a pricier retailer overwrites a cheaper known price — which quietly
   * suppresses target-hit pings and skews every grade and delta.
   */
  const winner = rows.find((r) => r.inStock !== false) || rows[0];
  if (winner) {
    const prev = item.currentBest || {};
    if (prev.retailer !== winner.retailer || Number(prev.price) !== Number(winner.price)) {
      item.currentBest = {
        ...prev,
        price: winner.price,
        retailer: winner.retailer,
        url: winner.url || prev.url || "",
        inStock: winner.inStock !== false,
        observedAt: winner.lastSeenAt || prev.observedAt,
        notes: prev.retailer === winner.retailer ? prev.notes || "" : "",
      };
    }
  }

  // an all-time low that the tape now beats is not an all-time low
  const floor = (item.priceHistory || []).reduce(
    (lo, h) => (Number(h.price) < Number(lo?.price ?? Infinity) ? h : lo),
    null
  );
  if (floor && (item.allTimeLow == null || Number(floor.price) < Number(item.allTimeLow.price))) {
    item.allTimeLow = {
      price: floor.price,
      retailer: floor.retailer,
      date: String(floor.date).slice(0, 10),
      url: item.retailers.find((r) => r.retailer === floor.retailer)?.url || "",
      notes: item.allTimeLow?.notes || "",
    };
  }

  return item;
}

export function mergeItem(base = {}, patch = {}) {
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

export function mergePirate(bay, payload, kind = "merge") {
  const items = [...(bay.payload?.items || [])];
  const incoming = payload.items || [];
  for (const patch of incoming) {
    const idx = items.findIndex((it) => it.id === patch.id);
    if (idx === -1) {
      items.push(rebuildRetailers({ ...patch }));
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

export function mergeProject(base = {}, patch = {}) {
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

export function mergeShipyard(bay, payload) {
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
      else acc.projects[idx] = mergeProject(acc.projects[idx], proj);
    }
  }
  return { ...bay, payload: { ...bay.payload, accounts }, updatedAt: new Date().toISOString() };
}

export function mergeMailbag(bay, payload) {
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

export function applyLiveOverlay(bays, live) {
  if (!live) return bays;
  if (live.items && Object.keys(live.items).length && bays.pirate) {
    bays.pirate = mergePirate(
      bays.pirate,
      { items: Object.entries(live.items).map(([id, patch]) => ({ id, ...patch })) },
      "merge"
    );
  }
  if (live.projects && Object.keys(live.projects).length && bays.shipyard) {
    const byOwner = {};
    for (const [id, patch] of Object.entries(live.projects)) {
      const owner = patch.owner || String(id).split("/")[0];
      if (!byOwner[owner]) byOwner[owner] = { id: owner, login: owner, projects: [] };
      byOwner[owner].projects.push({ id, ...patch });
    }
    bays.shipyard = mergeShipyard(bays.shipyard, { accounts: Object.values(byOwner) });
  }
  if (live.briefings && Object.keys(live.briefings).length && bays.mailbag) {
    bays.mailbag = mergeMailbag(bays.mailbag, { briefings: Object.values(live.briefings) });
  }
  if (live.alerts?.length) {
    const extra = live.alerts.map((a) => ({
      level: a.level || "info",
      title: a.title || "Live ping",
      body: a.body || "",
      href: a.href || "#/",
    }));
    if (bays.pirate) bays.pirate.alerts = [...extra, ...(bays.pirate.alerts || [])];
  }
  if (live.targets && bays.pirate?.payload?.items) {
    for (const it of bays.pirate.payload.items) {
      if (live.targets[it.id] != null) it.targetPrice = Number(live.targets[it.id]);
    }
  }
  return bays;
}

export function bumpLive(live, extra = {}) {
  return {
    ...live,
    ...extra,
    revision: (live.revision || 0) + 1,
    updatedAt: new Date().toISOString(),
  };
}
