export type Cashflow = { date: string; amount: number };

const TOLERANCE = 1e-6;
const MAX_ITERATIONS = 100;
const INITIAL_GUESS = 0.1;
const DAYS_PER_YEAR = 365;

function yearsBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return (b - a) / (DAYS_PER_YEAR * 86_400_000);
}

export function xirr(cashflows: Cashflow[]): number {
  if (cashflows.length < 2) {
    throw new Error('xirr: at least two cashflows required');
  }
  const sorted = [...cashflows].sort((a, b) => a.date.localeCompare(b.date));
  const t0 = sorted[0]!.date;
  const ts = sorted.map((cf) => yearsBetween(t0, cf.date));
  const amounts = sorted.map((cf) => cf.amount);

  let rate = INITIAL_GUESS;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let f = 0;
    let df = 0;
    for (let j = 0; j < amounts.length; j++) {
      const t = ts[j]!;
      const a = amounts[j]!;
      const factor = Math.pow(1 + rate, t);
      f += a / factor;
      df += (-t * a) / (factor * (1 + rate));
    }
    if (Math.abs(f) < TOLERANCE) return rate;
    if (df === 0) break;
    const next = rate - f / df;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - rate) < TOLERANCE) return next;
    rate = next;
  }
  throw new Error('XIRR did not converge');
}
