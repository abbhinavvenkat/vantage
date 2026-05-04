import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schemas (mirror .claude/rules/research-output-schema.md)
// ---------------------------------------------------------------------------

export const ManifestSourceSchema = z.object({
  type: z.string(),
  fy: z.string().optional(),
  fq: z.string().optional(),
  title: z.string(),
  url: z.string(),
  published_at: z.string().optional(),
  source: z.string().optional(),
  local_path: z.string().optional(),
  sha256_remote: z.string().optional(),
  sha256_local: z.string().optional(),
  license_note: z.string().optional(),
});

export const ManifestSchema = z.object({
  symbol: z.string(),
  isin: z.string().optional(),
  fetched_at: z.string(),
  sources: z.array(ManifestSourceSchema),
  warnings: z
    .array(z.object({ url: z.string(), reason: z.string() }))
    .optional()
    .default([]),
});

export type Manifest = z.infer<typeof ManifestSchema>;

export const ARSummarySchema = z.object({
  symbol: z.string(),
  fy: z.string(),
  source_url: z.string().optional(),
  source_local_path: z.string().optional(),
  generated_at: z.string(),
  business_model_md: z.string().optional().default(''),
  revenue_mix: z
    .array(
      z.object({
        segment: z.string(),
        share_pct: z.number().optional(),
        yoy_growth: z.number().optional(),
      }),
    )
    .optional()
    .default([]),
  growth_drivers_md: z.string().optional().default(''),
  risks_md: z.string().optional().default(''),
  capital_allocation_md: z.string().optional().default(''),
  management_quality_md: z.string().optional().default(''),
  red_flags: z.array(z.string()).optional().default([]),
  key_numbers: z.record(z.string(), z.number().nullable()).optional().default({}),
  checklist_results: z
    .array(
      z.object({
        item: z.string(),
        pass: z.union([z.boolean(), z.literal('unknown')]),
        evidence: z.string().optional(),
        page_ref: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

export type ARSummary = z.infer<typeof ARSummarySchema>;

export const ConcallDigestSchema = z.object({
  symbol: z.string(),
  fq: z.string(),
  source_url: z.string().optional(),
  transcript_local_path: z.string().optional(),
  guidance: z
    .object({
      revenue_growth_yoy: z.number().optional(),
      ebitda_margin: z.number().optional(),
      qualitative: z.string().optional(),
    })
    .optional()
    .default({}),
  kpi_deltas: z
    .array(
      z.object({
        kpi: z.string(),
        value: z.string().optional(),
        delta: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  analyst_question_themes: z
    .array(
      z.object({
        theme: z.string(),
        n_questions: z.number().optional(),
        summary: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
  management_tone: z
    .object({
      score_2_to_2: z.number().optional(),
      'score_-2_to_+2': z.number().optional(),
      notes: z.string().optional(),
    })
    .optional()
    .default({}),
  thesis_impact_md: z.string().optional().default(''),
});

export type ConcallDigest = z.infer<typeof ConcallDigestSchema>;

export const FilingsTriageSchema = z.object({
  symbol: z.string(),
  batch_id: z.string(),
  scanned_at: z.string(),
  filings: z.array(
    z.object({
      url: z.string(),
      title: z.string(),
      type: z.string().optional(),
      triage: z.enum(['read_now', 'skim', 'ignore']),
      summary_one_line: z.string().optional(),
      rationale: z.string().optional(),
    }),
  ),
});

export type FilingsTriage = z.infer<typeof FilingsTriageSchema>;

export const ThesisStressTestSchema = z.object({
  symbol: z.string(),
  thesis_md_hash: z.string().optional(),
  run_at: z.string(),
  checklist: z
    .array(
      z.object({
        item: z.string(),
        pass: z.union([z.boolean(), z.literal('unknown')]),
        evidence_md: z.string().optional(),
        citations: z
          .array(z.object({ url: z.string(), quote: z.string().optional() }))
          .optional()
          .default([]),
      }),
    )
    .optional()
    .default([]),
  verdict: z.enum(['intact', 'watch', 'weakened', 'broken']),
  verdict_rationale_md: z.string().optional().default(''),
});

export type ThesisStressTest = z.infer<typeof ThesisStressTestSchema>;

export const AccountabilityEntrySchema = z.object({
  fq: z.string(),
  guidance_vs_actuals: z
    .array(
      z.object({
        item: z.string(),
        prev_guidance: z.string(),
        actual: z.string(),
        verdict: z.enum(['beat', 'met', 'missed', 'pending', 'na']),
      }),
    )
    .optional()
    .default([]),
  drift_signals: z.array(z.string()).optional().default([]),
  tone_delta: z.number().nullable().optional(),
  verdict: z.enum(['delivered', 'partial', 'missed', 'na']),
});

export const ManagementAccountabilitySchema = z.object({
  symbol: z.string(),
  generated_at: z.string(),
  quarters: z.array(AccountabilityEntrySchema).optional().default([]),
  consistency_score: z.number().min(0).max(1),
  red_flags: z.array(z.string()).optional().default([]),
  thesis_impact_md: z.string().optional().default(''),
});

export type ManagementAccountability = z.infer<typeof ManagementAccountabilitySchema>;

// ---------------------------------------------------------------------------
// File system readers
// ---------------------------------------------------------------------------

export function getResearchRoot(): string {
  return resolve(process.env.RESEARCH_DATA_ROOT ?? './data');
}

function safeReadJson(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function listJsonFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => resolve(dir, f))
      .sort();
  } catch {
    return [];
  }
}

function newestFile(files: string[]): string | null {
  if (files.length === 0) return null;
  let best: { path: string; mtime: number } | null = null;
  for (const p of files) {
    try {
      const m = statSync(p).mtimeMs;
      if (!best || m > best.mtime) best = { path: p, mtime: m };
    } catch {
      /* ignore */
    }
  }
  return best?.path ?? null;
}

export function loadManifest(symbol: string, root = getResearchRoot()): Manifest | null {
  const path = resolve(root, 'sources', symbol, 'manifest.json');
  const raw = safeReadJson(path);
  if (!raw) return null;
  const parsed = ManifestSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function loadARSummaries(symbol: string, root = getResearchRoot()): ARSummary[] {
  const dir = resolve(root, 'research', symbol, 'annual-report-summarize');
  const out: ARSummary[] = [];
  for (const p of listJsonFiles(dir)) {
    const raw = safeReadJson(p);
    if (!raw) continue;
    const parsed = ARSummarySchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => b.fy.localeCompare(a.fy));
}

export function loadConcallDigests(symbol: string, root = getResearchRoot()): ConcallDigest[] {
  const dir = resolve(root, 'research', symbol, 'earnings-call-digest');
  const out: ConcallDigest[] = [];
  for (const p of listJsonFiles(dir)) {
    const raw = safeReadJson(p);
    if (!raw) continue;
    const parsed = ConcallDigestSchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out.sort((a, b) => b.fq.localeCompare(a.fq));
}

export function loadLatestFilingsTriage(
  symbol: string,
  root = getResearchRoot(),
): FilingsTriage | null {
  const dir = resolve(root, 'research', symbol, 'filings-triage');
  const newest = newestFile(listJsonFiles(dir));
  if (!newest) return null;
  const raw = safeReadJson(newest);
  if (!raw) return null;
  const parsed = FilingsTriageSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function loadLatestThesisStressTest(
  symbol: string,
  root = getResearchRoot(),
): ThesisStressTest | null {
  const dir = resolve(root, 'research', symbol, 'thesis-stress-test');
  const newest = newestFile(listJsonFiles(dir));
  if (!newest) return null;
  const raw = safeReadJson(newest);
  if (!raw) return null;
  const parsed = ThesisStressTestSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function loadLatestManagementAccountability(
  symbol: string,
  root = getResearchRoot(),
): ManagementAccountability | null {
  const dir = resolve(root, 'research', symbol, 'management-accountability');
  const newest = newestFile(listJsonFiles(dir));
  if (!newest) return null;
  const raw = safeReadJson(newest);
  if (!raw) return null;
  const parsed = ManagementAccountabilitySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type SymbolResearchBundle = {
  manifest: Manifest | null;
  arSummaries: ARSummary[];
  concallDigests: ConcallDigest[];
  filingsTriage: FilingsTriage | null;
  thesisStressTest: ThesisStressTest | null;
  managementAccountability: ManagementAccountability | null;
};

export function loadSymbolResearch(symbol: string, root = getResearchRoot()): SymbolResearchBundle {
  return {
    manifest: loadManifest(symbol, root),
    arSummaries: loadARSummaries(symbol, root),
    concallDigests: loadConcallDigests(symbol, root),
    filingsTriage: loadLatestFilingsTriage(symbol, root),
    thesisStressTest: loadLatestThesisStressTest(symbol, root),
    managementAccountability: loadLatestManagementAccountability(symbol, root),
  };
}

// ---------------------------------------------------------------------------
// Skill invocation string helpers (for copy-to-clipboard buttons)
// ---------------------------------------------------------------------------

export function buildSkillInvocation(skill: string, args: Record<string, string>): string {
  const argStr = Object.entries(args)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  return `/${skill} ${argStr}`.trim();
}

export function suggestNextFY(arSummaries: ARSummary[]): string {
  // FYxx format. Suggest the most recent + 1.
  const latest = arSummaries[0]?.fy;
  if (!latest) return 'FY25';
  const m = /^FY(\d{2,4})$/.exec(latest);
  if (!m) return latest;
  const n = parseInt(m[1] as string, 10);
  return `FY${(n + 1).toString().padStart(2, '0')}`;
}

export function suggestNextFQ(digests: ConcallDigest[]): string {
  // e.g. Q3-FY26 → next is Q4-FY26 → Q1-FY27
  const latest = digests[0]?.fq;
  if (!latest) return 'Q1-FY26';
  const m = /^Q(\d)-FY(\d{2,4})$/.exec(latest);
  if (!m) return latest;
  const q = parseInt(m[1] as string, 10);
  const fy = parseInt(m[2] as string, 10);
  if (q >= 4) return `Q1-FY${(fy + 1).toString().padStart(2, '0')}`;
  return `Q${q + 1}-FY${fy.toString().padStart(2, '0')}`;
}
