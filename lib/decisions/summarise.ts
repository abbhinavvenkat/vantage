/**
 * Pure helpers that aggregate per-symbol decisions, compounder profiles, and
 * CAGR-planner actions into the cross-cutting numbers the Decisions dashboard
 * displays.
 *
 * No I/O — callers load the inputs (decisions, profiles, plan actions) and
 * pass them in. Net-additive: nothing in this module changes existing
 * `lib/decisions/score.ts` or `lib/compounder/score.ts` behaviour.
 */

import type { CompounderClassification, CompounderProfile } from '@/lib/compounder/score';
import type { CagrAction } from '@/lib/cagr/portfolioPlan';
import type { FinalAction } from '@/lib/synthesis/finalRecommendation';
import {
  STALWART_DISPLAY_ACTIONS,
  toDisplayAction,
  type StalwartDisplayAction,
} from '@/lib/decisions/displayAction';

export type ActionKey = 'fresh_buy' | 'add' | 'hold' | 'trim_25' | 'trim_50' | 'exit';

export const ACTION_KEYS: ActionKey[] = ['fresh_buy', 'add', 'hold', 'trim_25', 'trim_50', 'exit'];

/** Minimal vote shape pulled out of `decisions.payloadJson.votes`. */
export type VoteLite = { ruleId: string; action: string; weight: number };

/** Minimal decision shape used by the summariser. Subset of `DecisionRow`. */
export type DecisionLite = {
  symbol: string;
  action: ActionKey;
  score: number;
  votes: VoteLite[];
};

export type ActionTileSymbol = { symbol: string; weight: number; score: number };

export type ActionTile = {
  action: ActionKey;
  count: number;
  /** Sum of fired-vote weights across all symbols whose winning action == this action. */
  totalWeight: number;
  /** Top symbols at this action, ranked by their per-symbol contribution to that action. */
  topSymbols: ActionTileSymbol[];
};

/**
 * For each action, count the number of symbols whose *winning* action is that
 * action, sum the votes (only votes whose own action matches the bucket so we
 * measure conviction in that direction), and return the top-N symbols.
 */
export function buildActionTiles(
  decisions: DecisionLite[],
  topN = 3,
): Record<ActionKey, ActionTile> {
  const buckets: Record<ActionKey, ActionTileSymbol[]> = {
    fresh_buy: [],
    add: [],
    hold: [],
    trim_25: [],
    trim_50: [],
    exit: [],
  };
  const totalWeight: Record<ActionKey, number> = {
    fresh_buy: 0,
    add: 0,
    hold: 0,
    trim_25: 0,
    trim_50: 0,
    exit: 0,
  };
  const counts: Record<ActionKey, number> = {
    fresh_buy: 0,
    add: 0,
    hold: 0,
    trim_25: 0,
    trim_50: 0,
    exit: 0,
  };

  for (const d of decisions) {
    if (!ACTION_KEYS.includes(d.action)) continue;
    counts[d.action] += 1;
    // Sum only votes whose action matches the winning bucket — that's the
    // "weight at that action" for this symbol.
    const matching = d.votes.filter((v) => v.action === d.action);
    const symWeight = matching.reduce((acc, v) => acc + (Number(v.weight) || 0), 0);
    totalWeight[d.action] += symWeight;
    buckets[d.action].push({
      symbol: d.symbol,
      weight: Number(symWeight.toFixed(4)),
      score: d.score,
    });
  }

  const out: Record<ActionKey, ActionTile> = {
    fresh_buy: { action: 'fresh_buy', count: 0, totalWeight: 0, topSymbols: [] },
    add: { action: 'add', count: 0, totalWeight: 0, topSymbols: [] },
    hold: { action: 'hold', count: 0, totalWeight: 0, topSymbols: [] },
    trim_25: { action: 'trim_25', count: 0, totalWeight: 0, topSymbols: [] },
    trim_50: { action: 'trim_50', count: 0, totalWeight: 0, topSymbols: [] },
    exit: { action: 'exit', count: 0, totalWeight: 0, topSymbols: [] },
  };
  for (const a of ACTION_KEYS) {
    const sorted = buckets[a]
      .slice()
      .sort((x, y) => y.weight - x.weight || y.score - x.score)
      .slice(0, topN);
    out[a] = {
      action: a,
      count: counts[a],
      totalWeight: Number(totalWeight[a].toFixed(4)),
      topSymbols: sorted,
    };
  }
  return out;
}

export type CompounderDistribution = {
  counts: Record<CompounderClassification, number>;
  total: number;
  fractions: Record<CompounderClassification, number>;
  /** Top 7-9× candidates by 10y multiple. */
  topCandidates: { symbol: string; tenYearMultiple: number; weightedScore: number }[];
};

const CLASSES: CompounderClassification[] = [
  '7-9x candidate',
  'solid compounder',
  'mediocre',
  'broken',
];

export function buildCompounderDistribution(
  profiles: CompounderProfile[],
  topN = 3,
): CompounderDistribution {
  const counts: Record<CompounderClassification, number> = {
    '7-9x candidate': 0,
    'solid compounder': 0,
    mediocre: 0,
    broken: 0,
  };
  for (const p of profiles) counts[p.classification] += 1;
  const total = profiles.length;
  const fractions: Record<CompounderClassification, number> = {
    '7-9x candidate': 0,
    'solid compounder': 0,
    mediocre: 0,
    broken: 0,
  };
  if (total > 0) {
    for (const c of CLASSES) fractions[c] = Number((counts[c] / total).toFixed(4));
  }
  const topCandidates = profiles
    .filter((p) => p.classification === '7-9x candidate')
    .sort((a, b) => b.estimatedTenYearReturn - a.estimatedTenYearReturn)
    .slice(0, topN)
    .map((p) => ({
      symbol: p.symbol,
      tenYearMultiple: p.estimatedTenYearReturn,
      weightedScore: p.weightedScore,
    }));
  return { counts, total, fractions, topCandidates };
}

export type Conflict = {
  symbol: string;
  /** Short label describing the conflict (e.g. "ADD vs broken"). */
  kind:
    | 'rule-add-vs-compounder-broken'
    | 'rule-fresh-buy-vs-compounder-broken'
    | 'rule-exit-vs-compounder-7-9x'
    | 'rule-trim-vs-compounder-7-9x'
    | 'cagr-replace-vs-compounder-7-9x'
    | 'cagr-add-vs-compounder-broken'
    | 'cagr-replace-vs-rule-add';
  ruleAction: ActionKey | null;
  compounderClass: CompounderClassification | null;
  cagrKind: CagrAction['kind'] | null;
  explanation: string;
};

export type FindConflictsInput = {
  decisions: DecisionLite[];
  profilesBySymbol: Map<string, CompounderProfile>;
  cagrActionsBySymbol: Map<string, CagrAction>;
};

export function findFrameworkConflicts(input: FindConflictsInput): Conflict[] {
  const out: Conflict[] = [];
  const dBySym = new Map(input.decisions.map((d) => [d.symbol, d]));
  const symbols = new Set<string>([
    ...dBySym.keys(),
    ...input.profilesBySymbol.keys(),
    ...input.cagrActionsBySymbol.keys(),
  ]);

  for (const sym of symbols) {
    const d = dBySym.get(sym) ?? null;
    const profile = input.profilesBySymbol.get(sym) ?? null;
    const cagr = input.cagrActionsBySymbol.get(sym) ?? null;
    const ruleAction = d?.action ?? null;
    const cls = profile?.classification ?? null;
    const cagrKind = cagr?.kind ?? null;

    // Rule library says ADD but compounder is broken.
    if (ruleAction === 'add' && cls === 'broken') {
      out.push({
        symbol: sym,
        kind: 'rule-add-vs-compounder-broken',
        ruleAction,
        compounderClass: cls,
        cagrKind,
        explanation: 'Rule library says ADD but the Compounder framework classifies it as broken.',
      });
      continue;
    }
    if (ruleAction === 'fresh_buy' && cls === 'broken') {
      out.push({
        symbol: sym,
        kind: 'rule-fresh-buy-vs-compounder-broken',
        ruleAction,
        compounderClass: cls,
        cagrKind,
        explanation:
          'Rule library says FRESH BUY but the Compounder framework classifies it as broken.',
      });
      continue;
    }
    // Rule library says EXIT/TRIM but compounder thinks it is a 7-9× candidate.
    if (ruleAction === 'exit' && cls === '7-9x candidate') {
      out.push({
        symbol: sym,
        kind: 'rule-exit-vs-compounder-7-9x',
        ruleAction,
        compounderClass: cls,
        cagrKind,
        explanation:
          'Rule library says EXIT but the Compounder framework rates it a 7-9× candidate.',
      });
      continue;
    }
    if ((ruleAction === 'trim_25' || ruleAction === 'trim_50') && cls === '7-9x candidate') {
      out.push({
        symbol: sym,
        kind: 'rule-trim-vs-compounder-7-9x',
        ruleAction,
        compounderClass: cls,
        cagrKind,
        explanation:
          'Rule library says TRIM but the Compounder framework rates it a 7-9× candidate.',
      });
      continue;
    }
    // CAGR planner says REPLACE but compounder thinks 7-9× candidate.
    if (cagrKind === 'replace' && cls === '7-9x candidate') {
      out.push({
        symbol: sym,
        kind: 'cagr-replace-vs-compounder-7-9x',
        ruleAction,
        compounderClass: cls,
        cagrKind,
        explanation:
          'Target-CAGR planner suggests REPLACE but the Compounder framework rates it 7-9×.',
      });
      continue;
    }
    // CAGR planner says ADD but compounder broken.
    if (cagrKind === 'add' && cls === 'broken') {
      out.push({
        symbol: sym,
        kind: 'cagr-add-vs-compounder-broken',
        ruleAction,
        compounderClass: cls,
        cagrKind,
        explanation:
          'Target-CAGR planner suggests ADD but the Compounder framework calls it broken.',
      });
      continue;
    }
    // CAGR planner says REPLACE but rule library says ADD.
    if (cagrKind === 'replace' && ruleAction === 'add') {
      out.push({
        symbol: sym,
        kind: 'cagr-replace-vs-rule-add',
        ruleAction,
        compounderClass: cls,
        cagrKind,
        explanation: 'Target-CAGR planner suggests REPLACE but the rule library says ADD.',
      });
      continue;
    }
  }

  // Stable order: by symbol so the UI is deterministic.
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

export type FinalActionCounts = Record<FinalAction, number>;

/**
 * Count how many symbols land at each FinalAction. Mirrors the existing
 * action-tile shape so the dashboard can render a parallel "Final synthesis"
 * row beneath the "Stalwarts only" Action signals row.
 */
export function summariseFinalActions(rows: { finalAction: FinalAction }[]): FinalActionCounts {
  const out: FinalActionCounts = {
    buy_more: 0,
    enter_position: 0,
    hold: 0,
    sell_partial: 0,
    sell_full: 0,
  };
  for (const r of rows) out[r.finalAction] += 1;
  return out;
}

export type StalwartDisplayCounts = Record<StalwartDisplayAction, number>;

/**
 * Aggregate Stalwarts winning actions onto the collapsed 4-action display
 * vocabulary (add_more / retain / sell_partial / sell_full).
 */
export function summariseStalwartDisplayActions(
  rows: { action: ActionKey; held?: boolean }[],
): StalwartDisplayCounts {
  const out: StalwartDisplayCounts = {
    add_more: 0,
    retain: 0,
    pass: 0,
    sell_partial: 0,
    sell_full: 0,
  };
  for (const r of rows) {
    if (!ACTION_KEYS.includes(r.action)) continue;
    out[toDisplayAction(r.action, { held: r.held })] += 1;
  }
  return out;
}

export const STALWART_DISPLAY_ACTION_ORDER = STALWART_DISPLAY_ACTIONS;

export type StyleTopInvestor = { investor: string; weight: number };

/** Returns the top-N investors by current style weight (already normalised). */
export function topStyleInvestors(weights: Record<string, number>, topN = 3): StyleTopInvestor[] {
  return Object.entries(weights)
    .filter(([, w]) => Number.isFinite(w) && w > 0)
    .map(([investor, weight]) => ({ investor, weight: Number(weight.toFixed(4)) }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, topN);
}

export type RecentSnapshot = {
  snapshotAt: number;
  ruleLibraryVersion: string;
  n: number;
  /** Number of symbols whose action differs from the *prior* snapshot. */
  changedFromPrior: number | null;
};

/** Take a list of snapshots (newest first) and a function that returns the
 * action map for a given snapshotAt; compute the changed-action delta vs the
 * immediately prior snapshot. The oldest snapshot in the input gets `null`.
 */
export function buildRecentSnapshots(
  snapshots: { snapshotAt: number; ruleLibraryVersion: string; n: number }[],
  actionsAt: (snapshotAt: number) => Map<string, ActionKey>,
  limit = 3,
): RecentSnapshot[] {
  // snapshots is newest-first; we want the same ordering in output.
  const slice = snapshots.slice(0, limit);
  const out: RecentSnapshot[] = [];
  for (let i = 0; i < slice.length; i += 1) {
    const cur = slice[i]!;
    const prior = slice[i + 1] ?? snapshots[limit] ?? null;
    let changed: number | null = null;
    if (prior) {
      const a = actionsAt(cur.snapshotAt);
      const b = actionsAt(prior.snapshotAt);
      let n = 0;
      const seen = new Set<string>([...a.keys(), ...b.keys()]);
      for (const sym of seen) {
        if (a.get(sym) !== b.get(sym)) n += 1;
      }
      changed = n;
    }
    out.push({
      snapshotAt: cur.snapshotAt,
      ruleLibraryVersion: cur.ruleLibraryVersion,
      n: cur.n,
      changedFromPrior: changed,
    });
  }
  return out;
}
