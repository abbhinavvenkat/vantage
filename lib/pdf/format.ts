/**
 * Number / date formatters for the monthly snapshot PDF.
 *
 * NOTE: pdfkit's default Helvetica font is WinAnsiEncoding-only, so we cannot
 * embed the rupee glyph (₹, U+20B9) without bundling a Unicode TTF. We use the
 * ASCII string "Rs " instead — this is consistent with the rest of the PDF and
 * keeps the export dependency-free. UI pages keep using ₹.
 */

function fmtNumberInIN(n: number, decimals: number): string {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

/** Compact INR formatter: Cr / L / raw rupees. Always prefixed with "Rs ". */
export function fmtInr(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_00_00_000) return `${sign}Rs ${fmtNumberInIN(abs / 1_00_00_000, 2)}Cr`;
  if (abs >= 1_00_000) return `${sign}Rs ${fmtNumberInIN(abs / 1_00_000, 2)}L`;
  return `${sign}Rs ${fmtNumberInIN(abs, 0)}`;
}

/** INR with explicit +/- prefix; used for P&L cells. */
export function fmtSignedInr(n: number): string {
  if (n < 0) return fmtInr(n);
  return `+${fmtInr(n)}`;
}

/** Plain decimal formatter (en-IN), no currency prefix. */
export function fmtNum(n: number, decimals = 2): string {
  return fmtNumberInIN(n, decimals);
}

/** Format an XIRR / return rate (decimal in 0.1234 form) as +12.34% / -5.00% / —. */
export function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  const v = n * 100;
  const sign = v < 0 ? '-' : '+';
  return `${sign}${fmtNumberInIN(Math.abs(v), 2)}%`;
}

/** Plain percentage already in 0..100 form (used for weight %). */
export function fmtPctRaw(n: number, decimals = 1): string {
  return `${fmtNumberInIN(n, decimals)}%`;
}

/**
 * Returns the YYYY-MM-DD of the last calendar day of the month containing
 * `dateStr`. Pure UTC arithmetic so DST cannot change the answer.
 */
export function lastDayOfMonth(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  if (y == null || m == null) throw new Error(`lastDayOfMonth: bad date '${dateStr}'`);
  // Day 0 of next month = last day of this month.
  const d = new Date(Date.UTC(y, m, 0));
  const yy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** YYYY-MM-DD for current UTC date. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
