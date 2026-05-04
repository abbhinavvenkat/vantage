import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';

import { escapeCsvField, toCsv } from '@/lib/csv/encode';

describe('csv/encode', () => {
  it('leaves plain values unquoted', () => {
    expect(escapeCsvField('ACME-EQ')).toBe('ACME-EQ');
    expect(escapeCsvField(42)).toBe('42');
  });

  it('renders null/undefined as empty', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('quotes fields with commas, quotes, or newlines', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvField('cr\rlf')).toBe('"cr\rlf"');
  });

  it('emits CRLF-terminated rows', () => {
    const csv = toCsv(
      ['a', 'b'],
      [
        [1, 2],
        [3, 4],
      ],
    );
    expect(csv).toBe('a,b\r\n1,2\r\n3,4\r\n');
  });

  it('round-trips through papaparse', () => {
    const headers = ['symbol', 'note', 'qty'];
    const rows = [
      ['ACME-EQ', 'plain', 100],
      ['WIDGET-EQ', 'has, comma', 50],
      ['QUOTED-EQ', 'has "quotes"', 25],
      ['MULTI-EQ', 'line1\nline2', null],
    ];
    const csv = toCsv(headers, rows);
    const parsed = Papa.parse<string[]>(csv.trimEnd(), { skipEmptyLines: true });
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.data[0]).toEqual(headers);
    expect(parsed.data[1]).toEqual(['ACME-EQ', 'plain', '100']);
    expect(parsed.data[2]).toEqual(['WIDGET-EQ', 'has, comma', '50']);
    expect(parsed.data[3]).toEqual(['QUOTED-EQ', 'has "quotes"', '25']);
    expect(parsed.data[4]).toEqual(['MULTI-EQ', 'line1\nline2', '']);
  });
});
