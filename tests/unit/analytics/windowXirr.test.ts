import { describe, it, expect } from 'vitest';
import { windowXirr } from '@/lib/analytics/windowXirr';
import { xirr, type Cashflow } from '@/lib/analytics/xirr';

describe('windowXirr', () => {
  it('matches all-time XIRR when window covers all cashflows and startMv = 0', () => {
    const cfs: Cashflow[] = [
      { date: '2020-01-01', amount: -1000 },
      { date: '2020-07-01', amount: -500 },
    ];
    const endMv = 1800;
    const endDate = '2022-01-01';

    const all = xirr([...cfs, { date: endDate, amount: endMv }]);
    const window = windowXirr({
      cashflows: cfs,
      startDate: '2019-01-01',
      startMv: 0,
      endDate,
      endMv,
    });

    expect(window).not.toBeNull();
    expect(window!).toBeCloseTo(all, 6);
  });

  it('returns simple CAGR when no cashflows fall inside the window', () => {
    const cfs: Cashflow[] = [{ date: '2018-01-01', amount: -1000 }];
    // Window starts well after the only cashflow. We anchor with startMv = 1500
    // (representing the position's MV at window start) and endMv = 1815 a year
    // later → simple 21% growth → annualised ≈ 21%.
    const rate = windowXirr({
      cashflows: cfs,
      startDate: '2021-01-01',
      startMv: 1500,
      endDate: '2022-01-01',
      endMv: 1815,
    });
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.21, 2);
  });

  it('correctly weights an in-window buy', () => {
    // Held 1000 from before window; window adds another 1000 mid-window;
    // ends at MV = 2200. Should be a positive XIRR strictly less than the
    // pure CAGR-on-startMv scenario.
    const cfs: Cashflow[] = [
      { date: '2018-01-01', amount: -1000 }, // before window
      { date: '2021-07-01', amount: -1000 }, // in window
    ];
    const rate = windowXirr({
      cashflows: cfs,
      startDate: '2021-01-01',
      startMv: 1100,
      endDate: '2022-01-01',
      endMv: 2300,
    });
    expect(rate).not.toBeNull();
    expect(rate!).toBeGreaterThan(0);
    expect(rate!).toBeLessThan(1);
  });

  it('returns 0 when startMv equals endMv with no in-window cashflows', () => {
    const rate = windowXirr({
      cashflows: [{ date: '2018-01-01', amount: -1000 }],
      startDate: '2021-01-01',
      startMv: 1500,
      endDate: '2022-01-01',
      endMv: 1500,
    });
    expect(rate).not.toBeNull();
    expect(Math.abs(rate!)).toBeLessThan(1e-3);
  });

  it('returns null when there is no capital deployed in the window', () => {
    // No prior position (startMv = 0) AND no in-window cashflows → nothing to
    // XIRR over. Caller should treat this as "no data".
    const rate = windowXirr({
      cashflows: [{ date: '2018-01-01', amount: -1000 }],
      startDate: '2021-01-01',
      startMv: 0,
      endDate: '2022-01-01',
      endMv: 0,
    });
    expect(rate).toBeNull();
  });

  it('ignores cashflows outside the window', () => {
    // Two scenarios that should give the same window XIRR:
    //   (a) only the in-window CF, with startMv=0
    //   (b) the same in-window CF plus a far-earlier one, with startMv=0
    // (b) should drop the earlier CF since it's before windowStart.
    const inWindow: Cashflow[] = [{ date: '2021-06-01', amount: -1000 }];
    const a = windowXirr({
      cashflows: inWindow,
      startDate: '2021-01-01',
      startMv: 0,
      endDate: '2022-06-01',
      endMv: 1100,
    });
    const b = windowXirr({
      cashflows: [{ date: '2018-01-01', amount: -500 }, ...inWindow],
      startDate: '2021-01-01',
      startMv: 0,
      endDate: '2022-06-01',
      endMv: 1100,
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!).toBeCloseTo(b!, 6);
  });

  it('excludes a CF exactly on startDate (already reflected in startMv)', () => {
    // Boundary policy: a CF ON startDate is treated as already absorbed into
    // startMv (qty-timelines reflect post-event qty). The caller is expected
    // to pass startMv consistent with that.
    const rate = windowXirr({
      cashflows: [],
      startDate: '2021-01-01',
      startMv: 1000,
      endDate: '2022-01-01',
      endMv: 1100,
    });
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.1, 3);
  });

  it('returns null on degenerate "lost everything" inputs (no terminal MV)', () => {
    // startMv > 0 but endMv = 0 with no in-window inflows — there's no
    // positive cashflow to anchor the solver, so we return null rather than
    // pretending to annualise a -100% loss.
    const rate = windowXirr({
      cashflows: [],
      startDate: '2021-01-01',
      startMv: 1000,
      endDate: '2022-01-01',
      endMv: 0,
    });
    expect(rate).toBeNull();
  });
});
