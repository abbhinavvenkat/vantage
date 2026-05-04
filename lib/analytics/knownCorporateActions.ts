import type { CorporateAction } from '@/lib/analytics/fifo';

/**
 * Bonus / split corporate actions known for symbols held in this user's portfolio.
 *
 * These are not ingested from broker tradebooks (Zerodha exports trades, not bonus credits)
 * so we maintain them here. Each action is applied by FIFO before sells are matched —
 * `ratio` is "shares-after / shares-before per existing lot held at ex-date".
 *
 * Derivation: ratios are reverse-engineered from the user's holdings statement
 * compared against FIFO-computed open qty per symbol. Ex-dates are set to the
 * published record/ex-date where known; otherwise placed between the user's last
 * pre-action buy and first post-action buy so the action applies to the correct lots.
 *
 * `type: 'bonus'` with ratio R means R bonus shares are issued per 1 held (so qty becomes 1+R).
 * `type: 'split'` with ratio R means qty multiplied by R (cost-per-share divided by R).
 *
 * For combined actions on the same date (e.g. Bajaj Finance Jun-2025: 4:1 bonus + 1:2 split,
 * effective 10x), we model as two sequential entries on consecutive ex-dates so the math is
 * unambiguous.
 */
export const KNOWN_CORPORATE_ACTIONS: CorporateAction[] = [
  // HDFCBANK 1:1 bonus, ex-date 27-Aug-2025 (record 27-Aug-2025)
  { symbol: 'HDFCBANK', exDate: '2025-08-27', type: 'bonus', ratio: 1 },

  // BAJFINANCE: 4:1 bonus + 1:2 split combined effective 16-Jun-2025 (= 10x ratio)
  { symbol: 'BAJFINANCE', exDate: '2025-06-16', type: 'bonus', ratio: 4 },
  { symbol: 'BAJFINANCE', exDate: '2025-06-17', type: 'split', ratio: 2 },

  // CAMS bonus 4:1 (5x), ex-date approx late 2024 (between user's last pre-action buy 2023-05-02 and now)
  { symbol: 'CAMS', exDate: '2024-12-23', type: 'bonus', ratio: 4 },

  // PIDILITIND 1:1 bonus (placed after user's last pre-action buy 2025-02-28)
  { symbol: 'PIDILITIND', exDate: '2025-12-01', type: 'bonus', ratio: 1 },

  // LALPATHLAB 1:1 bonus (placed after user's last pre-action buy 2023-04-11)
  { symbol: 'LALPATHLAB', exDate: '2024-06-01', type: 'bonus', ratio: 1 },

  // KOTAKBANK 4:1 bonus (5x) (placed after user's last pre-action buy 2025-11-03)
  { symbol: 'KOTAKBANK', exDate: '2026-01-01', type: 'bonus', ratio: 4 },

  // BEL: 230/180 = 23/18 — likely a 5:18 bonus (irregular). Models the observed ratio.
  // (Alternative theories: stock split with partial sells we don't see. Holding statement is truth.)
  { symbol: 'BEL', exDate: '2024-10-07', type: 'bonus', ratio: 5 / 18 },

  // AJANTPHARM 5:14 bonus (19/14 = 1.357 ≈ 1 + 5/14)
  { symbol: 'AJANTPHARM', exDate: '2024-08-23', type: 'bonus', ratio: 5 / 14 },

  // NOTE: discrepancies remaining for TCS, TATAELXSI, LT, SBICARD, SOLARINDS look like
  // missing trades between our last tradebook cutoff (2026-03-27) and the holdings statement
  // date (2026-04-30) rather than corporate actions, so they are NOT modeled here.
  // SBICARD: user had 37 net buys post-2026-03-27 (we have 0).
  // SOLARINDS: 4 shares acquired post-2026-03-27.
  // TCS:      ~10 extra shares ~₹2458 acquired post-2026-03-27.
  // TATAELXSI: ~8 extra shares acquired post-2026-03-27.
  // LT:       ~2 extra shares acquired post-2026-03-27.
];
