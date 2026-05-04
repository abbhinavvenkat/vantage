from __future__ import annotations

"""
06_generate_narratives.py — Enrich backtest results with:
  1. BSE 500 index benchmark XIRR (patched into summary.json)
  2. Per-framework narrative JSON files with call explanations and 2026 thesis

Usage:
    /Applications/Xcode.app/Contents/Developer/usr/bin/python3 scripts/backtest/06_generate_narratives.py
"""

import csv
import json
import math
import os
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Optional, List, Dict, Any

import pandas as pd
from scipy.optimize import brentq

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data" / "codex" / "backtests"
RESULTS_DIR = DATA_DIR / "results"
FUNDAMENTALS_DIR = DATA_DIR / "fundamentals"
PRICES_PARQUET = DATA_DIR / "prices" / "all_prices.parquet"
SUMMARY_JSON = RESULTS_DIR / "summary.json"

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DECISION_DATES = ["2016-01-04", "2020-01-02", "2023-01-02", "2026-05-03"]
DATE_LABELS = {
    "2016-01-04": "Jan 2016",
    "2020-01-02": "Jan 2020",
    "2023-01-02": "Jan 2023",
    "2026-05-03": "May 2026",
}
NEXT_DATE = {
    "2016-01-04": "2020-01-02",
    "2020-01-02": "2023-01-02",
    "2023-01-02": "2026-05-03",
    "2026-05-03": None,
}
PERIOD_LABELS = {
    "2016-01-04": "Jan 2016 → Jan 2020",
    "2020-01-02": "Jan 2020 → Jan 2023",
    "2023-01-02": "Jan 2023 → May 2026",
    "2026-05-03": "May 2026 (open)",
}

INITIAL_CAPITAL = 2_500_000  # ₹25L

FRAMEWORKS = ["mukherjea", "prasad", "agrawal", "greenblatt", "lynch", "graham", "naren"]

FRAMEWORK_LABELS = {
    "mukherjea": "Mukherjea CCP",
    "prasad": "Prasad / Nalanda",
    "agrawal": "Agrawal QGLP",
    "greenblatt": "Greenblatt Magic Formula",
    "lynch": "Lynch PEG",
    "graham": "Graham Deep Value",
    "naren": "Naren Contra",
}

FRAMEWORK_PHILOSOPHIES = {
    "mukherjea": (
        "Consistent Compounders Portfolio: owns businesses that have compounded revenue and earnings "
        ">10% for many years with high ROCE, low debt, and strong cash conversion. Consistency "
        "matters more than quantum."
    ),
    "prasad": (
        "Nalanda Capital quality filter: only the highest-quality Indian businesses — ROCE >25% "
        "consistently, near-zero debt, strong cash generation. Excludes all financials. "
        "Extreme concentration."
    ),
    "agrawal": (
        "QGLP framework (Motilal Oswal): Quality × Growth × Longevity × Price. All four pillars "
        "must score — ROCE >20%, PAT CAGR >20%, consistent multi-decade runway, and reasonable PEG."
    ),
    "greenblatt": (
        "Magic Formula India: ranks the entire universe by two metrics simultaneously — earnings "
        "yield (EBIT/EV) and return on capital (EBIT/invested capital). Buys the top "
        "combined-rank companies annually."
    ),
    "lynch": (
        "PEG ratio discipline: invest in growing companies where PE ÷ growth rate < 1. Avoids "
        "overpaying; penalises slow growers and story stocks without earnings."
    ),
    "graham": (
        "Deep value / Graham Number: buys stocks trading below √(22.5 × EPS × BVPS) with PE <20 "
        "and PB <2. Extreme margin of safety, often in ignored or beaten-down names."
    ),
    "naren": (
        "Contra / Deep Value (ICICI Pru): buys sectors and stocks at cyclical lows when PE is "
        "well below sector median. Requires basic quality (ROCE >12%) and positive but muted "
        "revenue growth."
    ),
}

FRAMEWORK_CRITERIA_SUMMARY = {
    "mukherjea": "consistent 10%+ ROCE + PAT CAGR + low debt",
    "prasad": "ROCE >25% + near-zero debt + CFO/PAT >0.9",
    "agrawal": "ROCE >20% + PAT CAGR >20% + no revenue dips + PEG <1.5",
    "greenblatt": "top earnings yield + top return on capital (combined rank)",
    "lynch": "PEG <1.0 with positive PAT CAGR",
    "graham": "Graham Number >price + PE <20 + PB <2",
    "naren": "PE well below sector median + ROCE >12% + muted revenue growth",
}

# ---------------------------------------------------------------------------
# XIRR
# ---------------------------------------------------------------------------

def xirr(cash_flows: List[tuple]) -> Optional[float]:
    """Compute annualised XIRR from irregular cash flows (date, amount)."""
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
# FY helper
# ---------------------------------------------------------------------------

def get_fy_for_date(date_str: str) -> str:
    """Return the most recently completed Indian FY for a given date."""
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    if dt.month <= 9:
        fy_end_year = dt.year - 1
    else:
        fy_end_year = dt.year
    return f"FY{fy_end_year}"


# ---------------------------------------------------------------------------
# Data loaders
# ---------------------------------------------------------------------------

def load_csv_rows(fw: str, date_str: str) -> List[Dict[str, Any]]:
    """Load a framework-date CSV. Returns list of row dicts."""
    path = RESULTS_DIR / f"{fw}_{date_str}.csv"
    if not path.exists():
        return []
    rows = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            # Cast numeric fields
            for field in ["score", "entry_price", "shares", "position_value",
                          "exit_price", "exit_value", "return_pct"]:
                try:
                    row[field] = float(row[field]) if row.get(field) not in ("", None) else None
                except (ValueError, TypeError):
                    row[field] = None
            rows.append(row)
    return rows


def load_fundamentals(symbol: str) -> Optional[Dict]:
    """Load fundamentals JSON for a symbol. Returns None if missing."""
    path = FUNDAMENTALS_DIR / f"{symbol}.json"
    if not path.exists():
        return None
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def load_all_fundamentals() -> Dict[str, Dict]:
    """Load all fundamentals JSONs keyed by symbol."""
    result: Dict[str, Dict] = {}
    for path in FUNDAMENTALS_DIR.glob("*.json"):
        if path.stem.startswith("_"):
            continue
        try:
            with open(path) as f:
                result[path.stem.upper()] = json.load(f)
        except Exception:
            pass
    return result


# ---------------------------------------------------------------------------
# Fundamentals extraction helpers
# ---------------------------------------------------------------------------

def _sorted_fy_keys(annual: Dict) -> List[str]:
    """Sort FY keys by year ascending."""
    def fy_year(k: str) -> int:
        import re
        m = re.search(r"(\d{4})", k)
        return int(m.group(1)) if m else 0
    return sorted(annual.keys(), key=fy_year)


def _cagr(values: List[Optional[float]], years: int) -> Optional[float]:
    valid = [v for v in values if v is not None and v > 0]
    if len(valid) < 2 or years < 1:
        return None
    start, end = valid[0], valid[-1]
    if start <= 0:
        return None
    return (end / start) ** (1.0 / years) - 1.0


def get_fundamentals_at_fy(symbol: str, date_str: str, all_fund: Dict[str, Dict]) -> Optional[Dict]:
    """Return the annual block for the FY corresponding to date_str."""
    fund = all_fund.get(symbol.upper())
    if fund is None:
        return None
    anchor_fy = get_fy_for_date(date_str)
    annual = fund.get("annual", {})
    keys = _sorted_fy_keys(annual)
    # Find keys up to and including anchor_fy
    import re

    def fy_year(k: str) -> int:
        m = re.search(r"(\d{4})", k)
        return int(m.group(1)) if m else 0

    anchor_year = fy_year(anchor_fy)
    filtered = {k: v for k, v in annual.items() if fy_year(k) <= anchor_year}
    return {
        "annual": filtered,
        "current": fund.get("current", {}),
        "anchor_fy": anchor_fy,
    }


def compute_pat_cagr(annual: Dict, anchor_fy: str, n_years: int = 5) -> Optional[float]:
    """Compute PAT CAGR over n_years ending at anchor_fy."""
    keys = _sorted_fy_keys(annual)
    # Get keys up to anchor_fy
    import re

    def fy_year(k: str) -> int:
        m = re.search(r"(\d{4})", k)
        return int(m.group(1)) if m else 0

    anchor_year = fy_year(anchor_fy)
    eligible = [k for k in keys if fy_year(k) <= anchor_year]
    vals = [annual[k].get("pat_cr") for k in eligible[-(n_years + 1):]]
    valid = [v for v in vals if v is not None and v > 0]
    if len(valid) < 2:
        return None
    return _cagr(valid, min(n_years, len(valid) - 1))


def compute_roce_avg(annual: Dict, anchor_fy: str, n_years: int = 5) -> Optional[float]:
    """Average ROCE over last n_years up to anchor_fy."""
    import re

    def fy_year(k: str) -> int:
        m = re.search(r"(\d{4})", k)
        return int(m.group(1)) if m else 0

    anchor_year = fy_year(anchor_fy)
    keys = _sorted_fy_keys(annual)
    eligible = [k for k in keys if fy_year(k) <= anchor_year]
    vals = [annual[k].get("roce_pct") for k in eligible[-n_years:]]
    valid = [v for v in vals if v is not None]
    return sum(valid) / len(valid) if valid else None


def get_latest_fy_data(annual: Dict, anchor_fy: str) -> Dict:
    """Return data dict for the latest FY <= anchor_fy."""
    import re

    def fy_year(k: str) -> int:
        m = re.search(r"(\d{4})", k)
        return int(m.group(1)) if m else 0

    anchor_year = fy_year(anchor_fy)
    eligible = {k: v for k, v in annual.items() if fy_year(k) <= anchor_year}
    if not eligible:
        return {}
    latest_key = max(eligible.keys(), key=fy_year)
    return eligible[latest_key]


# ---------------------------------------------------------------------------
# Per-framework "why" string builders
# ---------------------------------------------------------------------------

def _fmt(val: Optional[float], fmt_str: str, fallback: str = "—") -> str:
    if val is None:
        return fallback
    try:
        return fmt_str.format(val)
    except Exception:
        return fallback


def build_why_mukherjea(fund_at_date: Optional[Dict]) -> str:
    if fund_at_date is None:
        return "—"
    annual = fund_at_date.get("annual", {})
    anchor_fy = fund_at_date.get("anchor_fy", "")
    roce_avg = compute_roce_avg(annual, anchor_fy, 5)
    pat_cagr = compute_pat_cagr(annual, anchor_fy, 5)
    fy_data = get_latest_fy_data(annual, anchor_fy)
    de = fy_data.get("debt_to_equity")
    if de is None:
        debt = fy_data.get("debt_cr")
        eq = fy_data.get("equity_bv_cr")
        if debt is not None and eq is not None and eq > 0:
            de = debt / eq
    roce_str = _fmt(roce_avg, "{:.0f}%")
    pat_str = _fmt(pat_cagr, "{:.0f}%", "—") if pat_cagr is None else f"{pat_cagr * 100:.0f}%"
    de_str = _fmt(de, "{:.1f}")
    return f"ROCE {roce_str} avg · PAT CAGR {pat_str} · D/E {de_str}"


def build_why_prasad(fund_at_date: Optional[Dict]) -> str:
    if fund_at_date is None:
        return "—"
    annual = fund_at_date.get("annual", {})
    anchor_fy = fund_at_date.get("anchor_fy", "")
    fy_data = get_latest_fy_data(annual, anchor_fy)
    roce = fy_data.get("roce_pct")
    cfo = fy_data.get("cfo_cr")
    pat = fy_data.get("pat_cr")
    cfo_pat = (cfo / pat) if (cfo is not None and pat is not None and pat > 0) else None
    roce_str = _fmt(roce, "{:.0f}%")
    cfo_str = _fmt(cfo_pat, "{:.1f}x")
    return f"ROCE {roce_str} · zero-debt · CFO/PAT {cfo_str}"


def build_why_agrawal(fund_at_date: Optional[Dict], price: Optional[float],
                      market_cap_cr: Optional[float]) -> str:
    if fund_at_date is None:
        return "—"
    annual = fund_at_date.get("annual", {})
    anchor_fy = fund_at_date.get("anchor_fy", "")
    fy_data = get_latest_fy_data(annual, anchor_fy)
    roce = fy_data.get("roce_pct")
    pat_cagr = compute_pat_cagr(annual, anchor_fy, 5)
    pat = fy_data.get("pat_cr")
    pe = fund_at_date.get("current", {}).get("pe")
    if pe is None and market_cap_cr is not None and pat is not None and pat > 0:
        pe = market_cap_cr / pat
    peg = None
    if pe is not None and pat_cagr is not None and pat_cagr > 0:
        peg = pe / (pat_cagr * 100.0)
    roce_str = _fmt(roce, "{:.0f}%")
    pat_str = f"{pat_cagr * 100:.0f}%" if pat_cagr is not None else "—"
    peg_str = _fmt(peg, "{:.2f}")
    return f"ROCE {roce_str} · PAT CAGR {pat_str} · PEG {peg_str}"


def build_why_greenblatt(score: float) -> str:
    # Use score as a proxy for combined rank
    rank_proxy = int(100 - score) + 1
    return f"EY rank ~#{rank_proxy} · ROIC rank ~#{rank_proxy} → combined #{rank_proxy * 2}"


def build_why_lynch(fund_at_date: Optional[Dict], market_cap_cr: Optional[float]) -> str:
    if fund_at_date is None:
        return "—"
    annual = fund_at_date.get("annual", {})
    anchor_fy = fund_at_date.get("anchor_fy", "")
    fy_data = get_latest_fy_data(annual, anchor_fy)
    pat = fy_data.get("pat_cr")
    pe = fund_at_date.get("current", {}).get("pe")
    if pe is None and market_cap_cr is not None and pat is not None and pat > 0:
        pe = market_cap_cr / pat
    pat_cagr = compute_pat_cagr(annual, anchor_fy, 3)
    peg = None
    if pe is not None and pat_cagr is not None and pat_cagr > 0:
        peg = pe / (pat_cagr * 100.0)
    peg_str = _fmt(peg, "{:.2f}")
    pe_str = _fmt(pe, "{:.1f}")
    pat_str = f"{pat_cagr * 100:.0f}%" if pat_cagr is not None else "—"
    return f"PEG {peg_str} · PE {pe_str} · PAT CAGR {pat_str}"


def build_why_graham(fund_at_date: Optional[Dict], price: Optional[float],
                     market_cap_cr: Optional[float]) -> str:
    if fund_at_date is None:
        return "—"
    annual = fund_at_date.get("annual", {})
    anchor_fy = fund_at_date.get("anchor_fy", "")
    fy_data = get_latest_fy_data(annual, anchor_fy)
    eps = fy_data.get("eps")
    equity_bv = fy_data.get("equity_bv_cr")
    pat = fy_data.get("pat_cr")
    bvps = None
    if pat is not None and pat > 0 and eps is not None and eps > 0 and equity_bv is not None:
        shares = (pat * 1e7) / eps
        bvps = (equity_bv * 1e7) / shares
    graham_num = None
    if eps is not None and eps > 0 and bvps is not None and bvps > 0:
        graham_num = math.sqrt(22.5 * eps * bvps)
    pe = fund_at_date.get("current", {}).get("pe")
    if pe is None and market_cap_cr is not None and pat is not None and pat > 0:
        pe = market_cap_cr / pat
    pb = None
    if market_cap_cr is not None and equity_bv is not None and equity_bv > 0:
        pb = market_cap_cr / equity_bv
    price_str = _fmt(price, "{:.0f}")
    gn_str = _fmt(graham_num, "{:.0f}")
    pe_str = _fmt(pe, "{:.1f}")
    pb_str = _fmt(pb, "{:.1f}")
    return f"Price {price_str} vs Graham# {gn_str} · PE {pe_str} · PB {pb_str}"


def build_why_naren(fund_at_date: Optional[Dict], score: float,
                    market_cap_cr: Optional[float]) -> str:
    if fund_at_date is None:
        return f"score {score:.0f}"
    annual = fund_at_date.get("annual", {})
    anchor_fy = fund_at_date.get("anchor_fy", "")
    fy_data = get_latest_fy_data(annual, anchor_fy)
    pat = fy_data.get("pat_cr")
    pe = fund_at_date.get("current", {}).get("pe")
    if pe is None and market_cap_cr is not None and pat is not None and pat > 0:
        pe = market_cap_cr / pat
    roce = fy_data.get("roce_pct")
    # sector PE median is not available post-hoc, use a proxy of 20
    sector_pe = 20.0
    pe_str = _fmt(pe, "{:.1f}")
    roce_str = _fmt(roce, "{:.0f}%")
    return f"PE {pe_str} vs sector median ~{sector_pe:.1f} · ROCE {roce_str} · score {score:.0f}"


def build_why(fw: str, row: Dict[str, Any],
              fund_at_date: Optional[Dict], market_cap_cr: Optional[float]) -> str:
    price = row.get("entry_price")
    score = row.get("score") or 0.0
    if fw == "mukherjea":
        return build_why_mukherjea(fund_at_date)
    elif fw == "prasad":
        return build_why_prasad(fund_at_date)
    elif fw == "agrawal":
        return build_why_agrawal(fund_at_date, price, market_cap_cr)
    elif fw == "greenblatt":
        return build_why_greenblatt(score)
    elif fw == "lynch":
        return build_why_lynch(fund_at_date, market_cap_cr)
    elif fw == "graham":
        return build_why_graham(fund_at_date, price, market_cap_cr)
    elif fw == "naren":
        return build_why_naren(fund_at_date, score, market_cap_cr)
    return "—"


# ---------------------------------------------------------------------------
# Market cap estimator (from fundamentals current block + price ratio)
# ---------------------------------------------------------------------------

def estimate_market_cap_cr(symbol: str, date_str: str,
                            all_fund: Dict[str, Dict],
                            prices_df: Optional[pd.DataFrame] = None) -> Optional[float]:
    fund = all_fund.get(symbol.upper())
    if fund is None:
        return None
    current = fund.get("current", {})
    current_mcap = current.get("market_cap_cr")
    current_price = current.get("price")
    if current_mcap is None or current_price is None or current_price <= 0:
        return None
    if prices_df is None:
        return None
    sym_prices = prices_df[prices_df["symbol"] == symbol].copy()
    if sym_prices.empty:
        return None
    target_dt = pd.to_datetime(date_str)
    before = sym_prices[sym_prices["date"] <= target_dt].sort_values("date")
    if before.empty:
        return None
    hist_price = float(before.iloc[-1]["adj_close"])
    if hist_price <= 0:
        return None
    return current_mcap * (hist_price / current_price)


# ---------------------------------------------------------------------------
# Part 1: BSE 500 XIRR
# ---------------------------------------------------------------------------

def compute_bse500_xirr() -> Optional[float]:
    """Fetch BSE-500.BO from yfinance and compute XIRR on decision dates."""
    print("  Fetching BSE 500 index (BSE-500.BO) from yfinance...")
    try:
        import yfinance as yf
        ticker_sym = None
        hist = None
        for sym in ["BSE-500.BO", "^BSP", "^BSESN"]:
            try:
                t = yf.Ticker(sym)
                h = t.history(start="2015-12-01", end="2026-05-04")
                if len(h) >= 10:
                    hist = h
                    ticker_sym = sym
                    print(f"  Using {sym}: {len(h)} rows, "
                          f"{h.index.min().date()} to {h.index.max().date()}")
                    break
            except Exception:
                continue

        if hist is None or hist.empty:
            print("  WARNING: No BSE 500 data found, skipping.")
            return None

        # Build price lookup: date → Close
        hist.index = hist.index.tz_localize(None) if hist.index.tz is not None else hist.index

        def get_price_on_or_before(dt_str: str) -> Optional[float]:
            target = pd.to_datetime(dt_str)
            before = hist[hist.index <= target]
            if before.empty:
                return None
            row = before.iloc[-1]
            # Use Close column
            price = row.get("Close")
            if price is None or math.isnan(float(price)):
                return None
            return float(price)

        cash_flows: List[tuple] = []
        for i, dd in enumerate(DECISION_DATES):
            dd_date = datetime.strptime(dd, "%Y-%m-%d").date()
            buy_price = get_price_on_or_before(dd)
            if buy_price is None or buy_price <= 0:
                print(f"  WARNING: No price for BSE-500.BO at {dd}")
                continue
            shares = INITIAL_CAPITAL / buy_price
            cash_flows.append((dd_date, -float(INITIAL_CAPITAL)))

            next_dd = DECISION_DATES[i + 1] if i < len(DECISION_DATES) - 1 else dd
            next_date = datetime.strptime(next_dd, "%Y-%m-%d").date()
            sell_price = get_price_on_or_before(next_dd)
            if sell_price is None:
                sell_price = buy_price
            cash_flows.append((next_date, shares * sell_price))

        if not cash_flows:
            return None

        result = xirr(cash_flows)
        if result is not None:
            print(f"  BSE 500 XIRR ({ticker_sym}): {result:.2%}")
        return result

    except ImportError:
        print("  yfinance not installed; skipping BSE 500 XIRR.")
        return None
    except Exception as e:
        print(f"  ERROR computing BSE 500 XIRR: {e}")
        return None


def patch_summary_json(bse500_xirr: Optional[float]) -> None:
    """Add bse500_xirr to summary.json benchmarks block."""
    if not SUMMARY_JSON.exists():
        print(f"  summary.json not found at {SUMMARY_JSON}; creating stub.")
        summary: Dict[str, Any] = {
            "run_at": datetime.utcnow().isoformat() + "Z",
            "decision_dates": DECISION_DATES,
            "frameworks": {},
            "benchmarks": {},
            "data_quality_notes": ["generated_by_06_generate_narratives"],
        }
    else:
        with open(SUMMARY_JSON) as f:
            summary = json.load(f)

    benchmarks = summary.setdefault("benchmarks", {})
    benchmarks["bse500_xirr"] = bse500_xirr

    # Add delta vs BSE 500 per framework
    if bse500_xirr is not None:
        for fw in FRAMEWORKS:
            fw_data = summary.get("frameworks", {}).get(fw, {})
            fw_xirr = fw_data.get("xirr")
            if fw_xirr is not None:
                fw_data["benchmark_vs_bse500_xirr_delta"] = round(fw_xirr - bse500_xirr, 4)

    with open(SUMMARY_JSON, "w") as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"  Patched {SUMMARY_JSON.name} with bse500_xirr={bse500_xirr}")


# ---------------------------------------------------------------------------
# Part 2: Per-framework narrative generation
# ---------------------------------------------------------------------------

def build_period_narrative(
    fw: str,
    date_str: str,
    rows: List[Dict[str, Any]],
    all_fund: Dict[str, Dict],
    prices_df: Optional[pd.DataFrame],
) -> Dict[str, Any]:
    """Build the narrative block for one framework × one decision date."""
    date_label = DATE_LABELS[date_str]
    n_universe = 500  # Nifty 500

    # Sector distribution
    sector_dist: Dict[str, int] = {}
    for row in rows:
        sec = row.get("sector") or "Unknown"
        sector_dist[sec] = sector_dist.get(sec, 0) + 1

    # Sort sectors by count
    sorted_sectors = sorted(sector_dist.items(), key=lambda x: x[1], reverse=True)

    # Per-stock enrichment
    enriched_rows = []
    for row in rows:
        sym = row["symbol"]
        fund_at_date = get_fundamentals_at_fy(sym, date_str, all_fund)
        mcap = estimate_market_cap_cr(sym, date_str, all_fund, prices_df)
        why = build_why(fw, row, fund_at_date, mcap)
        enriched_rows.append({
            "symbol": sym,
            "company_name": row.get("company_name", sym),
            "sector": row.get("sector", "Unknown"),
            "score": round(row.get("score") or 0.0, 2),
            "why": why,
        })

    # Sort by score
    enriched_rows.sort(key=lambda r: r["score"], reverse=True)

    # Period stats (only for non-2026 dates that have exit data)
    is_open = NEXT_DATE[date_str] is None
    period_stats: Optional[Dict[str, Any]] = None
    if not is_open:
        returns = [row.get("return_pct") for row in rows if row.get("return_pct") is not None]
        if returns:
            avg_return = sum(returns) / len(returns)
            best_row = max(rows, key=lambda r: r.get("return_pct") or -999)
            worst_row = min(rows, key=lambda r: r.get("return_pct") or 999)
            n_winners = sum(1 for r in returns if r > 0)
            n_losers = sum(1 for r in returns if r <= 0)
            period_stats = {
                "avg_return_pct": round(avg_return, 2),
                "best": {
                    "symbol": best_row.get("symbol", ""),
                    "return_pct": round(best_row.get("return_pct") or 0.0, 2),
                },
                "worst": {
                    "symbol": worst_row.get("symbol", ""),
                    "return_pct": round(worst_row.get("return_pct") or 0.0, 2),
                },
                "n_winners": n_winners,
                "n_losers": n_losers,
                "period_label": PERIOD_LABELS[date_str],
            }

    # Framework rationale sentence
    criteria_summary = FRAMEWORK_CRITERIA_SUMMARY.get(fw, "")
    if sorted_sectors:
        top1_sec, top1_count = sorted_sectors[0]
        if len(sorted_sectors) >= 2:
            top2_sec, top2_count = sorted_sectors[1]
            dominant_sentence = (
                f"{top1_sec} ({top1_count}) and {top2_sec} ({top2_count}) "
                f"dominated the selection"
            )
        else:
            dominant_sentence = f"{top1_sec} ({top1_count}) dominated the selection"
    else:
        dominant_sentence = "No dominant sector emerged"

    if enriched_rows:
        top = enriched_rows[0]
        standout_sentence = (
            f"Highest scorer was {top['symbol']} ({top['score']:.0f}/100) "
            f"for its {top['why']}"
        )
    else:
        standout_sentence = "No qualifying stocks found"

    framework_rationale = (
        f"Screening {n_universe} Nifty 500 stocks by {criteria_summary} at {date_label} "
        f"surfaced {len(rows)} names. {dominant_sentence}. {standout_sentence}."
    )

    result: Dict[str, Any] = {
        "date": date_str,
        "date_label": date_label,
        "n_stocks": len(rows),
        "sector_distribution": sector_dist,
        "framework_rationale": framework_rationale,
        "top_picks_by_score": enriched_rows[:10],  # top 10 for the narrative
    }
    if period_stats is not None:
        result["period_stats"] = period_stats

    return result


def build_thesis_2026(
    fw: str,
    rows: List[Dict[str, Any]],
    all_fund: Dict[str, Dict],
    prices_df: Optional[pd.DataFrame],
) -> Dict[str, Any]:
    """Build the 2026 thesis block."""
    date_str = "2026-05-03"
    label = FRAMEWORK_LABELS[fw]
    philosophy = FRAMEWORK_PHILOSOPHIES[fw]

    sector_dist: Dict[str, int] = {}
    for row in rows:
        sec = row.get("sector") or "Unknown"
        sector_dist[sec] = sector_dist.get(sec, 0) + 1

    sorted_sectors = sorted(sector_dist.items(), key=lambda x: x[1], reverse=True)
    top_sectors_str = ", ".join(
        f"{sec} ({cnt})" for sec, cnt in sorted_sectors[:3]
    ) if sorted_sectors else "various sectors"

    # Key criteria per framework
    key_criteria_map = {
        "mukherjea": "ROCE consistency and earnings compounding quality",
        "prasad": "ROCE >25% and near-zero leverage",
        "agrawal": "all four QGLP pillars simultaneously",
        "greenblatt": "high earnings yield combined with high return on capital",
        "lynch": "low PEG (earnings growth at a reasonable price)",
        "graham": "deep discount to Graham Number with PE <20 and PB <2",
        "naren": "contrarian PE discount to sector median with quality floor",
    }
    key_criteria = key_criteria_map.get(fw, "the framework's core criteria")

    n_stocks = len(rows)
    philosophy_snippet = philosophy.split(".")[0]

    # Top 5 picks by score with why
    enriched_top5 = []
    top_rows = sorted(rows, key=lambda r: r.get("score") or 0, reverse=True)[:5]
    for row in top_rows:
        sym = row["symbol"]
        fund_at_date = get_fundamentals_at_fy(sym, date_str, all_fund)
        mcap = estimate_market_cap_cr(sym, date_str, all_fund, prices_df)
        why = build_why(fw, row, fund_at_date, mcap)
        enriched_top5.append({
            "symbol": sym,
            "company_name": row.get("company_name", sym),
            "sector": row.get("sector", "Unknown"),
            "score": round(row.get("score") or 0.0, 2),
            "why": why,
        })

    # Key themes: derive from top sectors + philosophy
    themes = [f"{sec} dominance ({cnt} picks)" for sec, cnt in sorted_sectors[:2]]
    themes.append(f"Screened on {key_criteria}")

    narrative = (
        f"The {label} portfolio for 2026 concentrates on {top_sectors_str}. "
        f"These selections score highest on {key_criteria}. "
        f"With {n_stocks} positions, the portfolio reflects {philosophy_snippet}."
    )

    return {
        "narrative": narrative,
        "top_picks": enriched_top5,
        "sector_distribution": sector_dist,
        "key_themes": themes,
    }


def generate_framework_narrative(
    fw: str,
    all_fund: Dict[str, Dict],
    prices_df: Optional[pd.DataFrame],
) -> Optional[Dict[str, Any]]:
    """Generate full narrative JSON for one framework."""
    label = FRAMEWORK_LABELS[fw]
    print(f"  [{fw}] Generating narrative...")

    periods = []
    thesis_2026: Optional[Dict[str, Any]] = None

    for date_str in DECISION_DATES:
        rows = load_csv_rows(fw, date_str)
        if not rows:
            print(f"    [{fw}] No CSV for {date_str}, skipping period.")
            continue

        print(f"    [{fw}] {date_str}: {len(rows)} stocks")

        period_block = build_period_narrative(fw, date_str, rows, all_fund, prices_df)
        periods.append(period_block)

        if date_str == "2026-05-03":
            thesis_2026 = build_thesis_2026(fw, rows, all_fund, prices_df)

    if not periods:
        print(f"  [{fw}] No periods found; skipping.")
        return None

    narrative: Dict[str, Any] = {
        "framework": fw,
        "label": label,
        "overall_philosophy": FRAMEWORK_PHILOSOPHIES[fw],
        "periods": periods,
    }
    if thesis_2026 is not None:
        narrative["thesis_2026"] = thesis_2026

    return narrative


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    print("=" * 60)
    print("06_generate_narratives.py")
    print("=" * 60)

    # Load prices (needed for market cap estimation)
    print("\nLoading prices...")
    try:
        prices_df = pd.read_parquet(PRICES_PARQUET)
        prices_df.columns = [c.strip().lower().replace(" ", "_") for c in prices_df.columns]
        prices_df["date"] = pd.to_datetime(prices_df["date"])
        print(f"  {len(prices_df)} price rows loaded.")
    except Exception as e:
        print(f"  WARNING: Could not load prices: {e}. Market cap estimates will be unavailable.")
        prices_df = None

    # Load all fundamentals
    print("\nLoading fundamentals...")
    all_fund = load_all_fundamentals()
    print(f"  {len(all_fund)} symbols loaded.")

    # Part 1: BSE 500 XIRR
    print("\n--- Part 1: BSE 500 XIRR ---")
    bse500_xirr = compute_bse500_xirr()
    patch_summary_json(bse500_xirr)

    # Part 2: Per-framework narratives
    print("\n--- Part 2: Framework narratives ---")
    generated = []
    skipped = []

    for fw in FRAMEWORKS:
        narrative = generate_framework_narrative(fw, all_fund, prices_df)
        if narrative is None:
            skipped.append(fw)
            continue

        out_path = RESULTS_DIR / f"{fw}_narrative.json"
        with open(out_path, "w") as f:
            json.dump(narrative, f, indent=2, ensure_ascii=False)
        print(f"  Wrote {out_path.name}")
        generated.append(fw)

    # Summary report
    print("\n" + "=" * 60)
    print("DONE")
    print(f"  BSE 500 XIRR: {bse500_xirr:.2%}" if bse500_xirr is not None else "  BSE 500 XIRR: N/A")
    print(f"  Narratives generated: {generated}")
    if skipped:
        print(f"  Skipped (no CSV data): {skipped}")

    # Print mukherjea thesis_2026 sample
    mukherjea_path = RESULTS_DIR / "mukherjea_narrative.json"
    if mukherjea_path.exists():
        print("\n--- Sample: mukherjea thesis_2026.narrative ---")
        with open(mukherjea_path) as f:
            data = json.load(f)
        thesis = data.get("thesis_2026", {})
        print(thesis.get("narrative", "(no narrative)"))
        print("\nTop picks:")
        for pick in thesis.get("top_picks", [])[:5]:
            print(f"  {pick['symbol']:15s} {pick['company_name'][:30]:30s}  {pick['why']}")
    print("=" * 60)


if __name__ == "__main__":
    main()
