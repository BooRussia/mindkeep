/**
 * Built-in studio-background knockout. No API key.
 * Flood-fills from the corners when they agree on a flat backdrop, then trims.
 * Grok Imagine cutouts go through the Worker when XAI_API_KEY is set; this is
 * the safety net for anything that lands with a solid backdrop.
 */

function colorDist(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function sample(d, w, x, y) {
  const i = (y * w + x) * 4;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}

export function cornersTransparent(d, w, h) {
  const pts = [
    sample(d, w, 0, 0),
    sample(d, w, w - 1, 0),
    sample(d, w, 0, h - 1),
    sample(d, w, w - 1, h - 1),
  ];
  return pts.filter((p) => p[3] < 16).length >= 3;
}

export function stripStudioBackground(img, { tolerance = 32, maxSide = 768 } = {}) {
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) return null;
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  if (cornersTransparent(d, w, h)) {
    return canvas.toDataURL("image/png");
  }

  const corners = [
    sample(d, w, 2, 2),
    sample(d, w, w - 3, 2),
    sample(d, w, 2, h - 3),
    sample(d, w, w - 3, h - 3),
  ];
  const bg = [
    Math.round(corners.reduce((s, c) => s + c[0], 0) / 4),
    Math.round(corners.reduce((s, c) => s + c[1], 0) / 4),
    Math.round(corners.reduce((s, c) => s + c[2], 0) / 4),
  ];
  const agreement = corners.filter((c) => colorDist(c, bg) < tolerance && c[3] > 200).length;
  if (agreement < 3) {
    // Not a studio plate — leave it, rather than chewing the product.
    return canvas.toDataURL("image/png");
  }

  const seen = new Uint8Array(w * h);
  const stack = [];
  const seeds = [
    [0, 0],
    [w - 1, 0],
    [0, h - 1],
    [w - 1, h - 1],
    [Math.floor(w / 2), 0],
    [Math.floor(w / 2), h - 1],
    [0, Math.floor(h / 2)],
    [w - 1, Math.floor(h / 2)],
  ];
  for (const [x, y] of seeds) stack.push(x, y);

  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const idx = y * w + x;
    if (seen[idx]) continue;
    seen[idx] = 1;
    const i = idx * 4;
    const pix = [d[i], d[i + 1], d[i + 2], d[i + 3]];
    if (pix[3] < 8) continue;
    if (colorDist(pix, bg) > tolerance) continue;
    d[i + 3] = 0;
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  // despill: fade remaining near-bg fringe
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const dist = colorDist([d[i], d[i + 1], d[i + 2]], bg);
    if (dist < tolerance * 1.35) {
      d[i + 3] = Math.max(0, Math.round(d[i + 3] * (dist / (tolerance * 1.35))));
    }
  }

  ctx.putImageData(image, 0, 0);
  return trimTransparent(canvas).toDataURL("image/png");
}

function trimTransparent(canvas) {
  const ctx = canvas.getContext("2d");
  const { width: w, height: h } = canvas;
  const { data } = ctx.getImageData(0, 0, w, h);
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX <= minX || maxY <= minY) return canvas;
  const pad = Math.round(Math.max(w, h) * 0.06);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const tw = maxX - minX + 1;
  const th = maxY - minY + 1;
  const side = Math.max(tw, th);
  const out = document.createElement("canvas");
  out.width = side;
  out.height = side;
  const octx = out.getContext("2d");
  octx.drawImage(canvas, minX, minY, tw, th, Math.floor((side - tw) / 2), Math.floor((side - th) / 2), tw, th);
  return out;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

export async function cutoutFromUrl(src) {
  const img = await loadImage(src);
  return stripStudioBackground(img);
}
