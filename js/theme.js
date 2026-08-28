const PREFS_KEY = "mindkeep-prefs-v1";

export function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function writePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function applyTheme(themeDoc, prefs = readPrefs()) {
  const id = prefs.theme || themeDoc.defaultPreset || "default";
  const preset = themeDoc.presets[id] || themeDoc.presets.default;
  const root = document.documentElement;
  root.dataset.theme = preset.id;
  for (const [k, v] of Object.entries(preset.tokens || {})) {
    root.style.setProperty(k, v);
  }
  const effects = prefs.effects !== false;
  const glow = Boolean(preset.glow) && effects && !reducedMotion();
  root.dataset.glow = glow ? "on" : "off";
  if (!glow) {
    root.style.setProperty("--glow-blue", "none");
    root.style.setProperty("--glow-pink", "none");
    root.style.setProperty("--glow-edge", "none");
    root.style.setProperty("--field-opacity", "0");
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", preset.tokens["--bg"] || "#050505");
  document.querySelector('meta[name="color-scheme"]')?.setAttribute(
    "content",
    preset.id === "paper" ? "light" : "dark"
  );
  return { preset, effects, glow };
}

export function fieldEnabled(themeDoc, prefs = readPrefs()) {
  const applied = applyTheme(themeDoc, prefs);
  if (reducedMotion() || !applied.effects) return false;
  const opacity = getComputedStyle(document.documentElement).getPropertyValue("--field-opacity").trim();
  return opacity !== "0";
}

export async function loadThemeDoc() {
  const res = await fetch("./data/theme.json", { cache: "no-store" });
  if (!res.ok) throw new Error("theme.json missing");
  return res.json();
}
