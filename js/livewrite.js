/**
 * Owner writes to the live Worker from this browser.
 * Token lives only in localStorage — never in the committed vault.
 */

export function workerBase(overlayUrl) {
  if (!overlayUrl) return "";
  return String(overlayUrl)
    .replace(/\/overlay\.json$/i, "")
    .replace(/\/overlay$/i, "")
    .replace(/\/$/, "");
}

export async function callLive({ overlayUrl, token }, tool, args = {}) {
  const base = workerBase(overlayUrl);
  if (!base) return { ok: false, reason: "no-url" };
  if (!token) return { ok: false, reason: "no-token" };
  try {
    const res = await fetch(`${base}/v1/${tool}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, reason: data.error || res.statusText || String(res.status), status: res.status, data };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: err.message || "network" };
  }
}

export function liveWriteHint(result, { action = "saved" } = {}) {
  if (result?.ok) return `${action} on the live overlay — every device will see it.`;
  if (result?.reason === "no-token") {
    return `${action} on this browser only. Add the bot token in Settings to persist it on the wire.`;
  }
  if (result?.reason === "no-url") {
    return `${action} on this browser only. Set the overlay URL to persist it on the wire.`;
  }
  return `${action} locally. Live write failed: ${result?.reason || "unknown"}.`;
}
