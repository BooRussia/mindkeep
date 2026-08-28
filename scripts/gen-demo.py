#!/usr/bin/env python3
"""Generate MindKeep demo bay JSON. Deterministic; no live scrapes."""

from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BAYS = ROOT / "data" / "bays"
INBOX = ROOT / "data" / "inbox"
TODAY = date(2026, 8, 28)


def md5_unit(seed: str) -> float:
    h = hashlib.md5(seed.encode("utf-8")).hexdigest()
    return int(h[:8], 16) / 0xFFFFFFFF


def iso_day(d: date, hour: int = 14) -> str:
    return datetime(d.year, d.month, d.day, hour, 0, 0, tzinfo=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )


def daterange(start: date, end: date, step_days: int = 1):
    cur = start
    while cur <= end:
        yield cur
        cur += timedelta(days=step_days)


def round_price(p: float) -> float:
    return round(p + 1e-9, 2)


def mean(xs):
    return sum(xs) / len(xs) if xs else None


def pct_change(now: float, then: float | None) -> float | None:
    if then is None or then == 0:
        return None
    return round((now - then) / then * 100, 2)


def avg_window(series: list[tuple[date, float]], end: date, days: int) -> float | None:
    start = end - timedelta(days=days)
    vals = [p for d, p in series if start <= d <= end]
    return mean(vals)


def nearest_on_or_before(series: list[tuple[date, float]], target: date) -> float | None:
    prior = [p for d, p in series if d <= target]
    return prior[-1] if prior else None


def compute_stats(history: list[dict], current: float, atl: float | None):
    series = sorted(
        ((date.fromisoformat(h["date"][:10]), float(h["price"])) for h in history),
        key=lambda x: x[0],
    )
    end = TODAY
    p1 = nearest_on_or_before(series, end - timedelta(days=1))
    p7 = nearest_on_or_before(series, end - timedelta(days=7))
    p30 = nearest_on_or_before(series, end - timedelta(days=30))
    p90 = nearest_on_or_before(series, end - timedelta(days=90))
    avg30 = avg_window(series, end, 30)
    avg90 = avg_window(series, end, 90)
    return {
        "change1dPct": pct_change(current, p1),
        "change7dPct": pct_change(current, p7),
        "change30dPct": pct_change(current, p30),
        "change90dPct": pct_change(current, p90),
        "vsAtlPct": pct_change(current, atl) if atl is not None else None,
        "vs30dAvgPct": pct_change(current, avg30),
        "vs90dAvgPct": pct_change(current, avg90),
    }


def walk_price(
    item_id: str,
    start: date,
    end: date,
    base: float,
    floor: float,
    ceiling: float,
    retailers: list[str],
    dips: list[tuple[date, float, str]],
    cadence: int = 2,
) -> list[dict]:
    """Random-walk daily-ish prices with forced sale dips."""
    points: list[dict] = []
    price = base
    dip_map = {d: (p, r) for d, p, r in dips}
    for i, day in enumerate(daterange(start, end, cadence)):
        u = md5_unit(f"{item_id}:{day.isoformat()}")
        drift = (u - 0.48) * (ceiling - floor) * 0.015
        price = min(ceiling, max(floor, price + drift))
        retailer = retailers[int(u * len(retailers)) % len(retailers)]
        if day in dip_map:
            price, retailer = dip_map[day]
        else:
            # slight retailer spread
            spread = (u - 0.5) * 8
            quoted = round_price(price + spread)
            quoted = min(ceiling, max(floor, quoted))
            points.append(
                {
                    "date": iso_day(day, 15 if u > 0.5 else 11),
                    "price": quoted,
                    "retailer": retailer,
                    "source": "agent",
                }
            )
            continue
        points.append(
            {
                "date": iso_day(day, 9),
                "price": round_price(price),
                "retailer": retailer,
                "source": "agent",
            }
        )
    # denser last 45 days
    dense_start = end - timedelta(days=45)
    seen = {(p["date"][:10], p["retailer"]) for p in points}
    for day in daterange(dense_start, end, 1):
        u = md5_unit(f"{item_id}:dense:{day.isoformat()}")
        if u < 0.35:
            continue
        retailer = retailers[int(u * 17) % len(retailers)]
        key = (day.isoformat(), retailer)
        if key in seen:
            continue
        # interpolate from last known
        last = [p for p in points if p["date"][:10] <= day.isoformat()]
        last_p = float(last[-1]["price"]) if last else base
        quoted = round_price(last_p + (u - 0.5) * 6)
        quoted = min(ceiling, max(floor, quoted))
        if day in dip_map:
            quoted, retailer = dip_map[day]
            quoted = round_price(quoted)
        points.append(
            {
                "date": iso_day(day, 16),
                "price": quoted,
                "retailer": retailer,
                "source": "agent",
            }
        )
        seen.add(key)
    points.sort(key=lambda p: p["date"])
    return points


def last_point(history: list[dict]) -> dict:
    return max(history, key=lambda p: p["date"])


def retailers_from_history(history: list[dict], winner_url: dict[str, str]):
    latest: dict[str, dict] = {}
    for p in history:
        r = p["retailer"]
        if r not in latest or p["date"] > latest[r]["date"]:
            latest[r] = p
    winner = min(latest.values(), key=lambda p: p["price"])
    rows = []
    for r, p in sorted(latest.items(), key=lambda kv: kv[1]["price"]):
        rows.append(
            {
                "retailer": r,
                "price": p["price"],
                "url": winner_url.get(r, ""),
                "inStock": True,
                "shippingNote": "Free over $35" if r == "Amazon" else "",
                "lastSeenAt": p["date"],
                "isWinner": r == winner["retailer"] and p["price"] == winner["price"],
                "setAtl": False,
            }
        )
    return rows, winner


def build_pirate():
    dyson_urls = {
        "Amazon": "https://www.amazon.com/dp/B0C3L5R5QK",
        "Best Buy": "https://www.bestbuy.com/site/dyson-v15-detect/6461323.p",
        "Dyson": "https://www.dyson.com/vacuum-cleaners/cordless/v15-detect",
        "Costco": "https://www.costco.com/dyson-v15.html",
        "Target": "https://www.target.com/p/dyson-v15/-/A-87901234",
    }
    sony_urls = {
        "Amazon": "https://www.amazon.com/dp/B09XS7JWHH",
        "Best Buy": "https://www.bestbuy.com/site/sony-wh-1000xm5/6505727.p",
        "Sony": "https://electronics.sony.com/audio/headphones/p/wh1000xm5",
        "Costco": "https://www.costco.com/sony-wh-1000xm5.html",
        "B&H": "https://www.bhphotovideo.com/c/product/1707630-REG/sony.html",
    }
    lg_urls = {
        "Amazon": "https://www.amazon.com/dp/B0CV4GQK8S",
        "Best Buy": "https://www.bestbuy.com/site/lg-c4-65/6572054.p",
        "LG": "https://www.lg.com/us/tvs/lg-oled65c4pua",
        "Costco": "https://www.costco.com/lg-c4-65.html",
        "Adorama": "https://www.adorama.com/lgc465.html",
    }
    weber_urls = {
        "Amazon": "https://www.amazon.com/dp/B0C8LGENESIS",
        "Home Depot": "https://www.homedepot.com/p/Weber-Genesis-E-325s/314958000",
        "Weber": "https://www.weber.com/US/en/grills/gas-grills/genesis/e-325s/",
        "Ace": "https://www.acehardware.com/departments/lawn-and-garden/weber-genesis",
    }
    fw_urls = {
        "Framework": "https://frame.work/products/laptop16-diy-edition-amd",
        "Amazon": "https://www.amazon.com/dp/B0FRAME16",
        "B&H": "https://www.bhphotovideo.com/c/product/framework-laptop-16.html",
    }

    # Seasonal US event dates
    bf24, cm24 = date(2024, 11, 29), date(2024, 12, 2)
    pd25 = date(2025, 7, 8)
    bf25, cm25 = date(2025, 11, 28), date(2025, 12, 1)
    pd26 = date(2026, 7, 8)

    # --- Dyson: near ATL, steal via ATL band ---
    dyson_atl = 429.00
    dyson_hist = walk_price(
        "dyson-v15-detect-extra",
        date(2024, 11, 1),
        TODAY,
        base=549,
        floor=429,
        ceiling=699,
        retailers=list(dyson_urls),
        dips=[
            (bf24, 449.00, "Best Buy"),
            (cm24, 439.99, "Amazon"),
            (pd25, 469.00, "Amazon"),
            (bf25, 429.00, "Best Buy"),
            (cm25, 434.00, "Amazon"),
            (pd26, 459.00, "Costco"),
            (TODAY - timedelta(days=1), 434.00, "Amazon"),
        ],
        cadence=3,
    )
    # Pin current
    dyson_hist = [p for p in dyson_hist if p["date"][:10] != TODAY.isoformat()]
    dyson_hist.append(
        {
            "date": iso_day(TODAY - timedelta(days=1), 18),
            "price": 434.00,
            "retailer": "Amazon",
            "source": "agent",
        }
    )
    dyson_rows, dyson_win = retailers_from_history(dyson_hist, dyson_urls)
    for row in dyson_rows:
        if row["retailer"] == "Best Buy" and row["price"] <= dyson_atl + 0.01:
            row["setAtl"] = True
    dyson_item = {
        "id": "dyson-v15-detect-extra",
        "name": "Dyson V15 Detect Extra",
        "variant": "Yellow / Iron, extra motorbar",
        "category": "Vacuum",
        "imageUrl": "",
        "imageSource": "monogram",
        "identifiers": {
            "asin": "B0C3L5R5QK",
            "upc": "885609027041",
            "model": "V15 Detect Extra",
            "sku": "419420-01",
        },
        "productUrls": [{"retailer": k, "url": v} for k, v in dyson_urls.items()],
        "status": "watching",
        "priority": "now",
        "targetPrice": 449.0,
        "currency": "USD",
        "cadence": "daily",
        "lastCheckedAt": iso_day(TODAY - timedelta(days=1), 18),
        "nextCheckAt": iso_day(TODAY, 18),
        "why": "Replacement for the dying V8. Buy at or under $449; ATL was $429 on BF 2025.",
        "currentBest": {
            "price": 434.00,
            "retailer": "Amazon",
            "url": dyson_urls["Amazon"],
            "inStock": True,
            "observedAt": iso_day(TODAY - timedelta(days=1), 18),
            "notes": "Sold by Amazon, ships free. Two-day.",
        },
        "allTimeLow": {
            "price": 429.00,
            "retailer": "Best Buy",
            "date": "2025-11-28",
            "url": dyson_urls["Best Buy"],
            "notes": "Black Friday doorbuster, open-box same price.",
        },
        "stats": compute_stats(dyson_hist, 434.00, 429.00),
        "dealGrade": "steal",
        "retailers": dyson_rows,
        "priceHistory": dyson_hist,
        "saleEvents": [
            {
                "type": "black_friday",
                "name": "Black Friday",
                "year": 2024,
                "price": 449.00,
                "retailer": "Best Buy",
                "notes": "First sub-450 print.",
            },
            {
                "type": "cyber_monday",
                "name": "Cyber Monday",
                "year": 2024,
                "price": 439.99,
                "retailer": "Amazon",
                "notes": "Lightning deal, 4h window.",
            },
            {
                "type": "prime_day",
                "name": "Prime Day",
                "year": 2025,
                "price": 469.00,
                "retailer": "Amazon",
                "notes": "Coupon stacked.",
            },
            {
                "type": "black_friday",
                "name": "Black Friday",
                "year": 2025,
                "price": 429.00,
                "retailer": "Best Buy",
                "notes": "ATL. Sold through by 11am ET.",
            },
            {
                "type": "cyber_monday",
                "name": "Cyber Monday",
                "year": 2025,
                "price": 434.00,
                "retailer": "Amazon",
                "notes": "Matched ATL plus tax-free in FL? No — same 434 now.",
            },
            {
                "type": "prime_day",
                "name": "Prime Day",
                "year": 2026,
                "price": 459.00,
                "retailer": "Costco",
                "notes": "Shop card made it $444 effective. Not recorded as ATL.",
            },
        ],
        "log": [
            {
                "at": iso_day(date(2026, 7, 8), 20),
                "actor": "pete",
                "kind": "check",
                "text": "Prime Day 2026: Costco 459. Shop card is a maybe, not a print ATL.",
            },
            {
                "at": iso_day(TODAY - timedelta(days=1), 18),
                "actor": "pete",
                "kind": "alert",
                "text": "Amazon 434 — inside 2% of ATL 429. Rule: steal.",
            },
            {
                "at": iso_day(TODAY - timedelta(days=1), 19),
                "actor": "me",
                "kind": "note",
                "text": "Hold one more check overnight. If it holds at 434, buy.",
            },
        ],
    }

    # --- Sony: mid pack, fair ---
    sony_atl = 248.00
    sony_hist = walk_price(
        "sony-wh-1000xm5",
        date(2024, 11, 1),
        TODAY,
        base=328,
        floor=248,
        ceiling=399,
        retailers=list(sony_urls),
        dips=[
            (bf24, 248.00, "Amazon"),
            (cm24, 258.00, "Best Buy"),
            (pd25, 278.00, "Amazon"),
            (bf25, 268.00, "Amazon"),
            (cm25, 278.00, "Best Buy"),
            (pd26, 298.00, "Costco"),
        ],
        cadence=3,
    )
    sony_hist = [p for p in sony_hist if p["date"][:10] != TODAY.isoformat()]
    # flatten last 30d around 330 so current 328 is fair (within 15% of 30d avg)
    for p in sony_hist:
        d = date.fromisoformat(p["date"][:10])
        if d >= TODAY - timedelta(days=32):
            u = md5_unit(f"sony-flat:{p['date']}")
            p["price"] = round_price(328 + (u - 0.5) * 10)
    sony_hist.append(
        {
            "date": iso_day(TODAY - timedelta(days=1), 12),
            "price": 328.00,
            "retailer": "Best Buy",
            "source": "agent",
        }
    )
    sony_rows, _ = retailers_from_history(sony_hist, sony_urls)
    sony_item = {
        "id": "sony-wh-1000xm5",
        "name": "Sony WH-1000XM5",
        "variant": "Black",
        "category": "Headphones",
        "imageUrl": "",
        "imageSource": "monogram",
        "identifiers": {
            "asin": "B09XS7JWHH",
            "upc": "027242925074",
            "model": "WH-1000XM5",
            "sku": "WH1000XM5/B",
        },
        "productUrls": [{"retailer": k, "url": v} for k, v in sony_urls.items()],
        "status": "watching",
        "priority": "watch",
        "targetPrice": 248.0,
        "currency": "USD",
        "cadence": "weekly",
        "lastCheckedAt": iso_day(TODAY - timedelta(days=1), 12),
        "nextCheckAt": iso_day(TODAY + timedelta(days=6), 12),
        "why": "Travel pair. XM6 launched; XM5 should keep drifting. Target is the 2024 BF print.",
        "currentBest": {
            "price": 328.00,
            "retailer": "Best Buy",
            "url": sony_urls["Best Buy"],
            "inStock": True,
            "observedAt": iso_day(TODAY - timedelta(days=1), 12),
            "notes": "Totaltech not stacked. Amazon 329.",
        },
        "allTimeLow": {
            "price": 248.00,
            "retailer": "Amazon",
            "date": "2024-11-29",
            "url": sony_urls["Amazon"],
            "notes": "Black Friday 2024 lightning deal.",
        },
        "stats": compute_stats(sony_hist, 328.00, 248.00),
        "dealGrade": "fair",
        "retailers": sony_rows,
        "priceHistory": sony_hist,
        "saleEvents": [
            {
                "type": "black_friday",
                "name": "Black Friday",
                "year": 2024,
                "price": 248.00,
                "retailer": "Amazon",
                "notes": "ATL. XM5 still current-gen then.",
            },
            {
                "type": "cyber_monday",
                "name": "Cyber Monday",
                "year": 2024,
                "price": 258.00,
                "retailer": "Best Buy",
                "notes": "Open-box as low as 229 — ignored, condition unknown.",
            },
            {
                "type": "prime_day",
                "name": "Prime Day",
                "year": 2025,
                "price": 278.00,
                "retailer": "Amazon",
                "notes": "Post-XM6 rumor cycle.",
            },
            {
                "type": "black_friday",
                "name": "Black Friday",
                "year": 2025,
                "price": 268.00,
                "retailer": "Amazon",
                "notes": "XM6 out. XM5 didn't reprint ATL.",
            },
            {
                "type": "prime_day",
                "name": "Prime Day",
                "year": 2026,
                "price": 298.00,
                "retailer": "Costco",
                "notes": "Bundle with case. Skip.",
            },
        ],
        "log": [
            {
                "at": iso_day(date(2026, 3, 12), 9),
                "actor": "pete",
                "kind": "note",
                "text": "XM6 street 398. XM5 mid-pack is 318–338. Wait for a 279 print.",
            },
            {
                "at": iso_day(TODAY - timedelta(days=1), 12),
                "actor": "pete",
                "kind": "check",
                "text": "Best Buy 328. Fair vs 30-day average. Not a buy.",
            },
        ],
    }

    # --- LG C4 65: currently high (recent spike vs 30d avg) ---
    lg_atl = 996.00
    lg_hist = walk_price(
        "lg-c4-65",
        date(2024, 11, 1),
        TODAY,
        base=1399,
        floor=996,
        ceiling=1799,
        retailers=list(lg_urls),
        dips=[
            (bf24, 996.00, "Best Buy"),
            (cm24, 1096.00, "Amazon"),
            (pd25, 1196.00, "Best Buy"),
            (bf25, 1096.00, "Best Buy"),
            (cm25, 1146.00, "Costco"),
            (pd26, 1246.00, "Amazon"),
        ],
        cadence=3,
    )
    # last 30 days: sit around 1240 then jump to 1496 last 4 days → high vs 30d avg
    for p in lg_hist:
        d = date.fromisoformat(p["date"][:10])
        if TODAY - timedelta(days=34) <= d <= TODAY - timedelta(days=5):
            u = md5_unit(f"lg-mid:{p['date']}")
            p["price"] = round_price(1230 + (u - 0.5) * 20)
        elif d > TODAY - timedelta(days=5):
            p["price"] = round_price(1496)
            p["retailer"] = "Amazon"
    lg_hist = [p for p in lg_hist if p["date"][:10] != TODAY.isoformat()]
    lg_hist.append(
        {
            "date": iso_day(TODAY - timedelta(days=1), 10),
            "price": 1496.00,
            "retailer": "Amazon",
            "source": "agent",
        }
    )
    lg_rows, _ = retailers_from_history(lg_hist, lg_urls)
    lg_item = {
        "id": "lg-c4-65",
        "name": "LG C4 65-inch OLED",
        "variant": "OLED65C4PUA",
        "category": "TV",
        "imageUrl": "",
        "imageSource": "monogram",
        "identifiers": {
            "asin": "B0CV4GQK8S",
            "upc": "195174075216",
            "model": "OLED65C4PUA",
            "sku": "6572054",
        },
        "productUrls": [{"retailer": k, "url": v} for k, v in lg_urls.items()],
        "status": "watching",
        "priority": "someday",
        "targetPrice": 1099.0,
        "currency": "USD",
        "cadence": "weekly",
        "lastCheckedAt": iso_day(TODAY - timedelta(days=1), 10),
        "nextCheckAt": iso_day(TODAY + timedelta(days=6), 10),
        "why": "Living room. C5 is out so C4 should sag into fall. Do not pay 1496.",
        "currentBest": {
            "price": 1496.00,
            "retailer": "Amazon",
            "url": lg_urls["Amazon"],
            "inStock": True,
            "observedAt": iso_day(TODAY - timedelta(days=1), 10),
            "notes": "Post-Prime bounce. Best Buy 1549.",
        },
        "allTimeLow": {
            "price": 996.00,
            "retailer": "Best Buy",
            "date": "2024-11-29",
            "url": lg_urls["Best Buy"],
            "notes": "Black Friday 2024. C4 launch year.",
        },
        "stats": compute_stats(lg_hist, 1496.00, 996.00),
        "dealGrade": "high",
        "retailers": lg_rows,
        "priceHistory": lg_hist,
        "saleEvents": [
            {
                "type": "black_friday",
                "name": "Black Friday",
                "year": 2024,
                "price": 996.00,
                "retailer": "Best Buy",
                "notes": "ATL. Haul-away included.",
            },
            {
                "type": "cyber_monday",
                "name": "Cyber Monday",
                "year": 2024,
                "price": 1096.00,
                "retailer": "Amazon",
                "notes": "Missed the 996.",
            },
            {
                "type": "prime_day",
                "name": "Prime Day",
                "year": 2025,
                "price": 1196.00,
                "retailer": "Best Buy",
                "notes": "C5 not yet. Fine-not-great.",
            },
            {
                "type": "black_friday",
                "name": "Black Friday",
                "year": 2025,
                "price": 1096.00,
                "retailer": "Best Buy",
                "notes": "C5 took the doorbuster slot.",
            },
            {
                "type": "prime_day",
                "name": "Prime Day",
                "year": 2026,
                "price": 1246.00,
                "retailer": "Amazon",
                "notes": "Last useful print before the bounce.",
            },
        ],
        "log": [
            {
                "at": iso_day(date(2026, 7, 9), 8),
                "actor": "pete",
                "kind": "check",
                "text": "Prime Day 1246. Not target. Park until October ads.",
            },
            {
                "at": iso_day(TODAY - timedelta(days=1), 10),
                "actor": "pete",
                "kind": "alert",
                "text": "Amazon 1496. High vs 30-day average. Do not chase.",
            },
        ],
    }

    # --- Weber: thin history, needs Pete, unknown ---
    weber_hist = [
        {
            "date": iso_day(date(2026, 6, 2), 11),
            "price": 1149.00,
            "retailer": "Home Depot",
            "source": "agent",
        },
        {
            "date": iso_day(date(2026, 6, 18), 11),
            "price": 1099.00,
            "retailer": "Weber",
            "source": "agent",
        },
        {
            "date": iso_day(date(2026, 7, 12), 11),
            "price": 1079.00,
            "retailer": "Amazon",
            "source": "agent",
        },
        {
            "date": iso_day(date(2026, 8, 21), 11),
            "price": 1099.00,
            "retailer": "Home Depot",
            "source": "agent",
        },
    ]
    weber_rows, weber_win = retailers_from_history(weber_hist, weber_urls)
    weber_item = {
        "id": "weber-genesis-e-325s",
        "name": "Weber Genesis E-325s",
        "variant": "Black, 3-burner + sear",
        "category": "Grill",
        "imageUrl": "",
        "imageSource": "monogram",
        "identifiers": {
            "asin": "B0C8LGENESIS",
            "upc": "077924181234",
            "model": "E-325s",
            "sku": "36410001",
        },
        "productUrls": [{"retailer": k, "url": v} for k, v in weber_urls.items()],
        "status": "needs_pete",
        "priority": "watch",
        "targetPrice": 899.0,
        "currency": "USD",
        "cadence": "manual",
        "lastCheckedAt": iso_day(date(2026, 8, 21), 11),
        "nextCheckAt": iso_day(TODAY + timedelta(days=3), 11),
        "why": "Deck rebuild this fall. Four prints only. Need Ace, Lowe's, and last year's BF card.",
        "currentBest": {
            "price": 1079.00,
            "retailer": "Amazon",
            "url": weber_urls["Amazon"],
            "inStock": True,
            "observedAt": iso_day(date(2026, 7, 12), 11),
            "notes": "Home Depot 1099 as of Aug 21. Amazon print is stale.",
        },
        "allTimeLow": None,
        "stats": compute_stats(weber_hist, 1079.00, None),
        "dealGrade": "unknown",
        "retailers": weber_rows,
        "priceHistory": weber_hist,
        "saleEvents": [],
        "log": [
            {
                "at": iso_day(date(2026, 8, 21), 11),
                "actor": "pete",
                "kind": "flag",
                "text": "History too thin for a grade. Need Ace/Lowe's and 2025 BF. Status: needs_pete.",
            }
        ],
    }

    # --- Framework Laptop 16: at target, steal ---
    fw_atl = 1549.00
    fw_hist = walk_price(
        "framework-laptop-16",
        date(2025, 5, 1),
        TODAY,
        base=1899,
        floor=1549,
        ceiling=2199,
        retailers=list(fw_urls),
        dips=[
            (pd25, 1699.00, "Framework"),
            (bf25, 1549.00, "Framework"),
            (cm25, 1599.00, "B&H"),
            (pd26, 1649.00, "Framework"),
            (TODAY - timedelta(days=2), 1699.00, "Framework"),
        ],
        cadence=4,
    )
    fw_hist = [p for p in fw_hist if p["date"][:10] != TODAY.isoformat()]
    fw_hist.append(
        {
            "date": iso_day(TODAY - timedelta(days=2), 17),
            "price": 1699.00,
            "retailer": "Framework",
            "source": "agent",
        }
    )
    fw_rows, _ = retailers_from_history(fw_hist, fw_urls)
    fw_item = {
        "id": "framework-laptop-16",
        "name": "Framework Laptop 16",
        "variant": "DIY, Ryzen 7040, 16GB, 1TB",
        "category": "Laptop",
        "imageUrl": "",
        "imageSource": "monogram",
        "identifiers": {
            "asin": "B0FRAME16",
            "upc": "",
            "model": "Laptop 16 DIY AMD",
            "sku": "FRANMD0001",
        },
        "productUrls": [{"retailer": k, "url": v} for k, v in fw_urls.items()],
        "status": "ready",
        "priority": "now",
        "targetPrice": 1699.0,
        "currency": "USD",
        "cadence": "weekly",
        "lastCheckedAt": iso_day(TODAY - timedelta(days=2), 17),
        "nextCheckAt": iso_day(TODAY + timedelta(days=5), 17),
        "why": "Travel build machine. DIY kit at 1699 is the line. Batch 16 restock this week.",
        "currentBest": {
            "price": 1699.00,
            "retailer": "Framework",
            "url": fw_urls["Framework"],
            "inStock": True,
            "observedAt": iso_day(TODAY - timedelta(days=2), 17),
            "notes": "DIY edition in stock. Ships from Taiwan, ~2 weeks.",
        },
        "allTimeLow": {
            "price": 1549.00,
            "retailer": "Framework",
            "date": "2025-11-28",
            "url": fw_urls["Framework"],
            "notes": "Black Friday 2025 configured closer to base. This SKU was 1549.",
        },
        "stats": compute_stats(fw_hist, 1699.00, 1549.00),
        "dealGrade": "steal",
        "retailers": fw_rows,
        "priceHistory": fw_hist,
        "saleEvents": [
            {
                "type": "prime_day",
                "name": "Prime Day",
                "year": 2025,
                "price": 1699.00,
                "retailer": "Framework",
                "notes": "Not Amazon. Framework ran a parallel promo.",
            },
            {
                "type": "black_friday",
                "name": "Black Friday",
                "year": 2025,
                "price": 1549.00,
                "retailer": "Framework",
                "notes": "ATL for this config.",
            },
            {
                "type": "cyber_monday",
                "name": "Cyber Monday",
                "year": 2025,
                "price": 1599.00,
                "retailer": "B&H",
                "notes": "Prebuilt, not DIY. Logged anyway.",
            },
            {
                "type": "prime_day",
                "name": "Prime Day",
                "year": 2026,
                "price": 1649.00,
                "retailer": "Framework",
                "notes": "Missed it. 1699 is back and at target.",
            },
        ],
        "log": [
            {
                "at": iso_day(TODAY - timedelta(days=2), 17),
                "actor": "pete",
                "kind": "alert",
                "text": "Framework DIY 1699, in stock. Hits target. Steal via target rule.",
            },
            {
                "at": iso_day(TODAY - timedelta(days=2), 18),
                "actor": "me",
                "kind": "note",
                "text": "Ready to order after RAM/SSD inventory check.",
            },
        ],
    }

    items = [dyson_item, sony_item, lg_item, weber_item, fw_item]
    for it in items:
        n = len(it["priceHistory"])
        assert n >= 4, it["id"]
        if it["id"] != "weber-genesis-e-325s":
            assert 60 <= n <= 400, (it["id"], n)

    return {
        "schemaVersion": "1.0.0",
        "bayId": "pirate",
        "updatedAt": iso_day(TODAY - timedelta(days=1), 19),
        "operator": "Pete",
        "status": "ok",
        "alerts": [
            {
                "level": "now",
                "title": "Dyson V15 is inside 2% of ATL",
                "body": "Amazon $434 vs ATL $429 (Best Buy, 2025-11-28). Target $449. Steal.",
                "href": "#/pirate/dyson-v15-detect-extra",
            },
            {
                "level": "now",
                "title": "Framework 16 is at target",
                "body": "DIY kit $1,699 in stock at Framework. Ready status.",
                "href": "#/pirate/framework-laptop-16",
            },
            {
                "level": "soon",
                "title": "Weber Genesis needs a real history",
                "body": "Four prints, no ATL. Ace/Lowe's and last BF still missing.",
                "href": "#/pirate/weber-genesis-e-325s",
            },
        ],
        "payload": {"items": items},
    }


def commit(sha, at, subject, body, author, email, committer, files, url, last_tool=None):
    return {
        "sha": sha,
        "at": at,
        "subject": subject,
        "body": body,
        "authorName": author,
        "authorEmail": email,
        "committerName": committer,
        "files": files,
        "url": url,
        **({"lastTool": last_tool} if last_tool else {}),
    }


def build_shipyard():
    acc_boorussia = {
        "id": "boorussia",
        "login": "BooRussia",
        "displayName": "BooRussia",
        "host": "github.com",
        "projects": [
            {
                "id": "boorussia/propwash-fpv",
                "owner": "BooRussia",
                "name": "propwash-fpv",
                "url": "https://github.com/BooRussia/propwash-fpv",
                "visibility": "public",
                "description": "Browser FPV sim — physics, USB radio, Miami + procedural maps.",
                "purpose": "Keep the sim playable and honest. Next: retrieval mission tuning.",
                "thumbnailUrl": "",
                "imageSource": "monogram",
                "status": "active",
                "needsMe": False,
                "defaultBranch": "main",
                "lastCommit": commit(
                    "a18c4e2b91d0",
                    iso_day(TODAY - timedelta(days=2), 21),
                    "Tighten propwash torque on punch-outs",
                    "Co-authored-by: grok[bot] <grok@x.ai>\n\nHold yaw authority when throttle slams. Playtest clip in issue 44.",
                    "Ney",
                    "ney@local",
                    "GitHub",
                    [
                        "js/physics/rotor.js",
                        "js/craft/quad.js",
                        "js/ui/osd.js",
                    ],
                    "https://github.com/BooRussia/propwash-fpv/commit/a18c4e2b91d0",
                ),
                "lastTool": "Grok",
                "lastToolEvidence": "Co-authored-by: grok[bot] <grok@x.ai> in commit body.",
                "lastBriefing": "LAST WATCH 2d. Grok co-authored a torque fix on punch-outs. OSD still shows the old watt draw. Next action is a 10-pack retrieval flight against the Miami map, then park the physics file unless the tail still wags.",
                "recentCommits": [
                    {
                        "sha": "a18c4e2",
                        "at": iso_day(TODAY - timedelta(days=2), 21),
                        "subject": "Tighten propwash torque on punch-outs",
                        "authorName": "Ney",
                        "lastTool": "Grok",
                    },
                    {
                        "sha": "9bb10c1",
                        "at": iso_day(TODAY - timedelta(days=5), 16),
                        "subject": "USB radio axis map for Radiomaster Pocket",
                        "authorName": "Ney",
                        "lastTool": "Cursor",
                    },
                    {
                        "sha": "77e2aa0",
                        "at": iso_day(TODAY - timedelta(days=9), 19),
                        "subject": "Miami marina collision hulls",
                        "authorName": "Ney",
                        "lastTool": "Human",
                    },
                    {
                        "sha": "51c09de",
                        "at": iso_day(TODAY - timedelta(days=14), 11),
                        "subject": "OSD: add current draw and sag",
                        "authorName": "Ney",
                        "lastTool": "Claude",
                    },
                    {
                        "sha": "40aa12f",
                        "at": iso_day(TODAY - timedelta(days=18), 8),
                        "subject": "Procedural park seed 7",
                        "authorName": "Ney",
                        "lastTool": "Grok",
                    },
                    {
                        "sha": "2f19b8c",
                        "at": iso_day(TODAY - timedelta(days=23), 22),
                        "subject": "Freestyle restart without full reload",
                        "authorName": "Ney",
                        "lastTool": "Cursor",
                    },
                    {
                        "sha": "1c88e04",
                        "at": iso_day(TODAY - timedelta(days=29), 15),
                        "subject": "Calibrate rates to 800 deg/s",
                        "authorName": "Ney",
                        "lastTool": "Human",
                    },
                    {
                        "sha": "0aa71d5",
                        "at": iso_day(TODAY - timedelta(days=36), 9),
                        "subject": "Initial WebGL renderer path",
                        "authorName": "Ney",
                        "lastTool": "Unknown",
                    },
                ],
                "links": [
                    {"label": "Issues", "url": "https://github.com/BooRussia/propwash-fpv/issues"},
                    {"label": "Live", "url": "https://boorussia.github.io/propwash-fpv/"},
                ],
                "nextAction": "Ten retrieval laps on Miami. If yaw still walks, reopen rotor.js — do not start a new physics rewrite.",
            },
            {
                "id": "boorussia/floorplan-visualizer",
                "owner": "BooRussia",
                "name": "floorplan-visualizer",
                "url": "https://github.com/BooRussia/floorplan-visualizer",
                "visibility": "public",
                "description": "Draw a 2D floorplan, get a textured 3D dollhouse.",
                "purpose": "Sales tool for window jobs. Next: opening callouts in the 3D view.",
                "thumbnailUrl": "",
                "imageSource": "monogram",
                "status": "active",
                "needsMe": False,
                "defaultBranch": "main",
                "lastCommit": commit(
                    "c4e91aa0188b",
                    iso_day(TODAY - timedelta(days=1), 23),
                    "Opening callouts follow camera in dollhouse",
                    "Generated with Claude Code.\n\nKeep labels screen-space. Hide when occluded by exterior walls.",
                    "Ney",
                    "ney@local",
                    "Claude",
                    [
                        "src/view/dollhouse.js",
                        "src/view/callouts.js",
                        "src/ui/legend.css",
                    ],
                    "https://github.com/BooRussia/floorplan-visualizer/commit/c4e91aa0188b",
                ),
                "lastTool": "Claude",
                "lastToolEvidence": "Commit body starts with “Generated with Claude Code.” CommitterName is Claude.",
                "lastBriefing": "LAST WATCH 1d. Claude landed screen-space opening callouts. The 2D editor still uses the old label layer, so a room rename does not push into 3D until a redraw. Resume there — one file, callouts.js, then a walkthrough on the Hernando demo plan.",
                "recentCommits": [
                    {
                        "sha": "c4e91aa",
                        "at": iso_day(TODAY - timedelta(days=1), 23),
                        "subject": "Opening callouts follow camera in dollhouse",
                        "authorName": "Ney",
                        "lastTool": "Claude",
                    },
                    {
                        "sha": "b7d2201",
                        "at": iso_day(TODAY - timedelta(days=3), 14),
                        "subject": "Texture atlas for vinyl and brick",
                        "authorName": "Ney",
                        "lastTool": "Cursor",
                    },
                    {
                        "sha": "aa91c03",
                        "at": iso_day(TODAY - timedelta(days=8), 10),
                        "subject": "Snap walls to 1/4 inch",
                        "authorName": "Ney",
                        "lastTool": "Human",
                    },
                    {
                        "sha": "98c11e4",
                        "at": iso_day(TODAY - timedelta(days=12), 18),
                        "subject": "Export glTF of the dollhouse",
                        "authorName": "Ney",
                        "lastTool": "Grok",
                    },
                    {
                        "sha": "81ab002",
                        "at": iso_day(TODAY - timedelta(days=16), 9),
                        "subject": "Undo stack for wall edits",
                        "authorName": "Ney",
                        "lastTool": "Claude",
                    },
                    {
                        "sha": "70dd9a1",
                        "at": iso_day(TODAY - timedelta(days=21), 20),
                        "subject": "Printable 2D with dimension strings",
                        "authorName": "Ney",
                        "lastTool": "Human",
                    },
                    {
                        "sha": "5e44b19",
                        "at": iso_day(TODAY - timedelta(days=27), 11),
                        "subject": "Load saved plan from JSON",
                        "authorName": "Ney",
                        "lastTool": "Cursor",
                    },
                    {
                        "sha": "3a01c77",
                        "at": iso_day(TODAY - timedelta(days=33), 16),
                        "subject": "First dollhouse extrude",
                        "authorName": "Ney",
                        "lastTool": "Unknown",
                    },
                ],
                "links": [
                    {
                        "label": "Repo",
                        "url": "https://github.com/BooRussia/floorplan-visualizer",
                    }
                ],
                "nextAction": "Push 2D room rename into callouts.js, then walk the Hernando demo plan once.",
            },
            {
                "id": "boorussia/edgecase",
                "owner": "BooRussia",
                "name": "edgecase",
                "url": "https://github.com/BooRussia/edgecase",
                "visibility": "public",
                "description": "Curated Tesla FSD dashcam index from X, ranked by severity.",
                "purpose": "Keep the index honest. Blocked on X API quota and a broken clip host.",
                "thumbnailUrl": "",
                "imageSource": "monogram",
                "status": "blocked",
                "needsMe": True,
                "defaultBranch": "main",
                "lastCommit": commit(
                    "e9021cc45aa0",
                    iso_day(TODAY - timedelta(days=11), 13),
                    "feat: retry clip posters when CDN 404s",
                    "Made-with: Cursor\n\nDoes not fix the quota. Host still 404s 18 clips.",
                    "Ney",
                    "ney@local",
                    "Cursor",
                    [
                        "src/clips/host.js",
                        "src/clips/retry.js",
                        "data/index.json",
                    ],
                    "https://github.com/BooRussia/edgecase/commit/e9021cc45aa0",
                ),
                "lastTool": "Cursor",
                "lastToolEvidence": "Commit body contains “Made-with: Cursor”. CommitterName is Cursor.",
                "lastBriefing": "LAST WATCH 11d. Cursor added retries for clip posters. Eighteen clips still 404, and the X pull is quota-blocked. This is waiting on you: either swap the clip host or freeze the index and mark those rows as missing. Do not ask an agent to invent replacements.",
                "recentCommits": [
                    {
                        "sha": "e9021cc",
                        "at": iso_day(TODAY - timedelta(days=11), 13),
                        "subject": "feat: retry clip posters when CDN 404s",
                        "authorName": "Ney",
                        "lastTool": "Cursor",
                    },
                    {
                        "sha": "d11a90b",
                        "at": iso_day(TODAY - timedelta(days=19), 17),
                        "subject": "Rank by severity, not likes",
                        "authorName": "Ney",
                        "lastTool": "Human",
                    },
                    {
                        "sha": "c08e44a",
                        "at": iso_day(TODAY - timedelta(days=24), 12),
                        "subject": "Parse X media from saved JSON",
                        "authorName": "Ney",
                        "lastTool": "Claude",
                    },
                    {
                        "sha": "aa77c12",
                        "at": iso_day(TODAY - timedelta(days=31), 8),
                        "subject": "Add maneuver tags",
                        "authorName": "Ney",
                        "lastTool": "Grok",
                    },
                    {
                        "sha": "9910b3e",
                        "at": iso_day(TODAY - timedelta(days=40), 21),
                        "subject": "Skeleton board layout",
                        "authorName": "Ney",
                        "lastTool": "Cursor",
                    },
                    {
                        "sha": "80c1d9a",
                        "at": iso_day(TODAY - timedelta(days=48), 14),
                        "subject": "Import first 40 clips",
                        "authorName": "Ney",
                        "lastTool": "Human",
                    },
                    {
                        "sha": "71aa002",
                        "at": iso_day(TODAY - timedelta(days=55), 9),
                        "subject": "Filter: night / rain / highway",
                        "authorName": "Ney",
                        "lastTool": "Copilot",
                    },
                    {
                        "sha": "60bb118",
                        "at": iso_day(TODAY - timedelta(days=62), 18),
                        "subject": "Initial Vite shell",
                        "authorName": "Ney",
                        "lastTool": "Unknown",
                    },
                ],
                "links": [
                    {"label": "Live", "url": "https://boorussia.github.io/edgecase/"}
                ],
                "nextAction": "Decide: new clip host, or freeze 18 missing rows. Quota will not clear itself.",
            },
        ],
    }

    acc_voxel = {
        "id": "voxeldesignedit",
        "login": "VoxelDesignedIt",
        "displayName": "Voxel Designed It",
        "host": "github.com",
        "projects": [
            {
                "id": "voxeldesignedit/voxel-drone-ops",
                "owner": "VoxelDesignedIt",
                "name": "voxel-drone-ops",
                "url": "https://github.com/VoxelDesignedIt/voxel-drone-ops",
                "visibility": "private",
                "description": "Studio ops board: jobs, aircraft, and deliverable status.",
                "purpose": "Private ops. JSON in this bay is the only contents the deck can show.",
                "thumbnailUrl": "",
                "imageSource": "monogram",
                "status": "active",
                "needsMe": True,
                "defaultBranch": "main",
                "lastCommit": commit(
                    "f3c10aa99120",
                    iso_day(TODAY - timedelta(days=3), 7),
                    "Add Hernando thermal job card",
                    "Co-authored-by: Cursor <cursoragent@cursor.com>\n\nDo not expose client addresses in the public site.",
                    "Ney",
                    "ney@local",
                    "Cursor",
                    [
                        "src/jobs/card.js",
                        "data/jobs/2026-08-hernando.json",
                        "src/privacy/redact.js",
                    ],
                    "https://github.com/VoxelDesignedIt/voxel-drone-ops/commit/f3c10aa99120",
                ),
                "lastTool": "Cursor",
                "lastToolEvidence": "Co-authored-by: Cursor <cursoragent@cursor.com> in commit body.",
                "lastBriefing": "LAST WATCH 3d. Cursor added the Hernando thermal card and a redact helper. The board still has two jobs in “awaiting stills” with no owner. You are the owner. Assign or close them before Friday’s shoot.",
                "recentCommits": [
                    {
                        "sha": "f3c10aa",
                        "at": iso_day(TODAY - timedelta(days=3), 7),
                        "subject": "Add Hernando thermal job card",
                        "authorName": "Ney",
                        "lastTool": "Cursor",
                    },
                    {
                        "sha": "e21bb04",
                        "at": iso_day(TODAY - timedelta(days=6), 19),
                        "subject": "Redact GPS from public JSON",
                        "authorName": "Ney",
                        "lastTool": "Human",
                    },
                    {
                        "sha": "c90aa17",
                        "at": iso_day(TODAY - timedelta(days=10), 12),
                        "subject": "Aircraft hours log",
                        "authorName": "Ney",
                        "lastTool": "Claude",
                    },
                    {
                        "sha": "b11d8e2",
                        "at": iso_day(TODAY - timedelta(days=15), 8),
                        "subject": "Status: awaiting stills",
                        "authorName": "Ney",
                        "lastTool": "Grok",
                    },
                    {
                        "sha": "a04c991",
                        "at": iso_day(TODAY - timedelta(days=20), 16),
                        "subject": "Client folder naming",
                        "authorName": "Ney",
                        "lastTool": "Human",
                    },
                    {
                        "sha": "8e77c10",
                        "at": iso_day(TODAY - timedelta(days=26), 11),
                        "subject": "Private README for operators",
                        "authorName": "Ney",
                        "lastTool": "Cursor",
                    },
                    {
                        "sha": "7c12ab9",
                        "at": iso_day(TODAY - timedelta(days=34), 9),
                        "subject": "Job schema v1",
                        "authorName": "Ney",
                        "lastTool": "Unknown",
                    },
                    {
                        "sha": "6a90ee4",
                        "at": iso_day(TODAY - timedelta(days=41), 18),
                        "subject": "Empty ops shell",
                        "authorName": "Ney",
                        "lastTool": "Copilot",
                    },
                ],
                "links": [],
                "nextAction": "Assign or close the two “awaiting stills” jobs before Friday.",
            },
            {
                "id": "voxeldesignedit/aerial-pricing",
                "owner": "VoxelDesignedIt",
                "name": "aerial-pricing",
                "url": "https://github.com/VoxelDesignedIt/aerial-pricing",
                "visibility": "public",
                "description": "Map-based drone job pricing calculator.",
                "purpose": "Shipped. Quote path is live. Park unless a rate card changes.",
                "thumbnailUrl": "",
                "imageSource": "monogram",
                "status": "shipped",
                "needsMe": False,
                "defaultBranch": "main",
                "lastCommit": commit(
                    "11d0aae77801",
                    iso_day(TODAY - timedelta(days=47), 15),
                    "Freeze 2026 rate card",
                    "No agent trailer. Typed by hand from the printed card.",
                    "Ney",
                    "ney@local",
                    "Ney",
                    ["src/rates/2026.json", "README.md"],
                    "https://github.com/VoxelDesignedIt/aerial-pricing/commit/11d0aae77801",
                ),
                "lastTool": "Human",
                "lastToolEvidence": "CommitterName matches author. Body states “No agent trailer. Typed by hand from the printed card.”",
                "lastBriefing": "LAST WATCH 47d. Human freeze of the 2026 rate card. Site is in production. Nothing in motion. Reopen only if insurance or FAA Part 107 language changes.",
                "recentCommits": [
                    {
                        "sha": "11d0aae",
                        "at": iso_day(TODAY - timedelta(days=47), 15),
                        "subject": "Freeze 2026 rate card",
                        "authorName": "Ney",
                        "lastTool": "Human",
                    },
                    {
                        "sha": "0c88b12",
                        "at": iso_day(TODAY - timedelta(days=54), 10),
                        "subject": "Printable quote PDF",
                        "authorName": "Ney",
                        "lastTool": "Claude",
                    },
                    {
                        "sha": "fa12c90",
                        "at": iso_day(TODAY - timedelta(days=61), 13),
                        "subject": "Map polygon area in acres",
                        "authorName": "Ney",
                        "lastTool": "Cursor",
                    },
                    {
                        "sha": "ee90aa1",
                        "at": iso_day(TODAY - timedelta(days=70), 9),
                        "subject": "Travel surcharge by county",
                        "authorName": "Ney",
                        "lastTool": "Human",
                    },
                    {
                        "sha": "d4bb018",
                        "at": iso_day(TODAY - timedelta(days=78), 17),
                        "subject": "Thermal vs photo line items",
                        "authorName": "Ney",
                        "lastTool": "Grok",
                    },
                    {
                        "sha": "c0a19e7",
                        "at": iso_day(TODAY - timedelta(days=88), 11),
                        "subject": "Copy quote as markdown",
                        "authorName": "Ney",
                        "lastTool": "Copilot",
                    },
                    {
                        "sha": "b81c003",
                        "at": iso_day(TODAY - timedelta(days=97), 8),
                        "subject": "Leaflet draw controls",
                        "authorName": "Ney",
                        "lastTool": "Cursor",
                    },
                    {
                        "sha": "a19ee44",
                        "at": iso_day(TODAY - timedelta(days=110), 16),
                        "subject": "First calculator shell",
                        "authorName": "Ney",
                        "lastTool": "Unknown",
                    },
                ],
                "links": [
                    {
                        "label": "Live",
                        "url": "https://voxeldesignedit.github.io/aerial-pricing/",
                    }
                ],
                "nextAction": "None. Reopen if the rate card or Part 107 language changes.",
            },
            {
                "id": "voxeldesignedit/opening-ops-kit",
                "owner": "VoxelDesignedIt",
                "name": "opening-ops-kit",
                "url": "https://github.com/VoxelDesignedIt/opening-ops-kit",
                "visibility": "public",
                "description": "3D showcase of window and door operations for customer demos.",
                "purpose": "Parked after the last sales season. Resume before next show.",
                "thumbnailUrl": "",
                "imageSource": "monogram",
                "status": "parked",
                "needsMe": False,
                "defaultBranch": "main",
                "lastCommit": commit(
                    "99c0ee1ab210",
                    iso_day(TODAY - timedelta(days=62), 14),
                    "chore: park demo lighting for show season",
                    "Copilot-generated commit message.\nCo-authored-by: github-copilot[bot] <github-copilot[bot]@users.noreply.github.com>",
                    "Ney",
                    "ney@local",
                    "GitHub",
                    ["src/demo/lights.js", "src/demo/season.js"],
                    "https://github.com/VoxelDesignedIt/opening-ops-kit/commit/99c0ee1ab210",
                ),
                "lastTool": "Copilot",
                "lastToolEvidence": "Co-authored-by: github-copilot[bot] and “Copilot-generated commit message.”",
                "lastBriefing": "LAST WATCH 62d. Copilot parked the demo lighting. The casement and slider rigs still play. Nothing is blocked. Leave it until the next in-person show; do not spend a morning “just polishing” the glass shader.",
                "recentCommits": [
                    {
                        "sha": "99c0ee1",
                        "at": iso_day(TODAY - timedelta(days=62), 14),
                        "subject": "chore: park demo lighting for show season",
                        "authorName": "Ney",
                        "lastTool": "Copilot",
                    },
                    {
                        "sha": "88b1c20",
                        "at": iso_day(TODAY - timedelta(days=70), 11),
                        "subject": "Casement crank animation",
                        "authorName": "Ney",
                        "lastTool": "Grok",
                    },
                    {
                        "sha": "77a09d4",
                        "at": iso_day(TODAY - timedelta(days=77), 16),
                        "subject": "Slider handle hits",
                        "authorName": "Ney",
                        "lastTool": "Claude",
                    },
                    {
                        "sha": "66c12ab",
                        "at": iso_day(TODAY - timedelta(days=85), 9),
                        "subject": "Low-E glass tint",
                        "authorName": "Ney",
                        "lastTool": "Cursor",
                    },
                    {
                        "sha": "55d0e18",
                        "at": iso_day(TODAY - timedelta(days=93), 13),
                        "subject": "Frame color swatches",
                        "authorName": "Ney",
                        "lastTool": "Human",
                    },
                    {
                        "sha": "44e91c0",
                        "at": iso_day(TODAY - timedelta(days=101), 18),
                        "subject": "Touch orbit damping",
                        "authorName": "Ney",
                        "lastTool": "Cursor",
                    },
                    {
                        "sha": "33f10aa",
                        "at": iso_day(TODAY - timedelta(days=112), 10),
                        "subject": "Show-mode kiosk flag",
                        "authorName": "Ney",
                        "lastTool": "Human",
                    },
                    {
                        "sha": "22a8b17",
                        "at": iso_day(TODAY - timedelta(days=120), 15),
                        "subject": "First hung window rig",
                        "authorName": "Ney",
                        "lastTool": "Unknown",
                    },
                ],
                "links": [
                    {
                        "label": "Repo",
                        "url": "https://github.com/VoxelDesignedIt/opening-ops-kit",
                    }
                ],
                "nextAction": "Leave parked. Resume two weeks before the next in-person show.",
            },
        ],
    }

    return {
        "schemaVersion": "1.0.0",
        "bayId": "shipyard",
        "updatedAt": iso_day(TODAY - timedelta(days=1), 23),
        "operator": "Rig",
        "status": "ok",
        "alerts": [
            {
                "level": "now",
                "title": "edgecase is blocked and needs you",
                "body": "18 clip posters 404. X quota is dead. Pick a host or freeze the rows.",
                "href": "#/shipyard/boorussia/edgecase",
            },
            {
                "level": "soon",
                "title": "voxel-drone-ops: two jobs have no owner",
                "body": "Hernando card landed. “Awaiting stills” is still yours.",
                "href": "#/shipyard/voxeldesignedit/voxel-drone-ops",
            },
        ],
        "payload": {"accounts": [acc_boorussia, acc_voxel]},
    }


def build_mailbag():
    return {
        "schemaVersion": "1.0.0",
        "bayId": "mailbag",
        "updatedAt": iso_day(TODAY, 7),
        "operator": "Post",
        "status": "ok",
        "alerts": [
            {
                "level": "now",
                "title": "Two threads want a reply today",
                "body": "Hernando stills handoff and the Best Buy open-box Dyson receipt. Post flagged both.",
                "href": "#/mailbag",
            },
            {
                "level": "info",
                "title": "Weekly scan is current",
                "body": "Gmail last 24h · 14 threads. No tax or legal timers this week.",
                "href": "#/mailbag",
            },
        ],
        "payload": {
            "cadence": "daily",
            "lastScanAt": iso_day(TODAY, 7),
            "briefings": [
                {
                    "id": "mb-2026-08-28",
                    "at": iso_day(TODAY, 7),
                    "operator": "Post",
                    "subject": "Morning bag — two replies, one receipt",
                    "severity": "now",
                    "needsReply": True,
                    "bullets": [
                        "Hernando client asked for thermal stills by 16:00 ET. Thread is 6 messages. You last wrote yesterday.",
                        "Best Buy sent an open-box Dyson V15 receipt to the shopping alias. Confirm it matches the 434 Amazon print before you buy a second unit.",
                        "Framework restock mail is marketing. Ignore.",
                    ],
                    "body": "Scan of the last 24 hours. Two threads need a human. Everything else is promo or already answered in the ops board.",
                    "source": "Gmail last 24h · 14 threads",
                    "threadCount": 14,
                },
                {
                    "id": "mb-2026-08-24",
                    "at": iso_day(date(2026, 8, 24), 7),
                    "operator": "Post",
                    "subject": "Weekly bag — quiet, one parked vendor",
                    "severity": "info",
                    "needsReply": False,
                    "bullets": [
                        "Weber dealer newsletter. No price. Still need Ace/Lowe's for the Genesis card.",
                        "GitHub billed BooRussia for private minutes. Expected. No action.",
                        "No unpaid invoices in the 7-day window.",
                    ],
                    "body": "A quiet week. Nothing legal, nothing tax. Vendor mail only.",
                    "source": "Gmail last 7d · 41 threads",
                    "threadCount": 41,
                },
            ],
        },
    }


def build_inbox_example():
    return {
        "schemaVersion": "1.0.0",
        "agent": "Pete",
        "bayId": "pirate",
        "at": iso_day(TODAY, 9),
        "kind": "merge",
        "payload": {
            "items": [
                {
                    "id": "dyson-v15-detect-extra",
                    "currentBest": {
                        "price": 429.00,
                        "retailer": "Amazon",
                        "url": "https://www.amazon.com/dp/B0C3L5R5QK",
                        "inStock": True,
                        "observedAt": iso_day(TODAY, 9),
                        "notes": "Matched ATL. Sold by Amazon.",
                    },
                    "priceHistory": [
                        {
                            "date": iso_day(TODAY, 9),
                            "price": 429.00,
                            "retailer": "Amazon",
                            "source": "agent",
                        }
                    ],
                    "log": [
                        {
                            "at": iso_day(TODAY, 9),
                            "actor": "pete",
                            "kind": "alert",
                            "text": "Amazon matched ATL at 429. Buy window is open.",
                        }
                    ],
                }
            ]
        },
    }


def write(path: Path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {path.relative_to(ROOT)}")


def main():
    pirate = build_pirate()
    write(BAYS / "pirate.json", pirate)
    write(BAYS / "shipyard.json", build_shipyard())
    write(BAYS / "mailbag.json", build_mailbag())
    write(INBOX / "example-pete.json", build_inbox_example())
    items = pirate["payload"]["items"]
    for it in items:
        print(
            f"  {it['id']}: {len(it['priceHistory'])} pts, grade={it['dealGrade']}, "
            f"best={it['currentBest']['price']} {it['currentBest']['retailer']}"
        )


if __name__ == "__main__":
    main()
