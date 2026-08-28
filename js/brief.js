import { gradeItem } from "./grades.js";
import { money } from "./format.js";

const MARKET = {
  "dyson-v15-detect-extra": {
    atlUnlikely: false,
    why: "V15 Extra is still in the US cordless cycle. $429 ATL is recent enough to be a live line, not a dead print.",
    suggestedTarget: 429,
  },
  "sony-wh-1000xm5": {
    atlUnlikely: true,
    why: "XM6 is the current flagship. XM5’s $248 Black Friday 2024 print is a previous-gen doorbuster. Do not wait for that ATL; watch a used-gen sale floor.",
    suggestedTarget: 279,
  },
  "lg-c4-65": {
    atlUnlikely: true,
    why: "C5 took the 2025 doorbuster slot. A 2024 launch-year $996 on a C4 is not coming back — same pattern as RAM/GPU once a new gen and supply shock land. Set a live target, not the museum ATL.",
    suggestedTarget: 1199,
  },
  "weber-genesis-e-325s": {
    atlUnlikely: false,
    why: "Four prints. No ATL, no seasonal card. Do not invent a floor. Need Ace/Lowe’s and last BF before this target means anything.",
    suggestedTarget: 899,
  },
  "framework-laptop-16": {
    atlUnlikely: false,
    why: "DIY kit, not commodity DRAM. The $1,549 BF print was a configured batch; $1,699 is the line Framework actually restocks. Treat target as the buy signal, ATL as trivia.",
    suggestedTarget: 1699,
  },
};

function roundWatch(n) {
  if (n == null) return null;
  return Math.round(n / 10) * 10 - 1;
}

export function isTargetHit(item) {
  const current = item.currentBest?.price;
  const target = item.targetPrice;
  return current != null && target != null && current <= target;
}

export function buildBrief(item) {
  const g = gradeItem(item);
  const market = MARKET[item.id] || {};
  const current = item.currentBest?.price;
  const target = item.targetPrice;
  const atl = item.allTimeLow;
  const hit = isTargetHit(item);
  const vsAtl = g.stats.vsAtlPct;
  let suggested = market.suggestedTarget ?? target;
  if (market.atlUnlikely && atl?.price && suggested < atl.price * 1.12) {
    suggested = roundWatch(atl.price * 1.18);
  }

  let call = "watch";
  let headline = "Keep the watch.";
  let body = item.why || "Not enough to call a buy.";

  if (hit) {
    call = "buy_now";
    headline = "Target hit. The price you set is on the table now.";
    body = `${money(current, item.currency)} at ${item.currentBest?.retailer} is at or under your ${money(target, item.currency)} target. ${market.why || ""}`.trim();
  } else if (g.grade === "steal") {
    call = "buy_now";
    headline = "Best available now. This is a buy window.";
    body = `Rule: ${g.rule}. ${market.why || ""}`.trim();
  } else if (g.grade === "good") {
    call = "good_now";
    headline = "Good buy if you need it. Not the floor.";
    body = `Rule: ${g.rule}. ${market.why || "If you can wait, hold for target."}`.trim();
  } else if (market.atlUnlikely && vsAtl != null && vsAtl > 10) {
    call = "retarget";
    headline = "ATL is not the line anymore. Watch a new target.";
    body = `${market.why} Suggested live target: ${money(suggested, item.currency)} — not the old ATL of ${atl ? money(atl.price, item.currency) : "—"}.`;
  } else if (g.grade === "high") {
    call = "wait";
    headline = "High vs the 30-day tape. Do not chase.";
    body = `${market.why || g.rule} Target stays ${money(target, item.currency)}.`;
  } else if (g.grade === "unknown") {
    call = "needs_data";
    headline = "Not enough history to brief a buy.";
    body = market.why || g.rule;
  } else {
    call = "watch";
    headline = "Fair. Hold for target.";
    body = `Live ${money(current, item.currency)} vs target ${money(target, item.currency)}. ${market.why || ""}`.trim();
  }

  return {
    call,
    headline,
    body,
    hit,
    suggestedTarget: suggested,
    marketWhy: market.why || "",
    atlUnlikely: Boolean(market.atlUnlikely),
    g,
  };
}
