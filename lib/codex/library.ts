/**
 * Helpers to discover + load Rule Library JSON files from data/codex/synthesized/.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { RuleLibrary } from '@/lib/codex/synthesize';

const SYNTH_ROOT = 'data/codex/synthesized';

export function listRuleLibraryVersions(root = SYNTH_ROOT): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((f) => /^v\d+\.\d+\.\d+\.json$/.test(f))
    .map((f) => f.replace(/^v|\.json$/g, ''))
    .sort((a, b) => {
      const pa = a.split('.').map((n) => parseInt(n, 10));
      const pb = b.split('.').map((n) => parseInt(n, 10));
      for (let i = 0; i < 3; i += 1) {
        const da = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (da !== 0) return da;
      }
      return 0;
    });
}

export function loadRuleLibrary(version: string, root = SYNTH_ROOT): RuleLibrary | null {
  const p = join(root, `v${version}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8')) as RuleLibrary;
}

export function loadLatestRuleLibrary(root = SYNTH_ROOT): RuleLibrary | null {
  const versions = listRuleLibraryVersions(root);
  if (versions.length === 0) return null;
  const latest = versions[versions.length - 1];
  return loadRuleLibrary(latest!, root);
}
