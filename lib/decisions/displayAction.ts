/**
 * Display-action collapse: maps the granular 6-action stalwart vocabulary
 * (`fresh_buy | add | hold | trim_25 | trim_50 | exit`) onto a 4-action
 * vocabulary used by the UI:
 *   add_more | retain | sell_partial | sell_full
 *
 * Underlying rule library, scoring, and audit log all keep storing the
 * granular tag — this collapse happens at render time only.
 */

import type { RuleAction } from '@/lib/codex/synthesize';
import type { FinalAction } from '@/lib/synthesis/finalRecommendation';

export type StalwartDisplayAction = 'add_more' | 'retain' | 'pass' | 'sell_partial' | 'sell_full';

export const STALWART_DISPLAY_ACTIONS: StalwartDisplayAction[] = [
  'add_more',
  'retain',
  'pass',
  'sell_partial',
  'sell_full',
];

export const STALWART_DISPLAY_LABEL: Record<StalwartDisplayAction, string> = {
  add_more: 'Add More',
  retain: 'Retain',
  pass: 'Pass / Wait',
  sell_partial: 'Sell Partial',
  sell_full: 'Sell Full',
};

export const STALWART_DISPLAY_TONE: Record<
  StalwartDisplayAction,
  'pos' | 'neutral' | 'info' | 'warning' | 'neg'
> = {
  add_more: 'pos',
  retain: 'neutral',
  pass: 'info',
  sell_partial: 'warning',
  sell_full: 'neg',
};

/** Sort priority: add_more first, then retain, pass, sell_partial, sell_full. */
export const STALWART_DISPLAY_PRIORITY: Record<StalwartDisplayAction, number> = {
  add_more: 0,
  retain: 1,
  pass: 2,
  sell_partial: 3,
  sell_full: 4,
};

/**
 * `held` is the position state for the symbol. When `held === false` and the
 * underlying action would map to 'retain' (i.e. a hold winner), we display
 * 'pass' instead — you can't "retain" something you don't own. Default is
 * `held: true` for backwards compatibility with callers that don't supply it.
 */
export type DisplayOpts = { held?: boolean };

export function toDisplayAction(action: RuleAction, opts?: DisplayOpts): StalwartDisplayAction {
  switch (action) {
    case 'fresh_buy':
    case 'add':
      return 'add_more';
    case 'hold':
      return opts?.held === false ? 'pass' : 'retain';
    case 'trim_25':
    case 'trim_50':
      return 'sell_partial';
    case 'exit':
      return 'sell_full';
  }
}

/**
 * Map the FinalAction (synthesis layer's 5-action vocab) onto the same
 * collapsed 4-action display vocab so the UI stays consistent.
 *   buy_more, enter_position → add_more
 *   hold                     → retain
 *   sell_partial             → sell_partial
 *   sell_full                → sell_full
 */
export function finalToDisplayAction(
  action: FinalAction,
  opts?: DisplayOpts,
): StalwartDisplayAction {
  switch (action) {
    case 'buy_more':
    case 'enter_position':
      return 'add_more';
    case 'hold':
      return opts?.held === false ? 'pass' : 'retain';
    case 'sell_partial':
      return 'sell_partial';
    case 'sell_full':
      return 'sell_full';
  }
}

/**
 * Map the Target-CAGR planner's native vocab onto the 4-action display vocab.
 *   add, fresh_buy   → add_more     (more capital toward the symbol)
 *   keep             → retain       (hold without changes)
 *   trim_partial     → sell_partial (~35% trim)
 *   replace          → sell_full    (exit the position)
 */
export type CagrKind = 'add' | 'keep' | 'trim_partial' | 'replace' | 'fresh_buy';

export function cagrToDisplayAction(kind: CagrKind, opts?: DisplayOpts): StalwartDisplayAction {
  switch (kind) {
    case 'add':
    case 'fresh_buy':
      return 'add_more';
    case 'keep':
      return opts?.held === false ? 'pass' : 'retain';
    case 'trim_partial':
      return 'sell_partial';
    case 'replace':
      return 'sell_full';
  }
}
