import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const uuid = () => crypto.randomUUID();
const nowMs = () => Date.now();

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const users = sqliteTable('users', {
  id: text('id').primaryKey().$defaultFn(uuid),
  passwordHash: text('password_hash').notNull(),
  createdAt: integer('created_at').notNull().$defaultFn(nowMs),
  lastLoginAt: integer('last_login_at'),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at').notNull(),
    csrfToken: text('csrf_token').notNull(),
    ipHash: text('ip_hash'),
    uaHash: text('ua_hash'),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    userIdx: index('sessions_user_idx').on(t.userId),
  }),
);

// ---------------------------------------------------------------------------
// Portfolios / brokers / accounts
// ---------------------------------------------------------------------------

export const portfolios = sqliteTable('portfolios', {
  id: text('id').primaryKey().$defaultFn(uuid),
  name: text('name').notNull(),
  baseCurrency: text('base_currency').notNull().default('INR'),
  createdAt: integer('created_at').notNull().$defaultFn(nowMs),
  archivedAt: integer('archived_at'),
});

export const brokers = sqliteTable(
  'brokers',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    code: text('code').notNull(),
  },
  (t) => ({
    codeUx: uniqueIndex('brokers_code_ux').on(t.code),
  }),
);

export const accounts = sqliteTable(
  'accounts',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    brokerId: text('broker_id')
      .notNull()
      .references(() => brokers.id, { onDelete: 'restrict' }),
    alias: text('alias').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    portfolioIdx: index('accounts_portfolio_idx').on(t.portfolioId),
  }),
);

// ---------------------------------------------------------------------------
// Trades
// ---------------------------------------------------------------------------

export const trades = sqliteTable(
  'trades',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    isin: text('isin'),
    tradeDate: text('trade_date').notNull(), // ISO date YYYY-MM-DD
    side: text('side', { enum: ['buy', 'sell'] }).notNull(),
    qty: real('qty').notNull(),
    price: real('price').notNull(),
    currency: text('currency').notNull().default('INR'),
    exchange: text('exchange'),
    segment: text('segment'),
    series: text('series'),
    tradeId: text('trade_id'),
    orderId: text('order_id'),
    execTime: text('exec_time'),
    sourceFileHash: text('source_file_hash'),
    sourceRowIdx: integer('source_row_idx'),
    isIntradayPairId: text('is_intraday_pair_id'),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    accountTradeUx: uniqueIndex('trades_account_trade_id_ux').on(t.accountId, t.tradeId),
    accountSymbolDateIdx: index('trades_account_symbol_date_idx').on(
      t.accountId,
      t.symbol,
      t.tradeDate,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Instruments / prices / fx / corp actions / events / filings
// ---------------------------------------------------------------------------

export const instruments = sqliteTable('instruments', {
  symbol: text('symbol').primaryKey(),
  isin: text('isin'),
  name: text('name'),
  sector: text('sector'),
  industry: text('industry'),
  currency: text('currency').notNull().default('INR'),
  listingExchange: text('listing_exchange'),
  country: text('country'),
});

export const pricesEod = sqliteTable(
  'prices_eod',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    symbol: text('symbol').notNull(),
    date: text('date').notNull(),
    open: real('open'),
    high: real('high'),
    low: real('low'),
    close: real('close'),
    adjClose: real('adj_close'),
    volume: real('volume'),
    source: text('source'),
  },
  (t) => ({
    symbolDateUx: uniqueIndex('prices_eod_symbol_date_ux').on(t.symbol, t.date),
  }),
);

export const fxRates = sqliteTable(
  'fx_rates',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    date: text('date').notNull(),
    base: text('base').notNull(),
    quote: text('quote').notNull(),
    rate: real('rate').notNull(),
    source: text('source'),
  },
  (t) => ({
    dateBaseQuoteUx: uniqueIndex('fx_rates_date_base_quote_ux').on(t.date, t.base, t.quote),
  }),
);

export const corporateActions = sqliteTable('corporate_actions', {
  id: text('id').primaryKey().$defaultFn(uuid),
  symbol: text('symbol').notNull(),
  exDate: text('ex_date').notNull(),
  type: text('type').notNull(), // 'split'|'bonus'|'dividend'|'rights'
  ratio: text('ratio'),
  notes: text('notes'),
  source: text('source'),
});

export const EVENT_TYPES = ['earnings', 'agm', 'ex_div', 'record_date', 'other'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_SOURCES = ['manual', 'skill', 'file'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    eventType: text('event_type', { enum: EVENT_TYPES }).notNull(),
    eventDate: text('event_date').notNull(), // ISO YYYY-MM-DD
    title: text('title').notNull(),
    notes: text('notes'),
    source: text('source', { enum: EVENT_SOURCES }).notNull().default('manual'),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    portfolioDateIdx: index('events_portfolio_date_idx').on(t.portfolioId, t.eventDate),
    portfolioSymbolIdx: index('events_portfolio_symbol_idx').on(t.portfolioId, t.symbol),
    dedupeUx: uniqueIndex('events_dedupe_ux').on(
      t.portfolioId,
      t.symbol,
      t.eventType,
      t.eventDate,
      t.title,
    ),
  }),
);

export const FILING_TYPES = [
  'annual_report',
  'quarterly_results',
  'announcement',
  'investor_presentation',
  'other',
] as const;
export type FilingType = (typeof FILING_TYPES)[number];

export const FILING_TRIAGES = ['read_now', 'skim', 'ignore'] as const;
export type FilingTriage = (typeof FILING_TRIAGES)[number];

export const filings = sqliteTable(
  'filings',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull(),
    filingType: text('filing_type', { enum: FILING_TYPES }).notNull(),
    triage: text('triage', { enum: FILING_TRIAGES }),
    summaryOneLine: text('summary_one_line'),
    publishedAt: text('published_at'),
    isRead: integer('is_read').notNull().default(0),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    portfolioUrlUx: uniqueIndex('filings_portfolio_url_ux').on(t.portfolioId, t.url),
    portfolioSymbolIdx: index('filings_portfolio_symbol_idx').on(t.portfolioId, t.symbol),
    portfolioReadIdx: index('filings_portfolio_read_idx').on(t.portfolioId, t.isRead),
  }),
);

export const newsItems = sqliteTable(
  'news_items',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull(),
    publishedAt: text('published_at'),
    source: text('source'),
    isRead: integer('is_read').notNull().default(0),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    portfolioUrlUx: uniqueIndex('news_items_portfolio_url_ux').on(t.portfolioId, t.url),
    portfolioSymbolIdx: index('news_items_portfolio_symbol_idx').on(t.portfolioId, t.symbol),
    portfolioReadIdx: index('news_items_portfolio_read_idx').on(t.portfolioId, t.isRead),
  }),
);

// ---------------------------------------------------------------------------
// Portfolio-scoped: watchlist, notes
// ---------------------------------------------------------------------------

export const watchlist = sqliteTable(
  'watchlist',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    thesis: text('thesis'),
    targetBuyPrice: real('target_buy_price'),
    targetSellPrice: real('target_sell_price'),
    conviction: text('conviction', { enum: ['high', 'medium', 'low'] })
      .notNull()
      .default('medium'),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
    updatedAt: integer('updated_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    portfolioSymbolUx: uniqueIndex('watchlist_portfolio_symbol_ux').on(t.portfolioId, t.symbol),
  }),
);

export type ThesisChecklistItem = {
  item: string;
  expected: 'pass' | 'fail' | 'unknown';
};

export const theses = sqliteTable(
  'theses',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    thesisMd: text('thesis_md').notNull().default(''),
    checklistJson: text('checklist_json', { mode: 'json' })
      .$type<ThesisChecklistItem[]>()
      .notNull()
      .default(sql`('[]')`),
    entryDate: text('entry_date'),
    targetReviewDate: text('target_review_date'),
    lastReviewedAt: text('last_reviewed_at'),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
    updatedAt: integer('updated_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    portfolioSymbolUx: uniqueIndex('theses_portfolio_symbol_ux').on(t.portfolioId, t.symbol),
  }),
);

export const notes = sqliteTable('notes', {
  id: text('id').primaryKey().$defaultFn(uuid),
  portfolioId: text('portfolio_id')
    .notNull()
    .references(() => portfolios.id, { onDelete: 'cascade' }),
  symbol: text('symbol'),
  bodyMd: text('body_md').notNull(),
  tags: text('tags'),
  createdAt: integer('created_at').notNull().$defaultFn(nowMs),
});

// ---------------------------------------------------------------------------
// Idea-generate candidates (Phase 4 #27)
// ---------------------------------------------------------------------------

export const CONVICTION_LEVELS = ['high', 'medium', 'low'] as const;
export type ConvictionLevel = (typeof CONVICTION_LEVELS)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const candidates = sqliteTable(
  'candidates',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    runId: text('run_id').notNull(),
    symbol: text('symbol').notNull(),
    name: text('name').notNull(),
    thesisMd: text('thesis_md').notNull().default(''),
    convictionLevel: text('conviction_level', { enum: CONVICTION_LEVELS }).notNull(),
    riskLevel: text('risk_level', { enum: RISK_LEVELS }).notNull(),
    keyRatiosJson: text('key_ratios_json').notNull().default('{}'),
    entryFair: real('entry_fair'),
    entryStrong: real('entry_strong'),
    matchingCodexRulesJson: text('matching_codex_rules_json').notNull().default('[]'),
    runAt: text('run_at').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    portfolioRunSymbolUx: uniqueIndex('candidates_portfolio_run_symbol_ux').on(
      t.portfolioId,
      t.runId,
      t.symbol,
    ),
    portfolioIdx: index('candidates_portfolio_idx').on(t.portfolioId),
    portfolioRunIdx: index('candidates_portfolio_run_idx').on(t.portfolioId, t.runId),
  }),
);

// ---------------------------------------------------------------------------
// LLM outputs
// ---------------------------------------------------------------------------

export type ResearchOutput = Record<string, unknown>;

export const researchRuns = sqliteTable('research_runs', {
  id: text('id').primaryKey().$defaultFn(uuid),
  portfolioId: text('portfolio_id').references(() => portfolios.id, {
    onDelete: 'cascade',
  }),
  symbol: text('symbol').notNull(),
  skill: text('skill').notNull(),
  inputHash: text('input_hash').notNull(),
  outputPath: text('output_path'),
  outputJson: text('output_json', { mode: 'json' }).$type<ResearchOutput>(),
  createdAt: integer('created_at').notNull().$defaultFn(nowMs),
});

// ---------------------------------------------------------------------------
// Investor Wisdom Codex
// ---------------------------------------------------------------------------

export const investors = sqliteTable(
  'investors',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    styleSummaryMd: text('style_summary_md'),
  },
  (t) => ({
    slugUx: uniqueIndex('investors_slug_ux').on(t.slug),
  }),
);

export const investorStyles = sqliteTable(
  'investor_styles',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    name: text('name').notNull(),
    descriptionMd: text('description_md'),
  },
  (t) => ({
    nameUx: uniqueIndex('investor_styles_name_ux').on(t.name),
  }),
);

export const codexSources = sqliteTable('codex_sources', {
  id: text('id').primaryKey().$defaultFn(uuid),
  investorId: text('investor_id')
    .notNull()
    .references(() => investors.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  url: text('url').notNull(),
  kind: text('kind').notNull(),
  fetchedAt: integer('fetched_at').notNull().$defaultFn(nowMs),
  sha256: text('sha256'),
  licenseNote: text('license_note'),
});

export const codexExtracted = sqliteTable('codex_extracted', {
  id: text('id').primaryKey().$defaultFn(uuid),
  sourceId: text('source_id')
    .notNull()
    .references(() => codexSources.id, { onDelete: 'cascade' }),
  anchor: text('anchor').notNull(),
  markdownPath: text('markdown_path').notNull(),
});

export type CodexDistilledJson = Record<string, unknown>;

export const codexDistilled = sqliteTable('codex_distilled', {
  id: text('id').primaryKey().$defaultFn(uuid),
  investorId: text('investor_id')
    .notNull()
    .references(() => investors.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  json: text('json', { mode: 'json' }).$type<CodexDistilledJson>().notNull(),
  version: text('version').notNull(),
});

export const codexVersions = sqliteTable(
  'codex_versions',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    semver: text('semver').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
    notesMd: text('notes_md'),
  },
  (t) => ({
    semverUx: uniqueIndex('codex_versions_semver_ux').on(t.semver),
  }),
);

export type CodexRuleConditions = {
  valuation?: string;
  fundamentals?: string;
  narrative?: string;
  price_action?: string;
  time_in_position?: string;
  [k: string]: unknown;
};

export const codexRules = sqliteTable('codex_rules', {
  id: text('id').primaryKey().$defaultFn(uuid),
  versionId: text('version_id')
    .notNull()
    .references(() => codexVersions.id, { onDelete: 'cascade' }),
  statement: text('statement').notNull(),
  action: text('action', {
    enum: ['fresh_buy', 'add', 'hold', 'trim_25', 'trim_50', 'exit'],
  }).notNull(),
  conditionsJson: text('conditions_json', { mode: 'json' }).$type<CodexRuleConditions>().notNull(),
  weight: real('weight').notNull().default(1),
  evidenceStrength: text('evidence_strength', {
    enum: ['weak', 'moderate', 'strong'],
  }).notNull(),
  rationaleMd: text('rationale_md'),
});

export const codexRuleCitations = sqliteTable('codex_rule_citations', {
  id: text('id').primaryKey().$defaultFn(uuid),
  ruleId: text('rule_id')
    .notNull()
    .references(() => codexRules.id, { onDelete: 'cascade' }),
  sourceId: text('source_id')
    .notNull()
    .references(() => codexSources.id, { onDelete: 'cascade' }),
  quote: text('quote').notNull(),
  pageOrTimestamp: text('page_or_timestamp'),
});

export const codexStyleWeights = sqliteTable(
  'codex_style_weights',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    styleId: text('style_id')
      .notNull()
      .references(() => investorStyles.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id')
      .notNull()
      .references(() => codexRules.id, { onDelete: 'cascade' }),
    weight: real('weight').notNull(),
  },
  (t) => ({
    styleRuleUx: uniqueIndex('codex_style_weights_style_rule_ux').on(t.styleId, t.ruleId),
  }),
);

export const userStyleProfile = sqliteTable(
  'user_style_profile',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    styleId: text('style_id')
      .notNull()
      .references(() => investorStyles.id, { onDelete: 'cascade' }),
    weight: real('weight').notNull(),
  },
  (t) => ({
    portfolioStyleUx: uniqueIndex('user_style_profile_portfolio_style_ux').on(
      t.portfolioId,
      t.styleId,
    ),
  }),
);

export const codexBacktests = sqliteTable('codex_backtests', {
  id: text('id').primaryKey().$defaultFn(uuid),
  ruleId: text('rule_id')
    .notNull()
    .references(() => codexRules.id, { onDelete: 'cascade' }),
  universe: text('universe').notNull(),
  periodStart: text('period_start').notNull(),
  periodEnd: text('period_end').notNull(),
  nSignals: integer('n_signals').notNull(),
  hitRate: real('hit_rate'),
  avgReturn: real('avg_return'),
  maxDd: real('max_dd'),
});

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type DecisionPayload = {
  votes?: Array<{ ruleId: string; action: string; weight: number }>;
  citations?: Array<{ ruleId: string; sourceId: string; quote: string }>;
  inputs?: Record<string, unknown>;
  [k: string]: unknown;
};

export const decisions = sqliteTable('decisions', {
  id: text('id').primaryKey().$defaultFn(uuid),
  portfolioId: text('portfolio_id')
    .notNull()
    .references(() => portfolios.id, { onDelete: 'cascade' }),
  symbol: text('symbol').notNull(),
  snapshotAt: integer('snapshot_at').notNull().$defaultFn(nowMs),
  action: text('action', {
    enum: ['fresh_buy', 'add', 'hold', 'trim_25', 'trim_50', 'exit'],
  }).notNull(),
  score: real('score').notNull(),
  ruleLibraryVersion: text('rule_library_version').notNull(),
  payloadJson: text('payload_json', { mode: 'json' }).$type<DecisionPayload>().notNull(),
});

// Per-portfolio investor style weights (Phase 5 #29 — Style Mixer).
// Stored as a JSON map of { investor_slug: weight ∈ [0,1] } summing to 1.
export type StyleWeightsJson = Record<string, number>;

export const portfolioStyleWeights = sqliteTable(
  'portfolio_style_weights',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    weightsJson: text('weights_json', { mode: 'json' })
      .$type<StyleWeightsJson>()
      .notNull()
      .default(sql`('{}')`),
    updatedAt: integer('updated_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    portfolioUx: uniqueIndex('portfolio_style_weights_portfolio_ux').on(t.portfolioId),
  }),
);

// ---------------------------------------------------------------------------
// In-app alerts
// ---------------------------------------------------------------------------

export const ALERT_RULE_TYPES = [
  'cmp_below',
  'cmp_above',
  'pct_drop_from_52w_high',
  'pct_rise_from_52w_low',
  'volume_spike',
] as const;

export type AlertRuleType = (typeof ALERT_RULE_TYPES)[number];

export const alertRules = sqliteTable(
  'alert_rules',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    symbol: text('symbol'),
    ruleType: text('rule_type', { enum: ALERT_RULE_TYPES }).notNull(),
    threshold: real('threshold').notNull(),
    enabled: integer('enabled').notNull().default(1),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    portfolioIdx: index('alert_rules_portfolio_idx').on(t.portfolioId),
  }),
);

export const alertEvents = sqliteTable(
  'alert_events',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id')
      .notNull()
      .references(() => alertRules.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    triggeredAt: text('triggered_at').notNull(),
    currentValue: real('current_value').notNull(),
    triggerValue: real('trigger_value').notNull(),
    message: text('message').notNull(),
    isAcked: integer('is_acked').notNull().default(0),
  },
  (t) => ({
    portfolioIdx: index('alert_events_portfolio_idx').on(t.portfolioId),
    ruleIdx: index('alert_events_rule_idx').on(t.ruleId),
  }),
);

// ---------------------------------------------------------------------------
// Rebalance targets
// ---------------------------------------------------------------------------

export const REBALANCE_MODES = ['symbol', 'sector'] as const;
export type RebalanceMode = (typeof REBALANCE_MODES)[number];

export const rebalanceTargets = sqliteTable(
  'rebalance_targets',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    mode: text('mode', { enum: REBALANCE_MODES }).notNull(),
    key: text('key').notNull(),
    targetPct: real('target_pct').notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
    updatedAt: integer('updated_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    portfolioModeKeyUx: uniqueIndex('rebalance_targets_portfolio_mode_key_ux').on(
      t.portfolioId,
      t.mode,
      t.key,
    ),
    portfolioIdx: index('rebalance_targets_portfolio_idx').on(t.portfolioId),
  }),
);

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------

export const dividends = sqliteTable(
  'dividends',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    symbol: text('symbol').notNull(),
    isin: text('isin'),
    exDate: text('ex_date').notNull(),
    qty: real('qty').notNull(),
    dividendPerShare: real('dividend_per_share').notNull(),
    netAmount: real('net_amount').notNull(),
    currency: text('currency').notNull().default('INR'),
    sourceFileHash: text('source_file_hash'),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    portfolioSymbolDateUx: uniqueIndex('dividends_portfolio_symbol_date_amount_ux').on(
      t.portfolioId,
      t.symbol,
      t.exDate,
      t.qty,
      t.netAmount,
    ),
    portfolioIdx: index('dividends_portfolio_idx').on(t.portfolioId),
  }),
);

// ---------------------------------------------------------------------------
// Target CAGR plans
// ---------------------------------------------------------------------------

export type CagrPlanJson = Record<string, unknown>;

export const cagrPlans = sqliteTable(
  'cagr_plans',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    portfolioId: text('portfolio_id')
      .notNull()
      .references(() => portfolios.id, { onDelete: 'cascade' }),
    targetCagrPct: real('target_cagr_pct').notNull(),
    horizonYears: integer('horizon_years').notNull(),
    currentForecastCagr: real('current_forecast_cagr').notNull(),
    proposedForecastCagr: real('proposed_forecast_cagr').notNull(),
    planJson: text('plan_json', { mode: 'json' }).$type<CagrPlanJson>().notNull(),
    createdAt: integer('created_at').notNull().$defaultFn(nowMs),
  },
  (t) => ({
    portfolioIdx: index('cagr_plans_portfolio_idx').on(t.portfolioId),
    portfolioCreatedIdx: index('cagr_plans_portfolio_created_idx').on(t.portfolioId, t.createdAt),
  }),
);

// SQL helper for tests / consumers
export const _sqlNow = sql`(unixepoch() * 1000)`;
