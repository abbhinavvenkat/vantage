from __future__ import annotations

"""
02b_patch_current_price.py

Enriches each fundamentals JSON with `current.price` (latest adj_close from
the prices parquet) so the backtest engine can scale historical market caps.

Safe to re-run: skips files that already have current.price set.
"""

import json
from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PRICES_PARQUET = PROJECT_ROOT / "data" / "codex" / "backtests" / "prices" / "all_prices.parquet"
FUNDAMENTALS_DIR = PROJECT_ROOT / "data" / "codex" / "backtests" / "fundamentals"


def main() -> None:
    if not PRICES_PARQUET.exists():
        print("ERROR: prices parquet not found. Run 01_fetch_universe_and_prices.py first.")
        return

    print("Loading prices parquet…")
    prices = pd.read_parquet(PRICES_PARQUET)
    prices.columns = [c.strip().lower().replace(" ", "_") for c in prices.columns]
    prices["date"] = pd.to_datetime(prices["date"])

    # Build {symbol: latest_adj_close} from the most recent non-NaN price
    print("Computing latest prices per symbol…")
    latest_prices: dict[str, float] = {}
    for sym, grp in prices.groupby("symbol"):
        valid = grp.dropna(subset=["adj_close"]).sort_values("date")
        if not valid.empty:
            latest_prices[str(sym)] = float(valid.iloc[-1]["adj_close"])

    print(f"Got latest prices for {len(latest_prices)} symbols")

    # Patch each fundamentals JSON
    patched = skipped = missing = 0
    for path in sorted(FUNDAMENTALS_DIR.glob("*.json")):
        if path.name.startswith("_"):
            continue
        symbol = path.stem.upper()
        try:
            with open(path) as f:
                data = json.load(f)
        except Exception as e:
            print(f"  WARN: could not read {path.name}: {e}")
            continue

        # Skip if already patched
        if data.get("current", {}).get("price") is not None:
            skipped += 1
            continue

        price = latest_prices.get(symbol)
        if price is None:
            missing += 1
            continue

        if "current" not in data:
            data["current"] = {}
        data["current"]["price"] = price

        with open(path, "w") as f:
            json.dump(data, f, indent=2)
        patched += 1

    print(f"\nDone — patched: {patched}  already had price: {skipped}  no price data: {missing}")


if __name__ == "__main__":
    main()
