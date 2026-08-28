import { gradeItem, enrichProject } from "./grades.js";
import { allAlerts, allItems, allProjects } from "./vault.js";
import {
  ageDays,
  copyText,
  esc,
  isoDay,
  money,
  monogram,
  pct,
  relTime,
  shortDate,
  shortSha,
  signedClass,
} from "./format.js";

let chart;

function gradeChip(g) {
  return `<span class="grade grade-${esc(g.grade)}">${esc(g.grade)}</span>`;
}

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
  const items = allItems(state.bays);
  const projects = allProjects(state.bays);
  const steals = items.filter((it) => gradeItem(it).grade === "steal").length;
  const need = projects.filter((p) => p.needsMe).length;
  const active = projects.filter((p) => p.status === "active").length;
  const lastMail = state.bays.mailbag?.payload?.lastScanAt;
  return [
    { label: "Watched items", value: String(items.length) },
    { label: "Steals", value: String(steals) },
    { label: "Repos that need me", value: String(need) },
    { label: "Active repos", value: String(active) },
    { label: "Last mailbag scan", value: relTime(lastMail) },
  ];
}

function inMotion(state) {
  const now = Date.now();
  const items = allItems(state.bays)
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
  const alerts = allAlerts(state.bays);
  const motion = inMotion(state);
  const k = kpis(state);
  const empty = !allItems(state.bays).length && !allProjects(state.bays).length;
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
  const items = allItems(state.bays).map((it) => ({ it, g: gradeItem(it) }));
  return `
    <header class="page-head">
      <div>
        <p class="kicker">Operator Pete</p>
        <h1>Price Pirate</h1>
      </div>
      <p class="legend">Down is good. Blue = down / steal. Pink = up / high.</p>
    </header>
    <div class="ticker" aria-label="Watched ticker">
      ${items
        .map(({ it, g }) => {
          const ch = g.stats.change7dPct;
          return `<a href="#/pirate/${esc(it.id)}" data-grade="${esc(g.grade)}">
            <strong>${esc(it.name)}</strong>
            <span class="num">${esc(money(it.currentBest?.price, it.currency))}</span>
            <span class="pct ${signedClass(ch, { invert: true })}">${esc(pct(ch))} 7d</span>
            ${gradeChip(g)}
          </a>`;
        })
        .join("")}
    </div>
    <div class="tbl-scroll" role="region" aria-labelledby="watch-cap" tabindex="0">
      <table>
        <caption id="watch-cap" class="sr-only">Watchlist</caption>
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th class="col-p2">Variant</th>
            <th class="num">Best</th>
            <th class="num col-p2">vs ATL</th>
            <th class="num">7d</th>
            <th>Grade</th>
            <th>Status</th>
            <th class="col-p2">Checked</th>
          </tr>
        </thead>
        <tbody>
          ${items
            .map(({ it, g }) => {
              const ch = g.stats.change7dPct;
              return `<tr data-href="#/pirate/${esc(it.id)}">
                <td>${mark(it.name)}</td>
                <td>${esc(it.name)}</td>
                <td class="col-p2 dim">${esc(it.variant || "")}</td>
                <td class="num">${esc(money(it.currentBest?.price, it.currency))}<div class="dim">${esc(it.currentBest?.retailer || "")}</div></td>
                <td class="num col-p2 ${signedClass(g.stats.vsAtlPct, { invert: true })}">${esc(pct(g.stats.vsAtlPct))}</td>
                <td class="num ${signedClass(ch, { invert: true })}">${esc(pct(ch))}</td>
                <td>${gradeChip(g)}</td>
                <td><span class="status-pill" data-status="${esc(it.status)}">${esc(it.status)}</span></td>
                <td class="col-p2 mono">${esc(relTime(it.lastCheckedAt))}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function peteBrief(it, g) {
  const urls = (it.productUrls || []).map((u) => `- ${u.retailer}: ${u.url}`).join("\n");
  const last = [...(it.priceHistory || [])]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 8)
    .map((h) => `- ${isoDay(h.date)}  ${money(h.price, it.currency)}  ${h.retailer}`)
    .join("\n");
  return `# Pete brief — ${it.name}

- id: ${it.id}
- variant: ${it.variant || ""}
- status: ${it.status}
- target: ${money(it.targetPrice, it.currency)}
- current: ${money(it.currentBest?.price, it.currency)} (${it.currentBest?.retailer || "—"})
- ATL: ${it.allTimeLow ? `${money(it.allTimeLow.price, it.currency)} ${it.allTimeLow.retailer} ${it.allTimeLow.date}` : "none"}
- grade: ${g.grade} — ${g.rule}
- identifiers: ASIN ${it.identifiers?.asin || "—"} · UPC ${it.identifiers?.upc || "—"} · model ${it.identifiers?.model || "—"}

## URLs
${urls || "- none"}

## Last prices
${last || "- none"}
`;
}

export function renderPirateItem(state, id) {
  const it = allItems(state.bays).find((x) => x.id === id);
  if (!it) return `<p class="empty">No item ${esc(id)}.</p>`;
  const g = gradeItem(it);
  const windows = [
    ["1d", g.stats.change1dPct],
    ["7d", g.stats.change7dPct],
    ["30d", g.stats.change30dPct],
    ["90d", g.stats.change90dPct],
  ];
  return `
    <nav class="crumb"><a href="#/pirate">Price Pirate</a><span class="dim">/</span><span>${esc(it.name)}</span></nav>
    <header class="page-head">
      <div>
        <p class="kicker">Pete · ${esc(it.category || "item")}</p>
        <h1>${esc(it.name)}</h1>
        <p class="dim">${esc(it.variant || "")}</p>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-copy-pete="${esc(it.id)}">Copy Pete brief</button>
      </div>
    </header>
    <p class="legend">${gradeChip(g)} Rule: ${esc(g.rule)}. Down is good.</p>
    <div class="stat-row">
      <article class="kpi"><div class="kpi-label">Best now</div><p class="kpi-value">${esc(money(it.currentBest?.price, it.currency))}</p><p class="dim">${esc(it.currentBest?.retailer || "")}</p></article>
      <article class="kpi"><div class="kpi-label">ATL</div><p class="kpi-value">${esc(it.allTimeLow ? money(it.allTimeLow.price, it.currency) : "—")}</p><p class="dim">${esc(it.allTimeLow ? `${it.allTimeLow.retailer} · ${shortDate(it.allTimeLow.date)}` : "no ATL")}</p></article>
      <article class="kpi"><div class="kpi-label">Target</div><p class="kpi-value">${esc(money(it.targetPrice, it.currency))}</p></article>
      ${windows
        .map(
          ([label, v]) =>
            `<article class="kpi"><div class="kpi-label">${label}</div><p class="kpi-value ${signedClass(v, { invert: true })}">${esc(pct(v))}</p></article>`
        )
        .join("")}
    </div>
    <div class="chart-wrap"><canvas id="price-chart" aria-label="Price history"></canvas></div>
    <div class="two-col">
      <section class="card">
        <h3>Retailer scoreboard</h3>
        <div class="tbl-scroll" role="region" tabindex="0" aria-label="Retailers">
          <table>
            <thead><tr><th>Retailer</th><th class="num">Price</th><th>Stock</th><th class="col-p2">Seen</th></tr></thead>
            <tbody>
              ${(it.retailers || [])
                .map(
                  (r) => `<tr>
                    <td>${esc(r.retailer)}${r.isWinner ? ' <span class="good">best</span>' : ""}${r.setAtl ? ' <span class="dim">ATL</span>' : ""}</td>
                    <td class="num">${esc(money(r.price, it.currency))}</td>
                    <td>${r.inStock ? "in" : "out"}</td>
                    <td class="col-p2 mono">${esc(relTime(r.lastSeenAt))}</td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section class="card">
        <h3>Seasonal cards</h3>
        ${(it.saleEvents || []).length
          ? (it.saleEvents || [])
              .map(
                (e) => `<p><strong>${esc(e.name)} ${esc(e.year)}</strong><br><span class="num">${esc(money(e.price, it.currency))}</span> · ${esc(e.retailer)}<br><span class="dim">${esc(e.notes || "")}</span></p>`
              )
              .join("")
          : `<p class="dim">No seasonal prints yet.</p>`}
      </section>
    </div>
    <section class="card" style="margin-top:1rem">
      <h3>Pete log</h3>
      <ul class="log">
        ${(it.log || [])
          .slice()
          .reverse()
          .map(
            (row) => `<li><div class="meta">${esc(shortDate(row.at))} · ${esc(row.actor)} · ${esc(row.kind)}</div><p>${esc(row.text)}</p></li>`
          )
          .join("")}
      </ul>
    </section>
    <p class="dim" style="margin-top:1rem">${esc(it.why || "")}</p>
  `;
}

export function mountPirateChart(item) {
  destroyChart();
  const canvas = document.getElementById("price-chart");
  if (!canvas || !window.Chart) return;
  const history = [...(item.priceHistory || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
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
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label(ctx) {
              return money(ctx.parsed.y, item.currency);
            },
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
      <h3>Vault</h3>
      <div class="actions">
        <button type="button" class="btn" data-export-vault>Export vault JSON</button>
        <button type="button" class="btn" data-reset-overlay>Reset overlay</button>
      </div>
      <p class="dim">localStorage key <span class="mono">mindkeep-vault-v1</span>. Overlay merges by item/repo id and unions price history. It never deletes old history.</p>
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
  for (const it of allItems(state.bays)) {
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

export { peteBrief, TEMPLATES };
