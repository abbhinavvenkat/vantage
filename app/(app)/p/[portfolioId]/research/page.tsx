import Link from 'next/link';
import type { Route } from 'next';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { computeOpenPositions } from '@/lib/analytics/fifoHoldings';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { listEvents, type EventRow } from '@/lib/db/queries/events';
import {
  listEvents as listAlertEvents,
  listRules,
  type AlertEvent as AlertEventRow,
} from '@/lib/db/queries/alerts';
import { listFilings, type FilingRow } from '@/lib/db/queries/filings';
import { listNews, type NewsRow } from '@/lib/db/queries/news';
import { getLatestPrices } from '@/lib/db/queries/prices';
import { listTheses, reviewStatus } from '@/lib/db/queries/theses';
import { getTradesForPortfolio, type Trade } from '@/lib/db/queries/trades';
import { listWatchlist } from '@/lib/db/queries/watchlist';
import { FILING_TRIAGES, type FilingTriage } from '@/lib/db/schema';
import type { AlertRuleType } from '@/lib/db/schema';
import { getSector, UNCLASSIFIED } from '@/lib/sectors/map';
import { EVENT_TYPE_LABEL, type EventType } from '@/lib/validation/events';
import type { NormalizedTrade } from '@/lib/parsers/types';

import { AckButton } from '../alerts/AckButton';
import { AddRuleForm } from '../alerts/AddRuleForm';
import { EvaluateButton } from '../alerts/EvaluateButton';
import { RuleActions } from '../alerts/RuleActions';
import { AddEventForm } from '../events/AddEventForm';
import { DeleteEventButton } from '../events/DeleteEventButton';
import { EventsFetchButtons } from '../events/EventsFetchButtons';
import { MarkReadToggle as FilingMarkReadToggle } from '../filings/MarkReadToggle';
import { RefreshFilingsButton } from '../filings/RefreshFilingsButton';
import { MarkReadToggle as NewsMarkReadToggle } from '../news/MarkReadToggle';
import { NewsFetchButtons } from '../news/NewsFetchButtons';
import { AddWatchlistForm } from '../watchlist/AddWatchlistForm';
import { RemoveButton } from '../watchlist/RemoveButton';

// ── shared helpers ────────────────────────────────────────────────────────────

function toNorm(t: Trade, i: number): NormalizedTrade {
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

function fmt(n: number, d = 2) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

function getHeldAndWatchSymbols(portfolioId: string): string[] {
  const trades = getTradesForPortfolio(db, portfolioId);
  const normalized = trades.filter((t) => t.isIntradayPairId === null).map(toNorm);
  const held = computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS).map((p) => p.symbol);
  const watch = listWatchlist(db, portfolioId).map((w) => w.symbol);
  return Array.from(new Set([...held, ...watch])).sort();
}

// ── sub-nav ───────────────────────────────────────────────────────────────────

const SECTIONS = [
  { label: 'Theses', key: 'theses' },
  { label: 'Watchlist', key: 'watchlist' },
  { label: 'News', key: 'news' },
  { label: 'Filings', key: 'filings' },
  { label: 'Events', key: 'events' },
  { label: 'Alerts', key: 'alerts' },
];

function SubNav({ portfolioId, active }: { portfolioId: string; active: string }) {
  return (
    <nav className="flex gap-0 overflow-x-auto border-b border-[var(--color-border)]">
      {SECTIONS.map((s) => (
        <Link
          key={s.key}
          href={`/p/${portfolioId}/research?section=${s.key}`}
          className={[
            'shrink-0 px-4 py-2 text-sm font-medium whitespace-nowrap transition',
            active === s.key
              ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-fg)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]',
          ].join(' ')}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

type Props = {
  params: Promise<{ portfolioId: string }>;
  searchParams: Promise<{
    section?: string;
    // news
    tab?: string;
    symbol?: string;
    sector?: string;
    f?: string;
    // events
    view?: string;
    range?: string;
    // alerts
    filter?: string;
  }>;
};

export default async function ResearchPage({ params, searchParams }: Props) {
  const { portfolioId } = await params;
  const sp = await searchParams;
  const section = SECTIONS.some((s) => s.key === sp.section) ? (sp.section ?? 'theses') : 'theses';
  const session = await getSession();
  const csrfToken = session?.csrfToken ?? '';

  return (
    <div className="flex flex-col gap-5">
      <SubNav portfolioId={portfolioId} active={section} />
      {section === 'theses' && <ThesesSection portfolioId={portfolioId} />}
      {section === 'watchlist' && (
        <WatchlistSection portfolioId={portfolioId} csrfToken={csrfToken} />
      )}
      {section === 'news' && (
        <NewsSection
          portfolioId={portfolioId}
          csrfToken={csrfToken}
          rawTab={sp.tab}
          symbolFilter={
            typeof sp.symbol === 'string' && sp.symbol.length > 0 ? sp.symbol : undefined
          }
          sectorFilter={
            typeof sp.sector === 'string' && sp.sector.length > 0 ? sp.sector : undefined
          }
          rawFilter={sp.f}
        />
      )}
      {section === 'filings' && (
        <FilingsSection
          portfolioId={portfolioId}
          csrfToken={csrfToken}
          rawFilter={sp.f}
          symbolFilter={
            typeof sp.symbol === 'string' && sp.symbol.length > 0 ? sp.symbol : undefined
          }
        />
      )}
      {section === 'events' && (
        <EventsSection
          portfolioId={portfolioId}
          csrfToken={csrfToken}
          rawView={sp.view}
          rawRange={sp.range}
        />
      )}
      {section === 'alerts' && (
        <AlertsSection portfolioId={portfolioId} csrfToken={csrfToken} rawFilter={sp.filter} />
      )}
    </div>
  );
}

// ── Theses ────────────────────────────────────────────────────────────────────

const STATUS_ORDER: Record<string, number> = {
  overdue: 0,
  due_soon: 1,
  unscheduled: 2,
  up_to_date: 3,
};

async function ThesesSection({ portfolioId }: { portfolioId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = listTheses(db, portfolioId).map((t) => ({
    thesis: t,
    status: reviewStatus(
      { targetReviewDate: t.targetReviewDate, lastReviewedAt: t.lastReviewedAt },
      today,
    ),
  }));
  rows.sort((a, b) => {
    const ao = STATUS_ORDER[a.status.status] ?? 99;
    const bo = STATUS_ORDER[b.status.status] ?? 99;
    return ao !== bo ? ao - bo : (a.status.days ?? 0) - (b.status.days ?? 0);
  });

  return (
    <Card padded={false}>
      <div className="border-b border-[var(--color-border)] px-5 py-4">
        <h2 className="text-base font-semibold">Thesis tracker</h2>
        <p className="text-xs text-[var(--color-muted)]">
          One thesis per holding · auto-prompts for re-review every 90 days
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-[var(--color-muted)]">
          No theses yet. Open a holding and write one.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-card)]">
            <tr className="border-b border-[var(--color-border)] text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
              <th className="px-5 py-3 text-left">Symbol</th>
              <th className="px-3 py-3 text-left">Status</th>
              <th className="px-3 py-3 text-left">Entry</th>
              <th className="px-3 py-3 text-left">Last reviewed</th>
              <th className="px-3 py-3 text-left">Target review</th>
              <th className="px-5 py-3 text-right">Checklist</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ thesis, status }) => (
              <tr
                key={thesis.id}
                className="border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-card-hover)]"
              >
                <td className="px-5 py-3">
                  <Link
                    href={`/p/${portfolioId}/symbol/${encodeURIComponent(thesis.symbol)}`}
                    className="font-medium hover:underline"
                  >
                    {thesis.symbol}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <Badge
                    tone={
                      status.status === 'overdue'
                        ? 'neg'
                        : status.status === 'due_soon'
                          ? 'warning'
                          : status.status === 'up_to_date'
                            ? 'pos'
                            : 'neutral'
                    }
                  >
                    {status.status === 'overdue'
                      ? `Overdue ${-(status.days ?? 0)}d`
                      : status.status === 'due_soon'
                        ? `Due in ${status.days}d`
                        : status.status === 'unscheduled'
                          ? 'Unscheduled'
                          : `${status.days}d`}
                  </Badge>
                </td>
                <td className="tnum px-3 py-3 text-[var(--color-muted)]">
                  {thesis.entryDate ?? '—'}
                </td>
                <td className="tnum px-3 py-3 text-[var(--color-muted)]">
                  {thesis.lastReviewedAt ?? '—'}
                </td>
                <td className="tnum px-3 py-3 text-[var(--color-muted)]">
                  {thesis.targetReviewDate ?? '—'}
                </td>
                <td className="tnum px-5 py-3 text-right">
                  {Array.isArray(thesis.checklistJson) ? thesis.checklistJson.length : 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

function convictionTone(c: 'high' | 'medium' | 'low'): 'pos' | 'info' | 'neutral' {
  if (c === 'high') return 'pos';
  if (c === 'medium') return 'info';
  return 'neutral';
}

async function WatchlistSection({
  portfolioId,
  csrfToken,
}: {
  portfolioId: string;
  csrfToken: string;
}) {
  const entries = listWatchlist(db, portfolioId);
  const prices = getLatestPrices(
    db,
    entries.map((e) => e.symbol),
  );

  function pct(n: number) {
    return `${n >= 0 ? '+' : ''}${fmt(n, 2)}%`;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="mb-4">
          <h2 className="text-sm font-semibold">Add to watchlist</h2>
          <p className="text-xs text-[var(--color-muted)]">
            Track symbols you don&apos;t hold yet — with thesis, targets, and conviction.
          </p>
        </div>
        <AddWatchlistForm portfolioId={portfolioId} csrfToken={csrfToken} />
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Watchlist ({entries.length})</h2>
            <p className="text-xs text-[var(--color-muted)]">
              Symbols on your radar with target prices
            </p>
          </div>
        </div>
        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <p className="text-sm font-medium">No symbols on the watchlist yet</p>
            <p className="text-xs text-[var(--color-muted)]">
              Add a symbol above to start tracking ideas you don&apos;t hold yet.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--color-card)]">
                  <tr className="border-b border-[var(--color-border)] text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                    <th className="px-5 py-3 text-left">Symbol</th>
                    <th className="px-3 py-3 text-left">Conviction</th>
                    <th className="px-3 py-3 text-right">CMP</th>
                    <th className="px-3 py-3 text-right">Target Buy</th>
                    <th className="px-3 py-3 text-right">Δ vs Buy</th>
                    <th className="px-3 py-3 text-right">Target Sell</th>
                    <th className="px-3 py-3 text-left">Thesis</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => {
                    const p = prices.get(e.symbol);
                    const cmp = p?.close ?? null;
                    const buyDelta =
                      cmp != null && e.targetBuyPrice != null && e.targetBuyPrice > 0
                        ? ((cmp - e.targetBuyPrice) / e.targetBuyPrice) * 100
                        : null;
                    const buyHit =
                      cmp != null && e.targetBuyPrice != null && cmp <= e.targetBuyPrice;
                    const sellHit =
                      cmp != null && e.targetSellPrice != null && cmp >= e.targetSellPrice;
                    return (
                      <tr
                        key={e.id}
                        className="group border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-card-hover)]"
                      >
                        <td className="px-5 py-3 font-medium">
                          <Link
                            href={`/p/${portfolioId}/symbol/${encodeURIComponent(e.symbol)}`}
                            className="hover:text-[var(--color-accent)]"
                          >
                            {e.symbol}
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone={convictionTone(e.conviction)}>{e.conviction}</Badge>
                        </td>
                        <td className="tnum px-3 py-3 text-right">
                          {cmp != null ? (
                            <span title={p?.date ?? ''}>₹{fmt(cmp)}</span>
                          ) : (
                            <span className="text-[var(--color-subtle)]">—</span>
                          )}
                        </td>
                        <td className="tnum px-3 py-3 text-right">
                          {e.targetBuyPrice != null ? `₹${fmt(e.targetBuyPrice)}` : '—'}
                        </td>
                        <td
                          className={`tnum px-3 py-3 text-right ${buyHit ? 'font-medium text-[var(--color-pos)]' : buyDelta != null ? 'text-[var(--color-muted)]' : 'text-[var(--color-subtle)]'}`}
                        >
                          {buyHit ? 'BUY ZONE' : buyDelta != null ? pct(buyDelta) : '—'}
                        </td>
                        <td
                          className={`tnum px-3 py-3 text-right ${sellHit ? 'font-medium text-[var(--color-neg)]' : ''}`}
                        >
                          {e.targetSellPrice != null ? `₹${fmt(e.targetSellPrice)}` : '—'}
                          {sellHit ? ' ⚠' : ''}
                        </td>
                        <td className="max-w-[280px] truncate px-3 py-3 text-[var(--color-muted)]">
                          {e.thesis ?? <span className="text-[var(--color-subtle)]">—</span>}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <RemoveButton
                            portfolioId={portfolioId}
                            entryId={e.id}
                            symbol={e.symbol}
                            csrfToken={csrfToken}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <ul className="flex flex-col divide-y divide-[var(--color-border)] md:hidden">
              {entries.map((e) => {
                const p = prices.get(e.symbol);
                const cmp = p?.close ?? null;
                const buyHit = cmp != null && e.targetBuyPrice != null && cmp <= e.targetBuyPrice;
                const sellHit =
                  cmp != null && e.targetSellPrice != null && cmp >= e.targetSellPrice;
                return (
                  <li key={e.id} className="flex flex-col gap-2 px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Link
                            href={`/p/${portfolioId}/symbol/${encodeURIComponent(e.symbol)}`}
                            className="truncate font-semibold hover:text-[var(--color-accent)]"
                          >
                            {e.symbol}
                          </Link>
                          <Badge tone={convictionTone(e.conviction)}>{e.conviction}</Badge>
                        </div>
                        <div className="tnum mt-1 text-xs text-[var(--color-muted)]">
                          CMP {cmp != null ? `₹${fmt(cmp)}` : '—'} ·{' '}
                          {e.targetBuyPrice != null
                            ? `Buy ₹${fmt(e.targetBuyPrice)}`
                            : 'No buy tgt'}{' '}
                          ·{' '}
                          {e.targetSellPrice != null
                            ? `Sell ₹${fmt(e.targetSellPrice)}`
                            : 'No sell tgt'}
                        </div>
                        {buyHit && (
                          <div className="mt-1 text-xs font-medium text-[var(--color-pos)]">
                            In buy zone
                          </div>
                        )}
                        {sellHit && (
                          <div className="mt-1 text-xs font-medium text-[var(--color-neg)]">
                            At/above sell target
                          </div>
                        )}
                        {e.thesis && (
                          <div className="mt-2 line-clamp-3 text-xs text-[var(--color-muted)]">
                            {e.thesis}
                          </div>
                        )}
                      </div>
                      <RemoveButton
                        portfolioId={portfolioId}
                        entryId={e.id}
                        symbol={e.symbol}
                        csrfToken={csrfToken}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

// ── News ──────────────────────────────────────────────────────────────────────

type NewsTab = 'symbol' | 'sector';
type NewsFilter = 'all' | 'unread';

function formatPublished(s: string | null) {
  if (!s) return 'Unknown date';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function NewsSection({
  portfolioId,
  csrfToken,
  rawTab,
  symbolFilter,
  sectorFilter,
  rawFilter,
}: {
  portfolioId: string;
  csrfToken: string;
  rawTab?: string;
  symbolFilter?: string;
  sectorFilter?: string;
  rawFilter?: string;
}) {
  const tab: NewsTab = rawTab === 'sector' ? 'sector' : 'symbol';
  const filter: NewsFilter = rawFilter === 'unread' ? 'unread' : 'all';
  const portfolioSymbols = getHeldAndWatchSymbols(portfolioId);
  const allRows = listNews(db, portfolioId);
  const newsSymbols = Array.from(new Set(allRows.map((r) => r.symbol))).sort();
  const symbolChips = Array.from(new Set([...portfolioSymbols, ...newsSymbols])).sort();
  const sectorSet = new Set<string>();
  for (const s of symbolChips) sectorSet.add(getSector(s));
  const sectorChips = Array.from(sectorSet).sort();

  let rows: NewsRow[] = allRows;
  if (filter === 'unread') rows = rows.filter((r) => r.isRead === 0);
  if (tab === 'symbol' && symbolFilter) rows = rows.filter((r) => r.symbol === symbolFilter);
  if (tab === 'sector' && sectorFilter)
    rows = rows.filter((r) => getSector(r.symbol) === sectorFilter);
  const unreadCount = allRows.filter((r) => r.isRead === 0).length;

  const base = `/p/${portfolioId}/research`;
  function chipHref(next: {
    tab?: NewsTab;
    symbol?: string | null;
    sector?: string | null;
    f?: NewsFilter;
  }): Route {
    const qs = new URLSearchParams({ section: 'news' });
    const t = next.tab ?? tab;
    if (t !== 'symbol') qs.set('tab', t);
    const sym = next.symbol === undefined ? symbolFilter : (next.symbol ?? undefined);
    const sec = next.sector === undefined ? sectorFilter : (next.sector ?? undefined);
    if (t === 'symbol' && sym) qs.set('symbol', sym);
    if (t === 'sector' && sec) qs.set('sector', sec);
    const ff = next.f ?? filter;
    if (ff !== 'all') qs.set('f', ff);
    return `${base}?${qs.toString()}` as Route;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="mb-4">
          <h2 className="text-sm font-semibold">News feed</h2>
          <p className="text-xs text-[var(--color-muted)]">
            Recent headlines per symbol from Google News. Filter by symbol or sector.
          </p>
        </div>
        <NewsFetchButtons
          portfolioId={portfolioId}
          csrfToken={csrfToken}
          symbols={portfolioSymbols}
        />
      </Card>
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Headlines ({rows.length})</h2>
            <p className="text-xs text-[var(--color-muted)]">{unreadCount} unread.</p>
          </div>
          <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] p-0.5">
            {(['symbol', 'sector'] as NewsTab[]).map((t) => (
              <Link
                key={t}
                href={chipHref({ tab: t, symbol: null, sector: null })}
                className={`rounded-[6px] px-2.5 py-1 text-xs font-medium capitalize transition-colors ${t === tab ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'}`}
              >
                By {t}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-5 py-3">
          {(['all', 'unread'] as NewsFilter[]).map((f) => (
            <Link
              key={f}
              href={chipHref({ f })}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${f === filter ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]'}`}
            >
              {f === 'all' ? 'All' : 'Unread'}
            </Link>
          ))}
          <span className="ml-2 hidden h-4 w-px bg-[var(--color-border)] sm:inline-block" />
          {tab === 'symbol' ? (
            <>
              <Link
                href={chipHref({ tab: 'symbol', symbol: null })}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${!symbolFilter ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]'}`}
              >
                All symbols
              </Link>
              {symbolChips.map((s) => {
                const active = s === symbolFilter;
                return (
                  <Link
                    key={s}
                    href={chipHref({ tab: 'symbol', symbol: active ? null : s })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]'}`}
                  >
                    {s}
                  </Link>
                );
              })}
            </>
          ) : (
            <>
              <Link
                href={chipHref({ tab: 'sector', sector: null })}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${!sectorFilter ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]'}`}
              >
                All sectors
              </Link>
              {sectorChips.map((sec) => {
                const active = sec === sectorFilter;
                return (
                  <Link
                    key={sec}
                    href={chipHref({ tab: 'sector', sector: active ? null : sec })}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]'}`}
                  >
                    {sec}
                  </Link>
                );
              })}
            </>
          )}
        </div>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <p className="text-sm font-medium">No news yet.</p>
            <p className="max-w-md text-xs text-[var(--color-muted)]">
              Copy the <code className="font-mono">/news-fetch …</code> command above and run it in
              Claude Code.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)]">
            {rows.map((r) => {
              const sector = getSector(r.symbol);
              return (
                <li
                  key={r.id}
                  className={`flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-[var(--color-card-hover)] ${r.isRead ? 'opacity-70' : ''}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone="neutral">{r.symbol}</Badge>
                        {sector !== UNCLASSIFIED && <Badge tone="info">{sector}</Badge>}
                        {r.source && (
                          <span className="text-[11px] text-[var(--color-muted)]">{r.source}</span>
                        )}
                        {!r.isRead && (
                          <span
                            className="inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]"
                            aria-label="unread"
                          />
                        )}
                      </div>
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={`block truncate text-sm hover:underline ${r.isRead ? 'text-[var(--color-muted)]' : 'font-medium text-[var(--color-fg)]'}`}
                      >
                        {r.title}
                      </a>
                      <div className="mt-1 text-[11px] text-[var(--color-subtle)]">
                        {formatPublished(r.publishedAt)}
                      </div>
                    </div>
                    <div className="shrink-0">
                      <NewsMarkReadToggle
                        portfolioId={portfolioId}
                        newsId={r.id}
                        isRead={r.isRead === 1}
                        csrfToken={csrfToken}
                      />
                    </div>
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

// ── Filings ───────────────────────────────────────────────────────────────────

const FILTERS_FILING = ['unread', 'all', ...FILING_TRIAGES] as const;
type FilingFilter = (typeof FILTERS_FILING)[number];

function isFilingFilter(v: unknown): v is FilingFilter {
  return typeof v === 'string' && (FILTERS_FILING as readonly string[]).includes(v);
}
function triageTone(t: FilingTriage | null): 'pos' | 'info' | 'neutral' | 'warning' {
  if (t === 'read_now') return 'warning';
  if (t === 'skim') return 'info';
  return 'neutral';
}
function filingTypeLabel(t: FilingRow['filingType']) {
  switch (t) {
    case 'annual_report':
      return 'Annual';
    case 'quarterly_results':
      return 'Quarterly';
    case 'announcement':
      return 'Announcement';
    case 'investor_presentation':
      return 'Presentation';
    default:
      return 'Other';
  }
}

async function FilingsSection({
  portfolioId,
  csrfToken,
  rawFilter,
  symbolFilter,
}: {
  portfolioId: string;
  csrfToken: string;
  rawFilter?: string;
  symbolFilter?: string;
}) {
  const filter: FilingFilter = isFilingFilter(rawFilter) ? rawFilter : 'unread';
  const predicate =
    filter === 'all'
      ? {}
      : filter === 'unread'
        ? { isRead: false }
        : { triage: filter as FilingTriage };
  const rows = listFilings(db, portfolioId, {
    ...predicate,
    ...(symbolFilter ? { symbol: symbolFilter } : {}),
  });
  const allRows = listFilings(db, portfolioId);
  const knownSymbols = Array.from(new Set(allRows.map((r) => r.symbol))).sort();
  const unreadCount = allRows.filter((r) => !r.isRead).length;

  const base = `/p/${portfolioId}/research`;
  function chipHref(f: FilingFilter, sym?: string): Route {
    const qs = new URLSearchParams({ section: 'filings', f });
    if (sym) qs.set('symbol', sym);
    return `${base}?${qs.toString()}` as Route;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Filings inbox</h2>
            <p className="text-xs text-[var(--color-muted)]">
              BSE/NSE announcements with triage tags from the{' '}
              <code className="rounded bg-[var(--color-card-hover)] px-1.5 py-0.5 font-mono text-[10px]">
                filings-triage
              </code>{' '}
              skill. {unreadCount} unread.
            </p>
          </div>
          <RefreshFilingsButton portfolioId={portfolioId} csrfToken={csrfToken} />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-5 py-3">
          {FILTERS_FILING.map((f) => (
            <Link
              key={f}
              href={chipHref(f, symbolFilter)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${f === filter ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]'}`}
            >
              {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : f}
            </Link>
          ))}
          {knownSymbols.length > 0 && (
            <span className="ml-2 hidden h-4 w-px bg-[var(--color-border)] sm:inline-block" />
          )}
          {knownSymbols.map((s) => {
            const active = s === symbolFilter;
            return (
              <Link
                key={s}
                href={chipHref(filter, active ? undefined : s)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${active ? 'border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]'}`}
              >
                {s}
              </Link>
            );
          })}
          {symbolFilter && (
            <Link
              href={`${base}?section=filings&f=${filter}` as Route}
              className="text-xs text-[var(--color-muted)] underline-offset-2 hover:underline"
            >
              clear symbol
            </Link>
          )}
        </div>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <p className="text-sm font-medium">No filings here</p>
            <p className="max-w-md text-xs text-[var(--color-muted)]">
              Drop a <code className="font-mono">filings-triage</code> JSON and click Refresh.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)]">
            {rows.map((r) => (
              <li
                key={r.id}
                className={`flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-[var(--color-card-hover)] ${r.isRead ? 'opacity-70' : ''}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">{r.symbol}</Badge>
                      <Badge tone="neutral">{filingTypeLabel(r.filingType)}</Badge>
                      {r.triage && <Badge tone={triageTone(r.triage)}>{r.triage}</Badge>}
                      {!r.isRead && (
                        <span
                          className="inline-block h-2 w-2 rounded-full bg-[var(--color-accent)]"
                          aria-label="unread"
                        />
                      )}
                    </div>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={`block truncate text-sm hover:underline ${r.isRead ? 'text-[var(--color-muted)]' : 'font-medium text-[var(--color-fg)]'}`}
                    >
                      {r.title}
                    </a>
                    {r.summaryOneLine && (
                      <p className="mt-1 line-clamp-2 text-xs text-[var(--color-muted)]">
                        {r.summaryOneLine}
                      </p>
                    )}
                    <div className="mt-1 text-[11px] text-[var(--color-subtle)]">
                      {r.publishedAt ? `Published ${r.publishedAt}` : 'Unknown date'}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <FilingMarkReadToggle
                      portfolioId={portfolioId}
                      filingId={r.id}
                      isRead={r.isRead === 1}
                      csrfToken={csrfToken}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── Events ────────────────────────────────────────────────────────────────────

type EventView = 'upcoming' | 'past';
type EventRange = 'all' | '7d' | '30d';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function monthLabel(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
function dayLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return {
    day: d.toLocaleDateString('en-US', { day: '2-digit', month: 'short', timeZone: 'UTC' }),
    weekday: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
  };
}
function eventTypeTone(t: EventType): 'pos' | 'neg' | 'info' | 'neutral' | 'warning' {
  switch (t) {
    case 'earnings':
      return 'info';
    case 'agm':
      return 'neutral';
    case 'ex_div':
      return 'pos';
    case 'record_date':
      return 'warning';
    default:
      return 'neutral';
  }
}
function groupByMonth(rows: EventRow[]) {
  const g = new Map<string, EventRow[]>();
  for (const r of rows) {
    const k = r.eventDate.slice(0, 7);
    const a = g.get(k) ?? [];
    a.push(r);
    g.set(k, a);
  }
  return [...g.entries()].map(([k, rows]) => ({ key: k, label: monthLabel(`${k}-01`), rows }));
}

async function EventsSection({
  portfolioId,
  csrfToken,
  rawView,
  rawRange,
}: {
  portfolioId: string;
  csrfToken: string;
  rawView?: string;
  rawRange?: string;
}) {
  const view: EventView = rawView === 'past' ? 'past' : 'upcoming';
  const range: EventRange = rawRange === '7d' || rawRange === '30d' ? rawRange : 'all';
  const today = todayIso();

  const entries =
    view === 'past'
      ? listEvents(db, portfolioId, { toDate: addDays(today, -1), order: 'desc' })
      : listEvents(db, portfolioId, {
          fromDate: today,
          ...(range === '7d'
            ? { toDate: addDays(today, 7) }
            : range === '30d'
              ? { toDate: addDays(today, 30) }
              : {}),
          order: 'asc',
        });

  const symbolSuggestions = getHeldAndWatchSymbols(portfolioId);
  const groups = groupByMonth(entries);
  const base = `/p/${portfolioId}/research`;

  function chipHref(nextRange: EventRange, nextView: EventView = view): Route {
    const qs = new URLSearchParams({ section: 'events' });
    if (nextView !== 'upcoming') qs.set('view', nextView);
    if (nextRange !== 'all') qs.set('range', nextRange);
    return `${base}?${qs.toString()}` as Route;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="mb-4">
          <h2 className="text-sm font-semibold">Add event</h2>
          <p className="text-xs text-[var(--color-muted)]">
            Track earnings, AGMs, ex-div dates and record dates.
          </p>
        </div>
        <AddEventForm
          portfolioId={portfolioId}
          csrfToken={csrfToken}
          symbolSuggestions={symbolSuggestions}
        />
        <div className="mt-5">
          <EventsFetchButtons
            portfolioId={portfolioId}
            csrfToken={csrfToken}
            symbols={symbolSuggestions}
          />
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-[var(--color-border)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold">Events ({entries.length})</h2>
            <p className="text-xs text-[var(--color-muted)]">
              {view === 'past' ? 'Past events' : 'Upcoming corporate calendar'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] p-0.5">
              {(['upcoming', 'past'] as EventView[]).map((v) => {
                const qs = new URLSearchParams({ section: 'events' });
                if (v !== 'upcoming') qs.set('view', v);
                const href = `${base}?${qs.toString()}` as Route;
                return (
                  <Link
                    key={v}
                    href={href}
                    className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${v === view ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'}`}
                  >
                    {v === 'upcoming' ? 'Upcoming' : 'Past'}
                  </Link>
                );
              })}
            </div>
            {view === 'upcoming' && (
              <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] p-0.5">
                {[
                  { key: '7d' as EventRange, label: 'Next 7d' },
                  { key: '30d' as EventRange, label: 'Next 30d' },
                  { key: 'all' as EventRange, label: 'All upcoming' },
                ].map((r) => (
                  <Link
                    key={r.key}
                    href={chipHref(r.key)}
                    className={`rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors ${r.key === range ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]'}`}
                  >
                    {r.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
        {entries.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <p className="text-sm font-medium">No events yet.</p>
            <p className="text-xs text-[var(--color-muted)]">
              Add manually or run the events-fetch skill.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col">
            {groups.map((g) => (
              <li key={g.key} className="flex flex-col">
                <div className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--color-card)] px-5 py-2 text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                  {g.label}
                </div>
                <ul className="flex flex-col divide-y divide-[var(--color-border)]">
                  {g.rows.map((e) => {
                    const dl = dayLabel(e.eventDate);
                    return (
                      <li
                        key={e.id}
                        className="flex items-start gap-4 px-5 py-3 transition-colors hover:bg-[var(--color-card-hover)]"
                      >
                        <div className="flex w-14 shrink-0 flex-col text-center">
                          <span className="text-xs font-semibold tracking-tight text-[var(--color-fg)]">
                            {dl.day}
                          </span>
                          <span className="text-[10px] text-[var(--color-muted)] uppercase">
                            {dl.weekday}
                          </span>
                        </div>
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={
                                `/p/${portfolioId}/symbol/${encodeURIComponent(e.symbol)}` as Route
                              }
                              className="font-medium hover:underline"
                            >
                              {e.symbol}
                            </Link>
                            <Badge tone={eventTypeTone(e.eventType as EventType)}>
                              {EVENT_TYPE_LABEL[e.eventType as EventType]}
                            </Badge>
                            {e.source !== 'manual' && <Badge tone="neutral">{e.source}</Badge>}
                          </div>
                          <div className="text-sm text-[var(--color-fg)]">{e.title}</div>
                          {e.notes && (
                            <div className="text-xs text-[var(--color-muted)]">{e.notes}</div>
                          )}
                        </div>
                        <div className="shrink-0">
                          <DeleteEventButton
                            portfolioId={portfolioId}
                            eventId={e.id}
                            title={e.title}
                            csrfToken={csrfToken}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── Alerts ────────────────────────────────────────────────────────────────────

const RULE_LABELS: Record<AlertRuleType, string> = {
  cmp_below: 'CMP below',
  cmp_above: 'CMP above',
  pct_drop_from_52w_high: '% drop from 52w high',
  pct_rise_from_52w_low: '% rise from 52w low',
  volume_spike: 'Volume spike',
};

async function AlertsSection({
  portfolioId,
  csrfToken,
  rawFilter,
}: {
  portfolioId: string;
  csrfToken: string;
  rawFilter?: string;
}) {
  const filter = rawFilter === 'acked' ? 'acked' : rawFilter === 'all' ? 'all' : 'unacked';
  const rules = listRules(db, portfolioId);
  const eventsFilter =
    filter === 'unacked' ? { acked: false } : filter === 'acked' ? { acked: true } : {};
  const events = listAlertEvents(db, portfolioId, eventsFilter);

  function FilterLink({
    value,
    children,
  }: {
    value: 'unacked' | 'acked' | 'all';
    children: React.ReactNode;
  }) {
    const active = value === filter;
    return (
      <a
        href={`/p/${portfolioId}/research?section=alerts&filter=${value}`}
        className={`rounded-[var(--radius-md)] px-2.5 py-1 ${active ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' : 'text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]'}`}
      >
        {children}
      </a>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Add alert rule</h2>
            <p className="text-xs text-[var(--color-muted)]">
              Local-only rules evaluated against the latest cached prices and 52w history.
            </p>
          </div>
          <EvaluateButton portfolioId={portfolioId} csrfToken={csrfToken} />
        </div>
        <AddRuleForm portfolioId={portfolioId} csrfToken={csrfToken} />
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Rules ({rules.length})</h2>
            <p className="text-xs text-[var(--color-muted)]">
              Watchlist target prices fire as synthetic CMP alerts automatically.
            </p>
          </div>
        </div>
        {rules.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <p className="text-sm font-medium">No rules yet</p>
            <p className="text-xs text-[var(--color-muted)]">Add a rule above.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                  <th className="px-5 py-3 text-left">Symbol</th>
                  <th className="px-3 py-3 text-left">Rule</th>
                  <th className="px-3 py-3 text-right">Threshold</th>
                  <th className="px-3 py-3 text-left">Status</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-card-hover)]"
                  >
                    <td className="px-5 py-3 font-medium">{r.symbol ?? '— (all)'}</td>
                    <td className="px-3 py-3 text-[var(--color-muted)]">
                      {RULE_LABELS[r.ruleType]}
                    </td>
                    <td className="tnum px-3 py-3 text-right">{fmt(r.threshold)}</td>
                    <td className="px-3 py-3">
                      {r.enabled === 1 ? (
                        <Badge tone="info">Enabled</Badge>
                      ) : (
                        <Badge tone="neutral">Disabled</Badge>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <RuleActions
                        portfolioId={portfolioId}
                        ruleId={r.id}
                        enabled={r.enabled === 1}
                        csrfToken={csrfToken}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Triggered ({events.length})</h2>
            <p className="text-xs text-[var(--color-muted)]">
              Events fired by your rules. Acknowledge to clear the bell badge.
            </p>
          </div>
          <nav className="flex items-center gap-1 text-xs">
            <FilterLink value="unacked">Unacked</FilterLink>
            <FilterLink value="acked">Acked</FilterLink>
            <FilterLink value="all">All</FilterLink>
          </nav>
        </div>
        {events.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center">
            <p className="text-sm font-medium">No events</p>
            <p className="text-xs text-[var(--color-muted)]">
              Click <span className="font-medium">Evaluate now</span> to check your rules.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)]">
            {events.map((e) => (
              <li
                key={e.id}
                className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{e.symbol}</span>
                    {e.isAcked === 0 ? (
                      <Badge tone="warning">Unacked</Badge>
                    ) : (
                      <Badge tone="neutral">Acked</Badge>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-[var(--color-fg)]">{e.message}</p>
                  <p className="mt-1 text-xs text-[var(--color-muted)]">
                    {new Date(e.triggeredAt).toLocaleString('en-IN')}
                  </p>
                </div>
                {e.isAcked === 0 && (
                  <AckButton portfolioId={portfolioId} eventId={e.id} csrfToken={csrfToken} />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
