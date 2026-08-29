import { buildBrief, isTargetHit } from "./brief.js";
import { itemBin } from "./bins.js";
import { isRecurring } from "./vault.js";
import { esc } from "./format.js";

const CALL_LABEL = {
  buy_now: "Buy",
  good_now: "Good",
  wait: "Wait",
  retarget: "Retarget",
  needs_data: "Need data",
  watch: "Watch",
};

export function callLabel(call) {
  return CALL_LABEL[call] || call;
}

export function itemTags(item) {
  const tags = [];
  const { id: binId, label: binLabel } = itemBin(item);
  if (binId && binId !== "unsorted") {
    tags.push({ id: `place:${binId}`, label: binLabel, kind: "place" });
  }
  const cat = String(item.category || "").trim();
  if (cat) {
    const slug = cat.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    tags.push({ id: `cat:${slug}`, label: cat, kind: "cat" });
  }
  tags.push(
    isRecurring(item)
      ? { id: "cadence:recurring", label: item.cadence || "recurring", kind: "cadence" }
      : { id: "cadence:once", label: "once", kind: "cadence" }
  );
  const brief = buildBrief(item);
  tags.push({
    id: `call:${brief.call}`,
    label: callLabel(brief.call),
    kind: "call",
    call: brief.call,
  });
  if (isTargetHit(item)) tags.push({ id: "hit", label: "target hit", kind: "hit" });
  return tags;
}

export function filterItems(items, tagId) {
  if (!tagId || tagId === "all") return items;
  return items.filter((it) => itemTags(it).some((t) => t.id === tagId));
}

export function catalogTags(items) {
  const map = new Map();
  for (const it of items) {
    for (const t of itemTags(it)) {
      const prev = map.get(t.id);
      if (prev) prev.count += 1;
      else map.set(t.id, { ...t, count: 1 });
    }
  }
  const rank = { hit: 0, call: 1, place: 2, cat: 3, cadence: 4 };
  return [...map.values()]
    .filter((t) => t.kind !== "cat")
    .sort((a, b) => {
      const ra = rank[a.kind] ?? 9;
      const rb = rank[b.kind] ?? 9;
      if (ra !== rb) return ra - rb;
      return a.label.localeCompare(b.label);
    });
}

export function tagChip(tag, { pressed = false, as = "button" } = {}) {
  const cls = `tag tag-${esc(tag.kind)}${tag.call ? ` tag-call-${esc(tag.call)}` : ""}`;
  const count = tag.count != null ? `<span class="tag-n">${esc(String(tag.count))}</span>` : "";
  if (as === "span") {
    return `<span class="${cls}">${esc(tag.label)}</span>`;
  }
  return `<button type="button" class="${cls}" data-tag-filter="${esc(tag.id)}" aria-pressed="${pressed ? "true" : "false"}">${esc(tag.label)}${count}</button>`;
}

export function tagBarHTML(items, active) {
  const tags = catalogTags(items);
  const all = { id: "all", label: "All", kind: "all", count: items.length };
  return `<div class="tag-bar" role="toolbar" aria-label="Filter by tag">
    ${tagChip(all, { pressed: !active || active === "all" })}
    ${tags.map((t) => tagChip(t, { pressed: active === t.id })).join("")}
  </div>`;
}
