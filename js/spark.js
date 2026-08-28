function byDate(a, b) {
  return String(a.date).localeCompare(String(b.date));
}

export function downsample(rows, n = 48) {
  const list = [...rows].sort(byDate);
  if (list.length <= n) return list;
  const step = (list.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => list[Math.round(i * step)]);
}

export function historyFor(item, retailer = null) {
  let rows = item.priceHistory || [];
  if (retailer) rows = rows.filter((h) => h.retailer === retailer);
  return downsample(rows, retailer ? 36 : 48);
}

export function sparkSVG(rows, { w = 120, h = 36, label = "Price trend" } = {}) {
  if (!rows || rows.length < 2) {
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="No trend yet"><line x1="4" y1="${h / 2}" x2="${w - 4}" y2="${h / 2}" stroke="currentColor" stroke-opacity="0.25"/></svg>`;
  }
  const ys = rows.map((r) => Number(r.price));
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const pts = rows.map((r, i) => {
    const x = 2 + (i / (rows.length - 1)) * (w - 4);
    const y = h - 3 - ((Number(r.price) - min) / span) * (h - 6);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const down = ys[ys.length - 1] <= ys[0];
  const color = down ? "var(--blue)" : "var(--pink)";
  const last = pts[pts.length - 1].split(",");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label}">
    <polyline fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(" ")}"></polyline>
    <circle cx="${last[0]}" cy="${last[1]}" r="2.1" fill="${color}"></circle>
  </svg>`;
}

export function seasonalRows(item, type) {
  return (item.saleEvents || [])
    .filter((e) => e.type === type)
    .sort((a, b) => a.year - b.year)
    .map((e) => ({ date: String(e.year), price: e.price, retailer: e.retailer, name: e.name }));
}
