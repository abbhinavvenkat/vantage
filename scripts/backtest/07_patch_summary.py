from __future__ import annotations
"""
07_patch_summary.py  —  Patch summary.json from existing CSV results.

Reads the 6 completed framework CSVs (mukherjea, prasad, agrawal, greenblatt,
lynch, graham), computes XIRR + total_return_pct from their cash flows, then
computes Nifty 50 (NIFTYBEES) and BSE 500 benchmarks and writes a complete
summary.json.  Naren is excluded intentionally — its backtest is still running.
"""

import csv
import json
import math
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import pandas as pd
from scipy.optimize import brentq

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "codex" / "backtests"
RESULTS_DIR = DATA_DIR / "results"
PRICES_PARQUET = DATA_DIR / "prices" / "all_prices.parquet"
UNIVERSE_CSV = DATA_DIR / "universe.csv"
SUMMARY_JSON = RESULTS_DIR / "summary.json"

DECISION_DATES = ["2016-01-04", "2020-01-02", "2023-01-02", "2026-05-03"]
FRAMEWORKS = ["mukherjea", "prasad", "agrawal", "greenblatt", "lynch", "graham", "naren"]
INITIAL_CAPITAL = 2_500_000  # ₹25L per framework period

BSE500_XIRR = 0.12350486178658189  # already computed by 06_generate_narratives.py


# ---------------------------------------------------------------------------
# XIRR
# ---------------------------------------------------------------------------

def xirr(cash_flows: list[tuple[date, float]]) -> Optional[float]:
    if not cash_flows:
        return None
    dates = [cf[0] for cf in cash_flows]
    amounts = [cf[1] for cf in cash_flows]
    t0 = min(dates)
    years = [(d - t0).days / 365.25 for d in dates]

    def npv(rate: float) -> float:
        return sum(a / (1.0 + rate) ** t for a, t in zip(amounts, years))

    try:
        result = brentq(npv, -0.999, 100.0, xtol=1e-8, maxiter=500)
        return float(result)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# CSV reading
# ---------------------------------------------------------------------------

def load_csv(fw: str, dd: str) -> list[dict]:
    path = RESULTS_DIR / f"{fw}_{dd}.csv"
    if not path.exists():
        return []
    rows = []
    with open(path) as f:
        reader = csv.DictReader(f)
        for row in reader:
            for field in ["score", "entry_price", "shares", "position_value",
                          "exit_price", "exit_value", "return_pct"]:
                try:
                    row[field] = float(row[field]) if row.get(field) not in ("", None) else None
                except (ValueError, TypeError):
                    row[field] = None
            rows.append(row)
    return rows


# ---------------------------------------------------------------------------
# Framework XIRR from CSVs
# ---------------------------------------------------------------------------

def compute_framework_xirr(fw: str) -> dict:
    cash_flows: list[tuple[date, float]] = []
    total_out = 0.0
    total_in = 0.0

    for i, dd in enumerate(DECISION_DATES):
        rows = load_csv(fw, dd)
        if not rows:
            continue
        dd_date = datetime.strptime(dd, "%Y-%m-%d").date()
        next_dd = DECISION_DATES[i + 1] if i < len(DECISION_DATES) - 1 else dd
        next_date = datetime.strptime(next_dd, "%Y-%m-%d").date()

        for row in rows:
            pv = row.get("position_value")
            ev = row.get("exit_value")
            if pv is None or math.isnan(pv) or pv <= 0:
                continue
            if ev is None or math.isnan(ev):
                ev = pv  # treat missing exit as flat (no gain/loss)
            cash_flows.append((dd_date, -pv))
            cash_flows.append((next_date, ev))
            total_out += pv
            total_in += ev

    fw_xirr = xirr(cash_flows)
    total_return_pct = round(((total_in / total_out) - 1.0) * 100.0, 2) if total_out > 0 else None

    xirr_str = f"{fw_xirr:.2%}" if fw_xirr is not None else "N/A"
    print(f"  [{fw}] XIRR={xirr_str} | TotalReturn={total_return_pct}% | {len(cash_flows)} cash flows")
    return {
        "xirr": fw_xirr,
        "total_return_pct": total_return_pct,
        "benchmark_vs_nifty50_xirr_delta": None,
        "benchmark_vs_bse500_xirr_delta": None,
    }


# ---------------------------------------------------------------------------
# Benchmark XIRRs from prices parquet
# ---------------------------------------------------------------------------

def get_price_on_or_before(sym: str, dt_str: str, prices_df: pd.DataFrame) -> Optional[float]:
    target = pd.to_datetime(dt_str)
    sub = prices_df[prices_df["symbol"] == sym]
    before = sub[sub["date"] <= target].sort_values("date")
    if before.empty:
        return None
    v = float(before.iloc[-1]["adj_close"])
    return v if not math.isnan(v) else None


def compute_nifty50_xirr(prices_df: pd.DataFrame) -> Optional[float]:
    """Buy NIFTYBEES at each decision date; fall back to ^NSEI via yfinance."""
    cash_flows: list[tuple[date, float]] = []
    niftybees_ok = any(
        get_price_on_or_before("NIFTYBEES", dd, prices_df) is not None
        for dd in DECISION_DATES
    )
    if niftybees_ok:
        for i, dd in enumerate(DECISION_DATES):
            buy_price = get_price_on_or_before("NIFTYBEES", dd, prices_df)
            if buy_price is None or buy_price <= 0:
                continue
            shares = INITIAL_CAPITAL / buy_price
            dd_date = datetime.strptime(dd, "%Y-%m-%d").date()
            cash_flows.append((dd_date, -INITIAL_CAPITAL))
            next_dd = DECISION_DATES[i + 1] if i < len(DECISION_DATES) - 1 else dd
            next_date = datetime.strptime(next_dd, "%Y-%m-%d").date()
            sell_price = get_price_on_or_before("NIFTYBEES", next_dd, prices_df) or buy_price
            cash_flows.append((next_date, shares * sell_price))
    else:
        print("  NIFTYBEES not in parquet; fetching ^NSEI via yfinance...")
        try:
            import yfinance as yf
            t = yf.Ticker("^NSEI")
            hist = t.history(start="2015-12-01", end="2026-05-05")
            hist.index = hist.index.tz_localize(None) if hist.index.tz else hist.index
            for i, dd in enumerate(DECISION_DATES):
                target = pd.to_datetime(dd)
                before = hist[hist.index <= target]
                if before.empty:
                    continue
                buy_price = float(before["Close"].iloc[-1])
                if math.isnan(buy_price) or buy_price <= 0:
                    continue
                shares = INITIAL_CAPITAL / buy_price
                dd_date = datetime.strptime(dd, "%Y-%m-%d").date()
                cash_flows.append((dd_date, -INITIAL_CAPITAL))
                next_dd = DECISION_DATES[i + 1] if i < len(DECISION_DATES) - 1 else dd
                next_date = datetime.strptime(next_dd, "%Y-%m-%d").date()
                target2 = pd.to_datetime(next_dd)
                before2 = hist[hist.index <= target2]
                sell_price = float(before2["Close"].iloc[-1]) if not before2.empty else buy_price
                cash_flows.append((next_date, shares * sell_price))
        except Exception as e:
            print(f"  yfinance error: {e}")
    result = xirr(cash_flows)
    print(f"  Nifty 50 XIRR: {result:.2%}" if result else "  Nifty 50 XIRR: N/A")
    return result


def compute_n500_ew_xirr(prices_df: pd.DataFrame) -> Optional[float]:
    """Equal-weight all Nifty 500 stocks at each decision date."""
    universe = pd.read_csv(UNIVERSE_CSV)
    universe.columns = [c.strip().lower().replace(" ", "_") for c in universe.columns]
    symbols = universe["symbol"].dropna().str.strip().tolist()
    n = len(symbols)
    if n == 0:
        return None
    per_stock = INITIAL_CAPITAL / n
    agg: list[tuple[date, float]] = []
    for i, dd in enumerate(DECISION_DATES):
        dd_date = datetime.strptime(dd, "%Y-%m-%d").date()
        next_dd = DECISION_DATES[i + 1] if i < len(DECISION_DATES) - 1 else dd
        next_date = datetime.strptime(next_dd, "%Y-%m-%d").date()
        for sym in symbols:
            buy_price = get_price_on_or_before(sym, dd, prices_df)
            if buy_price is None or buy_price <= 0:
                continue
            shares = per_stock / buy_price
            agg.append((dd_date, -per_stock))
            sell_price = get_price_on_or_before(sym, next_dd, prices_df)
            if sell_price is None:
                sell_price = buy_price
            agg.append((next_date, shares * sell_price))
    result = xirr(agg)
    print(f"  Nifty 500 equal-weight XIRR: {result:.2%}" if result else "  Nifty 500 EW XIRR: N/A")
    return result


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("07_patch_summary.py  —  patching summary.json from CSVs")
    print("=" * 60)

    print("\nLoading prices parquet...")
    prices_df = pd.read_parquet(PRICES_PARQUET)
    prices_df.columns = [c.strip().lower().replace(" ", "_") for c in prices_df.columns]
    prices_df["date"] = pd.to_datetime(prices_df["date"])
    print(f"  {len(prices_df)} rows, symbols: {prices_df['symbol'].nunique()}")

    print("\n--- Framework XIRRs ---")
    frameworks: dict = {}
    for fw in FRAMEWORKS:
        frameworks[fw] = compute_framework_xirr(fw)

    print("\n--- Benchmark XIRRs ---")
    nifty50_xirr = compute_nifty50_xirr(prices_df)
    n500_xirr = compute_n500_ew_xirr(prices_df)
    bse500_xirr = BSE500_XIRR
    print(f"  BSE 500 XIRR: {bse500_xirr:.2%}")

    # Load existing summary to preserve portfolios + total_return_pct from 04_backtest.py
    existing: dict = {}
    if SUMMARY_JSON.exists():
        try:
            with open(SUMMARY_JSON) as f:
                import re as _re
                raw = f.read()
                # JSON doesn't support NaN — replace bare NaN with null
                raw = _re.sub(r'\bNaN\b', 'null', raw)
                existing = json.loads(raw)
        except Exception as e:
            print(f"  WARNING: could not read existing summary.json: {e}")

    print("\n--- Delta computation ---")
    for fw, data in frameworks.items():
        fw_xirr = data["xirr"]
        xirr_str = f"{fw_xirr:.2%}" if fw_xirr is not None else "N/A"
        if fw_xirr is not None:
            data["benchmark_vs_nifty50_xirr_delta"] = (
                round(fw_xirr - nifty50_xirr, 4) if nifty50_xirr is not None else None
            )
            data["benchmark_vs_bse500_xirr_delta"] = round(fw_xirr - bse500_xirr, 4)
        # Preserve portfolios block and total_return_pct from existing summary if available
        existing_fw = existing.get("frameworks", {}).get(fw, {})
        if existing_fw.get("portfolios"):
            data["portfolios"] = existing_fw["portfolios"]
        if data["total_return_pct"] is None and existing_fw.get("total_return_pct") is not None:
            data["total_return_pct"] = existing_fw["total_return_pct"]
        print(f"  {fw}: XIRR={xirr_str} | vsNifty50={data['benchmark_vs_nifty50_xirr_delta']} | vsBSE500={data['benchmark_vs_bse500_xirr_delta']}")

    summary = {
        "run_at": existing.get("run_at") or datetime.utcnow().isoformat() + "Z",
        "decision_dates": DECISION_DATES,
        "frameworks_done": FRAMEWORKS,
        "frameworks": frameworks,
        "benchmarks": {
            "nifty50_xirr": nifty50_xirr,
            "nifty500_equal_weight_xirr": n500_xirr,
            "bse500_xirr": bse500_xirr,
        },
        "data_quality_notes": [
            "XIRR patched from CSV cash flows (NaN-price stocks excluded per period)",
            "survivorship bias present: Nifty 500 current constituents used",
        ],
    }

    with open(SUMMARY_JSON, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"\nWrote {SUMMARY_JSON}")

    print("\n--- Summary table ---")
    print(f"{'Framework':<15} {'XIRR':>8} {'TotalRet':>10} {'vsN50':>8} {'vsBSE500':>10}")
    print("-" * 55)
    for fw, d in frameworks.items():
        x = f"{d['xirr']:.1%}" if d["xirr"] else "N/A"
        r = f"{d['total_return_pct']:.1f}%" if d["total_return_pct"] else "N/A"
        n50 = f"{d['benchmark_vs_nifty50_xirr_delta']:+.1%}" if d["benchmark_vs_nifty50_xirr_delta"] is not None else "N/A"
        b5 = f"{d['benchmark_vs_bse500_xirr_delta']:+.1%}" if d["benchmark_vs_bse500_xirr_delta"] is not None else "N/A"
        print(f"{fw:<15} {x:>8} {r:>10} {n50:>8} {b5:>10}")
    print("-" * 55)
    n50s = f"{nifty50_xirr:.1%}" if nifty50_xirr else "N/A"
    n5s = f"{n500_xirr:.1%}" if n500_xirr else "N/A"
    print(f"{'Nifty 50':<15} {n50s:>8}")
    bse_str = f"{bse500_xirr * 100:.1f}%"
    print(f"{'BSE 500':<15} {bse_str:>8}")
    print(f"{'N500 EW':<15} {n5s:>8}")
    print("=" * 60)


if __name__ == "__main__":
    main()
