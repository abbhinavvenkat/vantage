from __future__ import annotations

"""
04_backtest.py — Multi-framework backtest engine.

Decision dates: 2016-01-04, 2020-01-02, 2023-01-02, 2026-05-03
Each framework selects its top 25 stocks at each date, holds until the next
date, then rebalances. XIRR is computed on the full cash-flow stream.

All data lives under data/codex/backtests/:
  universe.csv                        — Nifty 500 symbols
  prices/all_prices.parquet           — daily OHLCV (long format)
  fundamentals/<SYMBOL>.json          — 10-year annual financials
  results/                            — output directory
"""

import json
import os
import sys
import csv
from datetime import date, datetime
from pathlib import Path
from typing import Optional

import importlib.util

import pandas as pd
import numpy as np
from scipy.optimize import brentq

# ---------------------------------------------------------------------------
# Import 03_frameworks.py — module name starts with a digit so we use
# importlib.util.spec_from_file_location instead of a normal import.
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_fw_path = Path(__file__).resolve().parent / "03_frameworks.py"
_fw_spec = importlib.util.spec_from_file_location("frameworks_03", _fw_path)
_fw_mod = importlib.util.module_from_spec(_fw_spec)  # type: ignore[arg-type]
_fw_spec.loader.exec_module(_fw_mod)  # type: ignore[union-attr]

score_mukherjea = _fw_mod.score_mukherjea
score_prasad = _fw_mod.score_prasad
score_agrawal = _fw_mod.score_agrawal
score_greenblatt = _fw_mod.score_greenblatt
score_lynch = _fw_mod.score_lynch
score_graham = _fw_mod.score_graham
score_naren = _fw_mod.score_naren
compute_greenblatt_scores = _fw_mod.compute_greenblatt_scores
get_fundamentals_at_date = _fw_mod.get_fundamentals_at_date
get_price_at_date = _fw_mod.get_price_at_date
get_market_cap_at_date = _fw_mod.get_market_cap_at_date
cagr = _fw_mod.cagr

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DECISION_DATES = ["2016-01-04", "2020-01-02", "2023-01-02", "2026-05-03"]
TOP_N = 25
INITIAL_CAPITAL = 2_500_000  # ₹25L per framework
FRAMEWORKS = ["mukherjea", "prasad", "agrawal", "greenblatt", "lynch", "graham", "naren"]
MIN_SCORE_THRESHOLD = 30.0

DATA_DIR = PROJECT_ROOT / "data" / "codex" / "backtests"
UNIVERSE_CSV = DATA_DIR / "universe.csv"
PRICES_PARQUET = DATA_DIR / "prices" / "all_prices.parquet"
FUNDAMENTALS_DIR = DATA_DIR / "fundamentals"
RESULTS_DIR = DATA_DIR / "results"


# ---------------------------------------------------------------------------
# XIRR
# ---------------------------------------------------------------------------

def xirr(cash_flows: list[tuple[date, float]]) -> Optional[float]:
    """
    Compute XIRR (annualised IRR) from irregular cash flows.

    cash_flows: list of (date, amount)
        negative amounts = outflows (purchases)
        positive amounts = inflows (proceeds)

    Returns annualised rate or None if computation fails.
    """
    if not cash_flows:
        return None

    dates = [cf[0] for cf in cash_flows]
    amounts = [cf[1] for cf in cash_flows]
    t0 = min(dates)
    years = [(d - t0).days / 365.25 for d in dates]

    def npv(rate: float) -> float:
        return sum(a / (1.0 + rate) ** t for a, t in zip(amounts, years))

    try:
        return brentq(npv, -0.999, 100.0, xtol=1e-8, maxiter=500)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_universe() -> pd.DataFrame:
    """Load Nifty 500 universe. Expected columns: symbol, company_name, sector."""
    df = pd.read_csv(UNIVERSE_CSV)
    # Normalise column names
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    return df


def load_prices() -> pd.DataFrame:
    """Load daily prices from parquet. Expected columns: date, symbol, adj_close, high."""
    df = pd.read_parquet(PRICES_PARQUET)
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]
    df["date"] = pd.to_datetime(df["date"])
    return df


def load_all_fundamentals() -> dict[str, dict]:
    """
    Load all fundamentals JSONs from FUNDAMENTALS_DIR.
    Returns {symbol: data_dict}.
    """
    fundamentals: dict[str, dict] = {}
    for path in FUNDAMENTALS_DIR.glob("*.json"):
        symbol = path.stem.upper()
        try:
            with open(path) as f:
                fundamentals[symbol] = json.load(f)
        except Exception as e:
            print(f"  Warning: could not load {path}: {e}")
    return fundamentals


# ---------------------------------------------------------------------------
# Price utilities
# ---------------------------------------------------------------------------

def get_52w_high(symbol: str, date_str: str, prices_df: pd.DataFrame) -> Optional[float]:
    """Return the 52-week high for symbol up to and including date_str."""
    sym_prices = prices_df[prices_df["symbol"] == symbol].copy()
    if sym_prices.empty:
        return None
    target_dt = pd.to_datetime(date_str)
    start_dt = target_dt - pd.DateOffset(years=1)
    window = sym_prices[(sym_prices["date"] >= start_dt) & (sym_prices["date"] <= target_dt)]
    if window.empty:
        return None
    high_col = "high" if "high" in window.columns else "adj_close"
    return float(window[high_col].max())


def compute_sector_pe_medians(
    universe_df: pd.DataFrame,
    all_fundamentals: dict[str, dict],
    date_str: str,
    prices_df: pd.DataFrame,
) -> dict[str, float]:
    """
    Compute median PE per sector from available fundamentals at date_str.
    Returns {sector: median_pe}.
    """
    sector_pes: dict[str, list[float]] = {}
    for _, row in universe_df.iterrows():
        sym = row["symbol"]
        sector = row.get("sector", "unknown")
        fund = get_fundamentals_at_date(sym, date_str, all_fundamentals)
        if fund is None:
            continue
        annual = fund.get("annual", {})
        if not annual:
            continue
        all_fys = sorted(annual.keys(), key=lambda k: (_fw_mod._fy_year(k) or 0))
        latest_fy = all_fys[-1] if all_fys else None
        if not latest_fy:
            continue
        pat = annual[latest_fy].get("pat_cr")
        if pat is None or pat <= 0:
            continue
        mcap = get_market_cap_at_date(
            sym, date_str, prices_df,
            fund.get("current", {}).get("market_cap_cr"),
            fund.get("current", {}).get("price"),
        )
        if mcap is None or mcap <= 0:
            continue
        pe = mcap / pat
        if pe > 0:
            sector_pes.setdefault(sector, []).append(pe)

    return {s: float(np.median(pes)) for s, pes in sector_pes.items() if pes}


# ---------------------------------------------------------------------------
# Portfolio construction at a single decision date
# ---------------------------------------------------------------------------

def build_portfolio(
    framework: str,
    date_str: str,
    universe_df: pd.DataFrame,
    all_fundamentals: dict[str, dict],
    prices_df: pd.DataFrame,
    sector_pe_medians: dict[str, float],
    greenblatt_scores: dict[str, float],
) -> list[dict]:
    """
    Score all universe stocks under `framework` at `date_str`.
    Returns list of top TOP_N dicts sorted by score descending, each:
    {symbol, company_name, sector, score, entry_price}
    """
    rows = []

    for _, urow in universe_df.iterrows():
        sym = urow["symbol"]
        company_name = urow.get("company_name", sym)
        sector = urow.get("sector", "unknown")

        fund = get_fundamentals_at_date(sym, date_str, all_fundamentals)
        if fund is None:
            continue

        price = get_price_at_date(sym, date_str, prices_df)
        if price is None or price <= 0:
            continue

        current = fund.get("current", {})
        current_price = current.get("price")  # optional field
        mcap = get_market_cap_at_date(
            sym, date_str, prices_df,
            current.get("market_cap_cr"),
            current_price,
        )

        sc: float = 0.0

        if framework == "mukherjea":
            sc = score_mukherjea(sym, fund, price, mcap, sector)

        elif framework == "prasad":
            sc = score_prasad(sym, fund, price, mcap, sector)

        elif framework == "agrawal":
            sc = score_agrawal(sym, fund, price, mcap, sector)

        elif framework == "greenblatt":
            sc = greenblatt_scores.get(sym, 0.0)

        elif framework == "lynch":
            sc = score_lynch(sym, fund, price, mcap, sector)

        elif framework == "graham":
            sc = score_graham(sym, fund, price, mcap, sector)

        elif framework == "naren":
            w52h = get_52w_high(sym, date_str, prices_df)
            sec_pe_med = sector_pe_medians.get(sector)
            sc = score_naren(sym, fund, price, mcap, sector, sec_pe_med, w52h)

        if sc >= MIN_SCORE_THRESHOLD:
            rows.append({
                "symbol": sym,
                "company_name": company_name,
                "sector": sector,
                "score": sc,
                "entry_price": price,
            })

    rows.sort(key=lambda r: r["score"], reverse=True)
    return rows[:TOP_N]


# ---------------------------------------------------------------------------
# Backtest main loop
# ---------------------------------------------------------------------------

def run_backtest(
    universe_df: pd.DataFrame,
    all_fundamentals: dict[str, dict],
    prices_df: pd.DataFrame,
) -> dict:
    """
    Full multi-framework backtest across all DECISION_DATES.
    Returns results dict matching summary.json schema.
    """
    results: dict = {
        "run_at": datetime.utcnow().isoformat() + "Z",
        "decision_dates": DECISION_DATES,
        "frameworks": {},
        "benchmarks": {},
        "data_quality_notes": [
            "survivorship_bias_acknowledged",
            "fundamentals_scraped_screener_in",
            "market_cap_estimated_from_price_ratio",
        ],
    }

    # Pre-compute sector PE medians for each decision date
    print("Computing sector PE medians for each decision date...")
    sector_medians_by_date: dict[str, dict[str, float]] = {}
    for dd in DECISION_DATES:
        print(f"  {dd}...")
        sector_medians_by_date[dd] = compute_sector_pe_medians(
            universe_df, all_fundamentals, dd, prices_df
        )

    # Pre-compute Greenblatt scores (cross-sectional) for each decision date
    print("Computing Greenblatt cross-sectional scores for each decision date...")
    greenblatt_by_date: dict[str, dict[str, float]] = {}
    for dd in DECISION_DATES:
        print(f"  {dd}...")
        candidates = []
        for _, urow in universe_df.iterrows():
            sym = urow["symbol"]
            fund = get_fundamentals_at_date(sym, dd, all_fundamentals)
            if fund is None:
                continue
            price = get_price_at_date(sym, dd, prices_df)
            if price is None:
                continue
            current = fund.get("current", {})
            mcap = get_market_cap_at_date(
                sym, dd, prices_df,
                current.get("market_cap_cr"),
                current.get("price"),
            )
            candidates.append({
                "symbol": sym,
                "fundamentals": fund,
                "price": price,
                "market_cap_cr": mcap,
                "sector": urow.get("sector", "unknown"),
            })
        greenblatt_by_date[dd] = compute_greenblatt_scores(candidates)

    # Benchmark cash flows (same investment pattern across decision dates)
    # Nifty 50 via NIFTYBEES
    nifty_cfs: list[tuple[date, float]] = []
    n500_cfs: list[tuple[date, float]] = []

    # Per-framework backtest
    for fw in FRAMEWORKS:
        print(f"\nRunning framework: {fw}")
        fw_result: dict = {
            "xirr": None,
            "total_return_pct": None,
            "portfolios": {},
            "benchmark_vs_nifty50_xirr_delta": None,
        }

        cash_flows: list[tuple[date, float]] = []
        period_portfolios: dict[str, dict] = {}

        for period_idx, dd in enumerate(DECISION_DATES):
            is_last = period_idx == len(DECISION_DATES) - 1
            dd_date = datetime.strptime(dd, "%Y-%m-%d").date()

            print(f"  [{fw}] Building portfolio at {dd}...")

            portfolio_rows = build_portfolio(
                fw, dd,
                universe_df, all_fundamentals, prices_df,
                sector_medians_by_date[dd],
                greenblatt_by_date[dd],
            )

            if not portfolio_rows:
                print(f"  [{fw}] No stocks met threshold at {dd}, skipping period.")
                period_portfolios[dd] = {
                    "stocks": [],
                    "scores": {},
                    "portfolio_value_at_next_date": 0,
                }
                continue

            # Equal-weight across top N
            per_stock_capital = INITIAL_CAPITAL / len(portfolio_rows)

            for row in portfolio_rows:
                ep = row["entry_price"]
                if ep <= 0:
                    continue
                shares = per_stock_capital / ep
                row["shares"] = shares
                row["position_value"] = shares * ep
                # Outflow at entry
                cash_flows.append((dd_date, -row["position_value"]))

            stocks_in = [r["symbol"] for r in portfolio_rows]
            scores_in = {r["symbol"]: round(r["score"], 2) for r in portfolio_rows}

            # Determine next date to compute exit values
            next_dd = DECISION_DATES[period_idx + 1] if not is_last else dd
            next_dd_date = datetime.strptime(next_dd, "%Y-%m-%d").date()

            portfolio_value_at_next = 0.0
            for row in portfolio_rows:
                exit_price = get_price_at_date(row["symbol"], next_dd, prices_df)
                if exit_price is None:
                    exit_price = row["entry_price"]  # fallback: no gain/loss
                row["exit_price"] = exit_price
                row["exit_value"] = row.get("shares", 0) * exit_price
                row["return_pct"] = (
                    (exit_price / row["entry_price"] - 1.0) * 100.0
                    if row["entry_price"] > 0
                    else 0.0
                )
                portfolio_value_at_next += row["exit_value"]
                # Inflow at exit (at next decision date or final mark-to-market)
                cash_flows.append((next_dd_date, row["exit_value"]))

            period_portfolios[dd] = {
                "stocks": stocks_in,
                "scores": scores_in,
                "portfolio_value_at_next_date": round(portfolio_value_at_next, 2),
                "rows": portfolio_rows,  # keep full rows for CSV export
            }

            print(f"    Stocks: {len(portfolio_rows)} | Value at next date: ₹{portfolio_value_at_next:,.0f}")

        # Compute XIRR
        print(f"  [{fw}] Computing XIRR from {len(cash_flows)} cash flows...")
        fw_xirr = xirr(cash_flows)
        print(f"  [{fw}] XIRR = {fw_xirr:.2%}" if fw_xirr is not None else f"  [{fw}] XIRR computation failed.")

        # Total return: initial outflow vs final value
        total_out = sum(abs(a) for d, a in cash_flows if a < 0)
        total_in = sum(a for d, a in cash_flows if a > 0)
        total_return_pct = ((total_in / total_out) - 1.0) * 100.0 if total_out > 0 else None

        fw_result["xirr"] = fw_xirr
        fw_result["total_return_pct"] = round(total_return_pct, 2) if total_return_pct is not None else None

        # Store per-period portfolio summaries (without internal row data)
        for dd, pd_data in period_portfolios.items():
            fw_result["portfolios"][dd] = {
                "stocks": pd_data["stocks"],
                "scores": pd_data["scores"],
                "portfolio_value_at_next_date": pd_data["portfolio_value_at_next_date"],
            }

        results["frameworks"][fw] = fw_result

        # Export CSVs
        RESULTS_DIR.mkdir(parents=True, exist_ok=True)
        for dd, pd_data in period_portfolios.items():
            rows_for_csv = pd_data.get("rows", [])
            if not rows_for_csv:
                continue
            csv_path = RESULTS_DIR / f"{fw}_{dd}.csv"
            _export_portfolio_csv(csv_path, rows_for_csv)
            print(f"  Saved {csv_path.name}")

    # ---------------------------------------------------------------------------
    # Benchmarks
    # ---------------------------------------------------------------------------
    print("\nComputing benchmarks...")

    # Nifty 50 via NIFTYBEES
    nifty_xirr = _compute_benchmark_xirr("NIFTYBEES", prices_df)
    print(f"  Nifty 50 (NIFTYBEES) XIRR: {nifty_xirr:.2%}" if nifty_xirr is not None else "  Nifty 50 XIRR: N/A")

    # Nifty 500 equal-weight
    n500_xirr = _compute_n500_equal_weight_xirr(universe_df, prices_df)
    print(f"  Nifty 500 equal-weight XIRR: {n500_xirr:.2%}" if n500_xirr is not None else "  Nifty 500 EW XIRR: N/A")

    results["benchmarks"] = {
        "nifty50_xirr": nifty_xirr,
        "nifty500_equal_weight_xirr": n500_xirr,
    }

    # Add delta vs Nifty 50 for each framework
    for fw in FRAMEWORKS:
        fw_xirr = results["frameworks"].get(fw, {}).get("xirr")
        if fw_xirr is not None and nifty_xirr is not None:
            results["frameworks"][fw]["benchmark_vs_nifty50_xirr_delta"] = round(
                fw_xirr - nifty_xirr, 4
            )

    return results


def _export_portfolio_csv(path: Path, rows: list[dict]) -> None:
    """Write per-framework per-date portfolio CSV."""
    fieldnames = [
        "symbol", "company_name", "sector", "score",
        "entry_price", "shares", "position_value",
        "exit_price", "exit_value", "return_pct",
    ]
    with open(path, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: round(v, 4) if isinstance(v, float) else v for k, v in row.items()})


def _compute_benchmark_xirr(
    symbol: str,
    prices_df: pd.DataFrame,
) -> Optional[float]:
    """
    Simulate buying ₹INITIAL_CAPITAL of `symbol` at each DECISION_DATE,
    then selling at the next DECISION_DATE, with final mark-to-market at
    the last date. Returns XIRR.
    """
    cash_flows: list[tuple[date, float]] = []
    per_period_capital = INITIAL_CAPITAL

    for i, dd in enumerate(DECISION_DATES):
        dd_date = datetime.strptime(dd, "%Y-%m-%d").date()
        buy_price = get_price_at_date(symbol, dd, prices_df)
        if buy_price is None or buy_price <= 0:
            continue
        shares = per_period_capital / buy_price
        cash_flows.append((dd_date, -per_period_capital))

        next_dd = DECISION_DATES[i + 1] if i < len(DECISION_DATES) - 1 else dd
        next_date = datetime.strptime(next_dd, "%Y-%m-%d").date()
        sell_price = get_price_at_date(symbol, next_dd, prices_df)
        if sell_price is None:
            sell_price = buy_price
        cash_flows.append((next_date, shares * sell_price))

    return xirr(cash_flows)


def _compute_n500_equal_weight_xirr(
    universe_df: pd.DataFrame,
    prices_df: pd.DataFrame,
) -> Optional[float]:
    """
    Equal-weight all Nifty 500 stocks at each DECISION_DATE.
    Returns XIRR for the aggregate portfolio.
    """
    agg_cash_flows: list[tuple[date, float]] = []
    n = len(universe_df)
    if n == 0:
        return None

    per_stock_capital = INITIAL_CAPITAL / n

    for i, dd in enumerate(DECISION_DATES):
        dd_date = datetime.strptime(dd, "%Y-%m-%d").date()
        next_dd = DECISION_DATES[i + 1] if i < len(DECISION_DATES) - 1 else dd
        next_date = datetime.strptime(next_dd, "%Y-%m-%d").date()

        for _, urow in universe_df.iterrows():
            sym = urow["symbol"]
            buy_price = get_price_at_date(sym, dd, prices_df)
            if buy_price is None or buy_price <= 0:
                continue
            shares = per_stock_capital / buy_price
            agg_cash_flows.append((dd_date, -per_stock_capital))

            sell_price = get_price_at_date(sym, next_dd, prices_df)
            if sell_price is None:
                sell_price = buy_price
            agg_cash_flows.append((next_date, shares * sell_price))

    return xirr(agg_cash_flows)


# ---------------------------------------------------------------------------
# Entry point (called from 05_run_backtest.py)
# ---------------------------------------------------------------------------

def main() -> None:
    """Load data, run backtest, write results."""
    print("Loading universe...")
    universe_df = load_universe()
    print(f"  {len(universe_df)} stocks in universe.")

    print("Loading prices...")
    prices_df = load_prices()
    print(f"  {len(prices_df)} price rows loaded.")

    print("Loading fundamentals...")
    all_fundamentals = load_all_fundamentals()
    print(f"  {len(all_fundamentals)} stocks with fundamentals.")

    results = run_backtest(universe_df, all_fundamentals, prices_df)

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = RESULTS_DIR / "summary.json"
    with open(summary_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nResults written to {summary_path}")

    # Print summary table
    print("\n" + "=" * 60)
    print(f"{'Framework':<15} {'XIRR':>8} {'Total Return':>14} {'vs Nifty50':>12}")
    print("-" * 60)
    nifty_xirr = results["benchmarks"].get("nifty50_xirr")
    for fw in FRAMEWORKS:
        fw_data = results["frameworks"].get(fw, {})
        fw_xirr = fw_data.get("xirr")
        fw_ret = fw_data.get("total_return_pct")
        delta = fw_data.get("benchmark_vs_nifty50_xirr_delta")

        xirr_str = f"{fw_xirr:.1%}" if fw_xirr is not None else "N/A"
        ret_str = f"{fw_ret:.1f}%" if fw_ret is not None else "N/A"
        delta_str = f"{delta:+.1%}" if delta is not None else "N/A"
        print(f"{fw:<15} {xirr_str:>8} {ret_str:>14} {delta_str:>12}")

    print("-" * 60)
    nifty_str = f"{nifty_xirr:.1%}" if nifty_xirr is not None else "N/A"
    n500_xirr = results["benchmarks"].get("nifty500_equal_weight_xirr")
    n500_str = f"{n500_xirr:.1%}" if n500_xirr is not None else "N/A"
    print(f"{'Nifty 50':<15} {nifty_str:>8}")
    print(f"{'Nifty 500 EW':<15} {n500_str:>8}")
    print("=" * 60)


if __name__ == "__main__":
    main()
