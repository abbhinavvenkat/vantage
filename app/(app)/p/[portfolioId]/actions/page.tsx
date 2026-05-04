import { existsSync, readFileSync } from 'node:fs';
import Link from 'next/link';
import type { Route } from 'next';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Sparkle } from '@/components/ui/Icons';
import { getSession } from '@/lib/auth/session';
import { loadLatestRuleLibrary } from '@/lib/codex/library';
import { db } from '@/lib/db/client';
import { listCandidateRuns, listCandidates, type CandidateRow } from '@/lib/db/queries/candidates';
import { getLatestPrices } from '@/lib/db/queries/prices';
import { listTargets } from '@/lib/db/queries/rebalanceTargets';
import { getStyleWeights } from '@/lib/db/queries/styleWeights';
import { getTradesForPortfolio, type Trade } from '@/lib/db/queries/trades';
import { computeOpenPositions } from '@/lib/analytics/fifoHoldings';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import {
  computeRebalanceTrades,
  type RebalanceAction,
  type RebalanceTarget,
} from '@/lib/analytics/rebalance';
import { computeTaxHarvest, type HarvestRow } from '@/lib/analytics/taxHarvest';
import { type RebalanceMode } from '@/lib/db/schema';
import type { NormalizedTrade } from '@/lib/parsers/types';
import { getSector } from '@/lib/sectors/map';

import { AddTargetForm, DeleteTargetButton } from '../rebalance/TargetRowEditor';
import { PromoteButton } from '../candidates/CandidateActions';
import { CopyFetchCommandButton, ImportCandidatesButton } from '../candidates/HeaderActions';
import { SliderForm, type InvestorRow } from '../style-mixer/SliderForm';

type Props = {
  params: Promise<{ portfolioId: string }>;
  searchParams: Promise<{ section?: string; mode?: string; suggest?: string; run?: string }>;
};

const SECTIONS = [
  { key: 'rebalance', label: 'Rebalance' },
  { key: 'tax-harvest', label: 'Tax Harvest' },
  { key: 'candidates', label: 'Candidates' },
  { key: 'style-mixer', label: 'Style Mixer' },
] as const;

type Section = (typeof SECTIONS)[number]['key'];

function SubNav({ portfolioId, current }: { portfolioId: string; current: Section }) {
  return (
    <div className="-mb-px flex gap-1 overflow-x-auto border-b border-[var(--color-border)] pb-0">
      {SECTIONS.map((s) => {
        const active = s.key === current;
        return (
          <Link
            key={s.key}
            href={`/p/${portfolioId}/actions?section=${s.key}` as Route}
            className={
              'shrink-0 rounded-t-[var(--radius-sm)] border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
              (active
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-fg)]')
            }
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function fmt(n: number, d = 2) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

function fmtInr(n: number) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return `${sign}₹${fmt(abs / 1_00_00_000, 2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${fmt(abs / 1_00_000, 2)}L`;
  return `${sign}₹${fmt(abs, 0)}`;
}

function toNormalized(t: Trade, i: number): NormalizedTrade {
  return {
    brokerCode: 'zerodha',
    symbol: t.symbol,
    isin: t.isin ?? undefined,
    tradeDate: t.tradeDate,
    side: t.side as 'buy' | 'sell',
    qty: t.qty,
    price: t.price,
    currency: t.currency as 'INR' | 'USD',
    exchange: t.exchange ?? undefined,
    segment: t.segment ?? undefined,
    series: t.series ?? undefined,
    tradeId: t.tradeId ?? undefined,
    orderId: t.orderId ?? undefined,
    execTime: t.execTime ?? undefined,
    rawRowIdx: t.sourceRowIdx ?? i,
  };
}

// ─── Rebalance section ───────────────────────────────────────────────────────

async function RebalanceSection({
  portfolioId,
  csrfToken,
  mode,
  suggest,
}: {
  portfolioId: string;
  csrfToken: string;
  mode: RebalanceMode;
  suggest: boolean;
}) {
  const allTrades = getTradesForPortfolio(db, portfolioId);
  const deliveryTrades = allTrades.filter((t) => t.isIntradayPairId === null);
  const normalized: NormalizedTrade[] = deliveryTrades.map(toNormalized);
  const positions = computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS);
  const symbols = positions.map((p) => p.symbol);
  const prices = getLatestPrices(db, symbols);

  const totalMv = positions.reduce(
    (s, p) => s + (prices.get(p.symbol)?.close ?? p.avgCost) * p.qty,
    0,
  );
  const heldSectors = Array.from(new Set(positions.map((p) => getSector(p.symbol))));

  const targetRows = listTargets(db, portfolioId, mode);
  const targets: RebalanceTarget[] = targetRows.map((r) => ({
    mode: r.mode,
    key: r.key,
    targetPct: r.targetPct,
  }));
  const sumTargetPct = targets.reduce((s, t) => s + t.targetPct, 0);
  const cashPct = Math.max(0, 100 - sumTargetPct);

  const actions: RebalanceAction[] = suggest
    ? computeRebalanceTrades(positions, prices, targets, mode, totalMv)
    : [];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Rebalance suggester</h2>
            <p className="text-xs text-[var(--color-muted)]">
              Set target weights and we&apos;ll compute the buy/sell trades. Tax considerations are
              left to you.
            </p>
          </div>
          <div className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-1">
            <ModeLink portfolioId={portfolioId} value="symbol" current={mode}>
              By Symbol
            </ModeLink>
            <ModeLink portfolioId={portfolioId} value="sector" current={mode}>
              By Sector
            </ModeLink>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label="Total Market Value" value={fmtInr(totalMv)} />
          <Metric label="Targets set" value={`${targets.length}`} />
          <Metric
            label="Sum of targets"
            value={`${fmt(sumTargetPct, 1)}%`}
            sub={
              sumTargetPct > 100
                ? 'over 100% — invalid'
                : sumTargetPct < 100
                  ? `cash ${fmt(cashPct, 1)}%`
                  : 'fully allocated'
            }
            tone={sumTargetPct > 100 ? 'neg' : 'neutral'}
          />
          <Metric label="Mode" value={mode === 'symbol' ? 'Per Symbol' : 'Per Sector'} />
        </div>
      </Card>

      <Card>
        <h3 className="mb-3 text-sm font-semibold">
          Add / update {mode === 'symbol' ? 'symbol' : 'sector'} target
        </h3>
        <AddTargetForm
          portfolioId={portfolioId}
          csrfToken={csrfToken}
          mode={mode}
          knownKeys={mode === 'sector' ? heldSectors : symbols}
        />
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold">Targets ({targetRows.length})</h3>
            {sumTargetPct > 100 ? (
              <p className="text-xs text-[var(--color-neg)]">
                Targets sum to {fmt(sumTargetPct, 1)}% — exceed 100%.
              </p>
            ) : sumTargetPct < 100 ? (
              <p className="text-xs text-[var(--color-muted)]">
                Implicit cash allocation: {fmt(cashPct, 1)}%
              </p>
            ) : (
              <p className="text-xs text-[var(--color-muted)]">Fully allocated.</p>
            )}
          </div>
          <a
            href={`/p/${portfolioId}/actions?section=rebalance&mode=${mode}&suggest=1`}
            className="inline-flex h-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent)] px-3.5 text-sm font-medium text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)]"
          >
            Suggest trades
          </a>
        </div>
        {targetRows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--color-muted)]">
            No targets yet. Add one above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                  <th className="px-5 py-3 text-left">{mode === 'symbol' ? 'Symbol' : 'Sector'}</th>
                  <th className="px-3 py-3 text-right">Target %</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {targetRows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-card-hover)]"
                  >
                    <td className="px-5 py-3 font-medium">{r.key}</td>
                    <td className="tnum px-3 py-3 text-right">{fmt(r.targetPct, 2)}</td>
                    <td className="px-5 py-3 text-right">
                      <DeleteTargetButton
                        portfolioId={portfolioId}
                        id={r.id}
                        csrfToken={csrfToken}
                      />
                    </td>
                  </tr>
                ))}
                {sumTargetPct < 100 ? (
                  <tr className="border-t border-[var(--color-border)] bg-[var(--color-card-hover)]">
                    <td className="px-5 py-3 text-[var(--color-muted)] italic">
                      Uninvested cash (residual)
                    </td>
                    <td className="tnum px-3 py-3 text-right text-[var(--color-muted)]">
                      {fmt(cashPct, 2)}
                    </td>
                    <td />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {suggest ? (
        <Card padded={false} className="overflow-hidden">
          <div className="border-b border-[var(--color-border)] px-5 py-4">
            <h3 className="text-sm font-semibold">Suggested trades ({actions.length})</h3>
            <p className="text-xs text-[var(--color-muted)]">
              Whole-share quantities at latest cached close. Tax impact not modeled.
            </p>
          </div>
          {actions.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-[var(--color-muted)]">
              No actions to display. Add some targets and click &quot;Suggest trades&quot;.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                    <th className="px-5 py-3 text-left">{mode === 'symbol' ? 'Symbol' : 'Key'}</th>
                    <th className="px-3 py-3 text-right">Current %</th>
                    <th className="px-3 py-3 text-right">Target %</th>
                    <th className="px-3 py-3 text-right">Δ %</th>
                    <th className="px-3 py-3 text-left">Action</th>
                    <th className="px-3 py-3 text-right">Qty</th>
                    <th className="px-3 py-3 text-right">Est ₹</th>
                    <th className="px-5 py-3 text-left">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {actions.map((a, idx) => {
                    const isChild = Boolean(a.parentSector);
                    return (
                      <tr
                        key={`${a.parentSector ?? ''}-${a.key}-${idx}`}
                        className={
                          'border-b border-[var(--color-border)] last:border-0 ' +
                          (isChild ? 'bg-[var(--color-card-hover)]/40' : '')
                        }
                      >
                        <td
                          className={
                            'px-5 py-3 ' +
                            (isChild ? 'pl-10 text-[var(--color-muted)]' : 'font-medium')
                          }
                        >
                          {a.key}
                        </td>
                        <td className="tnum px-3 py-3 text-right">{fmt(a.currentPct, 2)}</td>
                        <td className="tnum px-3 py-3 text-right">{fmt(a.targetPct, 2)}</td>
                        <td
                          className={
                            'tnum px-3 py-3 text-right ' +
                            (a.deltaPct > 0
                              ? 'text-[var(--color-pos)]'
                              : a.deltaPct < 0
                                ? 'text-[var(--color-neg)]'
                                : '')
                          }
                        >
                          {a.deltaPct > 0 ? '+' : ''}
                          {fmt(a.deltaPct, 2)}
                        </td>
                        <td className="px-3 py-3">
                          {a.action === 'buy' ? (
                            <Badge tone="pos">BUY</Badge>
                          ) : a.action === 'sell' ? (
                            <Badge tone="neg">SELL</Badge>
                          ) : (
                            <Badge tone="neutral">HOLD</Badge>
                          )}
                        </td>
                        <td className="tnum px-3 py-3 text-right">
                          {a.qtyChange !== 0 ? (a.qtyChange > 0 ? '+' : '') + a.qtyChange : '—'}
                        </td>
                        <td className="tnum px-3 py-3 text-right">
                          {a.estTradeValue !== 0 ? fmtInr(a.estTradeValue) : '—'}
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--color-muted)]">
                          {a.note ?? ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

function ModeLink({
  portfolioId,
  value,
  current,
  children,
}: {
  portfolioId: string;
  value: RebalanceMode;
  current: RebalanceMode;
  children: React.ReactNode;
}) {
  const active = value === current;
  return (
    <a
      href={`/p/${portfolioId}/actions?section=rebalance&mode=${value}`}
      className={
        'rounded-[6px] px-2.5 py-1.5 text-xs font-medium transition-colors ' +
        (active
          ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
          : 'text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]')
      }
    >
      {children}
    </a>
  );
}

function Metric({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'neg';
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-3">
      <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </div>
      <div
        className={
          'tnum mt-1 text-lg font-semibold ' + (tone === 'neg' ? 'text-[var(--color-neg)]' : '')
        }
      >
        {value}
      </div>
      {sub ? <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">{sub}</div> : null}
    </div>
  );
}

// ─── Tax Harvest section ─────────────────────────────────────────────────────

async function TaxHarvestSection({ portfolioId }: { portfolioId: string }) {
  const allTrades = getTradesForPortfolio(db, portfolioId);
  const deliveryTrades = allTrades.filter((t) => t.isIntradayPairId === null);
  const normalized = deliveryTrades.map(toNormalized);

  const prelimSymbols = Array.from(new Set(normalized.map((t) => t.symbol)));
  const priceRows = getLatestPrices(db, prelimSymbols);
  const priceMap = new Map<string, number>();
  for (const [sym, p] of priceRows) priceMap.set(sym, p.close);

  const asOfDate = new Date().toISOString().slice(0, 10);
  const { rows, bySymbol, totals } = computeTaxHarvest(
    normalized,
    KNOWN_CORPORATE_ACTIONS,
    priceMap,
    asOfDate,
  );

  const eligibleRows = rows
    .filter((r) => r.eligibility !== 'none')
    .sort((a, b) => a.potentialLoss - b.potentialLoss);

  const eligibleSymbols = bySymbol.filter((s) => s.totalLoss < 0);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-base font-semibold">Tax-Loss Harvesting</h2>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Open delivery lots currently in unrealized loss, classified for LTCL / STCL eligibility
          (Indian equity rules; ≥365d hold = long-term).
        </p>
      </div>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryTile
          label="Potential LTCL"
          value={totals.totalLtcl}
          sublabel={`${totals.ltclLotCount} lot${totals.ltclLotCount === 1 ? '' : 's'} · offsets LTCG`}
        />
        <SummaryTile
          label="Potential STCL"
          value={totals.totalStcl}
          sublabel={`${totals.stclLotCount} lot${totals.stclLotCount === 1 ? '' : 's'} · offsets STCG/LTCG`}
        />
        <SummaryTile
          label="Total Eligible Loss"
          value={totals.totalLoss}
          sublabel={`${totals.totalLotCount} eligible lot${totals.totalLotCount === 1 ? '' : 's'}`}
          bold
        />
      </section>

      <Card>
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-sm font-semibold text-[var(--color-accent)]">
            i
          </div>
          <div className="text-sm">
            <div className="font-medium">Re-buy window reminder</div>
            <p className="mt-1 text-[var(--color-muted)]">
              India does not have a formal wash-sale rule, but to claim a loss legitimately the
              position must actually settle in demat. Best practice: wait at least{' '}
              <span className="font-medium text-[var(--color-fg)]">one settlement day (T+1)</span>{' '}
              after the sell before repurchasing the same symbol. Avoid same-day buy/sell, which
              FIFO will treat as intraday and exclude from delivery-realized P&amp;L.
            </p>
            <p className="mt-2 text-xs text-[var(--color-muted)]">
              FY25-26: equity LTCG taxed at 12.5% above ₹1.25L; STCG at 20%. Equity capital losses
              can offset capital gains only (not other income); STCL offsets STCG or LTCG, LTCL
              offsets LTCG. As-of date: {asOfDate}.
            </p>
          </div>
        </div>
      </Card>

      {eligibleSymbols.length > 0 ? (
        <Card padded={false} className="overflow-hidden">
          <div className="border-b border-[var(--color-border)] px-5 py-4">
            <h3 className="text-sm font-semibold">By Symbol ({eligibleSymbols.length})</h3>
            <p className="text-xs text-[var(--color-muted)]">
              Roll-up of all loss-eligible lots per symbol.
            </p>
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-card)]">
                <tr className="border-b border-[var(--color-border)] text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                  <th className="px-5 py-3 text-left">Symbol</th>
                  <th className="px-3 py-3 text-right">Lots</th>
                  <th className="px-3 py-3 text-right">LTCL</th>
                  <th className="px-3 py-3 text-right">STCL</th>
                  <th className="px-5 py-3 text-right">Total Loss</th>
                </tr>
              </thead>
              <tbody>
                {eligibleSymbols.map((s) => (
                  <tr
                    key={s.symbol}
                    className="border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-card-hover)]"
                  >
                    <td className="px-5 py-3 font-medium">{s.symbol}</td>
                    <td className="tnum px-3 py-3 text-right">{s.lotCount}</td>
                    <td className="tnum px-3 py-3 text-right text-[var(--color-neg)]">
                      {s.ltclLoss < 0 ? fmtInr(s.ltclLoss) : '—'}
                    </td>
                    <td className="tnum px-3 py-3 text-right text-[var(--color-neg)]">
                      {s.stclLoss < 0 ? fmtInr(s.stclLoss) : '—'}
                    </td>
                    <td className="tnum px-5 py-3 text-right font-semibold text-[var(--color-neg)]">
                      {fmtInr(s.totalLoss)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col divide-y divide-[var(--color-border)] md:hidden">
            {eligibleSymbols.map((s) => (
              <li key={s.symbol} className="flex items-start justify-between gap-3 px-5 py-4">
                <div>
                  <div className="font-semibold">{s.symbol}</div>
                  <div className="text-xs text-[var(--color-muted)]">
                    {s.lotCount} lot{s.lotCount === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="tnum text-right text-sm font-semibold text-[var(--color-neg)]">
                  {fmtInr(s.totalLoss)}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h3 className="text-sm font-semibold">Eligible Lots ({eligibleRows.length})</h3>
          <p className="text-xs text-[var(--color-muted)]">
            FIFO-derived open lots with last-known close &lt; cost.
          </p>
        </div>
        {eligibleRows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--color-muted)]">
            No loss-eligible lots right now. (Either no open positions are below cost, or prices
            haven&apos;t been refreshed.)
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--color-card)]">
                  <tr className="border-b border-[var(--color-border)] text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                    <th className="px-5 py-3 text-left">Symbol</th>
                    <th className="px-3 py-3 text-right">Lot Date</th>
                    <th className="px-3 py-3 text-right">Qty</th>
                    <th className="px-3 py-3 text-right">Cost</th>
                    <th className="px-3 py-3 text-right">Last</th>
                    <th className="px-3 py-3 text-right">Loss</th>
                    <th className="px-3 py-3 text-right">Held</th>
                    <th className="px-5 py-3 text-right">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {eligibleRows.map((r, i) => (
                    <tr
                      key={`${r.symbol}-${r.lotDate}-${i}`}
                      className="border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-card-hover)]"
                    >
                      <td className="px-5 py-3 font-medium">{r.symbol}</td>
                      <td className="tnum px-3 py-3 text-right text-[var(--color-muted)]">
                        {r.lotDate}
                      </td>
                      <td className="tnum px-3 py-3 text-right">{fmt(r.qty, 0)}</td>
                      <td className="tnum px-3 py-3 text-right">₹{fmt(r.costPerShare)}</td>
                      <td className="tnum px-3 py-3 text-right">
                        {r.lastPrice != null ? `₹${fmt(r.lastPrice)}` : '—'}
                      </td>
                      <td className="tnum px-3 py-3 text-right font-semibold text-[var(--color-neg)]">
                        {fmtInr(r.potentialLoss)}
                      </td>
                      <td className="tnum px-3 py-3 text-right text-xs text-[var(--color-muted)]">
                        {r.daysHeld}d
                      </td>
                      <td className="px-5 py-3 text-right">
                        <EligibilityBadge row={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="flex flex-col divide-y divide-[var(--color-border)] md:hidden">
              {eligibleRows.map((r, i) => (
                <li
                  key={`${r.symbol}-${r.lotDate}-${i}`}
                  className="flex items-start justify-between gap-3 px-5 py-4"
                >
                  <div>
                    <div className="font-semibold">{r.symbol}</div>
                    <div className="tnum text-xs text-[var(--color-muted)]">
                      {r.lotDate} · {fmt(r.qty, 0)} qty · {r.daysHeld}d held
                    </div>
                    <div className="mt-1">
                      <EligibilityBadge row={r} />
                    </div>
                  </div>
                  <div className="tnum text-right text-sm font-semibold text-[var(--color-neg)]">
                    {fmtInr(r.potentialLoss)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

function EligibilityBadge({ row }: { row: HarvestRow }) {
  if (row.eligibility === 'LTCL') return <Badge tone="info">LTCL</Badge>;
  if (row.eligibility === 'STCL') return <Badge tone="warning">STCL</Badge>;
  return <Badge tone="neutral">—</Badge>;
}

function SummaryTile({
  label,
  value,
  sublabel,
  bold,
}: {
  label: string;
  value: number;
  sublabel?: string;
  bold?: boolean;
}) {
  const cls = value < 0 ? 'text-[var(--color-neg)]' : 'text-[var(--color-muted)]';
  return (
    <Card>
      <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </div>
      <div
        className={
          'tnum mt-1.5 ' + (bold ? 'text-2xl font-semibold' : 'text-xl font-semibold') + ' ' + cls
        }
      >
        {value < 0 ? fmtInr(value) : '—'}
      </div>
      {sublabel ? <div className="mt-1 text-xs text-[var(--color-muted)]">{sublabel}</div> : null}
    </Card>
  );
}

// ─── Candidates section ──────────────────────────────────────────────────────

function convictionTone(c: CandidateRow['convictionLevel']): 'pos' | 'info' | 'neutral' {
  if (c === 'high') return 'pos';
  if (c === 'medium') return 'info';
  return 'neutral';
}

function riskTone(r: CandidateRow['riskLevel']): 'pos' | 'warning' | 'neg' {
  if (r === 'low') return 'pos';
  if (r === 'medium') return 'warning';
  return 'neg';
}

function safeParseObject<T>(raw: string, fallback: T): T {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function formatRatio(value: number): string {
  if (Math.abs(value) > 0 && Math.abs(value) < 1) return `${(value * 100).toFixed(2)}%`;
  if (Math.abs(value) >= 1000) return value.toLocaleString('en-IN');
  return value.toFixed(2);
}

function formatRunAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

async function CandidatesSection({
  portfolioId,
  csrfToken,
  selectedRun,
}: {
  portfolioId: string;
  csrfToken: string;
  selectedRun?: string;
}) {
  const runs = listCandidateRuns(db, portfolioId);
  const selectedRunId =
    typeof selectedRun === 'string' && runs.some((r) => r.runId === selectedRun)
      ? selectedRun
      : (runs[0]?.runId ?? undefined);

  const rows = selectedRunId ? listCandidates(db, portfolioId, { runId: selectedRunId }) : [];
  const fetchCmd = `/idea-generate ${portfolioId}`;

  return (
    <div className="flex flex-col gap-5">
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Candidates</h2>
            <p className="text-xs text-[var(--color-muted)]">
              Idea-generator outputs from the{' '}
              <code className="rounded bg-[var(--color-card-hover)] px-1.5 py-0.5 font-mono text-[10px]">
                idea-generate
              </code>{' '}
              skill. {runs.length} run{runs.length === 1 ? '' : 's'} on file.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CopyFetchCommandButton portfolioId={portfolioId} />
            <ImportCandidatesButton portfolioId={portfolioId} csrfToken={csrfToken} />
          </div>
        </div>

        {runs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-5 py-3">
            <span className="text-xs text-[var(--color-muted)]">Run:</span>
            {runs.map((r) => {
              const active = r.runId === selectedRunId;
              const href =
                `/p/${portfolioId}/actions?section=candidates&run=${encodeURIComponent(r.runId)}` as Route;
              return (
                <Link
                  key={r.runId}
                  href={href}
                  className={
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ' +
                    (active
                      ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]')
                  }
                >
                  {r.runId}
                  <span className="ml-1.5 text-[10px] text-[var(--color-subtle)]">
                    {formatRunAt(r.runAt)} · {r.count}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : null}

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <p className="text-sm font-medium">No candidates yet</p>
            <p className="max-w-md text-xs text-[var(--color-muted)]">
              Run the{' '}
              <code className="rounded bg-[var(--color-card-hover)] px-1.5 py-0.5 font-mono text-[10px]">
                {fetchCmd}
              </code>{' '}
              skill, or drop a JSON file under{' '}
              <code className="rounded bg-[var(--color-card-hover)] px-1.5 py-0.5 font-mono text-[10px]">
                data/research/_portfolio/{portfolioId}/idea-generate/
              </code>{' '}
              and click Re-import from files.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-0 divide-y divide-[var(--color-border)]">
            {rows.map((c) => {
              const ratios = safeParseObject<Record<string, number>>(c.keyRatiosJson, {});
              const codexRules = safeParseObject<string[]>(c.matchingCodexRulesJson, []);
              const symbolHref =
                `/p/${portfolioId}/symbol/${encodeURIComponent(c.symbol)}` as Route;
              return (
                <li
                  key={c.id}
                  className="flex flex-col gap-3 px-5 py-5 transition-colors hover:bg-[var(--color-card-hover)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Link
                          href={symbolHref}
                          className="text-base font-semibold tracking-tight hover:underline"
                        >
                          {c.symbol}
                        </Link>
                        <span className="text-sm text-[var(--color-muted)]">{c.name}</span>
                        <Badge tone={convictionTone(c.convictionLevel)}>
                          {c.convictionLevel} conviction
                        </Badge>
                        <Badge tone={riskTone(c.riskLevel)}>{c.riskLevel} risk</Badge>
                      </div>
                      {c.thesisMd ? (
                        <p className="mt-1 max-w-3xl text-sm leading-relaxed whitespace-pre-line text-[var(--color-fg)]">
                          {c.thesisMd}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <PromoteButton
                        portfolioId={portfolioId}
                        candidateId={c.id}
                        csrfToken={csrfToken}
                      />
                      <Link
                        href={symbolHref}
                        className="text-xs text-[var(--color-muted)] underline-offset-2 hover:underline"
                      >
                        View symbol →
                      </Link>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
                    {Object.keys(ratios).length > 0 ? (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="tracking-wider text-[var(--color-subtle)] uppercase">
                          Key ratios
                        </span>
                        {Object.entries(ratios).map(([k, v]) => (
                          <span key={k} className="text-[var(--color-fg)]">
                            <span className="text-[var(--color-muted)]">{k}</span>{' '}
                            <span className="font-mono">{formatRatio(v)}</span>
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {(c.entryFair !== null || c.entryStrong !== null) && (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="tracking-wider text-[var(--color-subtle)] uppercase">
                          Entry zones
                        </span>
                        {c.entryFair !== null ? (
                          <span>
                            <span className="text-[var(--color-muted)]">fair</span>{' '}
                            <span className="font-mono">{c.entryFair}</span>
                          </span>
                        ) : null}
                        {c.entryStrong !== null ? (
                          <span>
                            <span className="text-[var(--color-muted)]">strong buy</span>{' '}
                            <span className="font-mono">{c.entryStrong}</span>
                          </span>
                        ) : null}
                      </div>
                    )}

                    {codexRules.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="tracking-wider text-[var(--color-subtle)] uppercase">
                          Codex rules
                        </span>
                        {codexRules.map((r) => (
                          <Badge key={r} tone="info">
                            {r}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ─── Style Mixer section ─────────────────────────────────────────────────────

const NAME_BY_SLUG: Record<string, string> = {
  buffett: 'Warren Buffett',
  agrawal: 'Raamdeo Agrawal',
  marks: 'Howard Marks',
  damodaran: 'Aswath Damodaran',
  lynch: 'Peter Lynch',
  munger: 'Charlie Munger',
  pabrai: 'Mohnish Pabrai',
  mukherjea: 'Saurabh Mukherjea',
  greenblatt: 'Joel Greenblatt',
  graham: 'Benjamin Graham',
  'sankaran-naren': 'Sankaran Naren',
  'pulak-prasad': 'Pulak Prasad',
};

const FRAMEWORK_TO_SLUG: Record<string, string> = {
  agrawal: 'agrawal',
  greenblatt: 'greenblatt',
  graham: 'graham',
  lynch: 'lynch',
  mukherjea: 'mukherjea',
  naren: 'sankaran-naren',
  prasad: 'pulak-prasad',
};

type BacktestSummary = {
  decision_dates?: string[];
  frameworks?: Record<string, { xirr?: number; benchmark_vs_nifty50_xirr_delta?: number }>;
};

function loadBacktestSummary(): BacktestSummary | null {
  const p = 'data/codex/backtests/results/summary.json';
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as BacktestSummary;
  } catch {
    return null;
  }
}

async function StyleMixerSection({
  portfolioId,
  csrfToken,
}: {
  portfolioId: string;
  csrfToken: string;
}) {
  const lib = loadLatestRuleLibrary();
  const stored = getStyleWeights(db, portfolioId) ?? {};
  const summary = loadBacktestSummary();

  const investorSlugs = new Set<string>();
  const schoolsBySlug = new Map<string, Set<string>>();
  if (lib) {
    for (const r of lib.rules) {
      for (const s of r.supporting_investors) {
        investorSlugs.add(s.investor);
        const schools = schoolsBySlug.get(s.investor) ?? new Set<string>();
        for (const sc of (r as { schools?: string[] }).schools ?? []) schools.add(sc);
        schoolsBySlug.set(s.investor, schools);
      }
    }
  }

  const xirrBySlug = new Map<string, { xirr: number; alpha: number; cycles: number }>();
  if (summary?.frameworks) {
    for (const [fk, fv] of Object.entries(summary.frameworks)) {
      const slug = FRAMEWORK_TO_SLUG[fk];
      if (!slug || !fv) continue;
      xirrBySlug.set(slug, {
        xirr: fv.xirr ?? 0,
        alpha: fv.benchmark_vs_nifty50_xirr_delta ?? 0,
        cycles: summary.decision_dates?.length ?? 0,
      });
    }
  }

  const investors: InvestorRow[] = [...investorSlugs].sort().map((slug) => ({
    slug,
    name: NAME_BY_SLUG[slug] ?? slug,
    schools: [...(schoolsBySlug.get(slug) ?? [])].sort(),
    backtest: xirrBySlug.get(slug) ?? null,
  }));

  const autoWeights: Record<string, number> = {};
  let total = 0;
  for (const inv of investors) {
    const w = inv.backtest ? Math.max(0, inv.backtest.xirr) : 0.05;
    autoWeights[inv.slug] = w;
    total += w;
  }
  if (total > 0) {
    for (const k of Object.keys(autoWeights)) {
      const cur = autoWeights[k] ?? 0;
      autoWeights[k] = Number((cur / total).toFixed(3));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
            <Sparkle size={18} />
          </div>
          <div>
            <h2 className="text-base font-semibold">Style Mixer</h2>
            <p className="mt-0.5 text-sm text-[var(--color-muted)]">
              Tune how strongly each investor&apos;s voice influences your Recommendations. Rules
              supported by investors you weight higher get a multiplier on their score. Use{' '}
              <span className="font-medium">Auto-weight by backtest XIRR</span> to pre-fill from
              4-cycle Indian-equity backtests.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        {investors.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            No rule library loaded. Run the codex pipeline first.
          </p>
        ) : (
          <SliderForm
            portfolioId={portfolioId}
            csrfToken={csrfToken}
            investors={investors}
            initialWeights={stored}
            autoWeights={autoWeights}
          />
        )}
      </Card>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default async function ActionsPage({ params, searchParams }: Props) {
  const { portfolioId } = await params;
  const sp = await searchParams;

  const rawSection = sp.section ?? 'rebalance';
  const section: Section = (
    ['rebalance', 'tax-harvest', 'candidates', 'style-mixer'] as const
  ).includes(rawSection as Section)
    ? (rawSection as Section)
    : 'rebalance';

  const session = await getSession();
  const csrfToken = session?.csrfToken ?? '';

  return (
    <div className="flex flex-col gap-5">
      <SubNav portfolioId={portfolioId} current={section} />

      {section === 'rebalance' ? (
        <RebalanceSection
          portfolioId={portfolioId}
          csrfToken={csrfToken}
          mode={sp.mode === 'sector' ? 'sector' : 'symbol'}
          suggest={sp.suggest === '1'}
        />
      ) : section === 'tax-harvest' ? (
        <TaxHarvestSection portfolioId={portfolioId} />
      ) : section === 'candidates' ? (
        <CandidatesSection portfolioId={portfolioId} csrfToken={csrfToken} selectedRun={sp.run} />
      ) : (
        <StyleMixerSection portfolioId={portfolioId} csrfToken={csrfToken} />
      )}
    </div>
  );
}
