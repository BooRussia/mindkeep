import { enrichProject } from "./grades.js";
import { allAlerts, allProjects, removedItems, visibleItems } from "./vault.js";
import {
  ageDays,
  esc,
  isoDay,
  money,
  monogram,
  relTime,
  shortDate,
  shortSha,
} from "./format.js";
import { peteBrief as piratePeteBrief, renderPirateItem as pirateItemView, renderPirateList as pirateListView } from "./pirate.js";
import { historyInRange } from "./range.js";

let chart;

function mark(name) {
  return `<span class="mono-mark" aria-hidden="true">${esc(monogram(name))}</span>`;
}

export function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 2400);
}

export function destroyChart() {
  if (chart) {
    chart.destroy();
    chart = null;
  }
}

function kpis(state) {
  const items = visibleItems(state);
  const projects = allProjects(state.bays);
  const hits = items.filter((it) => it.targetPrice != null && it.currentBest?.price <= it.targetPrice).length;
  const need = projects.filter((p) => p.needsMe).length;
  const active = projects.filter((p) => p.status === "active").length;
  const lastMail = state.bays.mailbag?.payload?.lastScanAt;
  return [
    { label: "Watched items", value: String(items.length) },
    { label: "Target hits", value: String(hits) },
    { label: "Repos that need me", value: String(need) },
    { label: "Active repos", value: String(active) },
    { label: "Last mailbag scan", value: relTime(lastMail) },
  ];
}

function inMotion(state) {
  const now = Date.now();
  const items = visibleItems(state)
    .filter((it) => ageDays(it.lastCheckedAt, now) <= 7)
    .map((it) => ({
      href: `#/pirate/${it.id}`,
      title: it.name,
      sub: `${it.currentBest?.retailer || ""} ${money(it.currentBest?.price, it.currency)}`,
    }));
  const repos = allProjects(state.bays)
    .filter((p) => ageDays(p.lastCommit?.at, now) <= 7)
    .map((p) => ({
      href: `#/shipyard/${p.id}`,
      title: p.name,
      sub: `${p.lastTool || p.inferred?.tool || ""} · ${relTime(p.lastCommit?.at)}`,
    }));
  return [...items, ...repos];
}

export function renderToday(state) {
  const alerts = allAlerts(state);
  const motion = inMotion(state);
  const k = kpis(state);
  const empty = !visibleItems(state).length && !allProjects(state.bays).length;
  if (empty) {
    return `<div class="empty">Add a quarry or import JSON.</div>`;
  }
  return `
    <header class="page-head">
      <div>
        <p class="kicker">Command deck</p>
        <h1>Today</h1>
      </div>
      <p class="dim">${esc(new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }))}</p>
    </header>
    <section>
      <p class="kicker">Needs you</p>
      <div class="queue">
        ${
          alerts.length
            ? alerts
                .map(
                  (a) => `
          <a class="alert" data-level="${esc(a.level)}" href="${esc(a.href || "#/")}">
            <span class="alert-tick" aria-hidden="true"></span>
            <div>
              <h3>${esc(a.title)}</h3>
              <p>${esc(a.body)}</p>
            </div>
            <span class="meta">${esc(a.level)} · ${esc(a.operator || a.bayId)}</span>
          </a>`
                )
                .join("")
            : `<p class="dim">Queue is clear.</p>`
        }
      </div>
    </section>
    <section>
      <p class="kicker">In motion · 7 days</p>
      <div class="chip-row">
        ${
          motion.length
            ? motion
                .map(
                  (m) => `<a class="chip" href="${esc(m.href)}"><strong>${esc(m.title)}</strong><span class="dim">${esc(m.sub)}</span></a>`
                )
                .join("")
            : `<p class="dim">Nothing touched this week.</p>`
        }
      </div>
    </section>
    <section>
      <p class="kicker">Deck</p>
      <div class="kpis">
        ${k
          .map(
            (x) => `<article class="kpi"><div class="kpi-label">${esc(x.label)}</div><p class="kpi-value">${esc(x.value)}</p></article>`
          )
          .join("")}
      </div>
    </section>
  `;
}

export function renderPirateList(state) {
  return pirateListView(state);
}

export function peteBrief(it, g) {
  return piratePeteBrief(it, g);
}

export function renderPirateItem(state, id, rangeId) {
  return pirateItemView(state, id, rangeId);
}

export function mountPirateChart(item, rangeId = "all") {
  destroyChart();
  const canvas = document.getElementById("price-chart");
  if (!canvas || !window.Chart) return;
  const history = historyInRange(item.priceHistory || [], rangeId);
  const labels = history.map((h) => isoDay(h.date));
  const data = history.map((h) => h.price);
  const blue = getComputedStyle(document.documentElement).getPropertyValue("--blue").trim() || "#4D9EFF";
  const dim = getComputedStyle(document.documentElement).getPropertyValue("--text-dim").trim() || "#8A8A8A";
  const glowOn = document.documentElement.dataset.glow === "on";
  const atl = item.allTimeLow?.price;
  const eventMarks = (item.saleEvents || []).map((e) => {
    const stamp =
      e.type === "black_friday"
        ? `${e.year}-11-28`
        : e.type === "cyber_monday"
          ? `${e.year}-12-01`
          : e.type === "prime_day"
            ? `${e.year}-07-08`
            : null;
    const idx = stamp ? labels.findIndex((d) => d >= stamp) : -1;
    return { idx, y: e.price, label: `${e.name} ${e.year}` };
  });
  const eventData = labels.map((d, i) => {
    const hit = eventMarks.find((e) => e.idx === i);
    return hit ? hit.y : null;
  });

  const glowPlugin = {
    id: "lineGlow",
    beforeDatasetDraw(c, args) {
      if (!glowOn || args.index !== 0) return;
      const ctx = c.ctx;
      ctx.save();
      ctx.shadowColor = blue;
      ctx.shadowBlur = 16;
    },
    afterDatasetDraw(c, args) {
      if (!glowOn || args.index !== 0) return;
      c.ctx.restore();
    },
  };

  chart = new window.Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Best seen",
          data,
          borderColor: blue,
          backgroundColor: getComputedStyle(document.documentElement).getPropertyValue("--chart-fill").trim(),
          borderWidth: 1.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHitRadius: 28,
          pointHoverBackgroundColor: blue,
          pointHoverBorderColor: "#fff",
          pointHoverBorderWidth: 1.5,
          tension: 0.15,
          fill: false,
        },
        atl
          ? {
              label: "ATL",
              data: labels.map(() => atl),
              borderColor: dim,
              borderDash: [4, 4],
              borderWidth: 1,
              pointRadius: 0,
            }
          : null,
        eventMarks.some((e) => e.idx >= 0)
          ? {
              label: "Events",
              data: eventData,
              borderColor: "transparent",
              pointRadius: 4,
              pointBackgroundColor: blue,
              showLine: false,
              spanGaps: false,
            }
          : null,
      ].filter(Boolean),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: glowOn ? { duration: 400 } : false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          displayColors: false,
          backgroundColor: "rgba(18, 18, 22, 0.96)",
          borderColor: "rgba(255,255,255,0.12)",
          borderWidth: 1,
          padding: 10,
          caretPadding: 8,
          titleFont: { family: "IBM Plex Mono", size: 11, weight: "500" },
          bodyFont: { family: "IBM Plex Mono", size: 13, weight: "600" },
          titleColor: "#9a9aa2",
          bodyColor: blue,
          callbacks: {
            title(items) {
              const row = history[items[0]?.dataIndex];
              return row ? shortDate(row.date) : "";
            },
            label(ctx) {
              if (ctx.dataset.label !== "Best seen") return "";
              const row = history[ctx.dataIndex];
              const price = money(row?.price ?? ctx.parsed.y, item.currency);
              return row?.retailer ? `${price}  ·  ${row.retailer}` : price;
            },
            labelColor() {
              return { borderColor: "transparent", backgroundColor: "transparent" };
            },
          },
          filter(item) {
            return item.dataset.label === "Best seen";
          },
        },
      },
      scales: {
        x: {
          ticks: {
            maxTicksLimit: 8,
            color: dim,
            font: { family: "IBM Plex Mono", size: 10 },
          },
          grid: { color: getComputedStyle(document.documentElement).getPropertyValue("--line").trim() },
        },
        y: {
          ticks: {
            color: dim,
            font: { family: "IBM Plex Mono", size: 10 },
            callback: (v) => money(v, item.currency),
          },
          grid: { color: getComputedStyle(document.documentElement).getPropertyValue("--line").trim() },
        },
      },
    },
    plugins: [glowPlugin],
  });
}

export function renderShipyard(state) {
  const accounts = state.bays.shipyard?.payload?.accounts || [];
  return `
    <header class="page-head">
      <div>
        <p class="kicker">Operator Rig</p>
        <h1>Shipyard</h1>
      </div>
      <p class="dim">${accounts.length} accounts</p>
    </header>
    ${accounts
      .map((acc) => {
        return `<section class="account-block">
          <p class="kicker">${esc(acc.displayName || acc.login)} · ${esc(acc.host)}</p>
          <div class="cards">
            ${(acc.projects || [])
              .map((p) => {
                const inf = enrichProject(p);
                return `<a class="card project-card" href="#/shipyard/${esc(p.id)}">
                  ${mark(p.name)}
                  <div>
                    <h3>${esc(p.name)}</h3>
                    <p class="dim">${esc(p.purpose || p.description || "")}</p>
                    <div class="meta-row">
                      <span class="status-pill" data-status="${esc(p.status)}">${esc(p.status)}</span>
                      <span>${esc(p.visibility)}</span>
                      <span>${esc(inf.inferred.tool)}</span>
                      <span class="mono">${esc(relTime(p.lastCommit?.at))}</span>
                      ${p.needsMe ? `<span class="needs-me">needs me</span>` : ""}
                    </div>
                  </div>
                </a>`;
              })
              .join("")}
          </div>
        </section>`;
      })
      .join("")}
  `;
}

export function renderShipyardProject(state, id) {
  const p = allProjects(state.bays).find((x) => x.id === id);
  if (!p) return `<p class="empty">No project ${esc(id)}.</p>`;
  const inf = enrichProject(p);
  const files = p.lastCommit?.files || [];
  return `
    <nav class="crumb"><a href="#/shipyard">Shipyard</a><span class="dim">/</span><span>${esc(p.owner)}</span><span class="dim">/</span><span>${esc(p.name)}</span></nav>
    <header class="page-head">
      <div>
        <p class="kicker">${esc(p.visibility)} · ${esc(p.status)}${p.needsMe ? " · needs me" : ""}</p>
        <h1>${esc(p.name)}</h1>
        <p class="dim">${esc(p.purpose || p.description || "")}</p>
      </div>
      ${p.url ? `<a class="btn" href="${esc(p.url)}" target="_blank" rel="noreferrer">Open on GitHub</a>` : ""}
    </header>
    <section class="card" style="margin-bottom:1rem">
      <p class="kicker">Last watch</p>
      <p class="mono">${esc(relTime(p.lastCommit?.at))} · ${esc(p.lastCommit?.authorName || "—")} · ${esc(inf.inferred.tool)}</p>
      <p>${esc(p.lastBriefing || "")}</p>
      <p class="dim">${esc(inf.inferred.evidence)} (${esc(inf.inferred.certainty)})</p>
      <details class="raw">
        <summary>Raw commit subject</summary>
        <p class="mono">${esc(p.lastCommit?.subject || "—")}</p>
        <pre>${esc(p.lastCommit?.body || "")}</pre>
      </details>
    </section>
    <div class="two-col">
      <section class="card">
        <h3>Files touched</h3>
        <ul class="path-list">
          ${files.map((f) => `<li>${esc(f)}</li>`).join("") || "<li class='dim'>None recorded</li>"}
        </ul>
        <h3 style="margin-top:1rem">Next action</h3>
        <p>${esc(p.nextAction || "—")}</p>
      </section>
      <section class="card">
        <h3>Last 8 commits</h3>
        <ul class="log">
          ${(p.recentCommits || [])
            .slice(0, 8)
            .map(
              (c) => `<li>
                <div class="meta"><span class="sha">${esc(shortSha(c.sha))}</span> · ${esc(relTime(c.at))} · ${esc(c.lastTool || "—")}</div>
                <p>${esc(c.subject)}</p>
              </li>`
            )
            .join("")}
        </ul>
      </section>
    </div>
  `;
}

export function renderMailbag(state) {
  const bag = state.bays.mailbag;
  const list = bag?.payload?.briefings || [];
  return `
    <header class="page-head">
      <div>
        <p class="kicker">Operator Post</p>
        <h1>Mailbag</h1>
      </div>
      <p class="dim">Last scan ${esc(relTime(bag?.payload?.lastScanAt))} · ${esc(bag?.payload?.cadence || "")}</p>
    </header>
    <p class="legend">No Gmail API in this browser. Post writes JSON; this screen only renders it.</p>
    <div class="queue">
      ${list
        .map(
          (b) => `<article class="brief">
            <div class="meta">${esc(shortDate(b.at))} · ${esc(b.severity)} ${b.needsReply ? "· needs reply" : ""}</div>
            <h3>${esc(b.subject)}</h3>
            <p class="dim">${esc(b.source || "")}</p>
            <ul>${(b.bullets || []).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
          </article>`
        )
        .join("")}
    </div>
  `;
}

const TEMPLATES = {
  Pete: `{
  "schemaVersion": "1.0.0",
  "agent": "Pete",
  "bayId": "pirate",
  "at": "${new Date().toISOString()}",
  "kind": "merge",
  "payload": {
    "items": [
      {
        "id": "item-id",
        "targetPrice": 0,
        "currentBest": { "price": 0, "retailer": "", "url": "", "inStock": true, "observedAt": "${new Date().toISOString()}", "notes": "" },
        "priceHistory": [{ "date": "${new Date().toISOString()}", "price": 0, "retailer": "", "source": "agent" }]
      }
    ]
  }
}`,
  Rig: `{
  "schemaVersion": "1.0.0",
  "agent": "Rig",
  "bayId": "shipyard",
  "at": "${new Date().toISOString()}",
  "kind": "merge",
  "payload": {
    "accounts": [
      {
        "id": "owner",
        "login": "owner",
        "projects": [
          {
            "id": "owner/repo",
            "lastBriefing": "",
            "needsMe": false,
            "lastCommit": { "sha": "", "at": "${new Date().toISOString()}", "subject": "", "body": "", "authorName": "", "authorEmail": "", "committerName": "", "files": [], "url": "" }
          }
        ]
      }
    ]
  }
}`,
  Post: `{
  "schemaVersion": "1.0.0",
  "agent": "Post",
  "bayId": "mailbag",
  "at": "${new Date().toISOString()}",
  "kind": "merge",
  "payload": {
    "lastScanAt": "${new Date().toISOString()}",
    "briefings": [
      {
        "id": "mb-id",
        "at": "${new Date().toISOString()}",
        "operator": "Post",
        "subject": "",
        "severity": "info",
        "needsReply": false,
        "bullets": [],
        "body": "",
        "source": "Gmail last 24h · 0 threads",
        "threadCount": 0
      }
    ]
  }
}`,
};

export function renderDispatch(state, agent = "Pete") {
  return `
    <header class="page-head">
      <div>
        <p class="kicker">Agents</p>
        <h1>Dispatch</h1>
      </div>
    </header>
    <div class="agent-pick" role="radiogroup" aria-label="Agent">
      ${["Pete", "Rig", "Post"]
        .map(
          (a) =>
            `<button type="button" class="btn" data-agent="${a}" aria-pressed="${a === agent}">${a}</button>`
        )
        .join("")}
    </div>
    <section class="card">
      <h3>Copy ${esc(agent)} brief template</h3>
      <pre id="brief-template">${esc(TEMPLATES[agent])}</pre>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-copy-template>Copy template</button>
        <button type="button" class="btn" data-copy-ping>Copy target-hit ping</button>
        <button type="button" class="btn" data-load-example>Load example Pete drop</button>
        <button type="button" class="btn" id="dispatch-paste">Paste agent JSON</button>
      </div>
    </section>
    <p class="dim">Overlay drops: ${esc(String(state.overlay.drops.length))}. Published JSON in /data stays the source of truth.</p>
  `;
}

export function renderData(state, themeDoc, prefs) {
  const theme = prefs.theme || "default";
  const effects = prefs.effects !== false;
  const paths = [
    "data/manifest.json",
    "data/theme.json",
    ...(state.manifest.bays || []).map((b) => b.file),
    "data/inbox/example-pete.json",
  ];
  return `
    <header class="page-head">
      <div>
        <p class="kicker">Deck</p>
        <h1>Data</h1>
      </div>
    </header>
    <section>
      <p class="kicker">Theme presets</p>
      <div class="theme-picks">
        ${Object.values(themeDoc.presets)
          .map(
            (p) => `<button type="button" class="card" data-theme-id="${esc(p.id)}" aria-pressed="${p.id === theme}">
              <h3>${esc(p.label)}</h3>
              <p class="dim">${esc(p.note)}</p>
            </button>`
          )
          .join("")}
      </div>
    </section>
    <section class="card" style="margin-bottom:1.5rem">
      <label class="toggle">
        <span>Three.js field</span>
        <button type="button" class="btn" data-effects-toggle aria-pressed="${effects}">${effects ? "On" : "Off"}</button>
      </label>
      <p class="dim">Reduced-motion also disables the canvas. Dim preset turns glow off.</p>
    </section>
    <section class="card" style="margin-bottom:1.5rem">
      <h3>Live overlay</h3>
      <p class="dim">${
        state.live && !state.liveError
          ? `Connected · revision ${esc(String(state.live.revision ?? 0))} · ${esc(state.live.updatedAt || "waiting")}`
          : state.liveError
            ? `Unreachable: ${esc(state.liveError)}`
            : "Not connected. Pete talks to the Worker; this page only reads overlay.json."
      }</p>
      <label>
        <span class="kpi-label">Overlay URL</span>
        <input class="target-input" id="live-url" value="${esc(prefs.liveUrl || "")}" placeholder="https://mindkeep-live.your-account.workers.dev/overlay.json" autocomplete="off" spellcheck="false">
      </label>
      <label>
        <span class="kpi-label">Bot write token</span>
        <input class="target-input" id="live-token" type="password" value="${esc(prefs.writeToken || "")}" placeholder="same value as BOT_TOKEN on the Worker" autocomplete="off" spellcheck="false">
      </label>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-save-live-url>Save live URL + token</button>
      </div>
      <p class="dim">The token stays in this browser's localStorage and is used when you remove a watch, restore one, or save a target — so those writes land on the live overlay instead of dying on refresh. Bots still use MCP. Never commit the token. See <span class="mono">live/README.md</span>.</p>
    </section>
    <section class="card" style="margin-bottom:1.5rem">
      <h3>Vault</h3>
      <div class="actions">
        <button type="button" class="btn" data-export-vault>Export vault JSON</button>
        <button type="button" class="btn" data-reset-overlay>Reset overlay</button>
      </div>
      <p class="dim">localStorage key <span class="mono">mindkeep-vault-v1</span>. Overlay merges by item/repo id and unions price history. It never deletes old history. Remove hides an item on the live overlay when a write token is set; otherwise it only hides it in this browser.</p>
    </section>
    <section class="card" style="margin-bottom:1.5rem">
      <label class="toggle">
        <span>Pete pings in this browser</span>
        <button type="button" class="btn" data-notify-toggle>${prefs.notify === false ? "Off" : "On"}</button>
      </label>
      <p class="dim">When a live price meets the target, MindKeep writes a ping and can fire a desktop notification. Pete can also drop an inbox alert. No scrape, no Gmail.</p>
    </section>
    <section class="card" style="margin-bottom:1.5rem">
      <h3>Removed from Price Pirate</h3>
      ${
        removedItems(state).length
          ? `<ul class="path-list">${removedItems(state)
              .map(
                (it) =>
                  `<li>${esc(it.name)} <button type="button" class="btn" data-restore-item="${esc(it.id)}">Restore</button></li>`
              )
              .join("")}</ul>`
          : `<p class="dim">None. Remove on a watch card; history stays in /data.</p>`
      }
    </section>
    <section class="card" style="margin-bottom:1.5rem">
      <h3>Product PNGs</h3>
      <p class="dim">Cutouts live in <span class="mono">assets/products/[id].png</span>. Bring a transparent PNG on the item page to override locally.</p>
    </section>
    <section class="card" style="margin-bottom:1.5rem">
      <h3>Expected paths</h3>
      <ul class="path-list">${paths.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
    </section>
    <section class="card warn-box">
      <h3>Never commit tokens</h3>
      <p>No PATs, no Gmail OAuth, no retailer keys. Optional live GitHub API is public-repo only and is not wired in this build.</p>
    </section>
  `;
}

export function renderGeneric(bay) {
  if (!bay) return `<p class="empty">Unknown bay.</p>`;
  return `
    <header class="page-head">
      <div>
        <p class="kicker">Operator ${esc(bay.operator || "—")}</p>
        <h1>${esc(bay.bayId)}</h1>
      </div>
    </header>
    <div class="queue">
      ${(bay.alerts || [])
        .map(
          (a) => `<article class="alert" data-level="${esc(a.level)}">
            <span class="alert-tick"></span>
            <div><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p></div>
          </article>`
        )
        .join("")}
    </div>
    <pre>${esc(JSON.stringify(bay.payload || {}, null, 2))}</pre>
  `;
}

export function searchIndex(state) {
  const out = [];
  for (const it of visibleItems(state)) {
    out.push({
      href: `#/pirate/${it.id}`,
      title: it.name,
      sub: `Price Pirate · ${it.variant || ""}`,
      hay: `${it.name} ${it.variant} ${it.id} ${it.category}`.toLowerCase(),
    });
  }
  for (const p of allProjects(state.bays)) {
    out.push({
      href: `#/shipyard/${p.id}`,
      title: p.name,
      sub: `Shipyard · ${p.owner}`,
      hay: `${p.id} ${p.name} ${p.purpose} ${p.description}`.toLowerCase(),
    });
  }
  for (const b of state.bays.mailbag?.payload?.briefings || []) {
    out.push({
      href: "#/mailbag",
      title: b.subject,
      sub: `Mailbag · ${shortDate(b.at)}`,
      hay: `${b.subject} ${(b.bullets || []).join(" ")}`.toLowerCase(),
    });
  }
  return out;
}

export const PING_TEMPLATE = `{
  "schemaVersion": "1.0.0",
  "agent": "Pete",
  "bayId": "pirate",
  "at": "${new Date().toISOString()}",
  "kind": "alert",
  "payload": {
    "level": "now",
    "title": "Target hit: item-id",
    "body": "Live price met the watch target. Buy window is open.",
    "href": "#/pirate/item-id"
  }
}`;

export { TEMPLATES };
