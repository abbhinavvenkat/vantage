"""
Phase 1: Fetch Nifty 500 universe and full OHLCV price history.

Outputs:
  data/codex/backtests/universe.csv         — symbol, company_name, sector, industry
  data/codex/backtests/prices/all_prices.parquet — long format OHLCV
  data/codex/backtests/prices/fetch_log.json    — per-symbol status

Idempotent: if all_prices.parquet already exists, skips symbols already present.
"""

import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = REPO_ROOT / "data" / "codex" / "backtests"
PRICES_DIR = OUT_DIR / "prices"
UNIVERSE_CSV = OUT_DIR / "universe.csv"
PRICES_PARQUET = PRICES_DIR / "all_prices.parquet"
FETCH_LOG = PRICES_DIR / "fetch_log.json"

OUT_DIR.mkdir(parents=True, exist_ok=True)
PRICES_DIR.mkdir(parents=True, exist_ok=True)

START_DATE = "2013-01-01"
END_DATE = "2026-05-03"
BATCH_SIZE = 50
SCRIPT_START = time.time()
MAX_RUNTIME_SECONDS = 20 * 60  # 20 minutes

# ---------------------------------------------------------------------------
# 1. Download Nifty 500 constituent list
# ---------------------------------------------------------------------------

NSE_CSV_URLS = [
    "https://archives.nseindia.com/content/indices/ind_nifty500list.csv",
    "https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv",
]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def fetch_nifty500_csv() -> pd.DataFrame:
    """Try NSE URLs in order; returns DataFrame with columns: symbol, company_name, sector, industry."""
    for url in NSE_CSV_URLS:
        try:
            print(f"  Trying {url} …")
            resp = requests.get(url, headers=HEADERS, timeout=20)
            resp.raise_for_status()
            from io import StringIO
            df = pd.read_csv(StringIO(resp.text))
            # NSE CSV columns: Symbol, Company Name, Industry, Series, ISIN Code
            # (sometimes "Sector" is absent; Industry doubles as sector)
            df.columns = [c.strip() for c in df.columns]
            print(f"  Columns found: {list(df.columns)}")
            # Filter to EQ series only
            if "Series" in df.columns:
                df = df[df["Series"].str.strip() == "EQ"]
            # Normalise to our schema
            symbol_col = next(c for c in df.columns if c.lower() in ("symbol",))
            name_col = next(
                (c for c in df.columns if "company" in c.lower() or "name" in c.lower()),
                None,
            )
            industry_col = next(
                (c for c in df.columns if "industry" in c.lower()), None
            )
            sector_col = next(
                (c for c in df.columns if "sector" in c.lower()), None
            )
            out = pd.DataFrame()
            out["symbol"] = df[symbol_col].str.strip()
            out["company_name"] = df[name_col].str.strip() if name_col else ""
            # NSE CSV often has only "Industry"; use it for both sector and industry
            out["sector"] = (
                df[sector_col].str.strip() if sector_col else
                (df[industry_col].str.strip() if industry_col else "")
            )
            out["industry"] = df[industry_col].str.strip() if industry_col else ""
            out = out.dropna(subset=["symbol"])
            out = out[out["symbol"] != ""]
            print(f"  Fetched {len(out)} EQ symbols from NSE.")
            return out
        except Exception as exc:
            print(f"  Failed ({exc})")
    raise RuntimeError("All NSE URL attempts failed — no fallback implemented.")


def load_or_fetch_universe() -> pd.DataFrame:
    if UNIVERSE_CSV.exists():
        df = pd.read_csv(UNIVERSE_CSV)
        print(f"Universe already exists ({len(df)} symbols). Using cached version.")
        return df
    print("Fetching Nifty 500 constituent list …")
    df = fetch_nifty500_csv()
    df.to_csv(UNIVERSE_CSV, index=False)
    print(f"Saved universe.csv with {len(df)} symbols.")
    return df


# ---------------------------------------------------------------------------
# 2. Download price history
# ---------------------------------------------------------------------------

def load_existing_prices() -> set[str]:
    """Return set of symbols already present in the parquet file."""
    if not PRICES_PARQUET.exists():
        return set()
    try:
        df = pd.read_parquet(PRICES_PARQUET, columns=["symbol"])
        return set(df["symbol"].unique())
    except Exception:
        return set()


def load_existing_log() -> dict:
    if FETCH_LOG.exists():
        with open(FETCH_LOG) as f:
            return json.load(f)
    return {}


def save_log(log: dict) -> None:
    with open(FETCH_LOG, "w") as f:
        json.dump(log, f, indent=2)


def batch_download(symbols: list[str]) -> pd.DataFrame:
    """
    Download a batch of symbols via yfinance batch API.
    Returns long-format DataFrame: date, symbol, open, high, low, close, volume, adj_close
    """
    tickers_str = " ".join(s + ".NS" for s in symbols)
    try:
        raw = yf.download(
            tickers_str,
            start=START_DATE,
            end=END_DATE,
            auto_adjust=True,
            group_by="ticker",
            progress=False,
            threads=True,
        )
    except Exception as exc:
        print(f"    Batch download exception: {exc}")
        return pd.DataFrame()

    if raw is None or raw.empty:
        return pd.DataFrame()

    rows = []
    for sym in symbols:
        ticker_key = sym + ".NS"
        try:
            # With group_by="ticker" and multiple tickers, columns are MultiIndex
            if isinstance(raw.columns, pd.MultiIndex):
                if ticker_key not in raw.columns.get_level_values(0):
                    continue
                df_sym = raw[ticker_key].copy()
            else:
                # Single ticker — raw is already flat
                df_sym = raw.copy()

            if df_sym.empty:
                continue

            df_sym = df_sym.reset_index()
            df_sym.columns = [c.lower() if isinstance(c, str) else c for c in df_sym.columns]
            # Normalise column names: 'adj close' → 'adj_close' etc.
            df_sym.rename(
                columns={
                    "adj close": "adj_close",
                    "adj_close": "adj_close",
                    "date": "date",
                },
                inplace=True,
            )
            # With auto_adjust=True, Close IS the adjusted close; duplicate it
            if "adj_close" not in df_sym.columns and "close" in df_sym.columns:
                df_sym["adj_close"] = df_sym["close"]

            required = {"date", "open", "high", "low", "close", "volume", "adj_close"}
            if not required.issubset(df_sym.columns):
                continue

            df_sym["symbol"] = sym
            df_sym["date"] = pd.to_datetime(df_sym["date"]).dt.tz_localize(None).dt.date
            rows.append(
                df_sym[["date", "symbol", "open", "high", "low", "close", "volume", "adj_close"]]
            )
        except Exception as exc:
            print(f"    Error parsing {sym}: {exc}")
            continue

    if not rows:
        return pd.DataFrame()
    return pd.concat(rows, ignore_index=True)


def fetch_all_prices(universe: pd.DataFrame) -> None:
    symbols: list[str] = universe["symbol"].tolist()
    already_fetched = load_existing_prices()
    fetch_log = load_existing_log()

    # Skip symbols we already have
    pending = [s for s in symbols if s not in already_fetched]
    print(
        f"\nPrice fetch: {len(symbols)} total, "
        f"{len(already_fetched)} already cached, "
        f"{len(pending)} to fetch.\n"
    )

    all_frames: list[pd.DataFrame] = []

    # Load existing parquet to merge into at the end
    if PRICES_PARQUET.exists() and already_fetched:
        print("Loading existing parquet …")
        existing_df = pd.read_parquet(PRICES_PARQUET)
        all_frames.append(existing_df)

    batches = [pending[i : i + BATCH_SIZE] for i in range(0, len(pending), BATCH_SIZE)]

    for batch_idx, batch in enumerate(batches):
        elapsed = time.time() - SCRIPT_START
        if elapsed > MAX_RUNTIME_SECONDS:
            print(f"\nTimeout reached ({elapsed:.0f}s). Saving partial results.")
            break

        print(
            f"Batch {batch_idx + 1}/{len(batches)}  "
            f"({batch_idx * BATCH_SIZE + 1}–{min((batch_idx + 1) * BATCH_SIZE, len(pending))} of {len(pending)})  "
            f"elapsed={elapsed:.0f}s"
        )

        batch_df = batch_download(batch)

        for sym in batch:
            sym_rows = (
                len(batch_df[batch_df["symbol"] == sym]) if not batch_df.empty else 0
            )
            if sym_rows == 0:
                fetch_log[sym] = {"status": "failed", "rows": 0}
            elif sym_rows < 100:
                fetch_log[sym] = {"status": "partial", "rows": sym_rows}
            else:
                fetch_log[sym] = {"status": "ok", "rows": sym_rows}

        if not batch_df.empty:
            all_frames.append(batch_df)

        # Persist log after every batch
        save_log(fetch_log)

    # Combine and save
    if all_frames:
        print("\nCombining frames and saving parquet …")
        combined = pd.concat(all_frames, ignore_index=True)
        combined = combined.drop_duplicates(subset=["date", "symbol"])
        combined = combined.sort_values(["symbol", "date"]).reset_index(drop=True)
        combined.to_parquet(PRICES_PARQUET, index=False, engine="pyarrow")
        print(f"Saved {PRICES_PARQUET} ({PRICES_PARQUET.stat().st_size / 1e6:.1f} MB)")
    else:
        print("No price data to save.")


# ---------------------------------------------------------------------------
# 3. Main + summary
# ---------------------------------------------------------------------------

def print_summary(universe: pd.DataFrame) -> None:
    fetch_log = load_existing_log()
    ok = sum(1 for v in fetch_log.values() if v["status"] == "ok")
    partial = sum(1 for v in fetch_log.values() if v["status"] == "partial")
    failed = sum(1 for v in fetch_log.values() if v["status"] == "failed")

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Universe symbols   : {len(universe)}")
    print(f"Fetch OK           : {ok}")
    print(f"Fetch partial      : {partial}")
    print(f"Fetch failed       : {failed}")

    if PRICES_PARQUET.exists():
        df = pd.read_parquet(PRICES_PARQUET)
        print(f"Price rows total   : {len(df):,}")
        print(f"Date range         : {df['date'].min()} → {df['date'].max()}")
        print(f"Parquet size       : {PRICES_PARQUET.stat().st_size / 1e6:.1f} MB")

    if UNIVERSE_CSV.exists():
        print(f"Universe CSV size  : {UNIVERSE_CSV.stat().st_size / 1e3:.1f} KB")

    if FETCH_LOG.exists():
        print(f"Fetch log size     : {FETCH_LOG.stat().st_size / 1e3:.1f} KB")

    elapsed = time.time() - SCRIPT_START
    print(f"Total runtime      : {elapsed:.0f}s")
    print("=" * 60)


def main() -> None:
    print(f"Stock platform — Phase 1: universe + prices")
    print(f"Start: {datetime.utcnow().isoformat()}Z")
    print(f"Repo root: {REPO_ROOT}\n")

    universe = load_or_fetch_universe()
    fetch_all_prices(universe)
    print_summary(universe)


if __name__ == "__main__":
    main()
