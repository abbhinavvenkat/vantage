import type { ParserModule } from '@/lib/parsers/types';
import { zerodhaParser } from '@/lib/parsers/zerodha';
import { growwParser } from '@/lib/parsers/groww';
import { indmoneyParser } from '@/lib/parsers/indmoney';

// Order matters: Zerodha's header sniff is strict (13 columns, exact case, row 15),
// so it must be tried first. IndMoney's header sniff requires its specific
// `Broker Reference Id` + `Order Amount ($)` columns, so it goes before Groww
// (whose sniff is permissive, case-insensitive, alias-tolerant).
export const parsers: ParserModule[] = [zerodhaParser, indmoneyParser, growwParser];

export function detectParser(file: { name: string; bytes: Buffer }): ParserModule | null {
  for (const p of parsers) {
    try {
      if (p.detect(file)) return p;
    } catch {
      continue;
    }
  }
  return null;
}
