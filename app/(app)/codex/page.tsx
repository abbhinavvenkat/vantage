import fs from 'node:fs';
import path from 'node:path';
import type { Metadata } from 'next';

import { CodexContent } from './CodexContent';

export const metadata: Metadata = { title: 'Stalwarts Wisdom Codex' };

export default function CodexPage() {
  const mdPath = path.join(process.cwd(), 'data', 'codex', 'synthesized', 'consensus.md');
  let content = '';
  try {
    content = fs.readFileSync(mdPath, 'utf-8');
  } catch {
    content =
      '# Investor Codex\n\nConsensus file not found at `data/codex/synthesized/consensus.md`.';
  }
  return <CodexContent content={content} />;
}
