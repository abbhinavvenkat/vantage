/**
 * Minimal RFC 4180-style CSV encoder.
 * - Fields are quoted iff they contain a comma, double-quote, CR, or LF.
 * - Embedded double-quotes are escaped by doubling.
 * - `null` and `undefined` render as empty.
 * - Numbers render via `String(n)` (no locale formatting).
 * - Line terminator is CRLF.
 */
export type CsvCell = string | number | null | undefined;

export function escapeCsvField(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'number' ? String(value) : value;
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const out: string[] = [];
  out.push(headers.map(escapeCsvField).join(','));
  for (const row of rows) {
    out.push(row.map(escapeCsvField).join(','));
  }
  return out.join('\r\n') + '\r\n';
}
