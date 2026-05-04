from __future__ import annotations

"""
03_frameworks.py — Investor framework scoring functions for the multi-framework backtest.

Each framework exposes a single `score_<name>(...)` function returning a float 0-100.
Higher score = stronger buy signal according to that framework's philosophy.

Utility functions at the top handle CAGR, consistency, FY resolution, and price/fundamentals
lookups so the framework functions stay declarative and readable.
"""

import json
import math
import os
from datetime import datetime, date
from pathlib import Path
from typing import Optional

import re
import pandas as pd


# ---------------------------------------------------------------------------
# Utility helpers
# ---------------------------------------------------------------------------

def _fy_year(fy_str: str) -> Optional[int]:
    """
    Extract a 4-digit year from FY key strings.
    Handles:
      'FY2025'     → 2025   (standard Indian FY)
      'FYDec 2011' → 2011   (calendar-year companies e.g. ABB, Siemens)
      'FY202315m'  → 2023   (Screener 15-month period artefact)
    Returns None if no 4-digit year can be found (key should be skipped).
    """
    clean = fy_str.replace("FY", "").strip()
    try:
        return int(clean)
    except ValueError:
        m = re.search(r'(\d{4})', clean)
        return int(m.group(1)) if m else None

def cagr(values_oldest_to_newest: list[float], years: int) -> Optional[float]:
    """
    Compute CAGR from a list of annual values (oldest first).

    Returns None if:
    - fewer than 2 values
    - start value is zero or negative
    - years < 1
    """
    if not values_oldest_to_newest or len(values_oldest_to_newest) < 2:
        return None
    if years < 1:
        return None
    start = values_oldest_to_newest[0]
    end = values_oldest_to_newest[-1]
    if start is None or end is None:
        return None
    if start <= 0:
        return None
    return (end / start) ** (1.0 / years) - 1.0


def consistency_score(values: list[Optional[float]], threshold: float) -> float:
    """
    What fraction of non-None values meet or exceed the threshold?
    Returns a float 0.0–1.0.
    """
    valid = [v for v in values if v is not None]
    if not valid:
        return 0.0
    met = sum(1 for v in valid if v >= threshold)
    return met / len(valid)


def get_fy_for_date(date_str: str) -> str:
    """
    Given a date string (YYYY-MM-DD), return the most recently completed Indian FY
    whose full-year annual results would be available.

    Indian FY: Apr 1 – Mar 31.
    FY2019 = Apr 1 2018 – Mar 31 2019.

    Convention used here:
    - Jan 2016  → FY2015 (Apr14–Mar15 fully reported; Apr15–Mar16 not done)
    - Jan 2020  → FY2019
    - Jan 2023  → FY2022
    - May 2026  → FY2025

    Rule: For months Jan–Sep (month ≤ 9), use FY ending March of (year - 1).
          For months Oct–Dec (month ≥ 10), use FY ending March of (year).
    """
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    if dt.month <= 9:
        fy_end_year = dt.year - 1
    else:
        fy_end_year = dt.year
    return f"FY{fy_end_year}"


def get_fundamentals_at_date(
    symbol: str,
    date_str: str,
    all_fundamentals: dict[str, dict],
) -> Optional[dict]:
    """
    Return the annual fundamentals dict available as of date_str for the given symbol.
    Uses get_fy_for_date() to determine which FY to anchor on, then also gathers the
    preceding years so frameworks can compute multi-year CAGRs.

    Returns the full `annual` sub-dict (keyed by FY strings) filtered to years ≤
    the anchor FY, plus the `current` block.  Returns None if symbol not found.
    """
    if symbol not in all_fundamentals:
        return None

    data = all_fundamentals[symbol]
    anchor_fy = get_fy_for_date(date_str)

    annual = data.get("annual", {})
    # Keep only FY years that are ≤ anchor_fy; skip malformed keys
    anchor_year = _fy_year(anchor_fy) or 9999
    filtered_annual = {
        fy: v for fy, v in annual.items()
        if (_fy_year(fy) or 0) <= anchor_year
    }

    return {
        "symbol": symbol,
        "annual": filtered_annual,
        "current": data.get("current", {}),
        "anchor_fy": anchor_fy,
    }


def get_price_at_date(
    symbol: str,
    date_str: str,
    prices_df: pd.DataFrame,
) -> Optional[float]:
    """
    Return the adj_close price on or nearest before the given date.
    prices_df must have columns: date (str or date), symbol, adj_close.
    """
    sym_prices = prices_df[prices_df["symbol"] == symbol].copy()
    if sym_prices.empty:
        return None

    sym_prices["date"] = pd.to_datetime(sym_prices["date"])
    target_dt = pd.to_datetime(date_str)

    # Rows on or before target date, take the most recent
    before = sym_prices[sym_prices["date"] <= target_dt].sort_values("date")
    if before.empty:
        # Fall back to first available price after date
        after = sym_prices[sym_prices["date"] > target_dt].sort_values("date")
        if after.empty:
            return None
        return float(after.iloc[0]["adj_close"])
    return float(before.iloc[-1]["adj_close"])


def get_market_cap_at_date(
    symbol: str,
    date_str: str,
    prices_df: pd.DataFrame,
    current_market_cap_cr: Optional[float],
    current_price: Optional[float],
) -> Optional[float]:
    """
    Estimate market cap at date_str by scaling the known current_market_cap_cr
    by the ratio of historical price to current price.

    Returns market cap in crores (₹Cr).
    """
    if current_market_cap_cr is None or current_price is None or current_price <= 0:
        return None
    hist_price = get_price_at_date(symbol, date_str, prices_df)
    if hist_price is None or hist_price <= 0:
        return None
    return current_market_cap_cr * (hist_price / current_price)


def _sorted_annual_values(
    annual: dict[str, dict],
    field: str,
) -> list[Optional[float]]:
    """
    Extract field values from annual dict, sorted oldest-to-newest FY.
    Returns a list with None for missing entries.
    """
    sorted_keys = sorted(annual.keys(), key=lambda k: (_fy_year(k) or 0))
    return [annual[k].get(field) for k in sorted_keys]


def _last_n_annual_values(
    annual: dict[str, dict],
    field: str,
    n: int,
) -> list[Optional[float]]:
    """Return the most recent n values for field, oldest-to-newest."""
    all_vals = _sorted_annual_values(annual, field)
    return all_vals[-n:]


# ---------------------------------------------------------------------------
# Framework 1: Saurabh Mukherjea — Consistent Compounders Portfolio (CCP)
# ---------------------------------------------------------------------------
# Philosophy: invest only in businesses that have compounded earnings at
# >10% for many years AND demonstrate high-quality cash generation with
# near-zero debt. Consistency over quantum.
# ---------------------------------------------------------------------------

def score_mukherjea(
    symbol: str,
    fundamentals: dict,
    price: Optional[float],
    market_cap_cr: Optional[float],
    sector: str,
) -> float:
    """
    Mukherjea CCP scoring (0-100).

    Criteria:
    - Revenue CAGR 5yr ≥ 10%      → 20 pts
    - PAT CAGR 5yr ≥ 10%          → 20 pts
    - ROCE ≥ 15% every year        → 30 pts (−5 per year below)
    - CFO/PAT ≥ 0.8 consistently   → 15 pts
    - D/E ≤ 0.5                    → 15 pts (pro-rata down to 0 at D/E > 2)
    """
    annual = fundamentals.get("annual", {})
    if not annual:
        return 0.0

    score = 0.0

    # --- Revenue CAGR 5yr (20 pts) ---
    rev_vals = _last_n_annual_values(annual, "sales_cr", 6)  # 6 gives 5 gaps
    valid_rev = [v for v in rev_vals if v is not None and v > 0]
    if len(valid_rev) >= 2:
        rev_cagr = cagr(valid_rev, min(5, len(valid_rev) - 1))
        if rev_cagr is not None:
            if rev_cagr >= 0.10:
                score += 20.0
            elif rev_cagr >= 0.05:
                score += 10.0

    # --- PAT CAGR 5yr (20 pts) ---
    pat_vals = _last_n_annual_values(annual, "pat_cr", 6)
    valid_pat = [v for v in pat_vals if v is not None and v > 0]
    if len(valid_pat) >= 2:
        pat_cagr = cagr(valid_pat, min(5, len(valid_pat) - 1))
        if pat_cagr is not None:
            if pat_cagr >= 0.10:
                score += 20.0
            elif pat_cagr >= 0.05:
                score += 10.0

    # --- ROCE consistency ≥ 15% (30 pts) ---
    roce_vals = _sorted_annual_values(annual, "roce_pct")
    valid_roce = [v for v in roce_vals if v is not None]
    if valid_roce:
        below_15 = sum(1 for v in valid_roce if v < 15.0)
        roce_score = max(0.0, 30.0 - below_15 * 5.0)
        score += roce_score

    # --- CFO/PAT ≥ 0.8 (15 pts) ---
    all_fys = sorted(annual.keys(), key=lambda k: (_fy_year(k) or 0))
    cfo_pat_ratios: list[Optional[float]] = []
    for fy in all_fys:
        cfo = annual[fy].get("cfo_cr")
        pat = annual[fy].get("pat_cr")
        if cfo is not None and pat is not None and pat > 0:
            cfo_pat_ratios.append(cfo / pat)
        else:
            cfo_pat_ratios.append(None)
    cs = consistency_score(cfo_pat_ratios, 0.8)
    score += cs * 15.0

    # --- D/E ≤ 0.5 (15 pts) ---
    # Use most recent year
    latest_fy = all_fys[-1] if all_fys else None
    de = annual.get(latest_fy, {}).get("debt_to_equity") if latest_fy else None
    if de is None:
        # Fallback: compute from debt_cr / equity_bv_cr
        debt = annual.get(latest_fy, {}).get("debt_cr") if latest_fy else None
        equity = annual.get(latest_fy, {}).get("equity_bv_cr") if latest_fy else None
        if debt is not None and equity is not None and equity > 0:
            de = debt / equity
    if de is not None:
        if de <= 0.5:
            score += 15.0
        elif de <= 1.0:
            score += 10.0
        elif de <= 2.0:
            # Linear interpolation: 10 at 1.0 → 0 at 2.0
            score += max(0.0, 10.0 * (2.0 - de))

    return min(100.0, score)


# ---------------------------------------------------------------------------
# Framework 2: Pulak Prasad / Nalanda Capital — Quality Absolute
# ---------------------------------------------------------------------------
# Philosophy: only businesses with extreme capital efficiency (ROCE > 25%),
# virtually no debt, and consistent cash generation. No financial companies.
# Extremely concentrated, very long hold periods.
# ---------------------------------------------------------------------------

FINANCIAL_SECTORS = {
    "bank", "banking", "finance", "financial services", "insurance",
    "nbfc", "housing finance", "microfinance", "asset management",
}


def score_prasad(
    symbol: str,
    fundamentals: dict,
    price: Optional[float],
    market_cap_cr: Optional[float],
    sector: str,
) -> float:
    """
    Nalanda/Prasad quality scoring (0-100).

    Excludes financial companies entirely.

    Criteria:
    - ROCE ≥ 25% consistently      → 35 pts
    - Revenue CAGR 5yr ≥ 15%       → 25 pts
    - D/E ≈ 0 (near debt-free)     → 20 pts
    - CFO/PAT ≥ 0.9 consistently   → 20 pts
    """
    # Exclude financial companies — ROCE not meaningful for banks/NBFCs
    if any(fs in sector.lower() for fs in FINANCIAL_SECTORS):
        return 0.0

    annual = fundamentals.get("annual", {})
    if not annual:
        return 0.0

    score = 0.0

    # --- ROCE ≥ 25% consistently (35 pts) ---
    roce_vals = _sorted_annual_values(annual, "roce_pct")
    valid_roce = [v for v in roce_vals if v is not None]
    if valid_roce:
        cs = consistency_score(valid_roce, 25.0)
        score += cs * 35.0

    # --- Revenue CAGR 5yr ≥ 15% (25 pts) ---
    rev_vals = _last_n_annual_values(annual, "sales_cr", 6)
    valid_rev = [v for v in rev_vals if v is not None and v > 0]
    if len(valid_rev) >= 2:
        rev_cagr = cagr(valid_rev, min(5, len(valid_rev) - 1))
        if rev_cagr is not None:
            if rev_cagr >= 0.15:
                score += 25.0
            elif rev_cagr >= 0.10:
                score += 12.5

    # --- D/E ≈ 0 (debt-free premium, 20 pts) ---
    all_fys = sorted(annual.keys(), key=lambda k: (_fy_year(k) or 0))
    latest_fy = all_fys[-1] if all_fys else None
    de = annual.get(latest_fy, {}).get("debt_to_equity") if latest_fy else None
    if de is None:
        debt = annual.get(latest_fy, {}).get("debt_cr") if latest_fy else None
        equity = annual.get(latest_fy, {}).get("equity_bv_cr") if latest_fy else None
        if debt is not None and equity is not None and equity > 0:
            de = debt / equity
    if de is not None:
        if de <= 0.1:
            score += 20.0
        elif de <= 0.3:
            score += 14.0
        elif de <= 0.5:
            score += 8.0
        # Above 0.5 D/E: Nalanda would not invest

    # --- CFO/PAT ≥ 0.9 (20 pts) ---
    cfo_pat_ratios: list[Optional[float]] = []
    for fy in all_fys:
        cfo = annual[fy].get("cfo_cr")
        pat = annual[fy].get("pat_cr")
        if cfo is not None and pat is not None and pat > 0:
            cfo_pat_ratios.append(cfo / pat)
        else:
            cfo_pat_ratios.append(None)
    cs = consistency_score(cfo_pat_ratios, 0.9)
    score += cs * 20.0

    return min(100.0, score)


# ---------------------------------------------------------------------------
# Framework 3: Raamdeo Agrawal / Motilal Oswal — QGLP
# ---------------------------------------------------------------------------
# Philosophy: Quality × Growth × Longevity × Price. All four dimensions must
# be present. A great business at too high a price still fails QGLP.
# ---------------------------------------------------------------------------

def score_agrawal(
    symbol: str,
    fundamentals: dict,
    price: Optional[float],
    market_cap_cr: Optional[float],
    sector: str,
) -> float:
    """
    QGLP scoring (0-100).

    Q (Quality): ROCE ≥ 20% + CFO/PAT ≥ 0.8      → 30 pts
    G (Growth):  PAT CAGR 5yr ≥ 20%               → 25 pts
    L (Longevity): no negative revenue growth year → 20 pts
    P (Price):   PEG ≤ 1.5 (PE / PAT CAGR%)       → 25 pts
    """
    annual = fundamentals.get("annual", {})
    if not annual:
        return 0.0

    score = 0.0
    all_fys = sorted(annual.keys(), key=lambda k: (_fy_year(k) or 0))
    latest_fy = all_fys[-1] if all_fys else None

    # --- Q: Quality (30 pts total) ---
    # ROCE ≥ 20% latest year (15 pts)
    roce_latest = annual.get(latest_fy, {}).get("roce_pct") if latest_fy else None
    if roce_latest is not None:
        if roce_latest >= 20.0:
            score += 15.0
        elif roce_latest >= 15.0:
            score += 8.0

    # CFO/PAT ≥ 0.8 latest year (15 pts)
    cfo = annual.get(latest_fy, {}).get("cfo_cr") if latest_fy else None
    pat_latest = annual.get(latest_fy, {}).get("pat_cr") if latest_fy else None
    if cfo is not None and pat_latest is not None and pat_latest > 0:
        ratio = cfo / pat_latest
        if ratio >= 0.8:
            score += 15.0
        elif ratio >= 0.6:
            score += 7.0

    # --- G: Growth (25 pts) ---
    pat_vals = _last_n_annual_values(annual, "pat_cr", 6)
    valid_pat = [v for v in pat_vals if v is not None and v > 0]
    pat_cagr_5y: Optional[float] = None
    if len(valid_pat) >= 2:
        pat_cagr_5y = cagr(valid_pat, min(5, len(valid_pat) - 1))
    if pat_cagr_5y is not None:
        if pat_cagr_5y >= 0.20:
            score += 25.0
        elif pat_cagr_5y >= 0.15:
            score += 18.0
        elif pat_cagr_5y >= 0.10:
            score += 10.0

    # --- L: Longevity / Consistency (20 pts) ---
    # No negative revenue growth year in last 5 years
    rev_vals = _last_n_annual_values(annual, "sales_cr", 6)
    valid_rev = [v for v in rev_vals if v is not None and v > 0]
    if len(valid_rev) >= 2:
        yoy_growths = [
            (valid_rev[i] - valid_rev[i - 1]) / valid_rev[i - 1]
            for i in range(1, len(valid_rev))
        ]
        negative_years = sum(1 for g in yoy_growths if g < 0)
        if negative_years == 0:
            score += 20.0
        elif negative_years == 1:
            score += 10.0
        # 2+ negative years = 0 pts for Longevity

    # --- P: Price / Valuation (25 pts) ---
    # Use PE from fundamentals.current or derive from market_cap and pat
    pe: Optional[float] = fundamentals.get("current", {}).get("pe")
    if pe is None and market_cap_cr is not None and pat_latest is not None and pat_latest > 0:
        pe = market_cap_cr / pat_latest

    if pe is not None and pe > 0 and pat_cagr_5y is not None and pat_cagr_5y > 0:
        # PEG = PE / (PAT CAGR as percentage)
        peg = pe / (pat_cagr_5y * 100.0)
        if peg <= 0.75:
            score += 25.0
        elif peg <= 1.0:
            score += 22.0
        elif peg <= 1.5:
            score += 15.0
        elif peg <= 2.0:
            score += 8.0
        # PEG > 2 = 0 pts for Price

    return min(100.0, score)


# ---------------------------------------------------------------------------
# Framework 4: Joel Greenblatt — Magic Formula (adapted for India)
# ---------------------------------------------------------------------------
# Philosophy: buy above-average businesses at below-average prices.
# Uses two factors ranked across the universe: Earnings Yield and ROIC.
# The combined rank determines the portfolio.
# ---------------------------------------------------------------------------

def compute_greenblatt_scores(
    candidates: list[dict],  # each: {symbol, fundamentals, price, market_cap_cr, sector}
) -> dict[str, float]:
    """
    Greenblatt requires ranking across the full universe.
    Call this once with all candidates to get per-symbol scores.

    Returns {symbol: score} mapping.
    """
    ey_map: dict[str, float] = {}  # Earnings Yield
    roc_map: dict[str, float] = {}  # Return on Capital

    for c in candidates:
        sym = c["symbol"]
        fund = c["fundamentals"]
        mcap = c["market_cap_cr"]

        annual = fund.get("annual", {})
        if not annual:
            continue

        all_fys = sorted(annual.keys(), key=lambda k: (_fy_year(k) or 0))
        latest_fy = all_fys[-1] if all_fys else None
        if not latest_fy:
            continue

        pat = annual[latest_fy].get("pat_cr")
        if pat is None or pat <= 0:
            continue

        # Estimate EBIT = PAT / 0.75 (assumes ~25% effective tax rate)
        ebit = pat / 0.75

        # Enterprise Value = Market Cap + Debt − Cash proxy
        # We don't have cash separately; approximate EV ≈ market_cap + net_debt
        # net_debt ≈ debt_cr − (0.1 × equity_bv_cr) as a rough cash proxy
        debt = annual[latest_fy].get("debt_cr", 0.0) or 0.0
        equity_bv = annual[latest_fy].get("equity_bv_cr")
        cash_proxy = (equity_bv * 0.1) if equity_bv is not None else 0.0
        if mcap is None or mcap <= 0:
            continue
        ev = mcap + debt - cash_proxy
        if ev <= 0:
            ev = mcap  # fallback

        ey = ebit / ev  # Earnings Yield

        # Return on Capital = EBIT / (Net Fixed Assets + Working Capital proxy)
        # We approximate NFA + WC via: equity_bv_cr + debt_cr - cash_proxy
        # This is a rough proxy for invested capital
        capital_employed = (equity_bv or 0.0) + debt - cash_proxy
        if capital_employed <= 0:
            roc = ey  # fallback when capital unknown
        else:
            roc = ebit / capital_employed

        ey_map[sym] = ey
        roc_map[sym] = roc

    if not ey_map:
        return {}

    # Rank both metrics (lower rank = better; invert to score)
    symbols = list(ey_map.keys())
    n = len(symbols)

    ey_sorted = sorted(symbols, key=lambda s: ey_map[s], reverse=True)
    roc_sorted = sorted(symbols, key=lambda s: roc_map.get(s, 0.0), reverse=True)

    ey_rank = {s: i for i, s in enumerate(ey_sorted)}
    roc_rank = {s: i for i, s in enumerate(roc_sorted)}

    combined_rank = {s: ey_rank[s] + roc_rank.get(s, n) for s in symbols}

    # Convert combined rank to 0-100 score (rank 0 = 100, rank 2n = 0)
    max_rank = 2 * (n - 1)
    scores: dict[str, float] = {}
    for s in symbols:
        if max_rank > 0:
            scores[s] = 100.0 * (1.0 - combined_rank[s] / max_rank)
        else:
            scores[s] = 100.0

    return scores


def score_greenblatt(
    symbol: str,
    fundamentals: dict,
    price: Optional[float],
    market_cap_cr: Optional[float],
    sector: str,
    precomputed_score: Optional[float] = None,
) -> float:
    """
    Greenblatt Magic Formula score (0-100).
    If precomputed_score is provided (from compute_greenblatt_scores), returns it directly.
    Otherwise returns 0 (cross-sectional ranking requires full universe pass first).
    """
    if precomputed_score is not None:
        return precomputed_score
    # Cannot score in isolation — must use compute_greenblatt_scores() across the universe
    return 0.0


# ---------------------------------------------------------------------------
# Framework 5: Peter Lynch — PEG Ratio
# ---------------------------------------------------------------------------
# Philosophy: the PEG ratio (PE / earnings growth rate) is the most reliable
# single-number indicator of value for growth companies. PEG < 1 is a buy.
# ---------------------------------------------------------------------------

def score_lynch(
    symbol: str,
    fundamentals: dict,
    price: Optional[float],
    market_cap_cr: Optional[float],
    sector: str,
) -> float:
    """
    Lynch PEG scoring (0-100).

    PEG = PE / (PAT CAGR 3yr × 100)
    score = max(0, 100 − PEG × 40)

    PEG 0.0 → 100  |  PEG 1.0 → 60  |  PEG 2.0 → 20  |  PEG 2.5+ → 0

    Only applies when PAT growth is positive and PE is positive.
    """
    annual = fundamentals.get("annual", {})
    if not annual:
        return 0.0

    all_fys = sorted(annual.keys(), key=lambda k: (_fy_year(k) or 0))
    latest_fy = all_fys[-1] if all_fys else None
    if not latest_fy:
        return 0.0

    pat_latest = annual[latest_fy].get("pat_cr")
    if pat_latest is None or pat_latest <= 0:
        return 0.0

    # PAT CAGR 3yr
    pat_vals = _last_n_annual_values(annual, "pat_cr", 4)  # 4 values = 3 gaps
    valid_pat = [v for v in pat_vals if v is not None and v > 0]
    if len(valid_pat) < 2:
        return 0.0

    pat_cagr_3y = cagr(valid_pat, min(3, len(valid_pat) - 1))
    if pat_cagr_3y is None or pat_cagr_3y <= 0:
        return 0.0  # Negative growth → Lynch would avoid

    # PE: prefer from current; estimate from market cap if unavailable
    pe: Optional[float] = fundamentals.get("current", {}).get("pe")
    if pe is None and market_cap_cr is not None and pat_latest > 0:
        pe = market_cap_cr / pat_latest

    if pe is None or pe <= 0:
        return 0.0

    # PEG = PE / (CAGR expressed as %)
    peg = pe / (pat_cagr_3y * 100.0)

    return max(0.0, min(100.0, 100.0 - peg * 40.0))


# ---------------------------------------------------------------------------
# Framework 6: Benjamin Graham — Deep Value / Graham Number
# ---------------------------------------------------------------------------
# Philosophy: buy at a significant margin of safety to intrinsic value.
# Graham Number = sqrt(22.5 × EPS × BVPS) is the upper bound for a fair price.
# Require PE < 20 AND PB < 2 for full scoring.
# ---------------------------------------------------------------------------

def score_graham(
    symbol: str,
    fundamentals: dict,
    price: Optional[float],
    market_cap_cr: Optional[float],
    sector: str,
) -> float:
    """
    Graham Number scoring (0-100).

    Graham Number = sqrt(22.5 × EPS × BVPS)
    score = scales from 0 (price at Graham Number) to 100 (price at 50% of Graham Number)

    Hard filters:
    - PE < 20 AND PB < 2 required for score > 20
    - Negative earnings → score 0
    """
    annual = fundamentals.get("annual", {})
    if not annual:
        return 0.0

    all_fys = sorted(annual.keys(), key=lambda k: (_fy_year(k) or 0))
    latest_fy = all_fys[-1] if all_fys else None
    if not latest_fy:
        return 0.0

    fy_data = annual[latest_fy]
    eps = fy_data.get("eps")
    equity_bv_cr = fy_data.get("equity_bv_cr")

    if eps is None or eps <= 0:
        return 0.0  # Negative earnings → Graham says avoid

    if price is None or price <= 0:
        return 0.0

    # Estimate shares outstanding to get BVPS
    # BVPS = equity_bv_cr * 1e7 / shares; shares = (pat_cr * 1e7) / eps
    pat = fy_data.get("pat_cr")
    bvps: Optional[float] = None
    if pat is not None and pat > 0 and eps > 0:
        # shares (actual units) = pat_cr * 10_000_000 / eps
        shares = (pat * 1e7) / eps
        bvps = (equity_bv_cr * 1e7) / shares if equity_bv_cr is not None else None

    if bvps is None or bvps <= 0:
        return 0.0

    graham_number = math.sqrt(22.5 * eps * bvps)

    # Margin of safety ratio: how far below Graham Number is the current price?
    mos_ratio = graham_number / price  # > 1 means undervalued

    # Base score from MOS: 1.0 → 0, 1.5 → 50, 2.0+ → 100
    if mos_ratio <= 1.0:
        base_score = 0.0
    elif mos_ratio >= 2.0:
        base_score = 100.0
    else:
        base_score = (mos_ratio - 1.0) * 100.0

    # PE filter
    pe: Optional[float] = fundamentals.get("current", {}).get("pe")
    if pe is None and market_cap_cr is not None and pat is not None and pat > 0:
        pe = market_cap_cr / pat

    # PB filter
    pb: Optional[float] = None
    if market_cap_cr is not None and equity_bv_cr is not None and equity_bv_cr > 0:
        pb = market_cap_cr / equity_bv_cr

    # Apply hard filters: PE ≥ 20 or PB ≥ 2 → cap score at 20
    pe_ok = pe is not None and pe < 20.0
    pb_ok = pb is not None and pb < 2.0

    if not (pe_ok and pb_ok):
        base_score = min(base_score, 20.0)

    return min(100.0, base_score)


# ---------------------------------------------------------------------------
# Framework 7: S. Naren / ICICI Prudential — Deep Value / Contra
# ---------------------------------------------------------------------------
# Philosophy: buy hated, cheap, cyclical sectors when everyone has given up.
# Contrarian conviction: mean-reversion in earnings and valuations.
# ---------------------------------------------------------------------------

CYCLICAL_SECTORS = {
    "metals", "steel", "mining", "oil & gas", "power", "utilities",
    "chemicals", "fertilizers", "cement", "real estate", "construction",
    "auto", "auto ancillaries", "textiles", "shipping", "pharma",
    "capital goods", "engineering",
}

VALUE_SECTORS = {
    "psu", "public sector", "defense", "telecom", "media",
}


def score_naren(
    symbol: str,
    fundamentals: dict,
    price: Optional[float],
    market_cap_cr: Optional[float],
    sector: str,
    sector_pe_median: Optional[float] = None,
    price_52w_high: Optional[float] = None,
) -> float:
    """
    Naren Contra / Deep Value scoring (0-100).

    Criteria:
    - PE below sector median                           → 20-40 pts
    - ROCE ≥ 12%                                       → 15 pts
    - Stock down > 20% from 52-week high               → 10 pts
    - Cyclical / value sector                          → up to 15 pts
    - Positive but muted revenue growth (0-15%)        → 20 pts
    """
    annual = fundamentals.get("annual", {})
    if not annual:
        return 0.0

    score = 0.0
    all_fys = sorted(annual.keys(), key=lambda k: (_fy_year(k) or 0))
    latest_fy = all_fys[-1] if all_fys else None

    # --- PE vs sector median (20-40 pts) ---
    pat_latest = annual.get(latest_fy, {}).get("pat_cr") if latest_fy else None
    pe: Optional[float] = fundamentals.get("current", {}).get("pe")
    if pe is None and market_cap_cr is not None and pat_latest is not None and pat_latest > 0:
        pe = market_cap_cr / pat_latest

    if pe is not None and pe > 0 and sector_pe_median is not None and sector_pe_median > 0:
        if pe < sector_pe_median * 0.7:
            score += 40.0  # Deeply cheap vs sector
        elif pe < sector_pe_median:
            score += 20.0  # Cheap vs sector
    elif pe is not None and 0 < pe < 12:
        # Absolute cheap even without sector comparison
        score += 20.0

    # --- ROCE ≥ 12% (15 pts) ---
    # Naren wants quality at distressed prices, not permanently broken businesses
    roce_latest = annual.get(latest_fy, {}).get("roce_pct") if latest_fy else None
    if roce_latest is not None and roce_latest >= 12.0:
        score += 15.0
    elif roce_latest is not None and roce_latest >= 8.0:
        score += 7.0

    # --- Price down > 20% from 52-week high (10 pts) ---
    if price is not None and price_52w_high is not None and price_52w_high > 0:
        drawdown = (price - price_52w_high) / price_52w_high
        if drawdown <= -0.20:
            score += 10.0
        elif drawdown <= -0.10:
            score += 5.0

    # --- Sector in cyclical/value territory (15 pts) ---
    sec_lower = sector.lower()
    if any(s in sec_lower for s in CYCLICAL_SECTORS):
        score += 15.0
    elif any(s in sec_lower for s in VALUE_SECTORS):
        score += 8.0

    # --- Revenue growth positive but muted (0-15%) (20 pts) ---
    rev_vals = _last_n_annual_values(annual, "sales_cr", 3)
    valid_rev = [v for v in rev_vals if v is not None and v > 0]
    if len(valid_rev) >= 2:
        rev_cagr = cagr(valid_rev, len(valid_rev) - 1)
        if rev_cagr is not None:
            if 0 < rev_cagr <= 0.15:
                score += 20.0  # Muted positive growth → cyclical near trough
            elif rev_cagr > 0.15:
                score += 10.0  # Growing but not the turnaround Naren seeks
            # Negative growth = 0 pts for this criterion

    return min(100.0, score)
