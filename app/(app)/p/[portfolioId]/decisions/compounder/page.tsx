/**
 * Compounder Thesis overview — Option B per spec.
 *
 * Server Component. Per-symbol compounder evaluations for every holding +
 * watchlist symbol the user is tracking. Header shows summary "X of Y holdings
 * qualify as 7-9x candidates". The CompounderOverviewClient layer adds filter
 * chips + sort + per-row expand (the only interactive bits).
 */

import Link from 'next/link';

import { db } from '@/lib/db/client';
import { computeHoldings } from '@/lib/db/queries/holdings';
import { listWatchlist } from '@/lib/db/queries/watchlist';
import { getLatestPrices } from '@/lib/db/queries/prices';
import { computeCompounderProfile, type CompounderProfile } from '@/lib/compounder/score';
import { loadFundamentals } from '@/lib/decisions/growthForecast';
import { getSector } from '@/lib/sectors/map';
import { buildValuationContext } from '@/lib/valuation/peStats';
import { getSectorMedian } from '@/lib/valuation/sectorPe';
import { loadLatestThesisStressTest } from '@/lib/research/loadOutputs';
import { Card } from '@/components/ui/Card';
import { Sparkle } from '@/components/ui/Icons';

import { CompounderOverviewClient, type CompounderRowView } from './CompounderOverviewClient';

type Props = { params: Promise<{ portfolioId: string }> };

export default async function CompounderOverviewPage({ params }: Props) {
  const { portfolioId } = await params;

  const holdings = computeHoldings(db, portfolioId).filter((h) => h.netQty > 0);
  const watchlist = listWatchlist(db, portfolioId);
  const watchSet = new Set(watchlist.map((w) => w.symbol));
  const holdingSet = new Set(holdings.map((h) => h.symbol));
  const allSymbols = [
    ...new Set([...holdings.map((h) => h.symbol), ...watchlist.map((w) => w.symbol)]),
  ];
  const prices = getLatestPrices(db, allSymbols);

  let totalValue = 0;
  for (const h of holdings) {
    const p = prices.get(h.symbol)?.close;
    if (typeof p === 'number') totalValue += p * h.netQty;
  }

  const compToday = new Date().toISOString().slice(0, 10);
  const rows: CompounderRowView[] = allSymbols.map((symbol) => {
    const fund = loadFundamentals(symbol);
    const sector = getSector(symbol);
    const v = buildValuationContext({
      db,
      symbol,
      fund,
      sectorMedian: getSectorMedian(sector),
      endDate: compToday,
    });
    const profile: CompounderProfile = computeCompounderProfile({
      symbol,
      sector,
      fundamentals: fund,
      firedRules: [],
      valuation: {
        pe: v.pe,
        peg: v.peg,
        peVsSectorMedian: v.peVsSectorMedian,
        peSectorMedian: v.peSectorMedian,
        pe5yMedian: v.pe5yMedian,
        pe10yPercentile: v.pe10yPercentile,
        earningsYieldMinusGsec: v.earningsYieldMinusGsec,
      },
    });
    const h = holdings.find((x) => x.symbol === symbol);
    const lp = prices.get(symbol)?.close;
    const positionPct =
      h && typeof lp === 'number' && totalValue > 0 ? (lp * h.netQty) / totalValue : null;
    const stressTest = loadLatestThesisStressTest(symbol);
    const thesisVerdict = stressTest
      ? (stressTest.verdict as 'intact' | 'watch' | 'weakened' | 'broken')
      : 'untested';
    return {
      symbol,
      sector,
      isHolding: holdingSet.has(symbol),
      isWatchlist: watchSet.has(symbol),
      positionPct,
      profile,
      thesisVerdict,
    };
  });

  // Summary counts (holdings only — the headline metric the user asked for).
  const holdingProfiles = rows.filter((r) => r.isHolding);
  const sevenNineCount = holdingProfiles.filter(
    (r) => r.profile.classification === '7-9x candidate',
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <Sparkle size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold">Compounder Thesis Framework</h2>
              <p className="mt-0.5 text-sm text-[var(--color-muted)]">
                <span className="font-medium text-[var(--color-fg)]">
                  {sevenNineCount} of {holdingProfiles.length}
                </span>{' '}
                holdings qualify as 7-9× candidates · 10 factors · weighted score thresholds 0.75 /
                0.55 / 0.35
              </p>
            </div>
          </div>
          <Link
            href={`/p/${portfolioId}/decisions`}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]"
          >
            ← Decisions
          </Link>
        </div>
      </Card>

      {rows.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-muted)]">
            No holdings or watchlist symbols yet. Upload a tradebook on the Holdings page to begin.
          </p>
        </Card>
      ) : (
        <CompounderOverviewClient rows={rows} portfolioId={portfolioId} />
      )}
    </div>
  );
}
