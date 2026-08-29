function byDate(a, b) {
  return String(a.date).localeCompare(String(b.date));
}

function mean(xs) {
  return xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : null;
}

function pctChange(now, then) {
  if (then == null || then === 0 || now == null) return null;
  return ((now - then) / then) * 100;
}

function nearestOnOrBefore(series, targetMs) {
  let last = null;
  for (const row of series) {
    const t = new Date(row.date).getTime();
    if (Number.isNaN(t) || t > targetMs) continue;
    last = row.price;
  }
  return last;
}

export function computeStats(item, now = Date.now()) {
  const history = [...(item.priceHistory || [])].sort(byDate);
  const current = item.currentBest?.price;
  const atl = item.allTimeLow?.price ?? null;
  const histPrices = history.map((h) => Number(h.price)).filter(Number.isFinite);
  const ath = item.allTimeHigh?.price ?? (histPrices.length ? Math.max(...histPrices) : null);
  const p1 = nearestOnOrBefore(history, now - 86400000);
  const p7 = nearestOnOrBefore(history, now - 7 * 86400000);
  const p30 = nearestOnOrBefore(history, now - 30 * 86400000);
  const p90 = nearestOnOrBefore(history, now - 90 * 86400000);
  const p365 = nearestOnOrBefore(history, now - 365 * 86400000);
  const first = history[0]?.price ?? null;
  const avg30 = mean(
    history
      .filter((h) => now - new Date(h.date).getTime() <= 30 * 86400000)
      .map((h) => h.price)
  );
  const avg90 = mean(
    history
      .filter((h) => now - new Date(h.date).getTime() <= 90 * 86400000)
      .map((h) => h.price)
  );
  return {
    change1dPct: pctChange(current, p1),
    change7dPct: pctChange(current, p7),
    change30dPct: pctChange(current, p30),
    change90dPct: pctChange(current, p90),
    change1yPct: pctChange(current, p365),
    changeAllPct: pctChange(current, first),
    vsAtlPct: pctChange(current, atl),
    vsAthPct: pctChange(current, ath),
    vs30dAvgPct: pctChange(current, avg30),
    vs90dAvgPct: pctChange(current, avg90),
    avg30,
    avg90,
  };
}

export function gradeItem(item, now = Date.now()) {
  const history = item.priceHistory || [];
  const current = item.currentBest?.price;
  const atl = item.allTimeLow?.price ?? null;
  const target = item.targetPrice;
  const stats = computeStats(item, now);

  if (history.length < 5 && atl == null) {
    return { grade: "unknown", rule: "<5 history points and no ATL", stats };
  }
  if (current == null) {
    return { grade: "unknown", rule: "no current price", stats };
  }
  if (atl != null && current <= atl * 1.02) {
    return { grade: "steal", rule: "current ≤ ATL × 1.02", stats };
  }
  if (target != null && current <= target) {
    return { grade: "steal", rule: "current ≤ target", stats };
  }
  if (stats.avg30 != null && current <= stats.avg30 * 0.9) {
    return { grade: "good", rule: "current ≤ 30d avg × 0.90", stats };
  }
  if (atl != null && current <= atl * 1.08) {
    return { grade: "good", rule: "within 8% of ATL", stats };
  }
  if (stats.avg30 != null && Math.abs(current - stats.avg30) / stats.avg30 <= 0.15) {
    return { grade: "fair", rule: "within 15% of 30d avg", stats };
  }
  return { grade: "high", rule: "worse than 15% of 30d avg / ATL band", stats };
}

const TOOL_RULES = [
  {
    tool: "Cursor",
    re: /cursor\[bot\]|made-with:\s*cursor|co-authored-by:\s*cursor\b|committername:\s*cursor/i,
  },
  {
    tool: "Claude",
    re: /generated with claude|co-authored-by:\s*claude\b|committername:\s*claude|anthropic/i,
  },
  {
    tool: "Grok",
    re: /grok\[bot\]|co-authored-by:\s*grok\b|\bxai\b|committername:\s*grok/i,
  },
  {
    tool: "Copilot",
    re: /github-copilot|copilot-generated|co-authored-by:.*copilot|committername:\s*copilot/i,
  },
];

export function inferLastTool(commit = {}, fallback = {}) {
  const hay = [
    commit.subject,
    commit.body,
    commit.authorName,
    commit.authorEmail,
    commit.committerName,
    `committerName: ${commit.committerName || ""}`,
  ]
    .filter(Boolean)
    .join("\n");

  for (const rule of TOOL_RULES) {
    const m = hay.match(rule.re);
    if (m) {
      return {
        tool: rule.tool,
        evidence: `Matched “${m[0]}” in commit subject/body/committer.`,
        certainty: "inferred",
      };
    }
  }

  const author = (commit.authorName || "").trim();
  const committer = (commit.committerName || "").trim();
  if (author && committer && author.toLowerCase() === committer.toLowerCase()) {
    return {
      tool: "Human",
      evidence: `Committer “${committer}” matches author. No agent trailer.`,
      certainty: "inferred",
    };
  }

  if (fallback.lastTool && fallback.lastToolEvidence) {
    return {
      tool: fallback.lastTool,
      evidence: fallback.lastToolEvidence,
      certainty: "recorded",
    };
  }

  return {
    tool: "Unknown",
    evidence: "No tool signature in subject, body, or committer. Not guessed.",
    certainty: "unknown",
  };
}

export function enrichProject(project) {
  const inferred = inferLastTool(project.lastCommit, project);
  return { ...project, inferred };
}
