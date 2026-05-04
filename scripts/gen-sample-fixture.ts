import { resolve } from 'node:path';
import { writeZerodhaFixture, SYNTHETIC_TRADES } from '@/tests/fixtures/zerodhaSample';

const out = resolve(process.cwd(), 'data/sample/synthetic-tradebook-zerodha.xlsx');
writeZerodhaFixture(out);
console.log(`wrote ${out} (${SYNTHETIC_TRADES.length} trades)`);
