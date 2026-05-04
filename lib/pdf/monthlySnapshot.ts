import PDFDocument from 'pdfkit';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { aggregateByEntryFy, buildSymbolAggregates } from '@/lib/analytics/cohorts';
import { computeFifo } from '@/lib/analytics/fifo';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import { tradesToCashflows } from '@/lib/analytics/portfolioCashflows';
import { computeBenchmarkXirr } from '@/lib/analytics/benchmarkXirr';
import { fetchNifty50Close, getNifty50SeriesCached } from '@/lib/pricing/nifty50';
import { xirr, type Cashflow } from '@/lib/analytics/xirr';
import { computeHoldings } from '@/lib/db/queries/holdings';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { getLatestPrices } from '@/lib/db/queries/prices';
import { getTradesForPortfolio } from '@/lib/db/queries/trades';
import { getSector } from '@/lib/sectors/map';
import type { NormalizedTrade } from '@/lib/parsers/types';
import type { Trade } from '@/lib/db/queries/trades';
import { fmtInr, fmtNum, fmtPct, fmtPctRaw, fmtSignedInr, todayIso } from '@/lib/pdf/format';

type Db = BetterSQLite3Database<typeof schema>;

const PAGE_MARGIN = 48;
const PAGE_W = 595.28; // A4 width in pt
const CONTENT_W = PAGE_W - PAGE_MARGIN * 2;

const COL_FG = '#0f172a';
const COL_MUTED = '#64748b';
const COL_BORDER = '#e2e8f0';
const COL_POS = '#15803d';
const COL_NEG = '#b91c1c';
const COL_ACCENT = '#4f46e5';

function toNormalized(t: Trade): NormalizedTrade {
  return {
    brokerCode: 'zerodha',
    symbol: t.symbol,
    isin: t.isin ?? undefined,
    tradeDate: t.tradeDate,
    side: t.side as 'buy' | 'sell',
    qty: t.qty,
    price: t.price,
    currency: t.currency as 'INR' | 'USD',
    exchange: t.exchange ?? undefined,
    segment: t.segment ?? undefined,
    series: t.series ?? undefined,
    tradeId: t.tradeId ?? undefined,
    orderId: t.orderId ?? undefined,
    execTime: t.execTime ?? undefined,
    rawRowIdx: t.sourceRowIdx ?? 0,
  };
}

function fyOf(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  return m! >= 4 ? `FY${(y! + 1).toString().slice(2)}` : `FY${y!.toString().slice(2)}`;
}

function safeXirr(cfs: Cashflow[]): number | null {
  if (cfs.length < 2) return null;
  try {
    return xirr(cfs);
  } catch {
    return null;
  }
}

type HoldingRow = {
  symbol: string;
  qty: number;
  avgCost: number;
  cmp: number | null;
  mv: number;
  unrealized: number | null;
  weightPct: number;
};

type SectorRow = { bucket: string; symbols: number; mv: number; weightPct: number };
type CohortFyRow = {
  bucket: string;
  symbols: number;
  invested: number;
  mv: number;
  realized: number;
  unrealized: number;
};

type SnapshotData = {
  portfolioName: string;
  asOfDate: string;
  generatedAt: string;
  invested: number;
  marketValue: number;
  unrealized: number;
  realizedYtd: number;
  realizedAllTime: number;
  portfolioXirr: number | null;
  niftyXirr: number | null;
  topHoldings: HoldingRow[];
  topRealizedYtd: Array<{
    symbol: string;
    sellDate: string;
    qty: number;
    pnl: number;
    holdingDays: number;
  }>;
  sectorRows: SectorRow[];
  cohortFyRows: CohortFyRow[];
};

/**
 * Pure data assembly — fully deterministic given the DB. The Nifty bench XIRR
 * is the only network-touching step and is awaited but tolerant of failure
 * (returns null, doesn't throw).
 */
async function buildSnapshotData(
  db: Db,
  portfolioId: string,
  asOfDate: string,
): Promise<SnapshotData> {
  const portfolio = getPortfolio(db, portfolioId);
  if (!portfolio) {
    throw new Error(`portfolio not found: ${portfolioId}`);
  }

  // Holdings + prices.
  const rawHoldings = computeHoldings(db, portfolioId);
  const open = rawHoldings.filter((h) => h.netQty > 0);
  const symbols = open.map((h) => h.symbol);
  const priceMap = getLatestPrices(db, symbols);

  let totalCost = 0;
  let totalMv = 0;
  const allHoldings: HoldingRow[] = open.map((h) => {
    const avgCost = h.buyQty > 0 ? h.buyValue / h.buyQty : 0;
    const cost = avgCost * h.netQty;
    const cmp = priceMap.get(h.symbol)?.close ?? null;
    const mv = cmp != null ? cmp * h.netQty : cost;
    const unrealized = cmp != null ? mv - cost : null;
    totalCost += cost;
    totalMv += mv;
    return { symbol: h.symbol, qty: h.netQty, avgCost, cmp, mv, unrealized, weightPct: 0 };
  });
  for (const r of allHoldings) {
    r.weightPct = totalMv > 0 ? (r.mv / totalMv) * 100 : 0;
  }
  allHoldings.sort((a, b) => b.mv - a.mv);
  const topHoldings = allHoldings.slice(0, 20);
  const totalUnrealized = totalMv - totalCost;

  // Realized via FIFO + corporate actions + aliases (same as realized page).
  const allTrades = getTradesForPortfolio(db, portfolioId);
  const deliveryTrades = allTrades.filter((t) => t.isIntradayPairId === null);
  const normalized = deliveryTrades.map(toNormalized);
  const { realized } = computeFifo(normalized, KNOWN_CORPORATE_ACTIONS);

  const asOfFy = fyOf(asOfDate);
  const realizedYtd = realized
    .filter((r) => fyOf(r.sellDate) === asOfFy)
    .reduce((s, r) => s + r.pnl, 0);
  const realizedAllTime = realized.reduce((s, r) => s + r.pnl, 0);

  const topRealizedYtd = [...realized]
    .filter((r) => fyOf(r.sellDate) === asOfFy)
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))
    .slice(0, 10)
    .map((r) => ({
      symbol: r.symbol,
      sellDate: r.sellDate,
      qty: r.qty,
      pnl: r.pnl,
      holdingDays: r.holdingDays,
    }));

  // Cohorts (FY) + sectors via shared aggregator (applies aliases internally).
  const aliased = applySymbolAliases(normalized);
  const cmpBySymbol = new Map<string, number>();
  const aliasedSymbols = Array.from(new Set(aliased.map((t) => t.symbol)));
  const aliasedPrices = getLatestPrices(db, aliasedSymbols);
  for (const [sym, p] of aliasedPrices) cmpBySymbol.set(sym, p.close);

  const aggregates = buildSymbolAggregates(normalized, KNOWN_CORPORATE_ACTIONS, cmpBySymbol);
  const fyRows = aggregateByEntryFy(aggregates);
  const cohortFyRows: CohortFyRow[] = fyRows.map((r) => ({
    bucket: r.bucket,
    symbols: r.symbols.length,
    invested: r.invested,
    mv: r.marketValue,
    realized: r.realizedPnl,
    unrealized: r.unrealizedPnl,
  }));

  // Sectors: aggregate open-position MV by sector (matches what user sees).
  const sectorMvMap = new Map<string, { mv: number; symbols: Set<string> }>();
  for (const r of allHoldings) {
    const sec = getSector(r.symbol);
    const cur = sectorMvMap.get(sec) ?? { mv: 0, symbols: new Set<string>() };
    cur.mv += r.mv;
    cur.symbols.add(r.symbol);
    sectorMvMap.set(sec, cur);
  }
  const sectorRows: SectorRow[] = [...sectorMvMap.entries()]
    .map(([bucket, v]) => ({
      bucket,
      symbols: v.symbols.size,
      mv: v.mv,
      weightPct: totalMv > 0 ? (v.mv / totalMv) * 100 : 0,
    }))
    .sort((a, b) => b.mv - a.mv);

  // Portfolio + benchmark XIRR.
  const cashflows = tradesToCashflows(allTrades);
  let portfolioXirr: number | null = null;
  let niftyXirr: number | null = null;
  if (cashflows.length > 0) {
    const portCfs: Cashflow[] = [...cashflows];
    if (totalMv > 0) portCfs.push({ date: asOfDate, amount: totalMv });
    portfolioXirr = safeXirr(portCfs);

    try {
      const startDate = cashflows[0]!.date;
      const series = await getNifty50SeriesCached(startDate, asOfDate);
      const currentNifty = (await fetchNifty50Close(asOfDate)) ?? 0;
      if (currentNifty > 0) {
        niftyXirr = computeBenchmarkXirr(cashflows, series, currentNifty, asOfDate);
      }
    } catch {
      niftyXirr = null;
    }
  }

  return {
    portfolioName: portfolio.name,
    asOfDate,
    generatedAt: new Date().toISOString(),
    invested: totalCost,
    marketValue: totalMv,
    unrealized: totalUnrealized,
    realizedYtd,
    realizedAllTime,
    portfolioXirr,
    niftyXirr,
    topHoldings,
    topRealizedYtd,
    sectorRows,
    cohortFyRows,
  };
}

// ─── Drawing helpers ─────────────────────────────────────────────────────────

type Doc = InstanceType<typeof PDFDocument>;

function drawHRule(doc: Doc, y: number) {
  doc
    .moveTo(PAGE_MARGIN, y)
    .lineTo(PAGE_MARGIN + CONTENT_W, y)
    .lineWidth(0.5)
    .strokeColor(COL_BORDER)
    .stroke();
}

function pnlColor(n: number | null | undefined): string {
  if (n == null) return COL_MUTED;
  return n >= 0 ? COL_POS : COL_NEG;
}

function ensureSpace(doc: Doc, needed: number) {
  if (doc.y + needed > doc.page.height - PAGE_MARGIN - 24) {
    doc.addPage();
  }
}

function drawSectionHeader(doc: Doc, title: string) {
  ensureSpace(doc, 40);
  doc.moveDown(0.5);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(COL_FG).text(title);
  doc.moveDown(0.2);
  drawHRule(doc, doc.y);
  doc.moveDown(0.4);
}

type ColSpec = {
  header: string;
  width: number;
  align?: 'left' | 'right';
  color?: (raw: unknown) => string;
};

function drawTable(
  doc: Doc,
  cols: ColSpec[],
  rows: string[][],
  rowColors?: Array<Record<number, string>>,
) {
  const rowH = 16;
  const headerH = 18;

  // Header
  ensureSpace(doc, headerH + rowH * 2);
  let x = PAGE_MARGIN;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(COL_MUTED);
  for (const c of cols) {
    doc.text(c.header.toUpperCase(), x + 4, doc.y, {
      width: c.width - 8,
      align: c.align ?? 'left',
      lineBreak: false,
    });
    x += c.width;
  }
  doc.moveDown(0.6);
  drawHRule(doc, doc.y);
  doc.moveDown(0.2);

  // Rows
  doc.font('Helvetica').fontSize(9);
  for (let i = 0; i < rows.length; i++) {
    ensureSpace(doc, rowH);
    const row = rows[i]!;
    const overrides = rowColors?.[i];
    let cx = PAGE_MARGIN;
    const baseY = doc.y;
    for (let j = 0; j < cols.length; j++) {
      const c = cols[j]!;
      const value = row[j] ?? '';
      const color = overrides?.[j] ?? COL_FG;
      doc.fillColor(color);
      doc.text(value, cx + 4, baseY, {
        width: c.width - 8,
        align: c.align ?? 'left',
        lineBreak: false,
      });
      cx += c.width;
    }
    doc.y = baseY + rowH;
    if (i < rows.length - 1) {
      doc
        .moveTo(PAGE_MARGIN, doc.y - 2)
        .lineTo(PAGE_MARGIN + CONTENT_W, doc.y - 2)
        .lineWidth(0.25)
        .strokeColor(COL_BORDER)
        .stroke();
    }
  }
  doc.moveDown(0.5);
}

function drawCover(doc: Doc, d: SnapshotData) {
  doc.font('Helvetica-Bold').fontSize(22).fillColor(COL_ACCENT);
  doc.text('Monthly Portfolio Snapshot', PAGE_MARGIN, PAGE_MARGIN + 16);

  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(11).fillColor(COL_FG);
  doc.text(d.portfolioName);

  doc.moveDown(0.3);
  doc.font('Helvetica').fontSize(10).fillColor(COL_MUTED);
  doc.text(`As of ${d.asOfDate}`);
  doc.text(`Generated ${d.generatedAt.replace('T', ' ').replace(/\..+$/, '')} UTC`);

  doc.moveDown(0.6);
  drawHRule(doc, doc.y);
  doc.moveDown(0.4);
}

function drawSummary(doc: Doc, d: SnapshotData) {
  drawSectionHeader(doc, 'Summary');

  const xirrDelta =
    d.portfolioXirr != null && d.niftyXirr != null ? d.portfolioXirr - d.niftyXirr : null;

  const items: Array<{ label: string; value: string; color?: string }> = [
    { label: 'Invested', value: fmtInr(d.invested) },
    { label: 'Market Value', value: fmtInr(d.marketValue) },
    {
      label: 'Unrealized P&L',
      value: fmtSignedInr(d.unrealized),
      color: pnlColor(d.unrealized),
    },
    {
      label: 'Realized YTD',
      value: fmtSignedInr(d.realizedYtd),
      color: pnlColor(d.realizedYtd),
    },
    {
      label: 'Realized All-Time',
      value: fmtSignedInr(d.realizedAllTime),
      color: pnlColor(d.realizedAllTime),
    },
    { label: 'Portfolio XIRR', value: fmtPct(d.portfolioXirr) },
    { label: 'Nifty 50 XIRR', value: fmtPct(d.niftyXirr) },
    {
      label: 'Alpha vs Nifty',
      value: fmtPct(xirrDelta),
      color: pnlColor(xirrDelta),
    },
  ];

  // 4-up grid, two rows of four.
  const cols = 4;
  const colW = CONTENT_W / cols;
  const cellH = 46;
  const startY = doc.y;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    const r = Math.floor(i / cols);
    const c = i % cols;
    const x = PAGE_MARGIN + c * colW;
    const y = startY + r * cellH;
    doc.font('Helvetica').fontSize(8).fillColor(COL_MUTED);
    doc.text(item.label.toUpperCase(), x + 6, y + 4, {
      width: colW - 12,
      lineBreak: false,
    });
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor(item.color ?? COL_FG);
    doc.text(item.value, x + 6, y + 18, { width: colW - 12, lineBreak: false });
    // light border
    doc
      .rect(x + 2, y + 2, colW - 4, cellH - 6)
      .lineWidth(0.5)
      .strokeColor(COL_BORDER)
      .stroke();
  }
  doc.y = startY + Math.ceil(items.length / cols) * cellH + 6;
}

function drawHoldings(doc: Doc, d: SnapshotData) {
  drawSectionHeader(doc, `Top Holdings (${d.topHoldings.length})`);

  if (d.topHoldings.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor(COL_MUTED).text('No open positions.');
    return;
  }

  const cols: ColSpec[] = [
    { header: 'Symbol', width: 110 },
    { header: 'Qty', width: 50, align: 'right' },
    { header: 'Avg Cost', width: 65, align: 'right' },
    { header: 'Last', width: 60, align: 'right' },
    { header: 'Mkt Value', width: 75, align: 'right' },
    { header: 'Unrealized', width: 80, align: 'right' },
    { header: 'Weight', width: 60, align: 'right' },
  ];

  const rows: string[][] = [];
  const colors: Array<Record<number, string>> = [];
  for (const r of d.topHoldings) {
    rows.push([
      r.symbol,
      fmtNum(r.qty, 0),
      `Rs ${fmtNum(r.avgCost, 2)}`,
      r.cmp != null ? `Rs ${fmtNum(r.cmp, 2)}` : '—',
      fmtInr(r.mv),
      r.unrealized != null ? fmtSignedInr(r.unrealized) : '—',
      fmtPctRaw(r.weightPct),
    ]);
    const c: Record<number, string> = {};
    if (r.unrealized != null) c[5] = pnlColor(r.unrealized);
    colors.push(c);
  }

  drawTable(doc, cols, rows, colors);
}

function drawRealizedYtd(doc: Doc, d: SnapshotData) {
  drawSectionHeader(doc, `Realized YTD (top ${d.topRealizedYtd.length} by absolute P&L)`);

  if (d.topRealizedYtd.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor(COL_MUTED).text('No realized trades this FY.');
    return;
  }

  const cols: ColSpec[] = [
    { header: 'Symbol', width: 130 },
    { header: 'Sell Date', width: 90 },
    { header: 'Qty', width: 60, align: 'right' },
    { header: 'P&L', width: 110, align: 'right' },
    { header: 'Held', width: 60, align: 'right' },
    { header: 'Type', width: 50, align: 'right' },
  ];

  const rows: string[][] = [];
  const colors: Array<Record<number, string>> = [];
  for (const r of d.topRealizedYtd) {
    rows.push([
      r.symbol,
      r.sellDate,
      fmtNum(r.qty, 0),
      fmtSignedInr(r.pnl),
      `${r.holdingDays}d`,
      r.holdingDays >= 365 ? 'LTCG' : 'STCG',
    ]);
    colors.push({ 3: pnlColor(r.pnl) });
  }

  drawTable(doc, cols, rows, colors);
}

function drawSectors(doc: Doc, d: SnapshotData) {
  drawSectionHeader(doc, 'Sector Allocation');

  if (d.sectorRows.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor(COL_MUTED).text('No holdings.');
    return;
  }

  const cols: ColSpec[] = [
    { header: 'Sector', width: 220 },
    { header: 'Symbols', width: 70, align: 'right' },
    { header: 'Mkt Value', width: 110, align: 'right' },
    { header: 'Weight', width: 90, align: 'right' },
  ];

  const rows = d.sectorRows.map((r) => [
    r.bucket,
    fmtNum(r.symbols, 0),
    fmtInr(r.mv),
    fmtPctRaw(r.weightPct),
  ]);

  drawTable(doc, cols, rows);
}

function drawCohortsFy(doc: Doc, d: SnapshotData) {
  drawSectionHeader(doc, 'Cohorts by Entry Financial Year');

  if (d.cohortFyRows.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor(COL_MUTED).text('No cohorts.');
    return;
  }

  const cols: ColSpec[] = [
    { header: 'FY', width: 60 },
    { header: 'Symbols', width: 60, align: 'right' },
    { header: 'Invested', width: 90, align: 'right' },
    { header: 'Mkt Value', width: 90, align: 'right' },
    { header: 'Realized', width: 90, align: 'right' },
    { header: 'Unrealized', width: 100, align: 'right' },
  ];

  const rows: string[][] = [];
  const colors: Array<Record<number, string>> = [];
  for (const r of d.cohortFyRows) {
    rows.push([
      r.bucket,
      fmtNum(r.symbols, 0),
      fmtInr(r.invested),
      fmtInr(r.mv),
      r.realized !== 0 ? fmtSignedInr(r.realized) : '—',
      r.unrealized !== 0 ? fmtSignedInr(r.unrealized) : '—',
    ]);
    colors.push({
      4: r.realized !== 0 ? pnlColor(r.realized) : COL_MUTED,
      5: r.unrealized !== 0 ? pnlColor(r.unrealized) : COL_MUTED,
    });
  }

  drawTable(doc, cols, rows, colors);
}

/**
 * Lay down a footer ("Generated by stock-platform • page X of N") on every
 * page after the document body has been written. Must be called *before*
 * `doc.end()`.
 */
function drawFooters(doc: Doc) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const y = doc.page.height - PAGE_MARGIN + 6;
    doc
      .moveTo(PAGE_MARGIN, y - 6)
      .lineTo(PAGE_MARGIN + CONTENT_W, y - 6)
      .lineWidth(0.5)
      .strokeColor(COL_BORDER)
      .stroke();
    doc.font('Helvetica').fontSize(8).fillColor(COL_MUTED);
    doc.text('Generated by stock-platform', PAGE_MARGIN, y, {
      width: CONTENT_W / 2,
      lineBreak: false,
    });
    doc.text(`Page ${i + 1} of ${range.count}`, PAGE_MARGIN + CONTENT_W / 2, y, {
      width: CONTENT_W / 2,
      align: 'right',
      lineBreak: false,
    });
  }
}

/**
 * Generate a monthly portfolio snapshot PDF. Returns a Buffer suitable for
 * sending as `application/pdf`. Idempotent — pure function of (db, asOfDate).
 *
 * `asOfDate` is the YYYY-MM-DD label used on the cover and as the terminal
 * cashflow date for XIRR computation. Latest available EOD prices are used
 * for current MV (we don't time-travel the price history).
 */
export async function generateMonthlySnapshotPdf(
  db: Db,
  portfolioId: string,
  asOfDate: string,
): Promise<Buffer> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    throw new Error(`generateMonthlySnapshotPdf: bad asOfDate '${asOfDate}'`);
  }

  const data = await buildSnapshotData(db, portfolioId, asOfDate);

  const doc = new PDFDocument({
    size: 'A4',
    margin: PAGE_MARGIN,
    bufferPages: true,
    info: {
      Title: `${data.portfolioName} — Snapshot ${data.asOfDate}`,
      Author: 'stock-platform',
      CreationDate: new Date(),
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((res) => doc.on('end', () => res()));

  drawCover(doc, data);
  drawSummary(doc, data);
  drawHoldings(doc, data);
  drawRealizedYtd(doc, data);
  drawSectors(doc, data);
  drawCohortsFy(doc, data);

  drawFooters(doc);
  doc.end();

  await done;
  return Buffer.concat(chunks);
}

// Re-export today helper for callers that don't want to import format directly.
export { todayIso };
