/**
 * Runs the events-fetch skill for a list of symbols.
 * Hits NSE's per-symbol event-calendar API, filters upcoming events, writes JSON files.
 *
 * Usage:
 *   npx tsx scripts/run-events-fetch.ts SYMBOL1 SYMBOL2 ...
 *
 * Output: data/events/<SYMBOL>.json conforming to lib/validation/events.ts#EventsFileSchema
 */

import { request } from 'undici';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

import { EventsFileSchema } from '@/lib/validation/events';

const HORIZON_DAYS = 90;
const NSE_HOST = 'www.nseindia.com';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let lastFetchAt = 0;
async function rateWait(): Promise<void> {
  const wait = Math.max(0, 1100 - (Date.now() - lastFetchAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
}

type RawEvent = {
  symbol: string;
  company: string;
  purpose: string;
  bm_desc?: string;
  date: string; // "DD-Mon-YYYY"
};

const MONTHS: Record<string, string> = {
  Jan: '01',
  Feb: '02',
  Mar: '03',
  Apr: '04',
  May: '05',
  Jun: '06',
  Jul: '07',
  Aug: '08',
  Sep: '09',
  Oct: '10',
  Nov: '11',
  Dec: '12',
};

function parseNseDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  if (!m) return null;
  const dd = m[1]!.padStart(2, '0');
  const mm = MONTHS[m[2]!];
  if (!mm) return null;
  return `${m[3]}-${mm}-${dd}`;
}

type EventType = 'earnings' | 'agm' | 'ex_div' | 'record_date' | 'other';

function mapPurpose(purpose: string, desc: string): EventType {
  const all = `${purpose} ${desc}`.toLowerCase();
  if (all.includes('agm') || all.includes('annual general')) return 'agm';
  if (all.includes('record date') || all.includes('record-date')) return 'record_date';
  if (all.includes('ex-date') || all.includes('ex date') || all.includes('dividend'))
    return 'ex_div';
  if (
    all.includes('result') ||
    all.includes('financial') ||
    all.includes('quarterly') ||
    all.includes('audited')
  )
    return 'earnings';
  return 'other';
}

async function fetchSymbolEvents(symbol: string): Promise<RawEvent[]> {
  await rateWait();
  const url = `https://${NSE_HOST}/api/event-calendar?symbol=${encodeURIComponent(symbol)}`;
  try {
    const { statusCode, body } = await request(url, {
      method: 'GET',
      headers: {
        'User-Agent': UA,
        Accept: 'application/json,text/plain,*/*',
        Referer: 'https://www.nseindia.com/companies-listing/corporate-filings-event-calendar',
      },
      bodyTimeout: 15_000,
      headersTimeout: 10_000,
    });
    if (statusCode !== 200) return [];
    const json = (await body.json()) as RawEvent[] | unknown;
    return Array.isArray(json) ? (json as RawEvent[]) : [];
  } catch {
    return [];
  }
}

async function writeEventsFile(
  symbol: string,
  events: { eventType: EventType; eventDate: string; title: string; notes: string | null }[],
): Promise<{ written: number }> {
  const fileName = symbol.replace(/[^A-Za-z0-9_-]/g, '_'); // safe filename for ARE&M
  const out = {
    events: events.map((e) => ({
      eventType: e.eventType,
      eventDate: e.eventDate,
      title: e.title,
      notes: e.notes,
    })),
  };
  const parsed = EventsFileSchema.safeParse(out);
  if (!parsed.success) {
    console.error(`  ✗ ${symbol}: schema validation failed`);
    return { written: 0 };
  }
  const dir = resolve('./data/events');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(resolve(dir, `${fileName}.json`), JSON.stringify(parsed.data, null, 2));
  return { written: out.events.length };
}

async function main(): Promise<void> {
  const symbols = process.argv
    .slice(2)
    .map((s) => s.trim())
    .filter(Boolean);
  if (symbols.length === 0) {
    console.error('Usage: npx tsx scripts/run-events-fetch.ts SYM1 SYM2 ...');
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);

  console.log(`events-fetch — ${symbols.length} symbols, horizon ${today} → ${horizon}`);
  console.log('source: NSE event-calendar (rate-limited 1 req/s)\n');

  let totalEvents = 0;
  let symbolsWithEvents = 0;
  let symbolsEmpty = 0;
  let symbolsErrored = 0;

  for (const symbol of symbols) {
    // Map "ARE&M" to a fetchable ticker — NSE uses "ARE&M" itself
    const fetchSymbol = symbol;
    const raw = await fetchSymbolEvents(fetchSymbol);
    if (raw.length === 0) {
      console.log(`  ${symbol.padEnd(14)} — no events from NSE`);
      symbolsErrored++;
      continue;
    }
    const upcoming = raw
      .map((r) => {
        const iso = parseNseDate(r.date);
        if (!iso) return null;
        if (iso < today || iso > horizon) return null;
        const eventType = mapPurpose(r.purpose ?? '', r.bm_desc ?? '');
        const title =
          r.purpose && r.purpose !== ''
            ? `${r.purpose}${r.bm_desc ? ` — ${r.bm_desc.slice(0, 100)}` : ''}`
            : (r.bm_desc ?? 'Corporate event');
        return {
          eventType,
          eventDate: iso,
          title: title.slice(0, 200),
          notes: null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    // Dedupe on (eventType, eventDate, title)
    const seen = new Set<string>();
    const deduped = upcoming.filter((e) => {
      const k = `${e.eventType}|${e.eventDate}|${e.title}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (deduped.length === 0) {
      console.log(`  ${symbol.padEnd(14)} — 0 upcoming (next ${HORIZON_DAYS}d)`);
      symbolsEmpty++;
      continue;
    }
    const { written } = await writeEventsFile(symbol, deduped);
    if (written > 0) {
      console.log(`  ${symbol.padEnd(14)} — ${written} upcoming events written`);
      totalEvents += written;
      symbolsWithEvents++;
    }
  }

  console.log(
    `\nDone: ${totalEvents} events / ${symbolsWithEvents} symbols with events / ${symbolsEmpty} empty / ${symbolsErrored} errored`,
  );
  console.log(`Files: data/events/<SYMBOL>.json`);
  console.log(`Next: open the Events page in the app and click "Re-import from files".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
