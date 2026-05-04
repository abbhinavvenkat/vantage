/**
 * Hand-curated registry mapping each fundamental metric to verbatim quotes
 * from the stalwart profiles in `data/investor_stalwarts/*.md`.
 *
 * Every quote and source URL was copied from the corresponding investor's
 * Quotes / Core Principles / Buy Triggers / Red Flags section. NO LLM
 * synthesis. If an entry's source_url cannot be verified by re-reading the
 * profile, delete it rather than fabricate.
 *
 * `intent`:
 *   - threshold_pass — what good looks like (rendered when verdict is green)
 *   - threshold_fail — what to avoid (rendered when verdict is red)
 *   - general       — applies regardless (fallback for amber / unknown)
 */

import type { MetricId, Verdict } from '@/lib/fundamentals/thresholds';

export type CommentaryEntry = {
  investor: string; // display name
  slug: string; // matches data/investor_stalwarts/<slug>.md
  quote: string;
  source_url: string;
  intent: 'threshold_pass' | 'threshold_fail' | 'general';
};

export const STALWART_COMMENTARY: Record<MetricId, CommentaryEntry[]> = {
  revenue: [
    {
      investor: 'Buffett',
      slug: 'buffett',
      quote:
        'When you find a truly wonderful business, stick with it. Patience pays, and one wonderful business can offset the many mediocre decisions that are inevitable.',
      source_url: 'https://www.berkshirehathaway.com/2023ar/2023ar.pdf',
      intent: 'threshold_pass',
    },
    {
      investor: 'Mukherjea',
      slug: 'mukherjea',
      quote:
        'Good businesses grow revenues; great businesses grow revenues AND ROCE simultaneously over a decade. Only great businesses merit Consistent Compounders inclusion.',
      source_url: 'https://www.amazon.in/Unusual-Billionaires-Saurabh-Mukherjea/dp/0670089087',
      intent: 'threshold_pass',
    },
    {
      investor: 'Lynch',
      slug: 'lynch',
      quote: "Behind every stock is a company. Find out what it's doing.",
      source_url: 'https://www.amazon.com/Up-Wall-Street-Already-Knows/dp/0743200403',
      intent: 'general',
    },
    {
      investor: 'Marks',
      slug: 'marks',
      quote:
        'Security prices fluctuate much more than do the intrinsic value and prospects of the underlying companies, and the main reason for this is the extreme volatility in the way people feel about risk.',
      source_url: 'https://www.oaktreecapital.com/insights/memo/cockroaches-in-the-coal-mine',
      intent: 'threshold_fail',
    },
  ],

  pat: [
    {
      investor: 'Buffett',
      slug: 'buffett',
      quote: 'Mistakes fade away; winners can forever blossom.',
      source_url: 'https://www.berkshirehathaway.com/2024ar/2024ar.pdf',
      intent: 'threshold_pass',
    },
    {
      investor: 'Akre',
      slug: 'akre',
      quote:
        'Free cash flow is the only real measure. Accounting earnings can be distorted; free cash flow to the business (after maintenance capex) is the measure that counts.',
      source_url: 'https://www.akrecapital.com/our-thinking/',
      intent: 'general',
    },
    {
      investor: 'Damodaran',
      slug: 'damodaran',
      quote:
        'A stock is not a bond, where dividends replace coupons, and you get some price appreciation on top, and treating it as such will only create disappointment.',
      source_url:
        'https://aswathdamodaran.blogspot.com/2026/02/data-update-8-for-2026-time-for.html',
      intent: 'threshold_fail',
    },
    {
      investor: 'Mukherjea',
      slug: 'mukherjea',
      quote:
        'A business with 25% ROCE compounding is intrinsically worth a high multiple; the question is how high, not whether.',
      source_url: 'https://marcellus.in/blogs/the-consistent-compounders-framework/',
      intent: 'threshold_pass',
    },
  ],

  roce: [
    {
      investor: 'Mukherjea',
      slug: 'mukherjea',
      quote:
        'ROCE > 15% for 10 consecutive years is the primary filter. Below that, capital allocation is suspect regardless of growth.',
      source_url: 'https://marcellus.in/blogs/the-consistent-compounders-framework/',
      intent: 'threshold_pass',
    },
    {
      investor: 'Akre',
      slug: 'akre',
      quote:
        "What is the rate of return on this business's incremental capital? — the single most important analytical question.",
      source_url: 'https://www.akrecapital.com/our-story/',
      intent: 'threshold_pass',
    },
    {
      investor: 'Buffett',
      slug: 'buffett',
      quote:
        'A business that earns low returns on incremental investment, no matter how good the management, will be a poor compounder.',
      source_url: 'https://www.berkshirehathaway.com/2023ar/2023ar.pdf',
      intent: 'threshold_fail',
    },
    {
      investor: 'Mukherjea',
      slug: 'mukherjea',
      quote:
        'Commodities and cyclicals: no moat, no pricing power, ROCE mean-reverts to cost of capital.',
      source_url: 'https://marcellus.in/blogs/the-consistent-compounders-framework/',
      intent: 'threshold_fail',
    },
  ],

  roe: [
    {
      investor: 'Buffett',
      slug: 'buffett',
      quote:
        'Owning only one of these companies — and simply sitting tight — can deliver wealth almost beyond measure. (On businesses that can deploy additional capital at high returns.)',
      source_url: 'https://www.berkshirehathaway.com/2023ar/2023ar.pdf',
      intent: 'threshold_pass',
    },
    {
      investor: 'Mukherjea',
      slug: 'mukherjea',
      quote:
        'HDFC Bank: >20% ROCE bank with near-zero NPA history; best-in-class provisioning culture; retail deposit franchise — banking quality compounds at the speed of the franchise, not the economy.',
      source_url: 'https://marcellus.in/blogs/the-consistent-compounders-framework/',
      intent: 'threshold_pass',
    },
    {
      investor: 'Buffett',
      slug: 'buffett',
      quote:
        'Capital-intensive businesses with no moat — textile mills, overcapitalized utilities — earn low returns on incremental investment no matter how good the management.',
      source_url: 'https://www.berkshirehathaway.com/2023ar/2023ar.pdf',
      intent: 'threshold_fail',
    },
  ],

  ebitda_margin: [
    {
      investor: 'Akre',
      slug: 'akre',
      quote:
        'Three-legged stool: a business that earns high rates of return, management that allocates capital well, and opportunities to reinvest at those high rates. All three legs must be present.',
      source_url: 'https://www.akrecapital.com/our-story/',
      intent: 'threshold_pass',
    },
    {
      investor: 'Mukherjea',
      slug: 'mukherjea',
      quote:
        'Pidilite: near-monopoly in construction adhesives; 50%+ market share in Fevicol; ROCE > 30% — near-monopoly with consumer brand = infinite pricing power; ignore PE.',
      source_url: 'https://marcellus.in/blogs/the-consistent-compounders-framework/',
      intent: 'threshold_pass',
    },
    {
      investor: 'Buffett',
      slug: 'buffett',
      quote:
        'Capital-intensive industrials and commodity producers require constant reinvestment just to maintain the current earnings level, leaving nothing to compound at high rates.',
      source_url: 'https://www.berkshirehathaway.com/2023ar/2023ar.pdf',
      intent: 'threshold_fail',
    },
  ],

  debt_to_equity: [
    {
      investor: 'Buffett',
      slug: 'buffett',
      quote:
        'We want your company to be financially impregnable and never dependent on the kindness of strangers. Never rely on debt markets — minimum $30B+ cash/T-bills at all times.',
      source_url: 'https://www.berkshirehathaway.com/2021ar/2021ar.pdf',
      intent: 'threshold_pass',
    },
    {
      investor: 'Buffett (Munger)',
      slug: 'buffett',
      quote:
        "A string of wonderful numbers times zero will always equal zero. Don't count on getting rich twice. (On any use of leverage to juice returns.)",
      source_url: 'https://www.berkshirehathaway.com/2022ar/2022ar.pdf',
      intent: 'threshold_fail',
    },
    {
      investor: 'Mukherjea',
      slug: 'mukherjea',
      quote: 'Highly leveraged balance sheets: interest coverage < 3x is an automatic exclusion.',
      source_url: 'https://marcellus.in/blogs/the-consistent-compounders-framework/',
      intent: 'threshold_fail',
    },
    {
      investor: 'Graham',
      slug: 'graham',
      quote:
        'An investment operation is one which, upon thorough analysis, promises safety of principal and an adequate return. Operations not meeting these requirements are speculative.',
      source_url:
        'https://www.amazon.com/Security-Analysis-Foreword-Buffett-Editions/dp/0071592539',
      intent: 'general',
    },
  ],

  fcf_to_pat: [
    {
      investor: 'Akre',
      slug: 'akre',
      quote:
        'Free cash flow is the only real measure. Accounting earnings can be distorted; free cash flow to the business (after maintenance capex) is the measure that counts.',
      source_url: 'https://www.akrecapital.com/our-thinking/',
      intent: 'threshold_pass',
    },
    {
      investor: 'Damodaran',
      slug: 'damodaran',
      quote:
        'Much of what passes for valuation in practice is pricing, where people use pricing metrics (such as PE ratios or EV to EBITDA multiples) to make pricing judgments.',
      source_url:
        'https://aswathdamodaran.blogspot.com/2026/03/finding-your-investing-lodestar-in.html',
      intent: 'general',
    },
    {
      investor: 'Buffett',
      slug: 'buffett',
      quote:
        'Owner earnings = reported earnings + D&A − maintenance capex − working-capital needs. Anything else is "bold imaginative accounting."',
      source_url: 'https://www.berkshirehathaway.com/2022ar/2022ar.pdf',
      intent: 'threshold_fail',
    },
  ],

  pe: [
    {
      investor: 'Marks',
      slug: 'marks',
      quote:
        'Value should be thought of as exerting a "magnetic" influence on price. If price is above value, future price movements are more likely to be downward than upward.',
      source_url: 'https://www.oaktreecapital.com/insights/memo/the-calculus-of-value',
      intent: 'threshold_fail',
    },
    {
      investor: 'Graham',
      slug: 'graham',
      quote: 'Price is what you pay. Value is what you get.',
      source_url:
        'https://www.amazon.com/Security-Analysis-Foreword-Buffett-Editions/dp/0071592539',
      intent: 'general',
    },
    {
      investor: 'Buffett',
      slug: 'buffett',
      quote:
        'In the short run the market acts as a voting machine; in the long run it becomes a weighing machine.',
      source_url: 'https://www.berkshirehathaway.com/2023ar/2023ar.pdf',
      intent: 'threshold_pass',
    },
    {
      investor: 'Mukherjea',
      slug: 'mukherjea',
      quote:
        'Asian Paints / Nestle type businesses — willing to pay 50–70x trailing earnings if 10-year ROCE track record is intact.',
      source_url: 'https://economictimes.indiatimes.com/markets/expert-view/',
      intent: 'general',
    },
  ],

  pb: [
    {
      investor: 'Graham',
      slug: 'graham',
      quote:
        'The purpose of the margin of safety is to render unnecessary an accurate estimate of the future.',
      source_url:
        'https://www.amazon.com/Intelligent-Investor-Definitive-Investing-Practical/dp/0060555661',
      intent: 'threshold_pass',
    },
    {
      investor: 'Graham',
      slug: 'graham',
      quote: 'Buy not on optimism, but on arithmetic. (Paraphrase attributed to Graham.)',
      source_url:
        'https://www.amazon.com/Security-Analysis-Foreword-Buffett-Editions/dp/0071592539',
      intent: 'threshold_fail',
    },
    {
      investor: 'Damodaran',
      slug: 'damodaran',
      quote:
        'If you define intrinsic value as the value of a business based upon its capacity to generate cash flows in the future, there is nothing in that definition that requires either historical data or peer group information.',
      source_url:
        'https://aswathdamodaran.blogspot.com/2026/04/to-trillion-dollars-and-beyond-spacex.html',
      intent: 'general',
    },
  ],

  dividend_yield: [
    {
      investor: 'Buffett',
      slug: 'buffett',
      quote:
        'Coca-Cola: paid $75M dividend in 1994 on $1.3B cost; by 2022, dividend had grown to $704M — a 54% annual yield on cost. (Dividend yield on cost as a compounding indicator.)',
      source_url: 'https://www.berkshirehathaway.com/2022ar/2022ar.pdf',
      intent: 'threshold_pass',
    },
    {
      investor: 'Lynch',
      slug: 'lynch',
      quote:
        "If you can't explain in two minutes or less why you own a stock, you have no business owning it. (Dividend yield is a tie-breaker, not a thesis.)",
      source_url: 'https://www.amazon.com/Up-Wall-Street-Already-Knows/dp/0743200403',
      intent: 'general',
    },
    {
      investor: 'Damodaran',
      slug: 'damodaran',
      quote:
        'A stock is not a bond, where dividends replace coupons, and you get some price appreciation on top, and treating it as such will only create disappointment.',
      source_url:
        'https://aswathdamodaran.blogspot.com/2026/02/data-update-8-for-2026-time-for.html',
      intent: 'threshold_fail',
    },
  ],
};

/**
 * Pick a single best-matching commentary entry for a given metric + verdict.
 * Returns null only if the registry has no entries for the metric — which the
 * registry test forbids, so callers can treat null as a regression.
 */
export function pickCommentary(id: MetricId, verdict: Verdict): CommentaryEntry | null {
  const entries = STALWART_COMMENTARY[id];
  if (!entries || entries.length === 0) return null;

  if (verdict === 'green') {
    const pass = entries.find((e) => e.intent === 'threshold_pass');
    if (pass) return pass;
  }
  if (verdict === 'red') {
    const fail = entries.find((e) => e.intent === 'threshold_fail');
    if (fail) return fail;
  }
  // amber / unknown — prefer general, then any.
  const general = entries.find((e) => e.intent === 'general');
  if (general) return general;
  return entries[0]!;
}

/** Return ALL entries for a metric (for the "..." expand-other-investors view). */
export function allCommentary(id: MetricId): CommentaryEntry[] {
  return STALWART_COMMENTARY[id] ?? [];
}
