import {
  appendDrop,
  exportVault,
  loadLiveConfig,
  loadVault,
  patchOverlay,
  resetOverlay,
  validateEnvelope,
  visibleItems,
} from "./vault.js";
import { applyTheme, loadThemeDoc, readPrefs, writePrefs } from "./theme.js";
import { syncField } from "./field.js";
import { copyText, esc, money } from "./format.js";
import {
  PING_TEMPLATE,
  TEMPLATES,
  destroyChart,
  mountPirateChart,
  peteBrief,
  renderData,
  renderDispatch,
  renderGeneric,
  renderMailbag,
  renderPirateItem,
  renderPirateList,
  renderShipyard,
  renderShipyardProject,
  renderToday,
  searchIndex,
  toast,
} from "./views.js";
import { gradeItem } from "./grades.js";
import { isTargetHit } from "./brief.js";

const stage = () => document.getElementById("stage");

let state = { manifest: { bays: [] }, bays: {}, overlay: { drops: [] }, live: null };
let themeDoc = null;
let dispatchAgent = "Pete";
let liveCfg = { overlayUrl: "", pollMs: 4000 };
let liveTimer = 0;
let lastLiveRevision = null;

function resolveLiveUrl() {
  const prefs = readPrefs();
  if (prefs.liveUrl) return prefs.liveUrl;
  if (liveCfg.overlayUrl) return liveCfg.overlayUrl;
  const host = location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return liveCfg.localOverlayUrl || "http://127.0.0.1:8787/overlay.json";
  return "";
}

function parseRoute() {
  const raw = (location.hash || "#/").replace(/^#/, "");
  const parts = raw.split("/").filter(Boolean);
  const head = parts[0] || "today";
  if (head === "pirate") return { name: "pirate", id: parts[1] || null };
  if (head === "shipyard") return { name: "shipyard", id: parts.slice(1).join("/") || null };
  if (["today", "mailbag", "dispatch", "data"].includes(head)) return { name: head, id: null };
  return { name: "bay", id: head };
}

function setNav(route) {
  const key = route.name === "bay" ? route.id : route.name;
  document.querySelectorAll(".nav a, .dock a").forEach((a) => {
    const r = a.dataset.route;
    const on =
      r === key ||
      (r === "dispatch" && (key === "data" || key === "dispatch") && a.closest(".dock"));
    a.classList.toggle("is-active", Boolean(on));
  });
}

async function render() {
  destroyChart();
  const route = parseRoute();
  setNav(route);
  const prefs = readPrefs();
  let html = "";
  if (route.name === "today") html = renderToday(state);
  else if (route.name === "pirate" && route.id) html = renderPirateItem(state, route.id);
  else if (route.name === "pirate") html = renderPirateList(state);
  else if (route.name === "shipyard" && route.id) html = renderShipyardProject(state, route.id);
  else if (route.name === "shipyard") html = renderShipyard(state);
  else if (route.name === "mailbag") html = renderMailbag(state);
  else if (route.name === "dispatch") html = renderDispatch(state, dispatchAgent);
  else if (route.name === "data") html = renderData(state, themeDoc, prefs);
  else html = renderGeneric(state.bays[route.id]);
  document.documentElement.dataset.live = state.live && !state.liveError ? "on" : "off";
  const el = stage();
  el.innerHTML = html;
  if (route.name === "pirate" && route.id) {
    const item = visibleItems(state).find((x) => x.id === route.id);
    if (item) {
      const start = () => mountPirateChart(item);
      if (window.Chart) start();
      else window.addEventListener("load", start, { once: true });
    }
  }
  document.querySelectorAll("img.thumb-img").forEach((img) => {
    img.addEventListener("error", () => {
      const wrap = img.closest(".thumb");
      if (!wrap) return;
      wrap.classList.add("thumb-mono");
      wrap.textContent = wrap.parentElement?.getAttribute("aria-label")?.slice(0, 2).toUpperCase() || "MK";
    });
  });
}

function firePing(ping) {
  const prefs = readPrefs();
  if (prefs.notify === false) return;
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(ping.title, { body: ping.body, tag: ping.id });
  }
}

function ensureTargetPings() {
  const prefs = readPrefs();
  if (prefs.notify === false) return;
  const overlay = state.overlay;
  overlay.pings = overlay.pings || [];
  overlay.notifiedTargets = overlay.notifiedTargets || {};
  let wrote = false;
  for (const it of visibleItems(state)) {
    if (it.notifyOnTarget === false || !isTargetHit(it)) continue;
    const key = `${it.id}@${it.targetPrice}`;
    if (overlay.notifiedTargets[key]) continue;
    overlay.notifiedTargets[key] = new Date().toISOString();
    const ping = {
      id: key,
      at: overlay.notifiedTargets[key],
      itemId: it.id,
      title: `Target hit: ${it.name}`,
      body: `${money(it.currentBest.price, it.currency)} at ${it.currentBest.retailer} ≤ ${money(it.targetPrice, it.currency)}`,
      href: `#/pirate/${it.id}`,
    };
    overlay.pings.unshift(ping);
    wrote = true;
    firePing(ping);
  }
  if (wrote) {
    patchOverlay((o) => {
      o.pings = overlay.pings;
      o.notifiedTargets = overlay.notifiedTargets;
    });
    state.overlay = { ...state.overlay, pings: overlay.pings, notifiedTargets: overlay.notifiedTargets };
  }
}

function openModal() {
  const modal = document.getElementById("modal");
  modal.hidden = false;
  document.getElementById("paste-error").hidden = true;
  document.getElementById("paste-area").focus();
}

function closeModal() {
  document.getElementById("modal").hidden = true;
}

function applyPaste(text) {
  const result = validateEnvelope(text);
  const err = document.getElementById("paste-error");
  if (!result.ok) {
    err.textContent = result.error;
    err.hidden = false;
    return false;
  }
  appendDrop(result.envelope);
  err.hidden = true;
  closeModal();
  toast(`Merged ${result.envelope.agent} → ${result.envelope.bayId}`);
  return boot();
}

function startLivePoll() {
  if (liveTimer) clearInterval(liveTimer);
  const url = resolveLiveUrl();
  const ms = Math.max(2000, Number(liveCfg.pollMs) || 4000);
  if (!url) return;
  liveTimer = setInterval(async () => {
    try {
      const live = await (await fetch(url, { cache: "no-store" })).json();
      if (live && live.revision !== lastLiveRevision) {
        lastLiveRevision = live.revision;
        await boot({ quiet: true });
      }
    } catch {
      /* overlay host down — keep published vault */
    }
  }, ms);
}

async function boot({ quiet = false } = {}) {
  themeDoc = await loadThemeDoc();
  applyTheme(themeDoc);
  syncField(themeDoc);
  liveCfg = await loadLiveConfig();
  const liveUrl = resolveLiveUrl();
  state = await loadVault(liveUrl);
  lastLiveRevision = state.live?.revision ?? lastLiveRevision;
  ensureTargetPings();
  await render();
  if (!quiet) startLivePoll();
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

document.addEventListener("click", async (e) => {
  const row = e.target.closest("tr[data-href]");
  if (row) {
    location.hash = row.dataset.href;
    return;
  }
  if (e.target.closest("#paste-btn") || e.target.closest("#dispatch-paste")) {
    openModal();
    return;
  }
  if (e.target.closest("#modal-close") || e.target.closest("#paste-cancel")) {
    closeModal();
    return;
  }
  if (e.target.id === "modal" ) {
    closeModal();
    return;
  }
  if (e.target.closest("#paste-apply")) {
    await applyPaste(document.getElementById("paste-area").value);
    return;
  }
  const sparkBtn = e.target.closest("[data-spark]");
  if (sparkBtn) {
    e.preventDefault();
    e.stopPropagation();
    const open = sparkBtn.getAttribute("aria-expanded") === "true";
    document.querySelectorAll("[data-spark]").forEach((btn) => {
      btn.setAttribute("aria-expanded", "false");
      const grow = btn.querySelector(".spark-grow");
      if (grow) grow.hidden = true;
    });
    if (!open) {
      sparkBtn.setAttribute("aria-expanded", "true");
      const grow = sparkBtn.querySelector(".spark-grow");
      if (grow) grow.hidden = false;
    }
    return;
  }
  const removeBtn = e.target.closest("[data-remove-item]");
  if (removeBtn) {
    e.preventDefault();
    e.stopPropagation();
    const id = removeBtn.dataset.removeItem;
    if (!window.confirm("Remove from Price Pirate? History stays in the vault. Restore on Data.")) return;
    patchOverlay((o) => {
      o.removedIds = [...new Set([...(o.removedIds || []), id])];
    });
    toast("Removed from the deck.");
    location.hash = "#/pirate";
    await boot();
    return;
  }
  const restoreBtn = e.target.closest("[data-restore-item]");
  if (restoreBtn) {
    patchOverlay((o) => {
      o.removedIds = (o.removedIds || []).filter((id) => id !== restoreBtn.dataset.restoreItem);
    });
    toast("Restored.");
    await boot();
    return;
  }
  const applyTarget = e.target.closest("[data-apply-target]");
  if (applyTarget) {
    const id = applyTarget.dataset.applyTarget;
    const value = Number(applyTarget.dataset.targetValue);
    patchOverlay((o) => {
      o.targets = { ...(o.targets || {}), [id]: value };
    });
    toast("Target updated.");
    await boot();
    return;
  }
  const pete = e.target.closest("[data-copy-pete]");
  if (pete) {
    const item = visibleItems(state).find((x) => x.id === pete.dataset.copyPete);
    if (item) {
      await copyText(peteBrief(item, gradeItem(item)));
      toast("Pete brief copied.");
    }
    return;
  }
  const agentBtn = e.target.closest("[data-agent]");
  if (agentBtn) {
    dispatchAgent = agentBtn.dataset.agent;
    await render();
    return;
  }
  if (e.target.closest("[data-copy-template]")) {
    await copyText(TEMPLATES[dispatchAgent]);
    toast(`${dispatchAgent} template copied.`);
    return;
  }
  if (e.target.closest("[data-copy-ping]")) {
    await copyText(PING_TEMPLATE);
    toast("Target-hit ping copied.");
    return;
  }
  if (e.target.closest("[data-save-live-url]")) {
    const prefs = readPrefs();
    prefs.liveUrl = (document.getElementById("live-url")?.value || "").trim();
    writePrefs(prefs);
    toast(prefs.liveUrl ? "Live URL saved." : "Live URL cleared.");
    await boot();
    return;
  }
  if (e.target.closest("[data-notify-toggle]")) {
    const prefs = readPrefs();
    if (prefs.notify === false) {
      if ("Notification" in window && Notification.permission !== "granted") {
        await Notification.requestPermission();
      }
      prefs.notify = true;
    } else {
      prefs.notify = false;
    }
    writePrefs(prefs);
    await render();
    return;
  }
  if (e.target.closest("[data-load-example]")) {
    const res = await fetch("./data/inbox/example-pete.json");
    const json = await res.json();
    document.getElementById("paste-area").value = JSON.stringify(json, null, 2);
    openModal();
    return;
  }
  const themeBtn = e.target.closest("[data-theme-id]");
  if (themeBtn) {
    const prefs = readPrefs();
    prefs.theme = themeBtn.dataset.themeId;
    writePrefs(prefs);
    applyTheme(themeDoc, prefs);
    syncField(themeDoc);
    await render();
    return;
  }
  if (e.target.closest("[data-effects-toggle]")) {
    const prefs = readPrefs();
    prefs.effects = prefs.effects === false;
    writePrefs(prefs);
    applyTheme(themeDoc, prefs);
    syncField(themeDoc);
    await render();
    return;
  }
  if (e.target.closest("[data-export-vault]")) {
    downloadJson(`mindkeep-vault-${new Date().toISOString().slice(0, 10)}.json`, exportVault(state));
    toast("Vault exported.");
    return;
  }
  if (e.target.closest("[data-reset-overlay]")) {
    resetOverlay();
    toast("Overlay cleared.");
    await boot();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeModal();
  if (e.key === "/" && e.target.tagName !== "INPUT" && e.target.tagName !== "TEXTAREA") {
    e.preventDefault();
    document.getElementById("search").focus();
  }
});

document.getElementById("search").addEventListener("input", (e) => {
  const q = e.target.value.trim().toLowerCase();
  const box = document.getElementById("search-hits");
  if (!q) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const hits = searchIndex(state)
    .filter((h) => h.hay.includes(q))
    .slice(0, 8);
  box.hidden = hits.length === 0;
  box.innerHTML = hits
    .map(
      (h) =>
        `<a href="${esc(h.href)}"><strong>${esc(h.title)}</strong><span>${esc(h.sub)}</span></a>`
    )
    .join("");
});

document.getElementById("search-hits").addEventListener("click", () => {
  document.getElementById("search-hits").hidden = true;
  document.getElementById("search").value = "";
});

document.addEventListener("submit", async (e) => {
  const form = e.target.closest("[data-target-form]");
  if (!form) return;
  e.preventDefault();
  const id = form.dataset.targetForm;
  const value = Number(new FormData(form).get("target"));
  if (!Number.isFinite(value) || value <= 0) {
    toast("Need a dollar target.");
    return;
  }
  patchOverlay((o) => {
    o.targets = { ...(o.targets || {}), [id]: value };
  });
  toast("Target saved. Pete will ping when it prints.");
  await boot();
});

document.addEventListener("change", (e) => {
  const input = e.target.closest("[data-import-png]");
  if (!input?.files?.[0]) return;
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = async () => {
      const side = 768;
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext("2d");
      const scale = Math.min(side / img.width, side / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (side - w) / 2, (side - h) / 2, w, h);
      patchOverlay((o) => {
        o.itemImages = { ...(o.itemImages || {}), [input.dataset.importPng]: canvas.toDataURL("image/png") };
      });
      toast("PNG attached to this item.");
      await boot();
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

window.addEventListener("hashchange", () => {
  document.getElementById("search-hits").hidden = true;
  render();
});

boot().catch((err) => {
  stage().innerHTML = `<p class="empty">Could not load the vault. Serve over http, not file://. ${esc(err.message)}</p>`;
});
