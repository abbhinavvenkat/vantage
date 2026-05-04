from __future__ import annotations

"""
02_fetch_fundamentals.py

Scrape Screener.in for 10-year annual fundamental data for each stock in the
Nifty 500 and write one JSON file per stock to:
  data/codex/backtests/fundamentals/<SYMBOL>.json

A fetch log is maintained at:
  data/codex/backtests/fundamentals/_fetch_log.json

Run:
  python scripts/backtest/02_fetch_fundamentals.py

Rate-limit: 1.5 s between requests; exponential back-off on 429/503.
Idempotent: skips files scraped < 7 days ago.
"""

import io
import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests
import pandas as pd
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[2]
FUNDAMENTALS_DIR = REPO_ROOT / "data" / "codex" / "backtests" / "fundamentals"
UNIVERSE_CSV = REPO_ROOT / "data" / "codex" / "backtests" / "universe.csv"
FETCH_LOG_PATH = FUNDAMENTALS_DIR / "_fetch_log.json"

FUNDAMENTALS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SLEEP_BETWEEN = 1.5        # seconds between normal requests
SLEEP_RETRY   = 30         # seconds after 429/503
MAX_RETRIES   = 3          # attempts per symbol before giving up
SKIP_AGE_DAYS = 7          # skip if scraped within this many days
PROGRESS_EVERY = 10        # print progress every N stocks

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.screener.in/",
}

# ---------------------------------------------------------------------------
# Universe
# ---------------------------------------------------------------------------

def load_universe() -> list[str]:
    """Return list of NSE symbols for the Nifty 500."""
    if UNIVERSE_CSV.exists():
        df = pd.read_csv(UNIVERSE_CSV)
        col = next((c for c in df.columns if "symbol" in c.lower()), df.columns[0])
        return df[col].str.strip().tolist()

    print("universe.csv not found — downloading from NSE archives…")
    url = "https://archives.nseindia.com/content/indices/ind_nifty500list.csv"
    r = requests.get(url, headers=HEADERS, timeout=30)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    col = next((c for c in df.columns if "symbol" in c.lower()), df.columns[0])
    symbols = df[col].str.strip().tolist()

    UNIVERSE_CSV.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(UNIVERSE_CSV, index=False)
    print(f"Saved {len(symbols)} symbols to {UNIVERSE_CSV}")
    return symbols


# ---------------------------------------------------------------------------
# Number parsing
# ---------------------------------------------------------------------------

def parse_number(s: str | None) -> float | None:
    """Parse Indian-formatted numbers like '1,08,646' or '25.3%'."""
    if not s:
        return None
    s = s.strip().replace(",", "").replace("%", "").replace("₹", "").replace("\xa0", "")
    if s in ("", "-", "--", "N/A", "NA"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# HTML fetching
# ---------------------------------------------------------------------------

def fetch_html(symbol: str, session: requests.Session) -> tuple[str | None, str | None]:
    """
    Fetch Screener page HTML, trying consolidated first then standalone.
    Returns (html, url_used) or (None, None) on failure.
    """
    urls = [
        f"https://www.screener.in/company/{symbol}/consolidated/",
        f"https://www.screener.in/company/{symbol}/",
    ]
    for url in urls:
        for attempt in range(MAX_RETRIES):
            try:
                r = session.get(url, headers=HEADERS, timeout=15)
                if r.status_code == 200:
                    # Make sure we got an actual company page, not a redirect/error
                    if "screener" in r.url and symbol.upper() in r.url.upper():
                        return r.text, url
                    # Might have redirected to a search page
                    if "company" in r.url:
                        return r.text, url
                elif r.status_code == 404:
                    break  # try next URL
                elif r.status_code in (429, 503):
                    print(f"  [{symbol}] Rate-limited ({r.status_code}), sleeping {SLEEP_RETRY}s…")
                    time.sleep(SLEEP_RETRY)
                else:
                    print(f"  [{symbol}] HTTP {r.status_code} on {url}")
                    time.sleep(2)
            except requests.RequestException as exc:
                print(f"  [{symbol}] Request error attempt {attempt+1}: {exc}")
                time.sleep(3)
        time.sleep(SLEEP_BETWEEN)
    return None, None


# ---------------------------------------------------------------------------
# Table parsing helpers
# ---------------------------------------------------------------------------

def parse_table(soup: BeautifulSoup, section_id: str) -> tuple[list[str], dict[str, list[str | None]]]:
    """
    Parse a Screener data table identified by its section id.

    Returns:
        years  — list of year strings (header columns)
        rows   — {row_label: [val_year0, val_year1, …]}
    """
    section = soup.find(id=section_id)
    if not section:
        # Screener sometimes wraps tables in <section data-section="...">
        section = soup.find("section", {"id": section_id})
    if not section:
        return [], {}

    table = section.find("table")
    if not table:
        return [], {}

    # Header row → years
    thead = table.find("thead")
    if not thead:
        return [], {}
    header_cells = thead.find_all("th")
    # First cell is usually empty (row label column); rest are years
    years = [th.get_text(strip=True) for th in header_cells[1:]]

    # Body rows
    rows: dict[str, list[str | None]] = {}
    tbody = table.find("tbody")
    if not tbody:
        return years, rows

    for tr in tbody.find_all("tr"):
        cells = tr.find_all("td")
        if not cells:
            continue
        label_cell = cells[0]
        label = label_cell.get_text(strip=True)
        if not label:
            continue
        values = [cells[i].get_text(strip=True) if i < len(cells) else None
                  for i in range(1, len(years) + 1)]
        rows[label] = values

    return years, rows


def find_row(rows: dict[str, list], *candidates: str) -> list | None:
    """Find the first matching row label (case-insensitive partial match)."""
    for candidate in candidates:
        cl = candidate.lower()
        for key, vals in rows.items():
            if cl in key.lower():
                return vals
    return None


# ---------------------------------------------------------------------------
# Key ratios / top section parsing
# ---------------------------------------------------------------------------

def parse_current_ratios(soup: BeautifulSoup) -> dict:
    """Extract current P/E, market cap, and book value from the top section."""
    result: dict = {}

    # Screener renders key ratios as <li> items in #top-ratios or .company-ratios
    ratios_section = (
        soup.find(id="top-ratios")
        or soup.find("ul", class_="company-ratios")
        or soup.find(id="company-ratios")
    )
    if ratios_section:
        for li in ratios_section.find_all("li"):
            # Each li has <span class="name">…</span> and <span class="number">…</span>
            name_el = li.find("span", class_="name")
            val_el  = li.find("span", class_="number")
            if not name_el or not val_el:
                continue
            name = name_el.get_text(strip=True).lower()
            val  = parse_number(val_el.get_text(strip=True))
            if "p/e" in name:
                result["pe"] = val
            elif "market cap" in name:
                result["market_cap_cr"] = val
            elif "book value" in name:
                result["book_value_per_share"] = val

    # Fallback: scan all <li> text
    if not result:
        for li in soup.find_all("li"):
            text = li.get_text(" ", strip=True)
            if "Stock P/E" in text or "P/E" in text:
                parts = text.split()
                for p in parts:
                    v = parse_number(p)
                    if v and "pe" not in result:
                        result["pe"] = v
            if "Market Cap" in text:
                parts = text.split()
                for p in parts:
                    v = parse_number(p)
                    if v and "market_cap_cr" not in result:
                        result["market_cap_cr"] = v

    return result


# ---------------------------------------------------------------------------
# Main parse function
# ---------------------------------------------------------------------------

def parse_screener_page(html: str, symbol: str) -> dict | None:
    """Parse a Screener company page and return structured fundamental data."""
    soup = BeautifulSoup(html, "html.parser")

    # Company name
    name_el = (
        soup.find("h1", class_="company-name")
        or soup.find("h1")
    )
    company_name = name_el.get_text(strip=True) if name_el else symbol

    # -----------------------------------------------------------------------
    # Parse the four main tables
    # -----------------------------------------------------------------------
    pl_years,   pl_rows   = parse_table(soup, "profit-loss")
    bs_years,   bs_rows   = parse_table(soup, "balance-sheet")
    cf_years,   cf_rows   = parse_table(soup, "cash-flow")
    rat_years,  rat_rows  = parse_table(soup, "ratios")

    if not pl_years:
        return None  # nothing useful

    # -----------------------------------------------------------------------
    # Map row labels to data (Screener label names vary slightly)
    # -----------------------------------------------------------------------
    sales_row   = find_row(pl_rows,  "Sales", "Revenue", "Net Sales")
    ebitda_row  = find_row(pl_rows,  "Operating Profit", "EBITDA", "OPM")
    pat_row     = find_row(pl_rows,  "Net Profit", "PAT", "Profit after tax")
    eps_row     = find_row(pl_rows,  "EPS in Rs", "EPS", "Earnings per share")

    debt_row    = find_row(bs_rows,  "Borrowings", "Total Debt", "Long term borrowings")
    equity_row  = find_row(bs_rows,  "Equity Capital", "Share Capital", "Shareholders equity")
    reserves_row= find_row(bs_rows,  "Reserves", "Other Equity")

    cfo_row     = find_row(cf_rows,  "Cash from Operating", "Operating Activities", "CFO")
    capex_row   = find_row(cf_rows,  "Cash from Investing", "Capital expenditure", "Capex")

    roce_row    = find_row(rat_rows, "ROCE", "Return on Capital")
    roe_row     = find_row(rat_rows, "ROE", "Return on Equity", "Return on Net Worth")

    # -----------------------------------------------------------------------
    # Build per-year dict  (use P&L years as the master timeline)
    # -----------------------------------------------------------------------
    def get(row: list | None, idx: int) -> float | None:
        if row is None or idx >= len(row):
            return None
        return parse_number(row[idx])

    annual: dict[str, dict] = {}
    for i, year_label in enumerate(pl_years):
        # Normalise "Mar 2024" → "FY2024", "2024" → "FY2024", "TTM" → skip
        yl = year_label.strip()
        if "ttm" in yl.lower():
            continue
        if yl.isdigit() and len(yl) == 4:
            fy = f"FY{yl}"
        elif yl.startswith("Mar "):
            fy = f"FY{yl[4:]}"
        elif yl.startswith("FY") or yl.startswith("fy"):
            fy = yl.upper()
        else:
            fy = f"FY{yl}"

        # Equity BV = equity capital + reserves
        equity_cap = get(equity_row, i)
        reserves   = get(reserves_row, i)
        equity_bv: float | None
        if equity_cap is not None and reserves is not None:
            equity_bv = equity_cap + reserves
        elif equity_cap is not None:
            equity_bv = equity_cap
        elif reserves is not None:
            equity_bv = reserves
        else:
            equity_bv = None

        debt = get(debt_row, i)
        de: float | None = None
        if debt is not None and equity_bv and equity_bv != 0:
            de = round(debt / equity_bv, 3)

        annual[fy] = {
            "sales_cr":        get(sales_row, i),
            "ebitda_cr":       get(ebitda_row, i),
            "pat_cr":          get(pat_row, i),
            "eps":             get(eps_row, i),
            "roce_pct":        get(roce_row, i),
            "roe_pct":         get(roe_row, i),
            "debt_cr":         debt,
            "equity_bv_cr":    equity_bv,
            "cfo_cr":          get(cfo_row, i),
            "capex_cr":        get(capex_row, i),
            "debt_to_equity":  de,
        }

    if not annual:
        return None

    current = parse_current_ratios(soup)

    return {
        "symbol":       symbol,
        "company_name": company_name,
        "scraped_at":   datetime.now(timezone.utc).isoformat(),
        "annual":       annual,
        "current":      current,
    }


# ---------------------------------------------------------------------------
# Idempotency check
# ---------------------------------------------------------------------------

def should_skip(symbol: str) -> bool:
    """Return True if a recent (< SKIP_AGE_DAYS) file already exists."""
    path = FUNDAMENTALS_DIR / f"{symbol}.json"
    if not path.exists():
        return False
    try:
        data = json.loads(path.read_text())
        scraped_at = datetime.fromisoformat(data.get("scraped_at", "1970-01-01T00:00:00+00:00"))
        if scraped_at.tzinfo is None:
            scraped_at = scraped_at.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - scraped_at
        return age < timedelta(days=SKIP_AGE_DAYS)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Fetch log
# ---------------------------------------------------------------------------

def load_log() -> dict:
    if FETCH_LOG_PATH.exists():
        try:
            return json.loads(FETCH_LOG_PATH.read_text())
        except Exception:
            pass
    return {}


def save_log(log: dict) -> None:
    FETCH_LOG_PATH.write_text(json.dumps(log, indent=2))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    symbols = load_universe()
    total = len(symbols)
    print(f"Universe: {total} symbols")

    log = load_log()
    session = requests.Session()

    ok_count      = 0
    failed_count  = 0
    skipped_count = 0
    recent_ok: list[str] = []

    for idx, symbol in enumerate(symbols, start=1):
        if should_skip(symbol):
            skipped_count += 1
            if symbol not in log:
                log[symbol] = {"status": "ok", "scraped_at": "cached"}
            continue

        html, url_used = fetch_html(symbol, session)

        if html is None:
            print(f"  FAILED  {symbol} — could not fetch page")
            log[symbol] = {"status": "failed", "scraped_at": datetime.now(timezone.utc).isoformat()}
            failed_count += 1
        else:
            data = parse_screener_page(html, symbol)
            if data is None or not data.get("annual"):
                print(f"  NO_DATA {symbol} — page fetched but no table data parsed")
                log[symbol] = {"status": "no_data", "scraped_at": datetime.now(timezone.utc).isoformat()}
                failed_count += 1
            else:
                out_path = FUNDAMENTALS_DIR / f"{symbol}.json"
                out_path.write_text(json.dumps(data, indent=2))
                log[symbol] = {"status": "ok", "scraped_at": data["scraped_at"]}
                ok_count += 1
                recent_ok.append(symbol)

        # Progress report
        if idx % PROGRESS_EVERY == 0:
            recent_str = ", ".join(recent_ok[-PROGRESS_EVERY:])
            print(f"[{idx}/{total}] ok={ok_count} failed={failed_count} skipped={skipped_count} | recent: {recent_str}")
            save_log(log)
            recent_ok = []

        time.sleep(SLEEP_BETWEEN)

    # Final save
    save_log(log)

    print("\n" + "=" * 60)
    print(f"DONE  ok={ok_count}  failed={failed_count}  skipped={skipped_count}  total={total}")
    print(f"Output dir: {FUNDAMENTALS_DIR}")
    print(f"Fetch log:  {FETCH_LOG_PATH}")


if __name__ == "__main__":
    main()
