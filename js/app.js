import {
  appendDrop,
  exportVault,
  loadVault,
  resetOverlay,
  validateEnvelope,
  allItems,
} from "./vault.js";
import { applyTheme, loadThemeDoc, readPrefs, writePrefs } from "./theme.js";
import { syncField } from "./field.js";
import { copyText, esc } from "./format.js";
import {
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

const stage = () => document.getElementById("stage");

let state = { manifest: { bays: [] }, bays: {}, overlay: { drops: [] } };
let themeDoc = null;
let dispatchAgent = "Pete";

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
  const el = stage();
  el.innerHTML = html;
  if (route.name === "pirate" && route.id) {
    const item = allItems(state.bays).find((x) => x.id === route.id);
    if (item) {
      const start = () => mountPirateChart(item);
      if (window.Chart) start();
      else window.addEventListener("load", start, { once: true });
    }
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

async function boot() {
  themeDoc = await loadThemeDoc();
  applyTheme(themeDoc);
  syncField(themeDoc);
  state = await loadVault();
  await render();
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
  const pete = e.target.closest("[data-copy-pete]");
  if (pete) {
    const item = allItems(state.bays).find((x) => x.id === pete.dataset.copyPete);
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

window.addEventListener("hashchange", () => {
  document.getElementById("search-hits").hidden = true;
  render();
});

boot().catch((err) => {
  stage().innerHTML = `<p class="empty">Could not load the vault. Serve over http, not file://. ${esc(err.message)}</p>`;
});
