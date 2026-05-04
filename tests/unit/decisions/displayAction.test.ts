import { describe, it, expect } from 'vitest';

import {
  finalToDisplayAction,
  STALWART_DISPLAY_LABEL,
  STALWART_DISPLAY_TONE,
  toDisplayAction,
} from '@/lib/decisions/displayAction';

describe('toDisplayAction', () => {
  it('maps fresh_buy and add to add_more', () => {
    expect(toDisplayAction('fresh_buy')).toBe('add_more');
    expect(toDisplayAction('add')).toBe('add_more');
  });

  it('maps hold to retain when held', () => {
    expect(toDisplayAction('hold')).toBe('retain');
    expect(toDisplayAction('hold', { held: true })).toBe('retain');
  });

  it('maps hold to pass when not held (watchlist)', () => {
    expect(toDisplayAction('hold', { held: false })).toBe('pass');
  });

  it('maps trim_25 and trim_50 to sell_partial', () => {
    expect(toDisplayAction('trim_25')).toBe('sell_partial');
    expect(toDisplayAction('trim_50')).toBe('sell_partial');
  });

  it('maps exit to sell_full', () => {
    expect(toDisplayAction('exit')).toBe('sell_full');
  });
});

describe('finalToDisplayAction', () => {
  it('maps buy_more and enter_position to add_more', () => {
    expect(finalToDisplayAction('buy_more')).toBe('add_more');
    expect(finalToDisplayAction('enter_position')).toBe('add_more');
  });

  it('maps hold to retain when held, pass when not held', () => {
    expect(finalToDisplayAction('hold')).toBe('retain');
    expect(finalToDisplayAction('hold', { held: true })).toBe('retain');
    expect(finalToDisplayAction('hold', { held: false })).toBe('pass');
  });

  it('maps sell_partial to sell_partial and sell_full to sell_full', () => {
    expect(finalToDisplayAction('sell_partial')).toBe('sell_partial');
    expect(finalToDisplayAction('sell_full')).toBe('sell_full');
  });
});

describe('display labels and tones', () => {
  it('has a human label for every display action', () => {
    expect(STALWART_DISPLAY_LABEL.add_more).toBe('Add More');
    expect(STALWART_DISPLAY_LABEL.retain).toBe('Retain');
    expect(STALWART_DISPLAY_LABEL.pass).toBe('Pass / Wait');
    expect(STALWART_DISPLAY_LABEL.sell_partial).toBe('Sell Partial');
    expect(STALWART_DISPLAY_LABEL.sell_full).toBe('Sell Full');
  });

  it('has a tone for every display action', () => {
    expect(STALWART_DISPLAY_TONE.add_more).toBe('pos');
    expect(STALWART_DISPLAY_TONE.retain).toBe('neutral');
    expect(STALWART_DISPLAY_TONE.pass).toBe('info');
    expect(STALWART_DISPLAY_TONE.sell_partial).toBe('warning');
    expect(STALWART_DISPLAY_TONE.sell_full).toBe('neg');
  });
});
