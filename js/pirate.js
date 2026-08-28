import { buildBrief, isTargetHit } from "./brief.js";
import { gradeItem } from "./grades.js";
import { historyFor, seasonalRows, sparkSVG } from "./spark.js";
import { isRecurring, visibleItems } from "./vault.js";
import { esc, money, monogram, pct, relTime, shortDate, signedClass } from "./format.js";

function gradeChip(g) {
  return `<span class="grade grade-${esc(g.grade)}">${esc(g.grade)}</span>`;
}

export function thumbHTML(item, size = "lg") {
  const label = esc(item.name);
  if (item.imageUrl) {
    return `<span class="thumb thumb-${size}"><img class="thumb-img" src="${esc(item.imageUrl)}" alt="" width="160" height="160"></span>`;
  }
  return `<span class="thumb thumb-${size} thumb-mono" aria-hidden="true">${esc(monogram(item.name || label))}</span>`;
}

function cadenceLabel(item) {
  if (isRecurring(item)) return item.cadence;
  return "once";
}

function sparkButton(item, retailer = null, { grow = true, size = "sm" } = {}) {
  const rows = historyFor(item, retailer);
  const w = size === "lg" ? 560 : 132;
  const h = size === "lg" ? 120 : 36;
  const key = retailer ? `${item.id}::${retailer}` : item.id;
  const svg = sparkSVG(rows, {
    w,
    h,
    label: retailer ? `${item.name} at ${retailer}` : `${item.name} price trend`,
  });
  const grown = sparkSVG(historyFor(item, retailer), {
    w: 640,
    h: 150,
    label: `${item.name} expanded trend`,
  });
  return `<button type="button" class="spark-hit" data-spark="${esc(key)}" aria-expanded="false" aria-label="Expand price trend">
    <span class="spark-mini">${svg}</span>
    ${grow ? `<span class="spark-grow" hidden>${grown}</span>` : ""}
  </button>`;
}

function watchCard(it) {
  const g = gradeItem(it);
  const ch = g.stats.change7dPct;
  const hit = isTargetHit(it);
  return `<article class="watch-card" data-grade="${esc(g.grade)}" data-hit="${hit ? "1" : "0"}">
    <button type="button" class="icon-btn watch-remove" data-remove-item="${esc(it.id)}" aria-label="Remove ${esc(it.name)}">Remove</button>
    <a class="watch-thumb" href="#/pirate/${esc(it.id)}" aria-label="${esc(it.name)}">${thumbHTML(it, "lg")}</a>
    <div class="watch-body">
      <a class="watch-name" href="#/pirate/${esc(it.id)}">${esc(it.name)}</a>
      <p class="dim watch-var">${esc(it.variant || "")}</p>
      <div class="watch-nums">
        <span class="num watch-price">${esc(money(it.currentBest?.price, it.currency))}</span>
        <span class="pct ${signedClass(ch, { invert: true })}">${esc(pct(ch))} 7d</span>
        ${gradeChip(g)}
        ${hit ? `<span class="grade grade-steal">target hit</span>` : ""}
      </div>
      <p class="meta">target ${esc(money(it.targetPrice, it.currency))} · ${esc(cadenceLabel(it))} · ${esc(it.currentBest?.retailer || "")}</p>
      ${sparkButton(it)}
    </div>
  </article>`;
}

export function renderPirateList(state) {
  const items = visibleItems(state);
  const recurring = items.filter(isRecurring).map(watchCard);
  const once = items.filter((it) => !isRecurring(it)).map(watchCard);
  const hits = items.filter(isTargetHit);
  return `
    <header class="page-head">
      <div>
        <p class="kicker">Operator Pete</p>
        <h1>Price Pirate</h1>
      </div>
      <p class="legend">Down is good. Name opens the item. The spark opens a larger tape. Remove hides it from the deck — history stays in the vault.</p>
    </header>
    ${
      hits.length
        ? `<div class="hit-strip">${hits
            .map(
              (it) =>
                `<a class="chip" href="#/pirate/${esc(it.id)}"><strong>${esc(it.name)}</strong><span class="good">target hit · ${esc(money(it.currentBest?.price, it.currency))}</span></a>`
            )
            .join("")}</div>`
        : ""
    }
    <section class="watch-section">
      <p class="kicker">Recurring watch</p>
      <p class="dim section-note">Daily / weekly / biweekly. Pete keeps a tape on these.</p>
      <div class="watch-list">
        ${recurring.join("") || `<p class="empty">No recurring watches.</p>`}
      </div>
    </section>
    <section class="watch-section">
      <p class="kicker">One-time check</p>
      <p class="dim section-note">Manual cadence. One look, then it sits until you ask again.</p>
      <div class="watch-list">
        ${once.join("") || `<p class="empty">No one-time checks.</p>`}
      </div>
    </section>
  `;
}

function seasonalCard(item, type, title) {
  const rows = seasonalRows(item, type);
  if (!rows.length) {
    return `<article class="card season-card">
      <p class="kpi-label">${esc(title)}</p>
      <p class="dim">No ${esc(title)} print on file.</p>
    </article>`;
  }
  const last = rows[rows.length - 1];
  return `<article class="card season-card">
    <p class="kpi-label">${esc(title)}</p>
    <p class="kpi-value">${esc(money(last.price, item.currency))}</p>
    <p class="dim">${esc(last.date)} · ${esc(last.retailer)}</p>
    ${sparkSVG(
      rows.map((r) => ({ date: r.date, price: r.price })),
      { w: 180, h: 40, label: `${title} prints` }
    )}
    <ul class="season-list">
      ${rows.map((r) => `<li><span class="mono">${esc(r.date)}</span> ${esc(money(r.price, item.currency))} · ${esc(r.retailer)}</li>`).join("")}
    </ul>
  </article>`;
}

export function peteBrief(it, g) {
  const brief = buildBrief(it);
  const urls = (it.productUrls || []).map((u) => `- ${u.retailer}: ${u.url}`).join("\n");
  return `# Pete brief — ${it.name}

- id: ${it.id}
- call: ${brief.call}
- ${brief.headline}
- ${brief.body}
- target: ${money(it.targetPrice, it.currency)}${brief.hit ? " · HIT" : ""}
- suggested target: ${money(brief.suggestedTarget, it.currency)}
- current: ${money(it.currentBest?.price, it.currency)} (${it.currentBest?.retailer || "—"})
- ATL: ${it.allTimeLow ? `${money(it.allTimeLow.price, it.currency)} ${it.allTimeLow.retailer} ${it.allTimeLow.date}` : "none"}
- grade: ${g.grade} — ${g.rule}
- cadence: ${it.cadence}

## URLs
${urls || "- none"}
`;
}

export function renderPirateItem(state, id) {
  const it = visibleItems(state).find((x) => x.id === id) || state.bays.pirate?.payload?.items?.find((x) => x.id === id);
  if (!it) return `<p class="empty">No item ${esc(id)}. It may have been removed — restore it on Data.</p>`;
  const g = gradeItem(it);
  const brief = buildBrief(it);
  const hit = brief.hit;
  const windows = [
    ["1d", g.stats.change1dPct],
    ["7d", g.stats.change7dPct],
    ["30d", g.stats.change30dPct],
    ["90d", g.stats.change90dPct],
  ];
  const retailers = it.retailers || [];
  return `
    <nav class="crumb"><a href="#/pirate">Price Pirate</a><span class="dim">/</span><span>${esc(it.name)}</span></nav>
    <header class="item-head">
      ${thumbHTML(it, "sm")}
      <div class="item-head-copy">
        <p class="kicker">Pete · ${esc(it.category || "item")} · ${esc(cadenceLabel(it))}</p>
        <h1>${esc(it.name)}</h1>
        <p class="dim">${esc(it.variant || "")}</p>
      </div>
      <div class="actions">
        <button type="button" class="btn btn-primary" data-copy-pete="${esc(it.id)}">Copy Pete brief</button>
        <button type="button" class="btn" data-remove-item="${esc(it.id)}">Remove</button>
      </div>
    </header>

    <section class="target-hero ${hit ? "is-hit" : ""}">
      <div>
        <p class="kicker">Price target</p>
        <p class="kpi-value">${esc(money(it.targetPrice, it.currency))}</p>
        <p class="dim">${hit ? "Hit. Ping Pete." : "Watch for this number. ATL is trivia if the floor moved."}</p>
      </div>
      <form class="target-form" data-target-form="${esc(it.id)}">
        <label>
          <span class="kpi-label">Set target (USD)</span>
          <input class="target-input" name="target" inputmode="decimal" autocomplete="off" value="${esc(it.targetPrice ?? "")}">
        </label>
        <button type="submit" class="btn btn-primary">Save target</button>
      </form>
    </section>

    <section class="card brief-card call-${esc(brief.call)}">
      <p class="kicker">Brief</p>
      <h2>${esc(brief.headline)}</h2>
      <p>${esc(brief.body)}</p>
      ${
        brief.call === "retarget"
          ? `<p class="meta">Suggested live target <span class="num">${esc(money(brief.suggestedTarget, it.currency))}</span>
             <button type="button" class="btn" data-apply-target="${esc(it.id)}" data-target-value="${esc(brief.suggestedTarget)}">Use suggested</button></p>`
          : ""
      }
    </section>

    <div class="quick-refs">
      <article class="kpi">
        <div class="kpi-label">Best now</div>
        <p class="kpi-value">${esc(money(it.currentBest?.price, it.currency))}</p>
        <p class="dim">${esc(it.currentBest?.retailer || "")} · ${esc(relTime(it.currentBest?.observedAt))}</p>
      </article>
      <article class="kpi">
        <div class="kpi-label">Best on record</div>
        <p class="kpi-value">${esc(it.allTimeLow ? money(it.allTimeLow.price, it.currency) : "—")}</p>
        <p class="dim">${esc(it.allTimeLow ? `${it.allTimeLow.retailer} · ${shortDate(it.allTimeLow.date)}` : "no ATL")}</p>
        ${brief.atlUnlikely ? `<p class="meta">Unlikely to reprint</p>` : ""}
      </article>
      ${windows
        .map(
          ([label, v]) =>
            `<article class="kpi"><div class="kpi-label">${label}</div><p class="kpi-value ${signedClass(v, { invert: true })}">${esc(pct(v))}</p></article>`
        )
        .join("")}
    </div>

    <div class="season-grid">
      ${seasonalCard(it, "black_friday", "Black Friday")}
      ${seasonalCard(it, "cyber_monday", "Cyber Monday")}
      ${seasonalCard(it, "prime_day", "Prime Day")}
    </div>

    <div class="chart-wrap"><canvas id="price-chart" aria-label="Price history"></canvas></div>

    <section class="card">
      <h3>Indexed sites</h3>
      <p class="dim">Each row is a retailer tape. Open the site in a new tab. The spark is that store only.</p>
      <div class="retailer-list">
        ${
          retailers.length
            ? retailers
                .map((r) => {
                  const href = r.url || (it.productUrls || []).find((u) => u.retailer === r.retailer)?.url || "";
                  return `<article class="retailer-row">
                    <div>
                      <a class="retailer-name" href="${esc(href)}" ${href ? 'target="_blank" rel="noreferrer"' : ""}>${esc(r.retailer)}</a>
                      ${r.isWinner ? `<span class="good">best now</span>` : ""}
                      ${r.setAtl ? `<span class="dim">set ATL</span>` : ""}
                      <p class="dim">${r.inStock ? "in stock" : "out"} · ${esc(relTime(r.lastSeenAt))}</p>
                    </div>
                    <div class="retailer-right">
                      <span class="num">${esc(money(r.price, it.currency))}</span>
                      ${sparkButton(it, r.retailer, { size: "sm" })}
                    </div>
                  </article>`;
                })
                .join("")
            : `<p class="dim">No retailers indexed.</p>`
        }
      </div>
    </section>

    <section class="card png-card">
      <h3>Product PNG</h3>
      <p class="dim">Transparent PNG, no background. The list uses a large thumb; this page keeps it small. Drop a file to override the vault cutout. Stored in the local overlay — not committed.</p>
      <label class="btn">Bring in PNG
        <input type="file" accept="image/png,image/webp" data-import-png="${esc(it.id)}" hidden>
      </label>
    </section>

    <section class="card">
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
  `;
}
