/**
 * Concentration & risk analytics.
 *
 * - HHI: Herfindahl-Hirschman Index over portfolio weights.
 * - dailyReturns: simple returns r_t = P_t / P_{t-1} - 1.
 * - beta: trailing 252-day rolling sample beta of a symbol vs Nifty 50,
 *         computed as cov(symbol_returns, nifty_returns) / var(nifty_returns).
 *         Returns null when fewer than 60 paired observations are available
 *         or when the Nifty return series has zero variance.
 * - portfolioBeta: market-value-weighted average of per-symbol betas, with
 *                  null-beta symbols excluded and remaining weights renormalised.
 */

const MIN_PAIRED_OBS = 60;
const TRAILING_WINDOW = 252;

/** Sum of squares of weights. Weights expressed as fractions (e.g. 0.25 for 25%). */
export function computeHHI(weights: number[]): number {
  if (weights.length === 0) return 0;
  let s = 0;
  for (const w of weights) s += w * w;
  return s;
}

/** Simple daily returns. Closes assumed to be in chronological order. */
export function dailyReturns(closes: number[]): number[] {
  if (closes.length < 2) return [];
  const out: number[] = new Array(closes.length - 1);
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    const cur = closes[i]!;
    out[i - 1] = cur / prev - 1;
  }
  return out;
}

/**
 * Trailing 252-day sample beta of a symbol vs Nifty.
 *
 * Caller must pre-align the two series so `symbolCloses[i]` and `niftyCloses[i]`
 * correspond to the same trading date. Both must have equal length. The function
 * uses up to the most recent `TRAILING_WINDOW` paired close observations
 * (yielding `TRAILING_WINDOW - 1` returns).
 *
 * Returns null if fewer than `MIN_PAIRED_OBS` paired closes are supplied or
 * the Nifty return series has zero variance over the window.
 */
export function beta(symbolCloses: number[], niftyCloses: number[]): number | null {
  if (symbolCloses.length !== niftyCloses.length) return null;
  if (symbolCloses.length < MIN_PAIRED_OBS) return null;

  const start = Math.max(0, symbolCloses.length - TRAILING_WINDOW);
  const symWindow = symbolCloses.slice(start);
  const niftyWindow = niftyCloses.slice(start);

  const symRet = dailyReturns(symWindow);
  const niftyRet = dailyReturns(niftyWindow);
  const n = Math.min(symRet.length, niftyRet.length);
  if (n < MIN_PAIRED_OBS - 1) return null;

  let symMean = 0;
  let niftyMean = 0;
  for (let i = 0; i < n; i++) {
    symMean += symRet[i]!;
    niftyMean += niftyRet[i]!;
  }
  symMean /= n;
  niftyMean /= n;

  let cov = 0;
  let varNifty = 0;
  for (let i = 0; i < n; i++) {
    const ds = symRet[i]! - symMean;
    const dn = niftyRet[i]! - niftyMean;
    cov += ds * dn;
    varNifty += dn * dn;
  }
  // Sample (n-1) factor cancels between cov and var; can divide by n directly.
  if (varNifty === 0) return null;
  return cov / varNifty;
}

export type BetaPosition = { symbol: string; marketValue: number };

/**
 * Market-value-weighted portfolio beta.
 * Symbols whose beta is null are excluded; the remaining weights are
 * renormalised so they sum to 1. Returns null when no symbol has a beta or
 * total covered marketValue is zero.
 */
export function portfolioBeta(
  positions: BetaPosition[],
  betas: Map<string, number | null>,
): number | null {
  let totalCovered = 0;
  for (const p of positions) {
    const b = betas.get(p.symbol);
    if (b == null) continue;
    if (p.marketValue > 0) totalCovered += p.marketValue;
  }
  if (totalCovered <= 0) return null;

  let acc = 0;
  for (const p of positions) {
    const b = betas.get(p.symbol);
    if (b == null) continue;
    if (p.marketValue <= 0) continue;
    acc += (p.marketValue / totalCovered) * b;
  }
  return acc;
}
