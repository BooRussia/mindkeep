/** Chart windows. Default is all-time so multi-year tapes are visible. */

export const RANGES = [
  { id: "1m", label: "1 month", short: "1M", days: 30 },
  { id: "3m", label: "3 months", short: "3M", days: 90 },
  { id: "6m", label: "6 months", short: "6M", days: 180 },
  { id: "1y", label: "1 year", short: "1Y", days: 365 },
  { id: "2y", label: "2 years", short: "2Y", days: 730 },
  { id: "5y", label: "5 years", short: "5Y", days: 1826 },
  { id: "all", label: "All time", short: "ALL", days: null },
];

const YEAR_RE = /^y(\d{4})$/;

export function rangeSpec(id) {
  const year = String(id || "").match(YEAR_RE);
  if (year) return { id, label: year[1], short: year[1], year: Number(year[1]), days: null };
  return RANGES.find((r) => r.id === id) || RANGES[RANGES.length - 1];
}

export function yearOptions(rows = []) {
  const years = new Set();
  for (const row of rows) {
    const t = new Date(row.date).getTime();
    if (!Number.isNaN(t)) years.add(new Date(t).getUTCFullYear());
  }
  return [...years]
    .sort((a, b) => a - b)
    .map((y) => ({ id: `y${y}`, label: String(y), short: String(y), year: y }));
}

/**
 * Filter a price tape to a window. Keeps one print just before the cut so the
 * line does not start mid-air. If the window is empty, fall back to all rows
 * rather than rendering a blank chart.
 */
export function historyInRange(rows, rangeId, now = Date.now()) {
  const sorted = [...(rows || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (sorted.length < 2) return sorted;
  const spec = rangeSpec(rangeId);
  let filtered;
  if (spec.year) {
    filtered = sorted.filter((r) => new Date(r.date).getUTCFullYear() === spec.year);
  } else if (spec.days) {
    const cut = now - spec.days * 86400000;
    filtered = sorted.filter((r) => new Date(r.date).getTime() >= cut);
    if (filtered.length && filtered.length < sorted.length) {
      const before = sorted.filter((r) => new Date(r.date).getTime() < cut);
      if (before.length) filtered = [before[before.length - 1], ...filtered];
    }
  } else {
    filtered = sorted;
  }
  return filtered.length ? filtered : sorted;
}

export function rangePillsHTML(rows, activeId, { attr = "data-chart-range", extraYears = true } = {}) {
  const years = extraYears ? yearOptions(rows) : [];
  const pills = [
    ...RANGES,
    ...(years.length > 1 ? years : []),
  ];
  const current = rangeSpec(activeId).id;
  return `<div class="range-pills" role="group" aria-label="Chart time range">
    ${pills
      .map(
        (r) =>
          `<button type="button" class="range-pill" ${attr}="${r.id}" aria-pressed="${r.id === current}">${r.short}</button>`
      )
      .join("")}
  </div>`;
}

export function rangeSelectHTML(rows, activeId, { id = "chart-range", attr = "data-chart-range-select" } = {}) {
  const years = yearOptions(rows);
  const current = rangeSpec(activeId).id;
  const opts = [
    ...RANGES.map((r) => `<option value="${r.id}" ${r.id === current ? "selected" : ""}>${r.label}</option>`),
    ...(years.length > 1
      ? [`<option disabled>────────</option>`, ...years.map((y) => `<option value="${y.id}" ${y.id === current ? "selected" : ""}>${y.label}</option>`)]
      : []),
  ];
  return `<label class="range-select">
    <span class="sr-only">Chart time range</span>
    <select id="${id}" ${attr}>${opts.join("")}</select>
  </label>`;
}
