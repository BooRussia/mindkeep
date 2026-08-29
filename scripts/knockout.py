#!/usr/bin/env python3
"""Studio-backdrop knockout → square transparent PNG.

Flood-fills from the corners when they agree on a flat backdrop, then trims
and pads to a square. Same idea as js/cutout.js so local assets match the
in-browser safety net.

Usage:
  python3 scripts/knockout.py INPUT.png OUTPUT.png
  python3 scripts/knockout.py --audit
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
PRODUCTS = ROOT / "assets" / "products"


def dist(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def knockout(
    src: Path,
    dest: Path,
    *,
    tolerance: int = 36,
    max_side: int = 768,
    pad_frac: float = 0.06,
) -> Path:
    im = Image.open(src).convert("RGBA")
    src_w, src_h = im.size
    scale = min(1.0, max_side / max(src_w, src_h))
    if scale < 1:
        im = im.resize(
            (max(1, round(src_w * scale)), max(1, round(src_h * scale))),
            Image.Resampling.LANCZOS,
        )
    w, h = im.size
    px = im.load()

    corners = [
        px[min(2, w - 1), min(2, h - 1)],
        px[max(0, w - 3), min(2, h - 1)],
        px[min(2, w - 1), max(0, h - 3)],
        px[max(0, w - 3), max(0, h - 3)],
    ]
    bg = (
        round(sum(c[0] for c in corners) / 4),
        round(sum(c[1] for c in corners) / 4),
        round(sum(c[2] for c in corners) / 4),
    )
    agreement = sum(1 for c in corners if dist(c[:3], bg) < tolerance and c[3] > 200)

    if agreement >= 3:
        seen = bytearray(w * h)
        stack = [
            0,
            0,
            w - 1,
            0,
            0,
            h - 1,
            w - 1,
            h - 1,
            w // 2,
            0,
            w // 2,
            h - 1,
            0,
            h // 2,
            w - 1,
            h // 2,
        ]
        while stack:
            y = stack.pop()
            x = stack.pop()
            if x < 0 or y < 0 or x >= w or y >= h:
                continue
            idx = y * w + x
            if seen[idx]:
                continue
            seen[idx] = 1
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            if dist((r, g, b), bg) > tolerance:
                continue
            px[x, y] = (r, g, b, 0)
            stack.extend((x + 1, y, x - 1, y, x, y + 1, x, y - 1))

        fringe = tolerance * 1.35
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a == 0:
                    continue
                d = dist((r, g, b), bg)
                if d < fringe:
                    px[x, y] = (r, g, b, max(0, round(a * (d / fringe))))

    bbox = im.getbbox()
    if not bbox:
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, "PNG")
        return dest

    min_x, min_y, max_x, max_y = bbox
    pad = round(max(w, h) * pad_frac)
    min_x = max(0, min_x - pad)
    min_y = max(0, min_y - pad)
    max_x = min(w, max_x + pad)
    max_y = min(h, max_y + pad)
    cropped = im.crop((min_x, min_y, max_x, max_y))
    tw, th = cropped.size
    side = max(tw, th)
    out = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    out.paste(cropped, ((side - tw) // 2, (side - th) // 2), cropped)
    dest.parent.mkdir(parents=True, exist_ok=True)
    out.save(dest, "PNG", optimize=True)
    return dest


def main() -> int:
    parser = argparse.ArgumentParser(description="Knock out a studio backdrop.")
    parser.add_argument("src", nargs="?", type=Path)
    parser.add_argument("dest", nargs="?", type=Path)
    parser.add_argument("--audit", action="store_true", help="List pirate ids missing a local PNG")
    parser.add_argument("--tolerance", type=int, default=36)
    args = parser.parse_args()

    if args.audit:
        import json

        ids: list[str] = []
        pirate = ROOT / "data" / "bays" / "pirate.json"
        if pirate.exists():
            data = json.loads(pirate.read_text())
            ids.extend(it["id"] for it in data.get("payload", {}).get("items", []) if it.get("id"))
        inbox = ROOT / "data" / "inbox"
        for path in sorted(inbox.glob("*.json")):
            if path.name == "index.json":
                continue
            data = json.loads(path.read_text())
            for it in data.get("payload", {}).get("items", []) or []:
                if it.get("id"):
                    ids.append(it["id"])
        seen = []
        missing = []
        for item_id in dict.fromkeys(ids):
            png = PRODUCTS / f"{item_id}.png"
            if png.exists():
                seen.append(item_id)
            else:
                missing.append(item_id)
        print(f"have {len(seen)}  missing {len(missing)}")
        for item_id in missing:
            print(f"  MISSING  {item_id}")
        return 1 if missing else 0

    if not args.src or not args.dest:
        parser.error("src dest required unless --audit")
    knockout(args.src, args.dest, tolerance=args.tolerance)
    print(args.dest)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
