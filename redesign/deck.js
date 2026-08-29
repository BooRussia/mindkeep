/* ==========================================================================
   MindKeep — deck
   A redesign prototype. It runs on the real vault in ../data and the real
   scoring in ../js (grades.js, brief.js, format.js) — nothing is mocked, so
   anything here can be lifted straight into the app.
   ========================================================================== */

import { esc, money, monogram, relTime, shortDate } from "../js/format.js";
import { gradeItem } from "../js/grades.js";
import { buildBrief, isTargetHit } from "../js/brief.js";
import { applyLiveOverlay } from "../js/merge.js";
import { applyEnvelope } from "../js/vault.js";
import { historyInRange, rangePillsHTML, rangeSelectHTML } from "../js/range.js";
import { callLive, liveWriteHint } from "../js/livewrite.js";
import { cutoutFromUrl } from "../js/cutout.js";

/* ---------------------------------------------------------------- state -- */

const S = {
  items: [],
  projects: [],
  mail: null,
  alerts: [],
  live: null,
  liveUrl: "",
  filter: "all",
  sort: { key: "gap", dir: "asc" },
  chartRange: "all",
  peekId: null,
  route: { name: "today", id: null },
  paletteIdx: 0,
  paletteRows: [],
};

const PREFS_KEY = "mindkeep-deck-prefs-v1";
const readPrefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
};
const writePrefs = (p) => localStorage.setItem(PREFS_KEY, JSON.stringify(p));
S.chartRange = readPrefs().chartRange || "all";

function liveCreds() {
  const p = readPrefs();
  return { overlayUrl: S.liveUrl, token: p.writeToken || "" };
}

async function persistLive(tool, args, localMsg) {
  const result = await callLive(liveCreds(), tool, args);
  toast(liveWriteHint(result, { action: localMsg }));
  return result;
}

/* ------------------------------------------------------------ utilities -- */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (id) => document.getElementById(id);

async function getJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

function toast(msg) {
  const t = el("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), 2400);
}

async function copy(text, label = "Copied.") {
  try {
    await navigator.clipboard.writeText(text);
    toast(label);
  } catch {
    toast("Copy blocked by the browser.");
  }
}

/** Signed percentage where DOWN is good (prices). */
function deltaHTML(v, suffix = "") {
  if (v == null || Number.isNaN(Number(v))) return `<span class="dim">—</span>`;
  const n = Number(v);
  const cls = n === 0 ? "flat" : n < 0 ? "down" : "up";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `<span class="${cls}">${sign}${Math.abs(n).toFixed(1)}%${suffix}</span>`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/* -------------------------------------------------- seasonal intelligence -- */

const EVENTS = [
  { type: "black_friday", name: "Black Friday", short: "BF" },
  { type: "cyber_monday", name: "Cyber Monday", short: "CM" },
  { type: "prime_day", name: "Prime Day", short: "PD" },
];

/** 4th Thursday of November. */
function blackFriday(year) {
  const d = new Date(Date.UTC(year, 10, 1));
  const firstThu = (11 - d.getUTCDay()) % 7; // 4 = Thursday
  return new Date(Date.UTC(year, 10, 1 + firstThu + 21));
}

/** Next calendar occurrence of an event, from `now`. */
function nextEventDate(type, now = new Date()) {
  const y = now.getUTCFullYear();
  for (const year of [y, y + 1]) {
    let d;
    if (type === "black_friday") d = blackFriday(year);
    else if (type === "cyber_monday") d = new Date(blackFriday(year).getTime() + 3 * 86400000);
    else d = new Date(Date.UTC(year, 6, 8)); // Prime Day sits in early-to-mid July
    if (d > now) return d;
  }
  return null;
}

const daysUntil = (date, now = new Date()) => Math.ceil((date - now) / 86400000);

/** Event dates are built at UTC midnight — format them in UTC or they slip a day. */
const eventDay = (d) =>
  d.toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/**
 * The question the deck actually has to answer: buy now, or hold for a sale?
 * Compares today's best price against the best print each event has ever put up.
 */
function seasonalRead(item, now = new Date()) {
  const current = item.currentBest?.price;
  const rows = EVENTS.map((ev) => {
    const prints = (item.saleEvents || [])
      .filter((e) => e.type === ev.type)
      .sort((a, b) => a.year - b.year);
    // What to expect this year is the MOST RECENT print, not the all-time best.
    // An old launch-year doorbuster on last-gen hardware is history, not a forecast.
    const expect = prints.length ? prints[prints.length - 1] : null;
    const best = prints.length ? prints.reduce((a, b) => (b.price < a.price ? b : a)) : null;
    const stale = Boolean(best && expect && best.price < expect.price);
    const next = nextEventDate(ev.type, now);
    const days = next ? daysUntil(next, now) : null;
    const cutPct = expect && current ? ((current - expect.price) / current) * 100 : null;
    return { ...ev, prints, expect, best, stale, next, days, cutPct };
  });

  const candidates = rows.filter((r) => r.cutPct != null && r.cutPct >= 3);
  candidates.sort((a, b) => b.cutPct - a.cutPct || a.days - b.days);
  const win = candidates[0] || null;

  let call;
  if (!current) call = { wait: false, head: "No live price.", body: "Pete has not checked recently enough to compare against the sale calendar." };
  else if (!rows.some((r) => r.prints.length))
    call = {
      wait: false,
      head: "No sale history on file.",
      body: "This item has never been recorded through Black Friday, Cyber Monday or Prime Day. There is nothing to wait for yet — ask Pete to backfill last November before treating a sale as a plan.",
    };
  else if (!win)
    call = {
      wait: false,
      head: "Don't wait for a sale.",
      body: `Today's ${money(current, item.currency)} already matches or beats every Black Friday, Cyber Monday and Prime Day print on file. The calendar is not going to help you here.`,
    };
  else
    call = {
      wait: true,
      head: `Hold for ${win.name} — ${plural(win.days, "day", "days")} out.`,
      body:
        `Last ${win.name} (${win.expect.year}) printed ${money(win.expect.price, item.currency)} at ${win.expect.retailer} — ${win.cutPct.toFixed(0)}% under today's ${money(current, item.currency)}. ` +
        (win.stale
          ? `It went as low as ${money(win.best.price, item.currency)} in ${win.best.year}, but that floor has drifted up, so plan around the recent print, not the record. `
          : "") +
        `If you can wait until ${eventDay(win.next)}, wait.`,
      win,
    };

  return { rows, call };
}

/* ------------------------------------------------------- the target meter -- */

/**
 * Geometry for the "how far from my buy line" rail.
 * Domain is the real price envelope so the marker position means something.
 */
function meterGeom(item) {
  const current = item.currentBest?.price;
  const target = item.targetPrice;
  const hist = (item.priceHistory || []).map((h) => Number(h.price)).filter(Number.isFinite);
  const atl = item.allTimeLow?.price ?? (hist.length ? Math.min(...hist) : null);
  const hi = hist.length ? Math.max(...hist) : current;
  if (current == null || target == null) return null;

  const lo = Math.min(atl ?? current, target, current) * 0.985;
  const top = Math.max(hi ?? current, current, target) * 1.015;
  const span = top - lo || 1;
  const at = (v) => Math.max(0, Math.min(100, ((v - lo) / span) * 100));

  const gap = current - target;
  return {
    lo,
    top,
    atl,
    target,
    current,
    inZone: current <= target,
    gap,
    gapPct: target ? (gap / target) * 100 : null,
    xTarget: at(target),
    xCurrent: at(current),
    xAtl: atl != null ? at(atl) : null,
  };
}

/** Compact signed distance to the buy line: −$30 means you are $30 past it. */
function gapLabel(g, item, compact) {
  if (!g) return "—";
  if (Math.abs(g.gap) < 0.5) return compact ? "at line" : "sitting on your target";
  const abs = money(Math.abs(g.gap), item.currency).replace(/\.00$/, "");
  if (compact) return g.inZone ? `−${abs}` : `+${abs}`;
  return g.inZone ? `${abs} under target` : `${abs} to go`;
}

function meterHTML(item, { legend = true, compact = false } = {}) {
  const g = meterGeom(item);
  if (!g)
    return `<div class="meter"><div class="meter-rail"></div>${
      legend ? `<div class="meter-legend"><span>no target set</span></div>` : ""
    }</div>`;
  const inZone = g.inZone ? "1" : "0";
  const gapTxt = gapLabel(g, item, compact);
  return `
    <div class="meter">
      <div class="meter-rail">
        <div class="meter-zone" style="width:${g.xTarget.toFixed(2)}%"></div>
        <div class="meter-tick" style="left:${g.xTarget.toFixed(2)}%" title="Target ${money(g.target, item.currency)}"></div>
        <div class="meter-dot" data-in="${inZone}" style="left:${g.xCurrent.toFixed(2)}%" title="Now ${money(g.current, item.currency)}"></div>
      </div>
      ${
        legend
          ? `<div class="meter-legend">
               <span>${g.atl != null ? `low ${money(g.atl, item.currency).replace(/\.00$/, "")}` : "no floor"}</span>
               <span class="meter-gap" data-in="${inZone}">${esc(gapTxt)}</span>
             </div>`
          : ""
      }
    </div>`;
}

/* ---------------------------------------------------------------- sparks -- */

function sparkHTML(item, { h = 28, points = 60 } = {}) {
  const rows = [...(item.priceHistory || [])].sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );
  if (rows.length < 2) return `<svg class="spark" viewBox="0 0 100 ${h}" aria-hidden="true"></svg>`;
  const step = Math.max(1, Math.floor(rows.length / points));
  const sample = rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
  const ys = sample.map((r) => Number(r.price));
  const t = item.targetPrice;
  const min = Math.min(...ys, t ?? Infinity);
  const max = Math.max(...ys, t ?? -Infinity);
  const span = max - min || 1;
  const W = 100;
  const y = (v) => h - 2 - ((v - min) / span) * (h - 4);
  const pts = sample
    .map((r, i) => `${((i / (sample.length - 1)) * W).toFixed(2)},${y(Number(r.price)).toFixed(2)}`)
    .join(" ");
  const dir = ys[ys.length - 1] <= ys[0] ? "down" : "up";
  return `<svg class="spark" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(item.name)} price trend">
    ${t != null ? `<line class="spark-target" x1="0" y1="${y(t).toFixed(2)}" x2="${W}" y2="${y(t).toFixed(2)}" vector-effect="non-scaling-stroke"/>` : ""}
    <polyline class="spark-line" data-dir="${dir}" points="${pts}" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/* ------------------------------------------------------------- big chart -- */

/** Placeholder — the SVG is drawn after insertion at real pixel size so the
    labels never stretch (a 1000-unit viewBox squashed to any width does). */
function chartHTML() {
  return `<div class="chart" data-chart></div>`;
}

function drawChart(wrap, item, rangeId = S.chartRange) {
  const rows = historyInRange(item.priceHistory || [], rangeId);
  if (rows.length < 2) {
    wrap.innerHTML = `<div class="empty">Not enough price history to plot.</div>`;
    return null;
  }

  const W = Math.max(320, Math.round(wrap.clientWidth || 900));
  const H = Math.max(180, Math.round(wrap.clientHeight || 300));
  const padL = 54;
  const padR = 16;
  const padT = 14;
  const padB = 26;

  const t0 = new Date(rows[0].date).getTime();
  const t1 = new Date(rows[rows.length - 1].date).getTime();
  const tSpan = t1 - t0 || 1;

  const prices = rows.map((r) => Number(r.price));
  const target = item.targetPrice;
  const atl = item.allTimeLow?.price;
  const lo = Math.min(...prices, target ?? Infinity, atl ?? Infinity);
  const hi = Math.max(...prices, target ?? -Infinity);
  const pad = (hi - lo) * 0.1 || 10;
  const yMin = lo - pad;
  const yMax = hi + pad;

  const X = (iso) => padL + ((new Date(iso).getTime() - t0) / tSpan) * (W - padL - padR);
  const Y = (v) => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

  const path = rows.map((r, i) => `${i ? "L" : "M"}${X(r.date).toFixed(1)} ${Y(Number(r.price)).toFixed(1)}`).join(" ");

  // horizontal grid at 4 steps
  const grid = Array.from({ length: 4 }, (_, i) => {
    const v = yMin + ((yMax - yMin) * (i + 1)) / 5;
    const y = Y(v);
    return `<line class="grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"/>
            <text class="axis-text" x="${padL - 8}" y="${(y + 3).toFixed(1)}" text-anchor="end">${money(v, item.currency).replace(/\.\d+$/, "")}</text>`;
  }).join("");

  // month ticks
  const months = [];
  let cursor = new Date(t0);
  cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
  while (cursor.getTime() <= t1) {
    if (cursor.getTime() >= t0) months.push(new Date(cursor));
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  // a "MMM YY" label needs ~52px of room — derive the tick count from the plot
  // width, not a fixed 7, or phone widths overlap into mush
  const maxTicks = Math.max(2, Math.floor((W - padL - padR) / 62));
  const every = Math.ceil(months.length / maxTicks) || 1;
  const xAxis = months
    .filter((_, i) => i % every === 0)
    .map(
      (d) =>
        `<text class="axis-text" x="${X(d.toISOString()).toFixed(1)}" y="${H - 8}" text-anchor="middle">${d
          .toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" })
          .toUpperCase()}</text>`
    )
    .join("");

  // the buy zone: everything at or below the target line
  const zone =
    target != null && Y(target) < H - padB
      ? `<rect x="${padL}" y="${Y(target).toFixed(1)}" width="${W - padL - padR}" height="${(H - padB - Y(target)).toFixed(1)}" fill="url(#zoneFill)"/>`
      : "";

  const targetLine =
    target != null
      ? `<line class="target-line" x1="${padL}" y1="${Y(target).toFixed(1)}" x2="${W - padR}" y2="${Y(target).toFixed(1)}"/>
         <text class="axis-text over" x="${W - padR}" y="${(Y(target) - 6).toFixed(1)}" text-anchor="end">TARGET ${money(target, item.currency).replace(/\.\d+$/, "")}</text>`
      : "";

  // when the floor and the target sit on the same pixel row, one line says it all
  const atlLine =
    atl != null && (target == null || Math.abs(Y(atl) - Y(target)) > 9)
      ? `<line class="atl-line" x1="${padL}" y1="${Y(atl).toFixed(1)}" x2="${W - padR}" y2="${Y(atl).toFixed(1)}"/>
         <text class="axis-text over" x="${padL + 4}" y="${(Y(atl) + 12).toFixed(1)}">LOW ${money(atl, item.currency).replace(/\.\d+$/, "")}</text>`
      : "";

  // sale-event markers, placed on the real calendar date of that year
  const marks = (item.saleEvents || [])
    .map((e) => {
      const d =
        e.type === "black_friday"
          ? blackFriday(e.year)
          : e.type === "cyber_monday"
            ? new Date(blackFriday(e.year).getTime() + 3 * 86400000)
            : new Date(Date.UTC(e.year, 6, 8));
      const ms = d.getTime();
      if (ms < t0 || ms > t1) return "";
      const x = X(d.toISOString());
      const y = Y(e.price);
      const short = EVENTS.find((v) => v.type === e.type)?.short || "•";
      return `<g>
        <line class="event-stem" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x.toFixed(1)}" y2="${H - padB}"/>
        <rect class="event-mark" x="${(x - 3.2).toFixed(1)}" y="${(y - 3.2).toFixed(1)}" width="6.4" height="6.4" transform="rotate(45 ${x.toFixed(1)} ${y.toFixed(1)})"/>
        <text class="axis-text over" x="${x.toFixed(1)}" y="${(y - 9).toFixed(1)}" text-anchor="middle">${short} ${money(e.price, item.currency).replace(/\.\d+$/, "").replace("$", "$")}</text>
      </g>`;
    })
    .join("");

  const lastX = X(rows[rows.length - 1].date);
  const lastY = Y(prices[prices.length - 1]);

  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img"
         aria-label="Price history for ${esc(item.name)} with target line, buy zone and sale events">
      <defs>
        <linearGradient id="zoneFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4D9EFF" stop-opacity="0.16"/>
          <stop offset="100%" stop-color="#4D9EFF" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${grid}
      ${zone}
      ${atlLine}
      ${targetLine}
      <path class="price-line" d="${path}"/>
      ${marks}
      <circle class="now-dot" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="3.4"/>
      ${xAxis}
    </svg>`;

  return { W, H, padL, padR, padT, padB, rows };
}

/* ------------------------------------------------------------ agent feed -- */

function agentFeed(limit = 14) {
  const out = [];
  for (const it of S.items) {
    for (const row of it.log || []) {
      out.push({
        at: row.at,
        who: row.actor || "pete",
        text: row.text,
        subject: it.name,
        href: `#/pirate/${it.id}`,
        kind: row.kind,
      });
    }
  }
  for (const p of S.projects) {
    if (p.lastCommit?.at)
      out.push({
        at: p.lastCommit.at,
        who: "rig",
        text: p.lastCommit.subject,
        subject: p.name,
        href: `#/shipyard/${p.id}`,
        kind: "watch",
      });
  }
  for (const b of S.mail?.payload?.briefings || []) {
    out.push({ at: b.at, who: "post", text: b.subject, subject: "Mailbag", href: "#/mailbag", kind: "brief" });
  }
  for (const p of S.live?.pings || []) {
    out.push({ at: p.at, who: "pete", text: p.title, subject: "live ping", href: p.href || "#/", kind: "ping" });
  }
  return out
    .filter((r) => r.at)
    .sort((a, b) => String(b.at).localeCompare(String(a.at)))
    .slice(0, limit);
}

/* -------------------------------------------------------------- alerts ---- */

/** Rank, then collapse duplicates that point at the same thing. */
function rankedAlerts() {
  const rank = { now: 0, soon: 1, info: 2 };
  const seen = new Set();
  return [...S.alerts]
    .sort((a, b) => (rank[a.level] ?? 9) - (rank[b.level] ?? 9))
    .filter((a) => {
      const key = a.href || a.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/* ================================================================ VIEWS === */

function thumbHTML(item) {
  const src = item.imageUrl || `../assets/products/${item.id}.png`;
  return `<span class="pthumb"><img src="${esc(src)}" alt="" loading="lazy"
    onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'mg',textContent:'${esc(monogram(item.name))}'}))"></span>`;
}

/* ---- Deck (Today) --------------------------------------------------- */

function viewToday() {
  const alerts = rankedAlerts();
  const top = alerts.slice(0, 4);
  const rest = alerts.length - top.length;
  const hits = S.items.filter(isTargetHit);
  const needs = S.projects.filter((p) => p.needsMe || p.status === "blocked");
  const falling = S.items.filter((it) => (gradeItem(it).stats.change7dPct ?? 0) < 0);
  const hottest = S.items.slice().sort((a, b) => sortGap(a) - sortGap(b))[0];
  const maxPrice = Math.max(1, ...S.items.map((it) => it.currentBest?.price || 0));

  return `
    <header class="page-head">
      <div>
        <span class="lbl">Command deck</span>
        <h1>Everything, at once</h1>
      </div>
      <p class="mono dim" style="font-size:var(--t-xs)">${esc(
        new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
      )}</p>
    </header>

    <div class="kpi-strip">
      <article class="kpi-card">
        <span class="lbl">Watching</span>
        <p class="kpi-num">${S.items.length}</p>
        <p class="kpi-sub">${plural(S.items.filter((it) => ["daily", "weekly", "biweekly"].includes(it.cadence)).length, "recurring tape", "recurring tapes")}</p>
      </article>
      <article class="kpi-card">
        <span class="lbl">At target</span>
        <p class="kpi-num">${hits.length}</p>
        <p class="kpi-sub">${hits.length ? hits.map((it) => esc(it.name.split(" ")[0])).join(" · ") : "none in the buy zone"}</p>
      </article>
      <article class="kpi-card">
        <span class="lbl">Falling 7d</span>
        <p class="kpi-num">${falling.length}</p>
        <p class="kpi-sub">${falling.length ? "price down is the signal" : "no 7-day drops"}</p>
      </article>
      <article class="kpi-card">
        <span class="lbl">Need you</span>
        <p class="kpi-num">${needs.length + alerts.filter((a) => a.level === "now").length}</p>
        <p class="kpi-sub">${plural(needs.length, "repo", "repos")} · ${plural(alerts.length, "alert", "alerts")}</p>
      </article>
    </div>

    <div class="widget-grid">
      <section class="widget">
        <div class="widget-head">
          <div>
            <span class="lbl">Against the buy line</span>
            <h2>Watches</h2>
          </div>
          <a class="link" href="#/pirate">Open Prices →</a>
        </div>
        <div class="hbars">
          ${
            S.items
              .slice()
              .sort((a, b) => sortGap(a) - sortGap(b))
              .slice(0, 6)
              .map((it) => {
                const m = meterGeom(it);
                const width = Math.max(6, Math.min(100, ((it.currentBest?.price || 0) / maxPrice) * 100));
                return `<a class="hbar" href="#/pirate/${esc(it.id)}" data-peek="${esc(it.id)}">
                  <span class="hbar-label">${esc(it.name)}</span>
                  <span class="hbar-meta">${esc(money(it.currentBest?.price, it.currency))}</span>
                  <span class="hbar-track"><span class="hbar-fill" data-over="${m && !m.inZone ? "1" : "0"}" style="width:${width.toFixed(1)}%"></span></span>
                </a>`;
              })
              .join("") || `<div class="empty">No watches yet.</div>`
          }
        </div>
      </section>
      <section class="widget">
        <div class="widget-head">
          <div>
            <span class="lbl">${hottest ? esc(hottest.name) : "Price tape"}</span>
            <p class="kpi-num">${hottest ? esc(money(hottest.currentBest?.price, hottest.currency)) : "—"}</p>
          </div>
          ${hottest ? rangeSelectHTML(hottest.priceHistory || [], S.chartRange) : ""}
        </div>
        ${hottest ? `<div class="chart" data-chart data-chart-item="${esc(hottest.id)}"></div>` : `<div class="empty">No tape to plot.</div>`}
      </section>
    </div>

    <section class="section">
      <div class="section-head">
        <span class="lbl">Needs you${alerts.length ? ` · ${alerts.length}` : ""}</span>
      </div>
      ${
        top.length
          ? `<div class="queue">
              ${top
                .map(
                  (a) => `<a class="qrow" data-level="${esc(a.level)}" href="${esc(a.href || "#/")}">
                    <span class="qtick"></span>
                    <div class="qbody">
                      <h3>${esc(a.title)}</h3>
                      <p>${esc(a.body || "")}</p>
                    </div>
                    <span class="qmeta">${esc(a.operator || a.bayId || "")}</span>
                  </a>`
                )
                .join("")}
              ${rest > 0 ? `<div class="qmore">${rest} more in the bays</div>` : ""}
            </div>`
          : `<div class="empty">Queue is clear. Nothing is waiting on you.</div>`
      }
    </section>

    <div class="deck-split">
      <div>
        <section class="section">
          <div class="section-head">
            <span class="lbl">Price watches · ${S.items.length}${hits.length ? ` · ${hits.length} at target` : ""}</span>
            <a class="link" href="#/pirate">Open Prices →</a>
          </div>
          <div class="rows">
            ${S.items
              .slice()
              .sort((a, b) => sortGap(a) - sortGap(b))
              .slice(0, 5)
              .map((it) => priceRowCompact(it))
              .join("")}
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <span class="lbl">Projects · ${S.projects.length}${needs.length ? ` · ${needs.length} need you` : ""}</span>
            <a class="link" href="#/shipyard">Open Projects →</a>
          </div>
          <div class="rows">
            ${sortedProjects().slice(0, 5).map(projectRow).join("")}
          </div>
        </section>
      </div>

      <div>
        <section class="section">
          <div class="section-head">
            <span class="lbl">Agent activity</span>
            <a class="link" href="#/agents">Wire →</a>
          </div>
          <div class="feed">
            ${
              agentFeed(9)
                .map(
                  (r) => `<a class="feed-row" href="${esc(r.href)}">
                    <span class="feed-when">${esc(relTime(r.at))}</span>
                    <span class="feed-what"><span class="feed-who">${esc(r.who)}</span> ${esc(r.text || "")}</span>
                    <span class="feed-when">${esc(r.kind || "")}</span>
                  </a>`
                )
                .join("") || `<div class="empty">No agent writes yet.</div>`
            }
          </div>
        </section>

        <section class="section">
          <div class="section-head"><span class="lbl">Mailbag</span><a class="link" href="#/mailbag">Open →</a></div>
          <div class="rows">
            ${(S.mail?.payload?.briefings || [])
              .slice(0, 2)
              .map(
                (b) => `<a class="mail" href="#/mailbag">
                  <div class="mail-top"><h3>${esc(b.subject)}</h3><span class="lbl">${esc(relTime(b.at))}</span></div>
                  <ul>${(b.bullets || [])
                    .slice(0, 2)
                    .map((x) => `<li data-reply="${b.needsReply ? "1" : "0"}">${esc(x)}</li>`)
                    .join("")}</ul>
                </a>`
              )
              .join("") || `<div class="empty">No briefings.</div>`}
          </div>
        </section>
      </div>
    </div>`;
}

/* ---- Prices --------------------------------------------------------- */

function sortGap(it) {
  const g = meterGeom(it);
  if (!g) return 9e9;
  return g.gapPct ?? 9e9;
}

function priceRowCompact(it) {
  const b = buildBrief(it);
  const g = gradeItem(it);
  return `<a class="prow" href="#/pirate/${esc(it.id)}" data-peek="${esc(it.id)}">
    ${thumbHTML(it)}
    <div class="pmain">
      <div class="ptop">
        <span class="pname">${esc(it.name)}</span>
        <span class="pprice">${esc(money(it.currentBest?.price, it.currency))}</span>
      </div>
      <div class="pbottom">
        <span class="verdict" data-call="${esc(b.call)}">${esc(callLabel(b.call))}</span>
        <span class="pdelta">${deltaHTML(g.stats.change7dPct, " 7d")}</span>
        <span class="pat">${esc(it.currentBest?.retailer || "")}</span>
      </div>
      ${meterHTML(it, { compact: true })}
    </div>
  </a>`;
}

function callLabel(call) {
  return (
    {
      buy_now: "Buy now",
      good_now: "Good buy",
      wait: "Wait",
      retarget: "Retarget",
      watch: "Hold",
      needs_data: "Need data",
    }[call] || call
  );
}

function priceRowFull(it) {
  const b = buildBrief(it);
  const g = gradeItem(it);
  const m = meterGeom(it);
  const gapTxt = gapLabel(m, it, true);
  return `<a class="prow prow-table" href="#/pirate/${esc(it.id)}" data-peek="${esc(it.id)}">
    ${thumbHTML(it)}
    <div class="pmain">
      <div class="ptop">
        <span class="pname">${esc(it.name)}</span>
        <span class="pvar">${esc(it.variant || it.category || "")}</span>
      </div>
      <div class="pbottom">
        <span class="pcell pcell-num pprice">${esc(money(it.currentBest?.price, it.currency))}</span>
        <span class="pcell pcell-num pdelta">${deltaHTML(g.stats.change7dPct)}</span>
        <span class="pcell">${meterHTML(it, { legend: false })}
          <span class="meter-legend"><span>${esc(it.currentBest?.retailer || "")}</span><span class="meter-gap" data-in="${m?.inZone ? "1" : "0"}">${esc(gapTxt)}</span></span>
        </span>
        <span class="pcell"><span class="verdict" data-call="${esc(b.call)}">${esc(callLabel(b.call))}</span></span>
        <span class="pcell">${sparkHTML(it)}</span>
        <span class="pcell pactions">
          <button type="button" class="btn btn-ghost btn-sm" data-peek="${esc(it.id)}" title="Peek">▣</button>
          <button type="button" class="btn btn-ghost btn-sm" data-recheck="${esc(it.id)}" title="Ask Pete to re-check now">↻</button>
          <button type="button" class="btn btn-ghost btn-sm" data-remove="${esc(it.id)}" title="Remove from deck">✕</button>
        </span>
      </div>
    </div>
  </a>`;
}

const FILTERS = [
  { id: "all", label: "All" },
  { id: "hit", label: "At target" },
  { id: "close", label: "Within 10%" },
  { id: "recurring", label: "Recurring" },
  { id: "once", label: "One-time" },
  { id: "thin", label: "Thin data" },
];

function filterItems() {
  const list = S.items.slice();
  const f = S.filter;
  const out = list.filter((it) => {
    if (f === "hit") return isTargetHit(it);
    if (f === "close") {
      const m = meterGeom(it);
      return m && !m.inZone && m.gapPct != null && m.gapPct <= 10;
    }
    if (f === "recurring") return ["daily", "weekly", "biweekly"].includes(it.cadence);
    if (f === "once") return !["daily", "weekly", "biweekly"].includes(it.cadence);
    if (f === "thin") return gradeItem(it).grade === "unknown";
    return true;
  });
  const { key, dir } = S.sort;
  const val = (it) => {
    if (key === "price") return it.currentBest?.price ?? Infinity;
    if (key === "d7") return gradeItem(it).stats.change7dPct ?? 0;
    if (key === "name") return it.name.toLowerCase();
    return sortGap(it);
  };
  out.sort((a, b) => {
    const va = val(a);
    const vb = val(b);
    const c = typeof va === "string" ? va.localeCompare(vb) : va - vb;
    return dir === "asc" ? c : -c;
  });
  return out;
}

function countFor(id) {
  const keep = S.filter;
  S.filter = id;
  const n = filterItems().length;
  S.filter = keep;
  return n;
}

function viewPirate() {
  const list = filterItems();
  const s = (k) => (S.sort.key === k ? (S.sort.dir === "asc" ? "ascending" : "descending") : "none");
  const caret = (k) => (S.sort.key === k ? (S.sort.dir === "asc" ? "▲" : "▼") : "▲");
  return `
    <header class="page-head">
      <div>
        <span class="lbl">Pete · price pirate</span>
        <h1>Prices</h1>
      </div>
      <button type="button" class="btn" data-sheet="add-watch">+ Add a watch</button>
    </header>

    <div class="filters" role="group" aria-label="Filter watches">
      ${FILTERS.map((f) => {
        const n = countFor(f.id);
        const dead = n === 0 && S.filter !== f.id;
        return `<button type="button" class="chip" data-filter="${f.id}" aria-pressed="${S.filter === f.id}" ${dead ? "disabled" : ""}>${f.label}<span class="n">${n}</span></button>`;
      }).join("")}
    </div>

    <div class="rows">
      <div class="rows-head">
        <span></span>
        <button type="button" data-sort="name" aria-sort="${s("name")}">Item <span class="sort-caret">${caret("name")}</span></button>
        <button type="button" data-sort="price" aria-sort="${s("price")}" style="justify-content:flex-end">Best now <span class="sort-caret">${caret("price")}</span></button>
        <button type="button" data-sort="d7" aria-sort="${s("d7")}" style="justify-content:flex-end">7d <span class="sort-caret">${caret("d7")}</span></button>
        <button type="button" data-sort="gap" aria-sort="${s("gap")}">Against target <span class="sort-caret">${caret("gap")}</span></button>
        <span class="lbl">Call</span>
        <span class="lbl" style="text-align:right">Trend</span>
        <span></span>
      </div>
      ${list.map(priceRowFull).join("") || `<div class="empty">Nothing matches that filter.</div>`}
    </div>`;
}

/* ---- Item ----------------------------------------------------------- */

function viewItem(id) {
  const it = S.items.find((x) => x.id === id);
  if (!it) return `<div class="empty">No item “${esc(id)}”.</div>`;
  const b = buildBrief(it);
  const g = gradeItem(it);
  const m = meterGeom(it);
  const season = seasonalRead(it);
  const retailers = [...(it.retailers || [])].sort((a, b2) => (a.price ?? 9e9) - (b2.price ?? 9e9));
  const best = retailers[0]?.price;

  const windows = [
    ["1 day", g.stats.change1dPct],
    ["7 day", g.stats.change7dPct],
    ["30 day", g.stats.change30dPct],
    ["90 day", g.stats.change90dPct],
    ["1 year", g.stats.change1yPct],
    ["all time", g.stats.changeAllPct],
  ];

  return `
    <nav class="crumb"><a href="#/pirate">Prices</a><span>/</span><span>${esc(it.name)}</span></nav>

    <section class="item-hero">
      <div class="item-id">
        ${thumbHTML(it)}
        <div style="min-width:0">
          <span class="lbl">${esc(it.category || "item")} · checked ${esc(relTime(it.lastCheckedAt))} · ${esc(it.cadence)}</span>
          <h1>${esc(it.name)}</h1>
          <p class="dim" style="font-size:var(--t-sm)">${esc(it.variant || "")}</p>
        </div>
      </div>

      <div class="hero-figures">
        <div class="hero-now">
          <div>
            <span class="lbl">Best right now</span>
            <p class="hero-price">${esc(money(it.currentBest?.price, it.currency))}</p>
          </div>
          <div class="hero-side">
            <span class="hero-where">at <strong>${esc(it.currentBest?.retailer || "—")}</strong> · ${esc(relTime(it.currentBest?.observedAt))}</span>
            <span class="mono" style="font-size:var(--t-sm)">${deltaHTML(g.stats.change7dPct, " over 7d")}</span>
          </div>
          <div style="margin-left:auto;display:flex;gap:var(--s2);flex-wrap:wrap">
            ${
              it.currentBest?.url
                ? `<a class="btn btn-solid" href="${esc(it.currentBest.url)}" target="_blank" rel="noreferrer">Open at ${esc(it.currentBest.retailer)} ↗</a>`
                : ""
            }
            <button type="button" class="btn" data-sheet="edit-target" data-id="${esc(it.id)}">Target ${esc(money(it.targetPrice, it.currency))}</button>
          </div>
        </div>

        ${meterHTML(it)}

        <div class="hero-verdict">
          <span class="verdict" data-call="${esc(b.call)}">${esc(callLabel(b.call))}</span>
          <span class="hero-call">${esc(b.headline)}</span>
        </div>
        <p class="hero-why">${esc(b.body)}</p>
        ${
          b.call === "retarget" && b.suggestedTarget && b.suggestedTarget !== it.targetPrice
            ? `<div class="row-actions">
                 <button type="button" class="btn btn-sm" data-apply-target="${esc(it.id)}" data-value="${esc(b.suggestedTarget)}">Move target to ${esc(money(b.suggestedTarget, it.currency))}</button>
               </div>`
            : ""
        }
      </div>
    </section>

    <div class="deltas">
      ${windows
        .map(
          ([label, v]) => `<div class="delta">
            <p class="v">${deltaHTML(v)}</p>
            <p class="s">${esc(label)}</p>
          </div>`
        )
        .join("")}
    </div>

    <section class="card chart-card">
      <div class="chart-head">
        <span class="lbl">Price tape · ${esc((it.priceHistory || []).length)} prints</span>
        <div style="display:flex;gap:var(--s3);align-items:center;flex-wrap:wrap">
          ${rangePillsHTML(it.priceHistory || [], S.chartRange)}
          ${rangeSelectHTML(it.priceHistory || [], S.chartRange)}
        </div>
      </div>
      <div class="chart-legend">
        <span><i class="lg-swatch" data-k="price"></i>best seen</span>
        <span><i class="lg-swatch" data-k="target"></i>your target</span>
        <span><i class="lg-swatch" data-k="zone"></i>buy zone</span>
        <span><i class="lg-swatch"></i>sale events</span>
      </div>
      ${chartHTML(it)}
    </section>

    <section class="section">
      <div class="section-head"><span class="lbl">Wait, or buy?</span></div>
      <div class="season-call" data-wait="${season.call.wait ? "1" : "0"}">
        <div>
          <h3>${esc(season.call.head)}</h3>
          <p>${esc(season.call.body)}</p>
        </div>
      </div>
      <div class="season-grid">
        ${season.rows
          .map((r) => {
            const cut = r.cutPct;
            return `<article class="season">
              <div class="season-top">
                <span class="lbl">${esc(r.name)}</span>
                <span class="season-when">${r.days != null ? `in ${r.days}d` : ""}</span>
              </div>
              ${
                r.expect
                  ? `<p class="season-price">${esc(money(r.expect.price, it.currency))}</p>
                     <p class="season-bar">${
                       cut != null && cut >= 3
                         ? `<span class="down">${cut.toFixed(0)}% under today</span>`
                         : `<span class="dim">no better than today</span>`
                     }</p>
                     <div class="season-prints">${r.prints
                       .map(
                         (p) =>
                           `<span>${p.year} · ${money(p.price, it.currency)} · ${esc(p.retailer)}${
                             p === r.expect ? " · last" : ""
                           }</span>`
                       )
                       .join("")}</div>`
                  : `<p class="season-price dim">—</p><p class="season-bar dim">No print on file</p>`
              }
            </article>`;
          })
          .join("")}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <span class="lbl">Where it's cheapest · ${retailers.length} indexed</span>
        <span class="lbl">Sorted by price</span>
      </div>
      <div class="rtable">
        ${
          retailers
            .map((r) => {
              const over = best != null && r.price != null ? r.price - best : null;
              const href = r.url || (it.productUrls || []).find((u) => u.retailer === r.retailer)?.url || "";
              return `<a class="rrow" data-best="${r.price === best ? "1" : "0"}" ${href ? `href="${esc(href)}" target="_blank" rel="noreferrer"` : ""}>
                <span class="rname">${esc(r.retailer)} ${href ? `<span class="ext">↗</span>` : ""}
                  ${r.price === best ? `<span class="tag-best">best</span>` : ""}
                  ${r.inStock === false ? `<span class="tag-out rmeta">out of stock</span>` : ""}
                </span>
                <span class="rprice">${esc(money(r.price, it.currency))}</span>
                <span class="rover">${over ? `+${money(over, it.currency)}` : over === 0 ? "—" : ""}</span>
              </a>`;
            })
            .join("") || `<div class="empty">No retailers indexed yet.</div>`
        }
      </div>
    </section>

    <section class="section">
      <div class="section-head"><span class="lbl">Pete's log</span></div>
      <div class="feed">
        ${
          [...(it.log || [])]
            .reverse()
            .map(
              (r) => `<div class="feed-row">
                <span class="feed-when" title="${esc(shortDate(r.at))}">${esc(relTime(r.at))}</span>
                <span class="feed-what"><span class="feed-who">${esc(r.actor)}</span> ${esc(r.text)}</span>
                <span class="feed-when">${esc(r.kind)}</span>
              </div>`
            )
            .join("") || `<div class="empty">No log entries.</div>`
        }
      </div>
    </section>

    <div class="row-actions" style="margin-top:var(--s5)">
      <button type="button" class="btn" data-copy-brief="${esc(it.id)}">Copy brief for Grok</button>
      <button type="button" class="btn btn-ghost" data-remove="${esc(it.id)}">Remove from deck</button>
    </div>`;
}

/* ---- Projects -------------------------------------------------------- */

function sortedProjects() {
  const weight = (p) => {
    if (p.status === "blocked") return 0;
    if (p.needsMe) return 1;
    if (p.status === "active") return 2;
    if (p.status === "shipped") return 3;
    return 4;
  };
  return S.projects.slice().sort((a, b) => {
    const w = weight(a) - weight(b);
    if (w) return w;
    return String(b.lastCommit?.at || "").localeCompare(String(a.lastCommit?.at || ""));
  });
}

function commitStrip(p) {
  const commits = p.recentCommits || [];
  if (!commits.length) return "";
  const now = Date.now();
  const buckets = Array.from({ length: 10 }, (_, i) => {
    const from = now - (i + 1) * 7 * 86400000;
    const to = now - i * 7 * 86400000;
    return commits.filter((c) => {
      const t = new Date(c.at).getTime();
      return t > from && t <= to;
    }).length;
  }).reverse();
  const max = Math.max(1, ...buckets);
  return `<span class="commit-strip" role="img" aria-label="Commit activity, last 10 weeks">
    ${buckets
      .map(
        (n) =>
          `<i class="commit-bar" data-hot="${n ? "1" : "0"}" style="height:${Math.max(3, (n / max) * 18).toFixed(0)}px"></i>`
      )
      .join("")}
  </span>`;
}

function projectRow(p) {
  const flag = p.status === "blocked" ? "blocked" : p.needsMe ? "needs" : "";
  const tool = p.lastTool || "Unknown";
  return `<a class="prj" data-flag="${flag}" href="#/shipyard/${esc(p.id)}">
    <span class="prj-tick"></span>
    <div class="prj-body">
      <div class="prj-top">
        <span class="prj-name">${esc(p.name)}</span>
        <span class="prj-owner">${esc(p.owner)}</span>
        ${flag ? `<span class="flag" data-f="${flag}">${flag === "blocked" ? "blocked" : "needs you"}</span>` : ""}
      </div>
      <p class="prj-brief">${esc(p.purpose || p.description || "")}</p>
      <div class="prj-meta">
        <span>${esc(p.status)}</span>
        <span>${esc(p.visibility)}</span>
        <span class="tool" data-t="${esc(tool)}">${esc(tool)}</span>
        <span>${esc(relTime(p.lastCommit?.at))}</span>
      </div>
    </div>
    <div class="prj-right">
      ${commitStrip(p)}
      <span class="prj-owner">${esc((p.recentCommits || []).length)} commits</span>
    </div>
  </a>`;
}

function viewShipyard() {
  const list = sortedProjects();
  const blocked = list.filter((p) => p.status === "blocked" || p.needsMe).length;
  return `
    <header class="page-head">
      <div>
        <span class="lbl">Rig · shipyard</span>
        <h1>Projects</h1>
      </div>
      <p class="lbl">${list.length} repos · ${blocked} need you · sorted by what's stuck</p>
    </header>
    <div class="rows">${list.map(projectRow).join("")}</div>`;
}

function viewProject(id) {
  const p = S.projects.find((x) => x.id === id);
  if (!p) return `<div class="empty">No project “${esc(id)}”.</div>`;
  return `
    <nav class="crumb"><a href="#/shipyard">Projects</a><span>/</span><span>${esc(p.owner)}</span><span>/</span><span>${esc(p.name)}</span></nav>
    <header class="page-head">
      <div>
        <span class="lbl">${esc(p.visibility)} · ${esc(p.status)}${p.needsMe ? " · needs you" : ""}</span>
        <h1>${esc(p.name)}</h1>
        <p class="dim" style="font-size:var(--t-sm);max-width:60ch">${esc(p.purpose || p.description || "")}</p>
      </div>
      ${p.url ? `<a class="btn" href="${esc(p.url)}" target="_blank" rel="noreferrer">GitHub ↗</a>` : ""}
    </header>

    <section class="card" style="margin-bottom:var(--s5)">
      <span class="lbl">Last watch · ${esc(relTime(p.lastCommit?.at))} · ${esc(p.lastTool || "unknown tool")}</span>
      <p style="margin-top:var(--s2);font-size:var(--t-sm);max-width:72ch">${esc(p.lastBriefing || "")}</p>
      ${p.nextAction ? `<p style="margin-top:var(--s3);font-size:var(--t-sm)"><span class="lbl" style="display:inline">Next</span> ${esc(p.nextAction)}</p>` : ""}
    </section>

    <section class="section">
      <div class="section-head"><span class="lbl">Recent commits</span>${commitStrip(p)}</div>
      <div class="feed">
        ${(p.recentCommits || [])
          .map(
            (c) => `<div class="feed-row">
              <span class="feed-when">${esc(relTime(c.at))}</span>
              <span class="feed-what"><span class="feed-who">${esc(c.lastTool || "—")}</span> ${esc(c.subject)}</span>
              <span class="feed-when">${esc(String(c.sha).slice(0, 7))}</span>
            </div>`
          )
          .join("")}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><span class="lbl">Files touched last</span></div>
      <div class="feed">
        ${(p.lastCommit?.files || [])
          .map((f) => `<div class="feed-row"><span class="feed-when"></span><span class="feed-what mono">${esc(f)}</span><span></span></div>`)
          .join("") || `<div class="empty">None recorded.</div>`}
      </div>
    </section>`;
}

/* ---- Mail ------------------------------------------------------------ */

function viewMailbag() {
  const bag = S.mail;
  const list = bag?.payload?.briefings || [];
  return `
    <header class="page-head">
      <div>
        <span class="lbl">Post · mailbag</span>
        <h1>Mail</h1>
      </div>
      <p class="lbl">Last scan ${esc(relTime(bag?.payload?.lastScanAt))} · ${esc(bag?.payload?.cadence || "")}</p>
    </header>
    <div class="rows">
      ${
        list
          .map(
            (b) => `<article class="mail">
              <div class="mail-top">
                <h3>${esc(b.subject)}</h3>
                <span class="lbl">${esc(shortDate(b.at))}${b.needsReply ? " · needs reply" : ""}</span>
              </div>
              <span class="lbl">${esc(b.source || "")}</span>
              <ul>${(b.bullets || []).map((x) => `<li data-reply="${b.needsReply ? "1" : "0"}">${esc(x)}</li>`).join("")}</ul>
            </article>`
          )
          .join("") || `<div class="empty">No briefings yet.</div>`
      }
    </div>`;
}

/* ---- Agents (the MCP surface) ---------------------------------------- */

const MCP_TOOLS = [
  ["get_queue", "Everything waiting on you"],
  ["list_items", "Compact watch list"],
  ["get_item", "One item, live"],
  ["merge_item", "Record a price"],
  ["set_target", "Move the buy line"],
  ["ping", "Push an alert to the deck"],
  ["get_repo", "One project"],
  ["merge_watch", "Update a project watch"],
  ["post_briefing", "Add a mail briefing"],
  ["remove_item", "Hide from the deck (persists on the overlay)"],
  ["restore_item", "Un-hide a removed watch"],
  ["ensure_cutout", "Transparent product PNG via Grok Imagine"],
];

function viewAgents() {
  const base = (S.liveUrl || "").replace(/\/overlay\.json$/, "");
  const connected = Boolean(S.live) && !S.liveError;
  const mcpUrl = base ? `${base}/mcp` : "http://127.0.0.1:8787/mcp";

  return `
    <header class="page-head">
      <div>
        <span class="lbl">The wire</span>
        <h1>Agents</h1>
      </div>
      <p class="lbl">Pete · Rig · Post write over MCP. This page only reads.</p>
    </header>

    <section class="wire">
      <div class="wire-top">
        <div class="wire-state">
          <span class="pulse" data-state="${connected ? "on" : "off"}"></span>
          <span>${connected ? "Connected" : "Not connected"}</span>
          ${connected ? `<span class="dim">· rev ${esc(String(S.live.revision ?? 0))} · last write ${esc(relTime(S.live.updatedAt))}</span>` : ""}
        </div>
        <button type="button" class="btn btn-sm" data-sheet="wire-settings">Change endpoint</button>
      </div>
      <div class="endpoint"><span class="lbl" style="display:inline">MCP</span> ${esc(mcpUrl)}</div>
      <div class="row-actions">
        <button type="button" class="btn" data-copy-mcp>Copy Grok CLI command</button>
        <button type="button" class="btn" data-copy-mcp-json>Copy MCP JSON config</button>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><span class="lbl">Start a price check from here</span></div>
      <div class="card" style="display:grid;gap:var(--s3)">
        <p class="dim" style="font-size:var(--t-sm);max-width:70ch">
          Paste a product link. The deck writes the instruction — hand it to your Grokbot and it loops
          the check over MCP. No JSON file, no copy-paste envelope.
        </p>
        <div class="field">
          <label class="lbl" for="watch-url">Product URL</label>
          <input id="watch-url" type="url" inputmode="url" autocomplete="off" spellcheck="false"
                 placeholder="https://www.bestbuy.com/site/…" />
        </div>
        <div class="field">
          <label class="lbl" for="watch-target">Buy at or under (USD)</label>
          <input id="watch-target" type="text" inputmode="decimal" autocomplete="off" placeholder="449" />
        </div>
        <div class="row-actions">
          <button type="button" class="btn btn-solid" data-build-instruction>Build the instruction</button>
        </div>
        <pre class="code" id="instruction-out" hidden></pre>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><span class="lbl">Tools your bots can call · ${MCP_TOOLS.length}</span></div>
      <div class="tools-grid">
        ${MCP_TOOLS.map(([n, d]) => `<div class="tool-cell"><code>${esc(n)}</code><p>${esc(d)}</p></div>`).join("")}
      </div>
    </section>

    <section class="section">
      <div class="section-head"><span class="lbl">Recent writes</span></div>
      <div class="feed">
        ${
          agentFeed(16)
            .map(
              (r) => `<a class="feed-row" href="${esc(r.href)}">
                <span class="feed-when">${esc(relTime(r.at))}</span>
                <span class="feed-what"><span class="feed-who">${esc(r.who)}</span> ${esc(r.text || "")}</span>
                <span class="feed-when">${esc(r.kind || "")}</span>
              </a>`
            )
            .join("") || `<div class="empty">Nothing on the wire yet.</div>`
        }
      </div>
    </section>

    <details class="fold">
      <summary>Fallback: paste an agent JSON envelope</summary>
      <div class="fold-body">
        <p class="dim" style="font-size:var(--t-sm)">Only needed when the wire is down. The MCP path above is the normal one.</p>
        <div class="field"><textarea id="paste-json" spellcheck="false" placeholder='{ "schemaVersion": "1.0.0", "agent": "Pete", … }'></textarea></div>
        <div class="row-actions"><button type="button" class="btn" data-apply-json>Merge envelope</button></div>
      </div>
    </details>`;
}

/* ============================================================== ROUTER === */

function parseRoute() {
  const raw = (location.hash || "#/").replace(/^#/, "");
  const parts = raw.split("/").filter(Boolean);
  const head = parts[0] || "today";
  if (head === "pirate") return { name: "pirate", id: parts[1] || null };
  if (head === "shipyard") return { name: "shipyard", id: parts.slice(1).join("/") || null };
  if (["mailbag", "agents"].includes(head)) return { name: head, id: null };
  return { name: "today", id: null };
}

function setNav() {
  const key = S.route.name === "today" ? "today" : S.route.name;
  document.querySelectorAll(".nav a, .dock a, .rail-nav a").forEach((a) => {
    a.classList.toggle("is-active", a.dataset.route === key);
  });
  const needs = S.projects.filter((p) => p.needsMe || p.status === "blocked").length;
  const nav = $('.nav a[data-route="shipyard"]');
  if (nav) {
    if (needs) nav.dataset.count = String(needs);
    else delete nav.dataset.count;
  }
}

function renderTelemetry() {
  const hits = S.items.filter(isTargetHit).length;
  const needs = S.projects.filter((p) => p.needsMe || p.status === "blocked").length;
  const reply = (S.mail?.payload?.briefings || []).filter((b) => b.needsReply).length;
  const connected = Boolean(S.live) && !S.liveError;
  const feed = agentFeed(1)[0];
  const bits = [
    `<span class="tele"><span class="pulse" data-state="${connected ? "on" : "off"}"></span>${
      connected ? `wire live · rev <b>${esc(String(S.live.revision ?? 0))}</b>` : "wire offline"
    }</span>`,
    `<span class="tele">watches <b>${S.items.length}</b></span>`,
    `<span class="tele">at target <b class="${hits ? "down" : ""}">${hits}</b></span>`,
    `<span class="tele">repos <b>${S.projects.length}</b></span>`,
    `<span class="tele">need you <b class="${needs ? "up" : ""}">${needs}</b></span>`,
    `<span class="tele">replies <b class="${reply ? "up" : ""}">${reply}</b></span>`,
    feed ? `<span class="tele">last write <b>${esc(relTime(feed.at))}</b> ${esc(feed.who)}</span>` : "",
  ].filter(Boolean);
  el("telemetry").innerHTML = bits.join('<span class="tele-sep"></span>');
  const railLive = el("rail-live");
  if (railLive) {
    railLive.innerHTML = connected
      ? `wire live · rev ${esc(String(S.live.revision ?? 0))}`
      : "wire offline";
  }
}

function render() {
  S.route = parseRoute();
  setNav();
  renderTelemetry();
  const r = S.route;
  let html = "";
  if (r.name === "pirate" && r.id) html = viewItem(r.id);
  else if (r.name === "pirate") html = viewPirate();
  else if (r.name === "shipyard" && r.id) html = viewProject(r.id);
  else if (r.name === "shipyard") html = viewShipyard();
  else if (r.name === "mailbag") html = viewMailbag();
  else if (r.name === "agents") html = viewAgents();
  else html = viewToday();
  el("stage").innerHTML = html;
  wireChart();
}

/* ------------------------------------------------------- chart crosshair -- */

let chartResizeObserver = null;

function wireChart() {
  chartResizeObserver?.disconnect();
  chartResizeObserver = null;

  const peekOpen = el("peek") && !el("peek").hidden;
  const wrap = peekOpen ? el("peek").querySelector("[data-chart]") : $(".chart");
  if (!wrap) return;
  const itemId = wrap.dataset.chartItem || S.route.id || S.peekId;
  const item = S.items.find((x) => x.id === itemId);
  if (!item) return;

  let lastW = 0;
  const mount = () => {
    // innerHTML swaps also trip the observer — only redraw on a real width change
    const w = Math.round(wrap.clientWidth);
    if (w === lastW && wrap.dataset.drawnRange === S.chartRange && wrap.querySelector("svg")) return;
    lastW = w;
    wrap.dataset.drawnRange = S.chartRange;
    const geo = drawChart(wrap, item, S.chartRange);
    if (!geo) return;
    const { W, padL, padR, padT, padB, H, rows } = geo;
    const plotW = W - padL - padR;

    const tip = document.createElement("div");
    tip.className = "chart-tip";
    tip.hidden = true;
    wrap.appendChild(tip);

    const svg = wrap.querySelector("svg");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("class", "crosshair");
    line.setAttribute("y1", String(padT));
    line.setAttribute("y2", String(H - padB));
    line.style.display = "none";
    svg.appendChild(line);

    wrap.addEventListener("pointermove", (ev) => {
      const box = wrap.getBoundingClientRect();
      const x = ev.clientX - box.left;
      const frac = Math.max(0, Math.min(1, (x - padL) / plotW));
      const row = rows[Math.round(frac * (rows.length - 1))];
      if (!row) return;
      const px = padL + frac * plotW;
      line.style.display = "";
      line.setAttribute("x1", String(px));
      line.setAttribute("x2", String(px));
      tip.hidden = false;
      tip.style.left = `${px}px`;
      tip.style.top = `${H * 0.4}px`;
      tip.innerHTML = `<b>${money(row.price, item.currency)}</b> · ${esc(row.retailer || "")}<br>${shortDate(row.date)}`;
    });
    wrap.addEventListener("pointerleave", () => {
      tip.hidden = true;
      line.style.display = "none";
    });
  };

  mount();

  // redraw at the new pixel size on resize (debounced) so text never stretches
  let t;
  chartResizeObserver = new ResizeObserver(() => {
    clearTimeout(t);
    t = setTimeout(mount, 140);
  });
  chartResizeObserver.observe(wrap);
}

/* ========================================================== INTERACTION == */

/* ---- sheets ---------------------------------------------------------- */

function openSheet(title, body) {
  el("sheet-title").textContent = title;
  el("sheet-body").innerHTML = body;
  el("sheet").hidden = false;
  const first = el("sheet-body").querySelector("input, textarea, button");
  first?.focus();
}
function closeSheet() {
  el("sheet").hidden = true;
}

function sheetFor(kind, id) {
  if (kind === "edit-target") {
    const it = S.items.find((x) => x.id === id);
    if (!it) return;
    const b = buildBrief(it);
    openSheet(
      `Buy line — ${it.name}`,
      `<p class="dim" style="font-size:var(--t-sm)">Pete pings the deck the moment a retailer prints at or under this number.</p>
       <form class="field" data-target-form="${esc(it.id)}">
         <label class="lbl" for="tgt">Target (USD)</label>
         <input id="tgt" name="target" inputmode="decimal" value="${esc(it.targetPrice ?? "")}" autocomplete="off">
         <div class="row-actions" style="margin-top:var(--s3)">
           <button type="submit" class="btn btn-solid">Save target</button>
           ${
             b.suggestedTarget && b.suggestedTarget !== it.targetPrice
               ? `<button type="button" class="btn" data-apply-target="${esc(it.id)}" data-value="${esc(b.suggestedTarget)}">Use ${esc(money(b.suggestedTarget, it.currency))}</button>`
               : ""
           }
         </div>
       </form>`
    );
  }
  if (kind === "wire-settings") {
    const p = readPrefs();
    openSheet(
      "Wire endpoint",
      `<p class="dim" style="font-size:var(--t-sm)">Reads go to <span class="mono">overlay.json</span>. Paste the bot token so Remove / Restore / Target persist on the live overlay instead of only this browser.</p>
       <div class="field">
         <label class="lbl" for="live-url">Overlay URL</label>
         <input id="live-url" value="${esc(S.liveUrl)}" spellcheck="false" autocomplete="off"
                placeholder="https://mindkeep-live.<you>.workers.dev/overlay.json">
       </div>
       <div class="field">
         <label class="lbl" for="live-token">Bot write token</label>
         <input id="live-token" type="password" value="${esc(p.writeToken || "")}" spellcheck="false" autocomplete="off"
                placeholder="same value as BOT_TOKEN on the Worker">
       </div>
       <div class="row-actions"><button type="button" class="btn btn-solid" data-save-live>Save</button></div>`
    );
  }
  if (kind === "add-watch") {
    location.hash = "#/agents";
    closeSheet();
    setTimeout(() => el("watch-url")?.focus(), 120);
  }
  if (kind === "settings") {
    openSheet(
      "Deck",
      `<div class="field">
         <span class="lbl">Wire</span>
         <p class="dim" style="font-size:var(--t-sm)">${
           S.live && !S.liveError ? `Connected · revision ${esc(String(S.live.revision ?? 0))}` : "Offline — showing the committed vault."
         }</p>
       </div>
       <div class="row-actions">
         <button type="button" class="btn" data-sheet="wire-settings">Endpoint</button>
         <button type="button" class="btn" data-export>Export vault</button>
         <button type="button" class="btn" data-reset>Reset local overlay</button>
       </div>`
    );
  }
}

/* ---- command palette -------------------------------------------------- */

function paletteRows(q) {
  const query = q.trim().toLowerCase();
  const rows = [];
  const commands = [
    { kind: "→", title: "Go to Deck", trail: "", href: "#/" },
    { kind: "→", title: "Go to Prices", trail: "", href: "#/pirate" },
    { kind: "→", title: "Go to Projects", trail: "", href: "#/shipyard" },
    { kind: "→", title: "Go to Mail", trail: "", href: "#/mailbag" },
    { kind: "→", title: "Go to Agents / the wire", trail: "", href: "#/agents" },
    { kind: "+", title: "Add a price watch", trail: "", href: "#/agents" },
  ];
  for (const it of S.items) {
    const b = buildBrief(it);
    rows.push({
      kind: "$",
      title: it.name,
      sub: `${it.currentBest?.retailer || ""} · target ${money(it.targetPrice, it.currency)}`,
      trail: money(it.currentBest?.price, it.currency),
      call: b.call,
      href: `#/pirate/${it.id}`,
      hay: `${it.name} ${it.variant} ${it.category} ${it.id}`.toLowerCase(),
    });
  }
  for (const p of S.projects) {
    rows.push({
      kind: "⌥",
      title: p.name,
      sub: `${p.owner} · ${p.status}`,
      trail: relTime(p.lastCommit?.at),
      href: `#/shipyard/${p.id}`,
      hay: `${p.id} ${p.name} ${p.purpose || ""} ${p.description || ""}`.toLowerCase(),
    });
  }
  for (const b of S.mail?.payload?.briefings || []) {
    rows.push({
      kind: "✉",
      title: b.subject,
      sub: b.source || "",
      trail: relTime(b.at),
      href: "#/mailbag",
      hay: `${b.subject} ${(b.bullets || []).join(" ")}`.toLowerCase(),
    });
  }
  const cmds = commands.filter((c) => !query || c.title.toLowerCase().includes(query));
  const hits = rows.filter((r) => !query || r.hay.includes(query));
  return [...(query ? [] : cmds.slice(0, 5)), ...hits.slice(0, 8), ...(query ? cmds.slice(0, 3) : [])];
}

function renderPalette() {
  const list = el("palette-list");
  S.paletteRows = paletteRows(el("palette-input").value);
  if (S.paletteIdx >= S.paletteRows.length) S.paletteIdx = 0;
  list.innerHTML =
    S.paletteRows
      .map(
        (r, i) => `<li role="option" aria-selected="${i === S.paletteIdx}" data-href="${esc(r.href)}">
          <span class="palette-kind">${esc(r.kind)}</span>
          <span class="palette-main"><strong>${esc(r.title)}</strong>${r.sub ? `<span>${esc(r.sub)}</span>` : ""}</span>
          <span class="palette-trail">${r.call ? `<span class="verdict" data-call="${esc(r.call)}">${esc(callLabel(r.call))}</span> ` : ""}${esc(r.trail || "")}</span>
        </li>`
      )
      .join("") || `<li class="palette-group dim" style="font-size:var(--t-sm)">Nothing matches.</li>`;
  list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
}

function openPalette() {
  el("palette").hidden = false;
  el("palette-input").value = "";
  S.paletteIdx = 0;
  renderPalette();
  el("palette-input").focus();
}
function closePalette() {
  el("palette").hidden = true;
}

/* ---- local overlay (targets / removals) -------------------------------- */

function overlay() {
  const p = readPrefs();
  p.targets = p.targets || {};
  p.removed = p.removed || [];
  p.itemImages = p.itemImages || {};
  return p;
}
function saveTarget(id, value) {
  const p = overlay();
  p.targets[id] = value;
  writePrefs(p);
  const it = S.items.find((x) => x.id === id);
  if (it) it.targetPrice = value;
  persistLive("set_target", { id, targetPrice: value }, "Target saved");
}

function setChartRange(id) {
  S.chartRange = id || "all";
  const p = readPrefs();
  p.chartRange = S.chartRange;
  writePrefs(p);
  document.querySelectorAll("[data-chart-range]").forEach((btn) => {
    btn.setAttribute("aria-pressed", btn.dataset.chartRange === S.chartRange ? "true" : "false");
  });
  document.querySelectorAll("[data-chart-range-select]").forEach((sel) => {
    sel.value = S.chartRange;
  });
  document.querySelectorAll("[data-chart]").forEach((w) => {
    w.dataset.drawnRange = "";
  });
  wireChart();
}

async function removeWatch(id) {
  if (!window.confirm("Remove from Price Pirate? History stays. This hides it on the live overlay when a write token is set.")) return;
  const p = overlay();
  p.removed = [...new Set([...(p.removed || []), id])];
  writePrefs(p);
  closePeek();
  await persistLive("remove_item", { id }, "Removed from the deck");
  location.hash = "#/pirate";
  await boot();
}

function peekHTML(it) {
  const b = buildBrief(it);
  const g = gradeItem(it);
  return `
    <div class="peek-hero">
      ${thumbHTML(it)}
      <div>
        <span class="lbl">${esc(it.category || "item")} · ${esc(it.cadence || "")}</span>
        <h2 class="peek-title" id="peek-title">${esc(it.name)}</h2>
        <p class="dim" style="font-size:var(--t-sm)">${esc(it.variant || "")}</p>
      </div>
    </div>
    <p class="peek-price">${esc(money(it.currentBest?.price, it.currency))}
      <span class="dim" style="font-size:var(--t-sm)"> at ${esc(it.currentBest?.retailer || "—")} · ${deltaHTML(g.stats.change7dPct, " 7d")}</span>
    </p>
    <div class="hero-verdict" style="margin:var(--s3) 0">
      <span class="verdict" data-call="${esc(b.call)}">${esc(callLabel(b.call))}</span>
      <span class="hero-call">${esc(b.headline)}</span>
    </div>
    ${meterHTML(it)}
    <p class="dim" style="font-size:var(--t-sm);margin:var(--s3) 0">${esc(b.body)}</p>
    <div class="chart-head">
      <span class="lbl">Tape</span>
      ${rangeSelectHTML(it.priceHistory || [], S.chartRange)}
    </div>
    <div class="chart" data-chart data-chart-item="${esc(it.id)}"></div>
    <div class="peek-actions">
      <a class="btn btn-solid" href="#/pirate/${esc(it.id)}" data-open-full>Open full page</a>
      ${it.currentBest?.url ? `<a class="btn" href="${esc(it.currentBest.url)}" target="_blank" rel="noreferrer">Open ${esc(it.currentBest.retailer)} ↗</a>` : ""}
      <button type="button" class="btn btn-ghost" data-remove="${esc(it.id)}">Remove</button>
    </div>`;
}

function openPeek(id, originEl) {
  const it = S.items.find((x) => x.id === id);
  if (!it) return;
  S.peekId = id;
  const peek = el("peek");
  el("peek-body").innerHTML = peekHTML(it);
  peek.hidden = false;
  wireChart();
  const card = peek.querySelector(".peek-card");
  if (originEl && card && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const from = originEl.getBoundingClientRect();
    const to = card.getBoundingClientRect();
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    card.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(0.92)`, opacity: 0.4 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" }
    );
  }
}

function closePeek() {
  const peek = el("peek");
  if (!peek || peek.hidden) return;
  peek.hidden = true;
  S.peekId = null;
  el("peek-body").innerHTML = "";
  if (S.route.name === "pirate" && S.route.id) wireChart();
}

/* ---- copy blocks -------------------------------------------------------- */

function mcpBase() {
  return (S.liveUrl || "http://127.0.0.1:8787/overlay.json").replace(/\/overlay\.json$/, "");
}

function watchInstruction(url, target) {
  const base = mcpBase();
  return `Watch this for me in MindKeep.

URL: ${url}
Buy at or under: $${target || "—"}

Use the mindkeep MCP server (${base}/mcp):
1. list_items — check whether it is already on the deck.
2. If it is new, merge_item with a slug id, the price you find, and the retailer.
3. set_target with that id and targetPrice ${target || "<decide one>"}.
4. Re-check daily. Every time, merge_item the best price you find and the retailer.
5. The moment any retailer prints at or under the target, call ping with the item id.
6. After creating a new watch, call ensure_cutout so the deck gets a transparent product PNG.

Do not paste JSON at me — write it over MCP.`;
}

/* ---- global events ------------------------------------------------------ */

document.addEventListener("click", async (e) => {
  const t = e.target;

  if (t.closest("[data-close-palette]")) return closePalette();
  if (t.closest("[data-close-sheet]")) return closeSheet();
  if (t.closest("#cmd-open") || t.closest("[data-open-palette]")) return openPalette();
  if (t.closest("#settings-btn")) return sheetFor("settings");
  if (t.closest("[data-close-peek]")) {
    e.preventDefault();
    return closePeek();
  }

  const rangeBtn = t.closest("[data-chart-range]");
  if (rangeBtn) {
    e.preventDefault();
    setChartRange(rangeBtn.dataset.chartRange);
    return;
  }

  const peekBtn = t.closest("[data-peek]");
  if (peekBtn && !t.closest("[data-recheck], [data-remove], [data-open-full]")) {
    e.preventDefault();
    return openPeek(peekBtn.dataset.peek, peekBtn.closest(".prow, .hbar, article") || peekBtn);
  }

  const removeBtn = t.closest("[data-remove]");
  if (removeBtn) {
    e.preventDefault();
    e.stopPropagation();
    return removeWatch(removeBtn.dataset.remove);
  }

  const sheetBtn = t.closest("[data-sheet]");
  if (sheetBtn) {
    e.preventDefault();
    return sheetFor(sheetBtn.dataset.sheet, sheetBtn.dataset.id);
  }

  const opt = t.closest(".palette-list li[data-href]");
  if (opt) {
    location.hash = opt.dataset.href;
    return closePalette();
  }

  const f = t.closest("[data-filter]");
  if (f) {
    S.filter = f.dataset.filter;
    return render();
  }

  const sortBtn = t.closest("[data-sort]");
  if (sortBtn) {
    const k = sortBtn.dataset.sort;
    S.sort = S.sort.key === k ? { key: k, dir: S.sort.dir === "asc" ? "desc" : "asc" } : { key: k, dir: "asc" };
    return render();
  }

  const applyTarget = t.closest("[data-apply-target]");
  if (applyTarget) {
    e.preventDefault();
    saveTarget(applyTarget.dataset.applyTarget, Number(applyTarget.dataset.value));
    closeSheet();
    toast("Target moved.");
    return render();
  }

  const recheck = t.closest("[data-recheck]");
  if (recheck) {
    e.preventDefault();
    e.stopPropagation();
    const it = S.items.find((x) => x.id === recheck.dataset.recheck);
    return copy(
      `Re-check ${it.name} in MindKeep now. Call get_item("${it.id}") on the mindkeep MCP server, find today's best price across ${(it.retailers || []).map((r) => r.retailer).join(", ")}, then merge_item with the price and retailer. Ping me if it prints at or under $${it.targetPrice}.`,
      "Re-check instruction copied — paste it to Pete."
    );
  }

  const brief = t.closest("[data-copy-brief]");
  if (brief) {
    const it = S.items.find((x) => x.id === brief.dataset.copyBrief);
    const b = buildBrief(it);
    const s = seasonalRead(it);
    return copy(
      `${it.name} — ${callLabel(b.call)}
Now: ${money(it.currentBest?.price, it.currency)} at ${it.currentBest?.retailer}
Target: ${money(it.targetPrice, it.currency)}
Low on record: ${it.allTimeLow ? `${money(it.allTimeLow.price, it.currency)} ${it.allTimeLow.retailer} ${it.allTimeLow.date}` : "none"}
${b.headline} ${b.body}
Season: ${s.call.head} ${s.call.body}`,
      "Brief copied."
    );
  }

  if (t.closest("[data-copy-mcp]")) {
    return copy(
      `grok mcp add --transport http mindkeep ${mcpBase()}/mcp --header "Authorization: Bearer $MINDKEEP_TOKEN"`,
      "Grok CLI command copied."
    );
  }
  if (t.closest("[data-copy-mcp-json]")) {
    return copy(
      JSON.stringify(
        {
          mcpServers: {
            mindkeep: {
              type: "http",
              url: `${mcpBase()}/mcp`,
              headers: { Authorization: "Bearer ${MINDKEEP_TOKEN}" },
            },
          },
        },
        null,
        2
      ),
      "MCP config copied."
    );
  }

  if (t.closest("[data-build-instruction]")) {
    const url = el("watch-url").value.trim();
    const target = el("watch-target").value.trim();
    if (!url) return toast("Paste a product URL first.");
    const out = el("instruction-out");
    out.textContent = watchInstruction(url, target);
    out.hidden = false;
    return copy(watchInstruction(url, target), "Instruction built and copied — send it to your bot.");
  }

  if (t.closest("[data-save-live]")) {
    const p = readPrefs();
    p.liveUrl = el("live-url").value.trim();
    if (el("live-token")) p.writeToken = el("live-token").value.trim();
    writePrefs(p);
    closeSheet();
    toast("Endpoint saved.");
    return boot();
  }

  if (t.closest("[data-export]")) {
    const blob = new Blob([JSON.stringify({ items: S.items, projects: S.projects }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mindkeep-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    return toast("Exported.");
  }

  if (t.closest("[data-reset]")) {
    localStorage.removeItem(PREFS_KEY);
    closeSheet();
    toast("Local overlay cleared.");
    return boot();
  }
});

document.addEventListener("change", (e) => {
  const sel = e.target.closest("[data-chart-range-select]");
  if (sel) setChartRange(sel.value);
});

document.addEventListener("submit", (e) => {
  const form = e.target.closest("[data-target-form]");
  if (!form) return;
  e.preventDefault();
  const v = Number(new FormData(form).get("target"));
  if (!Number.isFinite(v) || v <= 0) return toast("Needs a dollar amount.");
  saveTarget(form.dataset.targetForm, v);
  closeSheet();
  toast("Target saved. Pete pings when it prints.");
  render();
});

document.addEventListener("keydown", (e) => {
  const paletteOpen = !el("palette").hidden;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    return paletteOpen ? closePalette() : openPalette();
  }
  if (e.key === "Escape") {
    closePalette();
    closeSheet();
    closePeek();
    return;
  }
  if (
    e.key === "/" &&
    !paletteOpen &&
    !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)
  ) {
    e.preventDefault();
    return openPalette();
  }
  if (!paletteOpen) return;
  if (e.key === "ArrowDown") {
    e.preventDefault();
    S.paletteIdx = Math.min(S.paletteIdx + 1, S.paletteRows.length - 1);
    renderPalette();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    S.paletteIdx = Math.max(S.paletteIdx - 1, 0);
    renderPalette();
  } else if (e.key === "Enter") {
    const row = S.paletteRows[S.paletteIdx];
    if (row) {
      location.hash = row.href;
      closePalette();
    }
  }
});

el("palette-input").addEventListener("input", () => {
  S.paletteIdx = 0;
  renderPalette();
});

window.addEventListener("hashchange", () => {
  closePeek();
  render();
  window.scrollTo(0, 0);
});

/* ================================================================= BOOT == */

function resolveLiveUrl(cfg) {
  const p = readPrefs();
  if (p.liveUrl) return p.liveUrl;
  if (cfg.overlayUrl) return cfg.overlayUrl;
  const h = location.hostname;
  if (h === "localhost" || h === "127.0.0.1")
    return cfg.localOverlayUrl || "http://127.0.0.1:8787/overlay.json";
  return "";
}

function applyLocalTargets() {
  const p = overlay();
  for (const it of S.items) {
    if (p.targets[it.id] != null) it.targetPrice = Number(p.targets[it.id]);
    if (p.itemImages?.[it.id]) {
      it.imageUrl = p.itemImages[it.id];
      it.imageSource = "cutout";
    }
  }
}

async function polishCutouts() {
  const p = overlay();
  p.itemImages = p.itemImages || {};
  let wrote = false;
  for (const it of S.items) {
    if (p.itemImages[it.id]) continue;
    if (!it.needsCutout && it.imageSource !== "imagine-raw") continue;
    if (!it.imageUrl || String(it.imageUrl).startsWith("data:")) continue;
    try {
      const cut = await cutoutFromUrl(it.imageUrl);
      if (!cut) continue;
      p.itemImages[it.id] = cut;
      it.imageUrl = cut;
      it.imageSource = "cutout";
      it.needsCutout = false;
      wrote = true;
    } catch {
      /* Worker Imagine is the other path */
    }
  }
  if (wrote) writePrefs(p);
}

let lastRevision = null;

async function boot() {
  const manifest = await getJson("../data/manifest.json");
  const bays = {};
  for (const row of manifest.bays) bays[row.id] = await getJson(`../${row.file}`);

  const cfg = await getJson("../data/live.json").catch(() => ({}));
  S.liveUrl = resolveLiveUrl(cfg);
  S.live = null;
  S.liveError = null;
  if (S.liveUrl) {
    try {
      S.live = await getJson(S.liveUrl);
    } catch (err) {
      S.liveError = err.message;
    }
  }

  const inbox = await getJson("../data/inbox/index.json").catch(() => ({ files: [] }));
  const drops = [];
  for (const file of inbox.files || []) {
    const drop = await getJson(`../data/inbox/${file}`).catch(() => null);
    if (drop) drops.push(drop);
  }
  drops.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const drop of drops) applyEnvelope(bays, drop);

  applyLiveOverlay(bays, S.live);

  S.items = bays.pirate?.payload?.items || [];
  const removed = new Set([...(S.live?.removedIds || []), ...overlay().removed]);
  S.items = S.items.filter((it) => !removed.has(it.id));
  applyLocalTargets();
  polishCutouts();

  S.projects = [];
  for (const acc of bays.shipyard?.payload?.accounts || []) {
    for (const p of acc.projects || []) S.projects.push({ ...p, account: acc });
  }
  S.mail = bays.mailbag;

  const rank = { now: 0, soon: 1, info: 2 };
  S.alerts = [];
  for (const [bayId, bay] of Object.entries(bays)) {
    for (const a of bay.alerts || []) S.alerts.push({ ...a, bayId, operator: bay.operator });
  }
  for (const p of S.live?.alerts || []) S.alerts.push({ ...p, bayId: "pirate", operator: "Pete" });
  S.alerts.sort((a, b) => (rank[a.level] ?? 9) - (rank[b.level] ?? 9));

  // acknowledge a fresh agent write with one settle-flash, never a strobe
  if (lastRevision != null && S.live?.revision !== lastRevision) {
    const tel = el("telemetry");
    tel.classList.remove("is-fresh");
    void tel.offsetWidth;
    tel.classList.add("is-fresh");
  }
  lastRevision = S.live?.revision ?? null;

  render();
}

setInterval(async () => {
  if (!S.liveUrl) return;
  try {
    const live = await getJson(S.liveUrl);
    if (live.revision !== lastRevision) await boot();
  } catch {
    /* wire down — keep the committed vault on screen */
  }
}, 4000);

boot().catch((err) => {
  el("stage").innerHTML = `<div class="empty">Could not load the vault — serve over http, not file://.<br><span class="mono">${esc(err.message)}</span></div>`;
});
