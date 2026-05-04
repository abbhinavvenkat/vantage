/**
 * Build the v0.2 Rule Library from the curated stalwart corpus + consensus +
 * backtest summary.
 *
 *   npx tsx scripts/run-codex-v2.ts
 */

import { synthesizeFromCorpus, writeCorpusLibrary } from '@/lib/codex/synthesizeFromCorpus';

function main() {
  const lib = synthesizeFromCorpus(
    {
      stalwartsRoot: 'data/investor_stalwarts',
      consensusPath: 'data/codex/synthesized/consensus.md',
      backtestSummaryPath: 'data/codex/backtests/results/summary.json',
    },
    '0.2.0',
  );
  const path = writeCorpusLibrary(lib);
  console.log(`Wrote ${path}`);
  console.log(`investors: ${lib._meta?.investors_processed}`);
  console.log(`rules: ${lib.rules.length}`);
  console.log(`by action: ${JSON.stringify(lib._meta?.rules_by_action)}`);
  console.log(`schools: ${lib._meta?.schools_represented.join(', ')}`);
  console.log('top 10 by weight:');
  for (const t of lib._meta?.top_rules_by_weight ?? []) {
    console.log(`  ${t.weight.toFixed(2)}  ${t.action.padEnd(10)}  ${t.id}`);
  }
  console.log('backtest contribution:');
  for (const [k, v] of Object.entries(lib._meta?.backtest_contribution ?? {})) {
    console.log(
      `  ${k.padEnd(12)} xirr ${(v.xirr * 100).toFixed(2)}%  alpha +${(v.alpha * 100).toFixed(2)}%`,
    );
  }
}

main();
