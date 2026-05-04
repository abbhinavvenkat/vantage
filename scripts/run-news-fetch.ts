/**
 * Runs the news-fetch skill for a list of symbols.
 * Hits Google News RSS, parses items, writes JSON files.
 *
 * Usage:
 *   npx tsx scripts/run-news-fetch.ts SYMBOL1 SYMBOL2 ...
 *
 * Output: data/news/<SYMBOL>.json conforming to lib/validation/news.ts#NewsFileSchema
 */

import { request } from 'undici';
import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';

import { NewsFileSchema } from '@/lib/validation/news';

const HORIZON_DAYS = 14;
const HOST = 'news.google.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 stock-platform/0.1';

let lastFetchAt = 0;
async function rateWait(): Promise<void> {
  const wait = Math.max(0, 1100 - (Date.now() - lastFetchAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();
}

async function loadCompanyMap(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(resolve('./data/refs/symbol_company.json'), 'utf8');
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractAll(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    out.push(m[1]!);
  }
  return out;
}

function unwrapCdata(s: string): string {
  const m = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return m ? m[1]! : s;
}

type ParsedItem = { title: string; url: string; publishedAt: string; source: string };

function parseRssItem(itemXml: string, fallbackSource: string): ParsedItem | null {
  const titleRaw = extractAll(itemXml, 'title')[0] ?? '';
  const linkRaw = extractAll(itemXml, 'link')[0] ?? '';
  const pubRaw = extractAll(itemXml, 'pubDate')[0] ?? '';
  const sourceRaw = extractAll(itemXml, 'source')[0] ?? '';
  const title = decodeXmlEntities(unwrapCdata(titleRaw)).trim();
  const url = decodeXmlEntities(unwrapCdata(linkRaw)).trim();
  if (!title || !url) return null;

  // Google News titles end with " - <Source>"; strip and use as `source`.
  let cleanTitle = title;
  let source = unwrapCdata(sourceRaw).trim();
  if (!source) {
    const m = title.match(/^(.+?)\s+-\s+([^-]+)$/);
    if (m) {
      cleanTitle = m[1]!.trim();
      source = m[2]!.trim();
    } else {
      try {
        source = new URL(url).host;
      } catch {
        source = fallbackSource;
      }
    }
  }

  let publishedAt = pubRaw.trim();
  if (publishedAt) {
    const d = new Date(publishedAt);
    if (!Number.isNaN(d.getTime())) publishedAt = d.toISOString();
  } else {
    publishedAt = new Date().toISOString();
  }
  return {
    title: cleanTitle.slice(0, 500),
    url: url.slice(0, 2000),
    publishedAt: publishedAt.slice(0, 64),
    source: source.slice(0, 200),
  };
}

async function fetchRss(query: string): Promise<string | null> {
  await rateWait();
  const url = `https://${HOST}/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
  try {
    const { statusCode, body } = await request(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml,application/xml,text/xml,*/*' },
      bodyTimeout: 15_000,
      headersTimeout: 10_000,
    });
    if (statusCode !== 200) return null;
    return await body.text();
  } catch {
    return null;
  }
}

async function writeNewsFile(symbol: string, items: ParsedItem[]): Promise<{ written: number }> {
  const fileName = symbol.replace(/[^A-Za-z0-9_-]/g, '_'); // safe filename for ARE&M
  // Merge with existing file (idempotent dedupe by URL)
  const dir = resolve('./data/news');
  await fs.mkdir(dir, { recursive: true });
  const filePath = resolve(dir, `${fileName}.json`);

  let existing: ParsedItem[] = [];
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = NewsFileSchema.safeParse(JSON.parse(raw));
    if (parsed.success) existing = parsed.data.items;
  } catch {
    // Fresh file
  }

  const seen = new Set<string>();
  const merged: ParsedItem[] = [];
  for (const it of [...existing, ...items]) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    merged.push(it);
  }
  // Sort newest-first
  merged.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

  const out = { items: merged };
  const validated = NewsFileSchema.safeParse(out);
  if (!validated.success) {
    console.error(`  ✗ ${symbol}: schema validation failed`);
    return { written: 0 };
  }
  await fs.writeFile(filePath, JSON.stringify(validated.data, null, 2));
  return { written: validated.data.items.length };
}

async function main(): Promise<void> {
  const symbols = process.argv
    .slice(2)
    .map((s) => s.trim())
    .filter(Boolean);
  if (symbols.length === 0) {
    console.error('Usage: npx tsx scripts/run-news-fetch.ts SYM1 SYM2 ...');
    process.exit(1);
  }

  const companies = await loadCompanyMap();
  const horizonStart = new Date(Date.now() - HORIZON_DAYS * 86_400_000);

  console.log(
    `news-fetch — ${symbols.length} symbols, horizon last ${HORIZON_DAYS}d, source: Google News RSS\n`,
  );

  let totalNew = 0;
  let totalKept = 0;
  let symbolsWithNews = 0;
  let symbolsErrored = 0;

  for (const symbol of symbols) {
    const company = companies[symbol] ?? symbol;
    const query = `${company} stock`;
    const rss = await fetchRss(query);
    if (!rss) {
      console.log(`  ${symbol.padEnd(14)} — fetch failed`);
      symbolsErrored++;
      continue;
    }
    const itemXmls = extractAll(rss, 'item');
    const items: ParsedItem[] = [];
    const seen = new Set<string>();
    for (const ix of itemXmls) {
      const it = parseRssItem(ix, 'news.google.com');
      if (!it) continue;
      if (seen.has(it.url)) continue;
      seen.add(it.url);
      // Filter by horizon
      const d = new Date(it.publishedAt);
      if (!Number.isNaN(d.getTime()) && d < horizonStart) continue;
      items.push(it);
    }
    if (items.length === 0) {
      console.log(`  ${symbol.padEnd(14)} — 0 items in last ${HORIZON_DAYS}d`);
      continue;
    }
    const { written } = await writeNewsFile(symbol, items);
    if (written > 0) {
      console.log(`  ${symbol.padEnd(14)} — ${items.length} new, ${written} total in file`);
      totalNew += items.length;
      totalKept += written;
      symbolsWithNews++;
    }
  }

  console.log(
    `\nDone: ${totalNew} new items / ${totalKept} total after dedupe / ${symbolsWithNews} symbols with news / ${symbolsErrored} errored`,
  );
  console.log(`Files: data/news/<SYMBOL>.json`);
  console.log(`Next: open the News page and click "Re-import from files".`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
