"""
05_run_backtest.py — Runner script for the multi-framework investor backtest.

Usage:
    python scripts/backtest/05_run_backtest.py

Pre-conditions (checked at startup):
  1. data/codex/backtests/universe.csv           — Nifty 500 symbol list
  2. data/codex/backtests/prices/all_prices.parquet — daily OHLCV
  3. data/codex/backtests/fundamentals/<SYMBOL>.json — at least 200 stocks

If data is missing, prints a clear message and exits with code 1.
If data is ready, runs the full backtest (calls 04_backtest.main()).
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "codex" / "backtests"

UNIVERSE_CSV = DATA_DIR / "universe.csv"
PRICES_PARQUET = DATA_DIR / "prices" / "all_prices.parquet"
FUNDAMENTALS_DIR = DATA_DIR / "fundamentals"

MIN_FUNDAMENTALS_COUNT = 200  # require at least this many JSONs before running


# ---------------------------------------------------------------------------
# Data readiness check
# ---------------------------------------------------------------------------

def check_data_ready() -> tuple[bool, list[str]]:
    """
    Verify that all required data artefacts are present and minimally valid.
    Returns (ready: bool, issues: list[str]).
    """
    issues: list[str] = []

    # 1. universe.csv
    if not UNIVERSE_CSV.exists():
        issues.append(f"Missing universe file: {UNIVERSE_CSV}")
    else:
        try:
            with open(UNIVERSE_CSV) as f:
                lines = f.readlines()
            # Expect header + at least 100 data rows
            if len(lines) < 101:
                issues.append(
                    f"universe.csv has only {len(lines) - 1} rows — expected ≥ 100."
                )
        except Exception as e:
            issues.append(f"Could not read universe.csv: {e}")

    # 2. prices parquet
    if not PRICES_PARQUET.exists():
        issues.append(f"Missing prices file: {PRICES_PARQUET}")
    else:
        try:
            import pandas as pd
            df = pd.read_parquet(PRICES_PARQUET)
            if len(df) < 1000:
                issues.append(
                    f"prices/all_prices.parquet has only {len(df)} rows — expected ≥ 1000."
                )
        except ImportError:
            issues.append("pandas/pyarrow not installed — cannot validate parquet.")
        except Exception as e:
            issues.append(f"Could not read all_prices.parquet: {e}")

    # 3. fundamentals JSONs
    if not FUNDAMENTALS_DIR.exists():
        issues.append(f"Missing fundamentals directory: {FUNDAMENTALS_DIR}")
    else:
        json_files = list(FUNDAMENTALS_DIR.glob("*.json"))
        if len(json_files) < MIN_FUNDAMENTALS_COUNT:
            issues.append(
                f"Only {len(json_files)} fundamentals JSONs found in {FUNDAMENTALS_DIR}. "
                f"Need ≥ {MIN_FUNDAMENTALS_COUNT}. "
                "Run 01_fetch_universe.py and 02_fetch_fundamentals.py first."
            )

    return (len(issues) == 0), issues


# ---------------------------------------------------------------------------
# Dynamic import of 04_backtest.py (also starts with digit)
# ---------------------------------------------------------------------------

def load_backtest_module():
    """Load 04_backtest.py via importlib (filename starts with digit)."""
    bt_path = Path(__file__).resolve().parent / "04_backtest.py"
    if not bt_path.exists():
        print(f"ERROR: Cannot find {bt_path}")
        sys.exit(1)
    spec = importlib.util.spec_from_file_location("backtest_04", bt_path)
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("Multi-Framework Investor Backtest — Data Check")
    print("=" * 60)

    ready, issues = check_data_ready()

    if not ready:
        print("\nData not ready yet. Run 01 and 02 first.\n")
        print("Issues found:")
        for issue in issues:
            print(f"  - {issue}")
        print()
        print("Expected data layout:")
        print(f"  {UNIVERSE_CSV}")
        print(f"  {PRICES_PARQUET}")
        print(f"  {FUNDAMENTALS_DIR}/<SYMBOL>.json  (≥ {MIN_FUNDAMENTALS_COUNT} files)")
        sys.exit(1)

    # Count fundamentals for info
    fund_count = len(list(FUNDAMENTALS_DIR.glob("*.json")))
    print(f"\nData ready:")
    print(f"  universe.csv              ✓")
    print(f"  all_prices.parquet        ✓")
    print(f"  fundamentals JSONs        ✓  ({fund_count} stocks)")
    print()
    print("Starting backtest...")
    print("=" * 60)

    bt = load_backtest_module()
    bt.main()


if __name__ == "__main__":
    main()
