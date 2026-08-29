/** Price Pirate cargo bins. One slug per watch. Missing/empty → unsorted. */

export const DEFAULT_BIN_SLUGS = [
  "daily",
  "home",
  "compute",
  "range",
  "drone",
  "audio",
  "kitchen",
  "unsorted",
];

const BIN_LABELS = {
  daily: "Daily",
  home: "Home",
  compute: "Compute",
  range: "Range",
  drone: "Drone",
  audio: "Audio",
  kitchen: "Kitchen",
  unsorted: "Unsorted",
};

export function binSlug(raw) {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "unsorted";
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function defaultBinLabel(slug) {
  const id = binSlug(slug);
  return BIN_LABELS[id] || titleFromSlug(id);
}

export function itemBin(item) {
  const id = binSlug(item?.bin);
  const label = (item?.binLabel && String(item.binLabel).trim()) || defaultBinLabel(id);
  return { id, label };
}

export function binLabelFor(item) {
  return itemBin(item).label;
}

export function sortBinRows(rows) {
  return rows.sort((a, b) => {
    if (a.id === "unsorted") return 1;
    if (b.id === "unsorted") return -1;
    const ia = DEFAULT_BIN_SLUGS.indexOf(a.id);
    const ib = DEFAULT_BIN_SLUGS.indexOf(b.id);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return String(a.label).localeCompare(String(b.label));
  });
}

export function groupItemsByBin(items) {
  const groups = new Map();
  for (const it of items) {
    const { id, label } = itemBin(it);
    if (!groups.has(id)) groups.set(id, { id, label, items: [] });
    const g = groups.get(id);
    if (it.binLabel && String(it.binLabel).trim()) g.label = String(it.binLabel).trim();
    g.items.push(it);
  }
  return sortBinRows([...groups.values()]);
}

export function listBinsFromItems(items) {
  return groupItemsByBin(items).map((g) => ({
    id: g.id,
    label: g.label,
    count: g.items.length,
    itemIds: g.items.map((it) => it.id),
  }));
}

/** Suggested slugs plus any the vault already uses — for pickers, not list_bins. */
export function knownBins(items = []) {
  const map = new Map();
  for (const slug of DEFAULT_BIN_SLUGS) map.set(slug, defaultBinLabel(slug));
  for (const it of items) {
    const { id, label } = itemBin(it);
    map.set(id, label);
  }
  return sortBinRows([...map.entries()].map(([id, label]) => ({ id, label })));
}

export function stowIndex(id) {
  let h = 0;
  for (const c of String(id || "")) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0;
  return Math.abs(h) % 3;
}

export function wireBinRails(root = document) {
  if (!root) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  root.querySelectorAll("[data-bin-rail]").forEach((rail) => {
    const scroller = rail.querySelector("[data-bin-track]");
    if (!scroller) return;
    const cards = [...scroller.querySelectorAll("[data-crate]")];
    const prev = rail.querySelector("[data-bin-prev]");
    const next = rail.querySelector("[data-bin-next]");

    const cardStep = () => {
      const card = cards[0];
      if (!card) return Math.max(160, scroller.clientWidth * 0.7);
      const gap = parseFloat(getComputedStyle(scroller).gap) || 12;
      return card.getBoundingClientRect().width + gap;
    };

    const scrollByCard = (dir) => {
      scroller.scrollBy({ left: dir * cardStep(), behavior: reduce ? "auto" : "smooth" });
    };

    const markOnDeck = () => {
      const rect = scroller.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      let best = null;
      let bestDist = Infinity;
      for (const c of cards) {
        const r = c.getBoundingClientRect();
        const d = Math.abs(r.left + r.width / 2 - mid);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      for (const c of cards) {
        if (c === best) c.setAttribute("data-on-deck", "1");
        else c.removeAttribute("data-on-deck");
      }
      const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      if (prev) prev.disabled = scroller.scrollLeft <= 2;
      if (next) next.disabled = scroller.scrollLeft >= max - 2 || max <= 2;
    };

    prev?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      scrollByCard(-1);
    });
    next?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      scrollByCard(1);
    });
    scroller.addEventListener("scroll", markOnDeck, { passive: true });
    scroller.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        scrollByCard(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        scrollByCard(-1);
      }
    });
    markOnDeck();
  });
}
