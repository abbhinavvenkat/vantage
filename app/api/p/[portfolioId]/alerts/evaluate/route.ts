import { requireCsrf } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import {
  evaluateRules,
  type EvaluatorRule,
  type PriceSnapshot,
  type SymbolHistory,
} from '@/lib/analytics/alertEvaluator';
import { db } from '@/lib/db/client';
import { hasUnackedEventOnDate, insertEvent, listEnabledRules } from '@/lib/db/queries/alerts';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { getLatestPrices, getSymbolStats } from '@/lib/db/queries/prices';
import { listWatchlist } from '@/lib/db/queries/watchlist';

type Ctx = { params: Promise<{ portfolioId: string }> };

const SYNTHETIC_PREFIX = 'watchlist:';

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const csrf = await requireCsrf(req);
  if (csrf) return csrf;

  const { portfolioId } = await ctx.params;
  const pf = getPortfolio(db, portfolioId);
  if (!pf || pf.archivedAt !== null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  // 1. Real, persisted rules.
  const dbRules = listEnabledRules(db, portfolioId);
  const realRules: EvaluatorRule[] = dbRules
    .filter((r) => r.symbol != null) // global rules not yet supported in evaluator
    .map((r) => ({
      id: r.id,
      symbol: r.symbol!,
      ruleType: r.ruleType,
      threshold: r.threshold,
      enabled: r.enabled === 1,
    }));

  // 2. Synthetic rules from watchlist target prices (opt-in via target presence).
  const wl = listWatchlist(db, portfolioId);
  const syntheticRules: EvaluatorRule[] = [];
  for (const w of wl) {
    if (w.targetBuyPrice != null) {
      syntheticRules.push({
        id: `${SYNTHETIC_PREFIX}buy:${w.id}`,
        symbol: w.symbol,
        ruleType: 'cmp_below',
        threshold: w.targetBuyPrice,
        enabled: true,
      });
    }
    if (w.targetSellPrice != null) {
      syntheticRules.push({
        id: `${SYNTHETIC_PREFIX}sell:${w.id}`,
        symbol: w.symbol,
        ruleType: 'cmp_above',
        threshold: w.targetSellPrice,
        enabled: true,
      });
    }
  }

  const allRules = [...realRules, ...syntheticRules];
  if (allRules.length === 0) {
    return Response.json({ evaluated: 0, fired: 0, persisted: 0 });
  }

  const symbols = [...new Set(allRules.map((r) => r.symbol))];
  const prices = getLatestPrices(db, symbols);
  const today = new Date().toISOString().slice(0, 10);
  const stats = getSymbolStats(db, symbols, today);

  const priceMap = new Map<string, PriceSnapshot>();
  for (const [sym, p] of prices) {
    priceMap.set(sym, { symbol: sym, close: p.close, volume: null, date: p.date });
  }
  const histMap = new Map<string, SymbolHistory>();
  for (const [sym, s] of stats) {
    histMap.set(sym, {
      high52w: s.high52w,
      low52w: s.low52w,
      avgVolume30d: s.avgVolume30d,
    });
  }

  const fired = evaluateRules(allRules, priceMap, histMap, today, {
    alreadyFiredToday: (rid, d) => {
      // Synthetic rules can't dedupe via DB (no rule row) — best-effort: skip dedupe.
      if (rid.startsWith(SYNTHETIC_PREFIX)) return false;
      return hasUnackedEventOnDate(db, rid, d);
    },
  });

  // Persist only events that came from real (DB) rules. Synthetic rules trigger
  // notifications but cannot be FK-linked; skip persistence for now.
  let persisted = 0;
  for (const ev of fired) {
    if (ev.ruleId.startsWith(SYNTHETIC_PREFIX)) continue;
    insertEvent(db, portfolioId, {
      ruleId: ev.ruleId,
      symbol: ev.symbol,
      triggeredAt: ev.triggeredAt,
      currentValue: ev.currentValue,
      triggerValue: ev.triggerValue,
      message: ev.message,
    });
    persisted++;
  }

  return Response.json({
    evaluated: allRules.length,
    fired: fired.length,
    persisted,
    events: fired,
  });
}
