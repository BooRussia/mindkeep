import { esc, money } from "./format.js";

/**
 * Recorded price envelope: all-time low ↔ all-time high, with today's print
 * as a position on that rail. Independent of the buy-line meter.
 */
export function priceEnvelope(item) {
  const hist = (item.priceHistory || []).map((h) => Number(h.price)).filter(Number.isFinite);
  const current = item.currentBest?.price;
  if (current == null && !hist.length) return null;

  const histLo = hist.length ? Math.min(...hist) : current;
  const histHi = hist.length ? Math.max(...hist) : current;
  let atl = item.allTimeLow?.price ?? histLo;
  let ath = item.allTimeHigh?.price ?? histHi;
  if (current != null) {
    if (current < atl) atl = current;
    if (current > ath) ath = current;
  }
  const now = current ?? histHi;
  const span = ath - atl;
  const position = span > 0 ? Math.max(0, Math.min(100, ((now - atl) / span) * 100)) : 50;
  const vsLowPct = atl ? ((now - atl) / atl) * 100 : null;
  const vsHighPct = ath ? ((now - ath) / ath) * 100 : null; // negative = under the high

  let band = "mid";
  if (position <= 12) band = "low";
  else if (position >= 88) band = "high";

  return {
    atl,
    ath,
    current: now,
    position,
    vsLowPct,
    vsHighPct,
    band,
    atlDate: item.allTimeLow?.date || null,
    athDate: item.allTimeHigh?.date || null,
  };
}

function vsLabel(env) {
  if (!env) return "no range yet";
  if (env.band === "low") return "near the floor";
  if (env.band === "high") return "near the high";
  const up = env.vsLowPct;
  const down = env.vsHighPct;
  if (up == null || down == null) return "";
  return `${up.toFixed(0)}% off floor · ${Math.abs(down).toFixed(0)}% under high`;
}

export function envelopeHTML(item, { compact = false } = {}) {
  const env = priceEnvelope(item);
  if (!env) {
    return `<div class="envelope"><div class="envelope-rail"></div><div class="envelope-legend"><span>no range yet</span></div></div>`;
  }
  const lo = money(env.atl, item.currency).replace(/\.00$/, "");
  const hi = money(env.ath, item.currency).replace(/\.00$/, "");
  const now = money(env.current, item.currency).replace(/\.00$/, "");
  const title = `Low ${lo}${env.atlDate ? ` (${env.atlDate})` : ""} · now ${now} · high ${hi}${env.athDate ? ` (${env.athDate})` : ""}`;
  if (compact) {
    return `<div class="envelope envelope-compact" data-band="${env.band}" title="${esc(title)}">
      <span class="envelope-end">${esc(lo)}</span>
      <div class="envelope-rail">
        <div class="envelope-fill" style="width:${env.position.toFixed(1)}%"></div>
        <div class="envelope-dot" style="left:${env.position.toFixed(1)}%"></div>
      </div>
      <span class="envelope-end">${esc(hi)}</span>
    </div>`;
  }
  return `<div class="envelope" data-band="${env.band}" title="${esc(title)}">
    <div class="envelope-rail">
      <div class="envelope-fill" style="width:${env.position.toFixed(1)}%"></div>
      <div class="envelope-dot" style="left:${env.position.toFixed(1)}%"></div>
    </div>
    <div class="envelope-legend">
      <span>low ${esc(lo)}</span>
      <span class="envelope-now">${esc(now)} · ${esc(vsLabel(env))}</span>
      <span>high ${esc(hi)}</span>
    </div>
  </div>`;
}
