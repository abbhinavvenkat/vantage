import fs from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';

import { BacktestContent } from './BacktestContent';

export const metadata: Metadata = { title: 'Historical Simulation · Stalwarts Wisdom Codex' };

export type PortfolioRow = {
  symbol: string;
  company_name: string;
  sector: string;
  score: number;
  entry_price: number | null;
  exit_price: number | null;
  return_pct: number | null;
  position_value: number | null;
  exit_value: number | null;
};

export type FrameworkResult = {
  xirr: number | null;
  total_return_pct: number | null;
  benchmark_vs_nifty50_xirr_delta: number | null;
  benchmark_vs_bse500_xirr_delta: number | null;
};

export type NarrativePick = {
  symbol: string;
  company_name: string;
  sector: string;
  score: number;
  why: string;
};

export type NarrativePeriod = {
  date: string;
  date_label: string;
  n_stocks: number;
  sector_distribution: Record<string, number>;
  framework_rationale: string;
  top_picks_by_score: NarrativePick[];
  period_stats: {
    avg_return_pct: number | null;
    best: { symbol: string; return_pct: number } | null;
    worst: { symbol: string; return_pct: number } | null;
    n_winners: number;
    n_losers: number;
    period_label: string;
  };
};

export type FrameworkNarrative = {
  framework: string;
  label: string;
  overall_philosophy: string;
  periods: NarrativePeriod[];
  thesis_2026: {
    narrative: string;
    top_picks: NarrativePick[];
    sector_distribution: Record<string, number>;
    key_themes: string[];
  } | null;
};

export type BacktestData = {
  status: 'not_started' | 'running' | 'complete';
  run_at: string | null;
  decision_dates: string[];
  frameworks_done: string[];
  frameworks: Record<string, FrameworkResult>;
  benchmarks: {
    nifty50_xirr: number | null;
    nifty500_equal_weight_xirr: number | null;
    bse500_xirr: number | null;
  };
  portfolios: Record<string, Record<string, PortfolioRow[]>>;
  narratives: Record<string, FrameworkNarrative>;
};

const DATA_DIR = path.join(process.cwd(), 'data', 'codex', 'backtests');
const RESULTS_DIR = path.join(DATA_DIR, 'results');
const DECISION_DATES = ['2016-01-04', '2020-01-02', '2023-01-02', '2026-05-03'];
const FRAMEWORK_LABELS: Record<string, string> = {
  mukherjea: 'Mukherjea CCP',
  prasad: 'Pulak Prasad / Nalanda',
  agrawal: 'Agrawal QGLP',
  greenblatt: 'Greenblatt Magic Formula',
  lynch: 'Lynch PEG',
  graham: 'Graham Value',
  naren: 'Naren Deep Value / Contra',
};
const ALL_FRAMEWORKS = Object.keys(FRAMEWORK_LABELS);

function parseNumber(s: string): number | null {
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function parseCsv(filepath: string): PortfolioRow[] {
  try {
    const raw = fs.readFileSync(filepath, 'utf-8');
    const lines = raw.trim().split('\n');
    if (lines.length < 2) return [];
    return lines.slice(1).map((line) => {
      const [
        symbol,
        company_name,
        sector,
        score,
        entry_price,
        ,
        position_value,
        exit_price,
        exit_value,
        return_pct,
      ] = line.split(',');
      return {
        symbol: symbol ?? '',
        company_name: company_name ?? '',
        sector: sector ?? '',
        score: parseNumber(score ?? '') ?? 0,
        entry_price: parseNumber(entry_price ?? ''),
        exit_price: parseNumber(exit_price ?? ''),
        return_pct: parseNumber(return_pct ?? ''),
        position_value: parseNumber(position_value ?? ''),
        exit_value: parseNumber(exit_value ?? ''),
      };
    });
  } catch {
    return [];
  }
}

function loadNarrative(fw: string): FrameworkNarrative | null {
  const p = path.join(RESULTS_DIR, `${fw}_narrative.json`);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as FrameworkNarrative;
  } catch {
    return null;
  }
}

function loadData(): BacktestData {
  const portfolios: Record<string, Record<string, PortfolioRow[]>> = {};
  const frameworksDone: string[] = [];

  for (const fw of ALL_FRAMEWORKS) {
    for (const dd of DECISION_DATES) {
      const csvPath = path.join(RESULTS_DIR, `${fw}_${dd}.csv`);
      if (fs.existsSync(csvPath)) {
        if (!portfolios[fw]) portfolios[fw] = {};
        portfolios[fw][dd] = parseCsv(csvPath);
        if (!frameworksDone.includes(fw)) frameworksDone.push(fw);
      }
    }
  }

  const narratives: Record<string, FrameworkNarrative> = {};
  for (const fw of ALL_FRAMEWORKS) {
    const n = loadNarrative(fw);
    if (n) narratives[fw] = n;
  }

  const summaryPath = path.join(RESULTS_DIR, 'summary.json');
  if (fs.existsSync(summaryPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
      return {
        status: 'complete',
        run_at: raw.run_at ?? null,
        decision_dates: raw.decision_dates ?? DECISION_DATES,
        frameworks_done: ALL_FRAMEWORKS,
        frameworks: raw.frameworks ?? {},
        benchmarks: {
          nifty50_xirr: raw.benchmarks?.nifty50_xirr ?? null,
          nifty500_equal_weight_xirr: raw.benchmarks?.nifty500_equal_weight_xirr ?? null,
          bse500_xirr: raw.benchmarks?.bse500_xirr ?? null,
        },
        portfolios,
        narratives,
      };
    } catch {
      // fall through
    }
  }

  if (frameworksDone.length === 0) {
    return {
      status: 'not_started',
      run_at: null,
      decision_dates: DECISION_DATES,
      frameworks_done: [],
      frameworks: {},
      benchmarks: { nifty50_xirr: null, nifty500_equal_weight_xirr: null, bse500_xirr: null },
      portfolios: {},
      narratives: {},
    };
  }

  return {
    status: 'running',
    run_at: null,
    decision_dates: DECISION_DATES,
    frameworks_done: frameworksDone,
    frameworks: {},
    benchmarks: { nifty50_xirr: null, nifty500_equal_weight_xirr: null, bse500_xirr: null },
    portfolios,
    narratives,
  };
}

export default function BacktestPage() {
  const data = loadData();
  return (
    <BacktestContent
      data={data}
      frameworkLabels={FRAMEWORK_LABELS}
      allFrameworks={ALL_FRAMEWORKS}
    />
  );
}
