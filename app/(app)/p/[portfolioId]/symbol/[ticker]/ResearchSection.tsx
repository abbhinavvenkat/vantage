/**
 * Single consolidated "Research" section for the per-stock page.
 *
 * Merges what used to live in two separate components / sections:
 *   - ResearchSynthesis (decision-oriented summary tile)
 *   - ResearchPanel     (skill manifest + AR/concall history + filings + events)
 *
 * One function, one section. Keeps the manifest stats + skill invocations on
 * top, then the synthesis verdict tiles (thesis health, accountability,
 * latest AR, latest concall, filings inbox, upcoming events, recent filings).
 *
 * Server Component. No client-side fetching. All data via existing loaders.
 */

import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { ChevronRight } from '@/components/ui/Icons';
import type { EventRow } from '@/lib/db/queries/events';
import type { FilingRow } from '@/lib/db/queries/filings';
import {
  buildSkillInvocation,
  loadSymbolResearch,
  suggestNextFQ,
  suggestNextFY,
} from '@/lib/research/loadOutputs';

import { CopyButton } from './CopyButton';
import { RefreshResearchButton } from './RefreshResearchButton';

type Props = {
  portfolioId: string;
  symbol: string;
  upcomingEvents: EventRow[];
  recentFilings: FilingRow[];
};

const VERDICT_GLYPH: Record<'intact' | 'watch' | 'weakened' | 'broken' | 'untested', string> = {
  intact: '🟢',
  watch: '⚪',
  weakened: '🟡',
  broken: '🔴',
  untested: '⚪',
};

const VERDICT_TONE: Record<
  'intact' | 'watch' | 'weakened' | 'broken' | 'untested',
  'pos' | 'info' | 'warning' | 'neg' | 'neutral'
> = {
  intact: 'pos',
  watch: 'info',
  weakened: 'warning',
  broken: 'neg',
  untested: 'neutral',
};

const VERDICT_LABEL: Record<'intact' | 'watch' | 'weakened' | 'broken' | 'untested', string> = {
  intact: 'Intact',
  watch: 'Watch',
  weakened: 'Weakened',
  broken: 'Broken',
  untested: 'No stress test yet',
};

const QUARTER_TONE: Record<
  'delivered' | 'partial' | 'missed' | 'na',
  'pos' | 'warning' | 'neg' | 'neutral'
> = {
  delivered: 'pos',
  partial: 'warning',
  missed: 'neg',
  na: 'neutral',
};

const TRIAGE_TONE: Record<'read_now' | 'skim' | 'ignore', 'pos' | 'info' | 'neutral'> = {
  read_now: 'pos',
  skim: 'info',
  ignore: 'neutral',
};

function fmtPct(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(1)}%`;
}

function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1e7) return `${(n / 1e7).toFixed(2)} Cr`;
  if (Math.abs(n) >= 1e5) return `${(n / 1e5).toFixed(2)} L`;
  return n.toLocaleString('en-IN');
}

function truncate(s: string, max = 200): { text: string; truncated: boolean } {
  const flat = s.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return { text: flat, truncated: false };
  return { text: `${flat.slice(0, max - 1)}…`, truncated: true };
}

export function ResearchSection({ portfolioId, symbol, upcomingEvents, recentFilings }: Props) {
  const {
    manifest,
    arSummaries,
    concallDigests,
    filingsTriage,
    thesisStressTest,
    managementAccountability,
  } = loadSymbolResearch(symbol);

  const fetchInvocation = buildSkillInvocation('company-research-fetch', { symbol });
  const stressInvocation = buildSkillInvocation('thesis-stress-test', { symbol });
  const accountabilityInvocation = buildSkillInvocation('management-accountability', { symbol });
  const arInvocation = buildSkillInvocation('annual-report-summarize', {
    symbol,
    fy: suggestNextFY(arSummaries),
  });
  const concallInvocation = buildSkillInvocation('earnings-call-digest', {
    symbol,
    fq: suggestNextFQ(concallDigests),
  });

  const verdict = thesisStressTest?.verdict ?? 'untested';
  const latestAr = arSummaries[0] ?? null;
  const latestDigest = concallDigests[0] ?? null;
  const recentDigests = concallDigests.slice(0, 4);

  const arCount = manifest?.sources.filter((s) => s.type === 'annual_report').length ?? 0;
  const concallCount = manifest?.sources.filter((s) => s.type === 'concall_transcript').length ?? 0;
  const otherCount =
    manifest?.sources.filter((s) =>
      ['quarterly_results', 'press_release', 'investor_presentation'].includes(s.type),
    ).length ?? 0;

  const inboxFilings = recentFilings
    .filter((f) => f.triage === 'read_now' || f.triage === 'skim')
    .slice(0, 5);

  return (
    <div className="flex flex-col gap-4">
      {/* ── Manifest + 1-click refresh ───────────────────────────────── */}
      <Card>
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">Research</h3>
            <p className="text-xs text-[var(--color-muted)]">
              Skill outputs from{' '}
              <code className="rounded bg-[var(--color-card-hover)] px-1 py-0.5 font-mono text-[10px]">
                data/research/{symbol}/
              </code>
            </p>
          </div>
        </div>

        {/* 1-click refresh button + live progress */}
        <RefreshResearchButton portfolioId={portfolioId} symbol={symbol} />

        {/* Manifest stats */}
        {manifest ? (
          <div className="mt-4 grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-4 sm:grid-cols-4">
            <Stat label="Annual Reports" value={String(arCount)} />
            <Stat label="Concalls" value={String(concallCount)} />
            <Stat label="Other filings" value={String(otherCount)} />
            <Stat
              label="Last fetch"
              value={new Date(manifest.fetched_at).toISOString().slice(0, 10)}
            />
            {manifest.warnings && manifest.warnings.length > 0 ? (
              <div className="col-span-2 sm:col-span-4">
                <Badge tone="warning">{manifest.warnings.length} fetch warnings</Badge>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-3 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-muted)]">
            No manifest yet. Click Refresh all to fetch sources and run all skills.
          </p>
        )}

        {/* Manual invocations (collapsed by default) */}
        <details className="mt-3 border-t border-[var(--color-border)] pt-3">
          <summary className="cursor-pointer text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase hover:text-[var(--color-fg)]">
            Run manually
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">
            <CopyButton text={fetchInvocation} label="/company-research-fetch" size="sm" />
            <CopyButton text={arInvocation} label="/annual-report-summarize" size="sm" />
            <CopyButton text={concallInvocation} label="/earnings-call-digest" size="sm" />
            <CopyButton
              text={accountabilityInvocation}
              label="/management-accountability"
              size="sm"
            />
            <CopyButton text={stressInvocation} label="/thesis-stress-test" size="sm" />
          </div>
        </details>
      </Card>

      {/* Thesis verdict synthesis tile */}
      <Card padded={false}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="text-2xl leading-none">{VERDICT_GLYPH[verdict]}</div>
            <div>
              <div className="flex items-center gap-2">
                <Badge tone={VERDICT_TONE[verdict]}>{VERDICT_LABEL[verdict]}</Badge>
                {thesisStressTest ? (
                  <span className="text-[11px] text-[var(--color-muted)]">
                    last run {thesisStressTest.run_at.slice(0, 10)}
                  </span>
                ) : null}
              </div>
              {thesisStressTest?.verdict_rationale_md ? (
                <p className="mt-1 max-w-2xl text-xs text-[var(--color-muted)]">
                  {truncate(thesisStressTest.verdict_rationale_md, 220).text}
                </p>
              ) : (
                <p className="mt-1 max-w-2xl text-xs text-[var(--color-muted)]">
                  No stress-test on file. Click Refresh all above to run the full pipeline.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Detailed checklist if available */}
        {thesisStressTest && thesisStressTest.checklist.length > 0 ? (
          <details className="border-t border-[var(--color-border)] px-5 py-4">
            <summary className="cursor-pointer text-[11px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
              Checklist · {thesisStressTest.checklist.length} items
            </summary>
            <ul className="mt-3 space-y-1.5">
              {thesisStressTest.checklist.map((c, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <Badge tone={c.pass === true ? 'pos' : c.pass === false ? 'neg' : 'neutral'}>
                    {c.pass === true ? 'PASS' : c.pass === false ? 'FAIL' : '?'}
                  </Badge>
                  <div className="min-w-0">
                    <span className="font-medium">{c.item}</span>
                    {c.evidence_md ? (
                      <span className="ml-1 text-[var(--color-muted)]">— {c.evidence_md}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Card>

      {/* Management accountability */}
      <Card padded={false}>
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h3 className="text-sm font-semibold">Management accountability</h3>
          <p className="text-xs text-[var(--color-muted)]">
            {managementAccountability
              ? `${managementAccountability.quarters.length} quarters · consistency ${(managementAccountability.consistency_score * 100).toFixed(0)}%`
              : 'Are they doing what they promised?'}
          </p>
        </div>

        {managementAccountability ? (
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-card-hover)]">
                <div
                  className={`h-full rounded-full ${
                    managementAccountability.consistency_score >= 0.7
                      ? 'bg-[var(--color-pos)]'
                      : managementAccountability.consistency_score >= 0.4
                        ? 'bg-[#d97706]'
                        : 'bg-[var(--color-neg)]'
                  }`}
                  style={{
                    width: `${(managementAccountability.consistency_score * 100).toFixed(0)}%`,
                  }}
                />
              </div>
              <span className="tnum shrink-0 text-xs font-semibold">
                {(managementAccountability.consistency_score * 100).toFixed(0)}% delivered
              </span>
            </div>

            {managementAccountability.quarters.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {managementAccountability.quarters.slice(-8).map((q) => (
                  <div key={q.fq} className="flex flex-col items-center gap-1">
                    <Badge tone={QUARTER_TONE[q.verdict]}>{q.verdict}</Badge>
                    <span className="text-[10px] text-[var(--color-muted)]">{q.fq}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {(() => {
              const latest = managementAccountability.quarters.at(-1);
              if (!latest || !latest.drift_signals || latest.drift_signals.length === 0)
                return null;
              return (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                    Latest drift signals ({latest.fq})
                  </p>
                  <ul className="space-y-1">
                    {latest.drift_signals.slice(0, 3).map((s, i) => (
                      <li key={i} className="text-xs text-[var(--color-muted)]">
                        · {s}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}

            {managementAccountability.red_flags.length > 0 ? (
              <div className="rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-neg)_8%,transparent)] p-3">
                <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-[var(--color-neg)] uppercase">
                  Red flags
                </p>
                <ul className="space-y-1">
                  {managementAccountability.red_flags.map((f, i) => (
                    <li key={i} className="text-xs text-[var(--color-muted)]">
                      · {f}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {managementAccountability.thesis_impact_md ? (
              <p className="text-xs text-[var(--color-muted)] italic">
                {managementAccountability.thesis_impact_md}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="px-5 py-6 text-xs text-[var(--color-muted)]">
            Run earnings-call-digest for ≥2 quarters (use Refresh all above), then re-run
            management-accountability to compare what management promised vs what they delivered.
          </p>
        )}
      </Card>

      {/* Latest annual report (synthesis tile) + full history collapsible */}
      <Card padded={false}>
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h3 className="text-sm font-semibold">Annual reports</h3>
          <p className="text-xs text-[var(--color-muted)]">
            {arSummaries.length} year{arSummaries.length === 1 ? '' : 's'} on file
          </p>
        </div>
        {latestAr ? (
          <div className="space-y-3 px-5 py-4 text-sm">
            <div className="flex items-center gap-2">
              <Badge tone="info">{latestAr.fy}</Badge>
              <span className="text-[11px] text-[var(--color-muted)]">
                {latestAr.checklist_results.length} checks ·{' '}
                {latestAr.checklist_results.filter((c) => c.pass === true).length} pass /{' '}
                {latestAr.checklist_results.filter((c) => c.pass === false).length} fail
              </span>
            </div>
            {Object.keys(latestAr.key_numbers ?? {}).length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {(['revenue', 'ebitda_margin', 'roce', 'fcf', 'net_debt'] as const).map((k) => {
                  if (!(k in latestAr.key_numbers)) return null;
                  const v = latestAr.key_numbers[k];
                  return (
                    <div
                      key={k}
                      className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] px-2 py-1.5"
                    >
                      <div className="text-[10px] tracking-wide text-[var(--color-muted)] uppercase">
                        {k.replace(/_/g, ' ')}
                      </div>
                      <div className="tnum mt-0.5 text-sm font-semibold">
                        {k.endsWith('margin') || k === 'roce'
                          ? typeof v === 'number'
                            ? `${(v * 100).toFixed(1)}%`
                            : '—'
                          : fmtNum(typeof v === 'number' ? v : null)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {latestAr.growth_drivers_md ? (
              <div>
                <div className="text-[11px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
                  Top growth drivers
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-muted)]">
                  {latestAr.growth_drivers_md
                    .split(/\n+/)
                    .map((s) => s.replace(/^[-*]\s*/, '').trim())
                    .filter(Boolean)
                    .slice(0, 3)
                    .map((line, i) => (
                      <li key={i}>· {line}</li>
                    ))}
                </ul>
              </div>
            ) : null}
            {latestAr.risks_md ? (
              <div>
                <div className="text-[11px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
                  Top risks
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-muted)]">
                  {latestAr.risks_md
                    .split(/\n+/)
                    .map((s) => s.replace(/^[-*]\s*/, '').trim())
                    .filter(Boolean)
                    .slice(0, 3)
                    .map((line, i) => (
                      <li key={i}>· {line}</li>
                    ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="px-5 py-6 text-xs text-[var(--color-muted)]">
            No AR summary on file. Click Refresh all above to fetch and summarise the latest annual
            report.
          </p>
        )}
        {arSummaries.length > 1 ? (
          <details className="border-t border-[var(--color-border)]">
            <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]">
              Earlier years ({arSummaries.length - 1})
            </summary>
            <div className="border-t border-[var(--color-border)]">
              {arSummaries.slice(1, 4).map((ar) => (
                <details
                  key={ar.fy}
                  className="border-b border-[var(--color-border)] last:border-0"
                >
                  <summary className="flex cursor-pointer items-center justify-between px-5 py-3 text-sm hover:bg-[var(--color-card-hover)]">
                    <span className="flex items-center gap-2">
                      <Badge tone="info">{ar.fy}</Badge>
                      <span className="text-[var(--color-muted)]">
                        generated {ar.generated_at?.slice(0, 10) ?? '—'}
                      </span>
                    </span>
                    <span className="text-xs text-[var(--color-muted)]">
                      {ar.checklist_results.length} checks · {ar.red_flags.length} red flags
                    </span>
                  </summary>
                  <div className="space-y-3 px-5 pb-5 text-sm">
                    {ar.business_model_md ? (
                      <p className="text-[var(--color-muted)]">{ar.business_model_md}</p>
                    ) : null}
                    {ar.checklist_results.length > 0 ? (
                      <ul className="space-y-1">
                        {ar.checklist_results.slice(0, 6).map((c, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs">
                            <Badge
                              tone={c.pass === true ? 'pos' : c.pass === false ? 'neg' : 'neutral'}
                            >
                              {c.pass === true ? 'PASS' : c.pass === false ? 'FAIL' : '?'}
                            </Badge>
                            <span>{c.item}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {ar.red_flags.length > 0 ? (
                      <div className="text-xs">
                        <span className="font-medium text-[var(--color-neg)]">Red flags:</span>{' '}
                        <span className="text-[var(--color-muted)]">{ar.red_flags.join(', ')}</span>
                      </div>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          </details>
        ) : null}
      </Card>

      {/* Earnings calls (latest digest tile + recent history) */}
      <Card padded={false}>
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h3 className="text-sm font-semibold">Earnings calls</h3>
          <p className="text-xs text-[var(--color-muted)]">latest {recentDigests.length}</p>
        </div>
        {recentDigests.length === 0 ? (
          <div className="px-5 py-6 text-xs text-[var(--color-muted)]">
            No concall digests yet. Click Refresh all above to fetch and process transcripts.
          </div>
        ) : latestDigest ? (
          <div className="divide-y divide-[var(--color-border)]">
            {/* Latest, expanded by default */}
            <div className="space-y-3 px-5 py-4 text-sm">
              <div className="flex items-center justify-between">
                <Badge tone="info">{latestDigest.fq}</Badge>
                {(() => {
                  const tone =
                    (latestDigest.management_tone as Record<string, number | string | undefined>)[
                      'score_-2_to_+2'
                    ] ??
                    latestDigest.management_tone.score_2_to_2 ??
                    null;
                  if (tone == null) return null;
                  return (
                    <Badge tone={Number(tone) > 0 ? 'pos' : Number(tone) < 0 ? 'neg' : 'neutral'}>
                      Tone {Number(tone) >= 0 ? '+' : ''}
                      {tone}
                    </Badge>
                  );
                })()}
              </div>
              <p className="text-xs text-[var(--color-muted)]">
                <span className="font-medium text-[var(--color-fg)]">Guidance: </span>
                {latestDigest.guidance.qualitative ?? '—'}
                {latestDigest.guidance.revenue_growth_yoy != null ? (
                  <span className="ml-2">
                    Rev {fmtPct(latestDigest.guidance.revenue_growth_yoy)}
                  </span>
                ) : null}
                {latestDigest.guidance.ebitda_margin != null ? (
                  <span className="ml-2">
                    EBITDA mgn {fmtPct(latestDigest.guidance.ebitda_margin)}
                  </span>
                ) : null}
              </p>
              {latestDigest.kpi_deltas.length > 0
                ? (() => {
                    const positives = latestDigest.kpi_deltas
                      .filter((k) => (k.delta ?? '').trim().startsWith('+'))
                      .slice(0, 3);
                    const negatives = latestDigest.kpi_deltas
                      .filter((k) => (k.delta ?? '').trim().startsWith('-'))
                      .slice(0, 3);
                    return (
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <div className="text-[11px] font-semibold tracking-wide text-[var(--color-pos)] uppercase">
                            Positive KPI deltas
                          </div>
                          {positives.length === 0 ? (
                            <p className="text-xs text-[var(--color-muted)]">—</p>
                          ) : (
                            <ul className="space-y-0.5">
                              {positives.map((k, i) => (
                                <li key={i} className="text-xs">
                                  <span className="text-[var(--color-muted)]">{k.kpi}: </span>
                                  <span>{k.value ?? '—'}</span>
                                  <span className="ml-1 text-[var(--color-pos)]">{k.delta}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div>
                          <div className="text-[11px] font-semibold tracking-wide text-[var(--color-neg)] uppercase">
                            Negative KPI deltas
                          </div>
                          {negatives.length === 0 ? (
                            <p className="text-xs text-[var(--color-muted)]">—</p>
                          ) : (
                            <ul className="space-y-0.5">
                              {negatives.map((k, i) => (
                                <li key={i} className="text-xs">
                                  <span className="text-[var(--color-muted)]">{k.kpi}: </span>
                                  <span>{k.value ?? '—'}</span>
                                  <span className="ml-1 text-[var(--color-neg)]">{k.delta}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    );
                  })()
                : null}
              {latestDigest.analyst_question_themes.length > 0 ? (
                <p className="text-xs text-[var(--color-muted)]">
                  <span className="font-medium text-[var(--color-fg)]">Top analyst theme: </span>
                  {latestDigest.analyst_question_themes[0]?.theme}
                </p>
              ) : null}
              {latestDigest.thesis_impact_md ? (
                <ThesisImpactBlock text={latestDigest.thesis_impact_md} />
              ) : null}
            </div>
            {/* Older quarters, collapsed */}
            {recentDigests.length > 1 ? (
              <details>
                <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]">
                  Earlier quarters ({recentDigests.length - 1})
                </summary>
                <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
                  {recentDigests.slice(1).map((d) => {
                    const tone =
                      (d.management_tone as Record<string, number | string | undefined>)[
                        'score_-2_to_+2'
                      ] ??
                      d.management_tone.score_2_to_2 ??
                      null;
                    return (
                      <div key={d.fq} className="space-y-2 px-5 py-3 text-sm">
                        <div className="flex items-center justify-between">
                          <Badge tone="info">{d.fq}</Badge>
                          {tone != null ? (
                            <Badge
                              tone={Number(tone) > 0 ? 'pos' : Number(tone) < 0 ? 'neg' : 'neutral'}
                            >
                              Tone {Number(tone) >= 0 ? '+' : ''}
                              {tone}
                            </Badge>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-3 text-xs text-[var(--color-muted)]">
                          {d.guidance.revenue_growth_yoy != null ? (
                            <span>Rev growth: {fmtPct(d.guidance.revenue_growth_yoy)}</span>
                          ) : null}
                          {d.guidance.ebitda_margin != null ? (
                            <span>EBITDA mgn: {fmtPct(d.guidance.ebitda_margin)}</span>
                          ) : null}
                          {d.guidance.qualitative ? <span>{d.guidance.qualitative}</span> : null}
                        </div>
                        {d.kpi_deltas.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {d.kpi_deltas.slice(0, 5).map((k, i) => (
                              <span
                                key={i}
                                className="rounded bg-[var(--color-card-hover)] px-2 py-1 text-[11px]"
                              >
                                <span className="text-[var(--color-muted)]">{k.kpi}:</span>{' '}
                                <span className="font-medium">{k.value ?? '—'}</span>
                                {k.delta ? (
                                  <span className="ml-1 text-[var(--color-muted)]">
                                    ({k.delta})
                                  </span>
                                ) : null}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </details>
            ) : null}
          </div>
        ) : null}
      </Card>

      {/* Filings inbox excerpt + filings triage */}
      <Card padded={false}>
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold">Filings</h3>
            <p className="text-xs text-[var(--color-muted)]">
              {recentFilings.filter((f) => !f.isRead).length} unread
              {filingsTriage ? ` · triage batch ${filingsTriage.batch_id}` : ''}
            </p>
          </div>
          <Link
            href={`/p/${portfolioId}/filings?symbol=${encodeURIComponent(symbol)}`}
            className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
          >
            View all <ChevronRight size={12} />
          </Link>
        </div>
        {/* Inbox excerpt (read_now / skim only) */}
        {inboxFilings.length > 0 ? (
          <div className="px-5 py-3">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
              Inbox · last 5
            </div>
            <ul className="flex flex-col divide-y divide-[var(--color-border)]">
              {inboxFilings.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <a
                      href={f.url}
                      className="block truncate font-medium hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {f.title}
                    </a>
                    {f.summaryOneLine ? (
                      <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
                        {f.summaryOneLine}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {f.triage ? <Badge tone={TRIAGE_TONE[f.triage]}>{f.triage}</Badge> : null}
                    {f.publishedAt ? (
                      <span className="tnum text-[10px] text-[var(--color-muted)]">
                        {f.publishedAt.slice(0, 10)}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Recent filings (read tracking) */}
        {recentFilings.length > 0 ? (
          <details className="border-t border-[var(--color-border)]">
            <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]">
              Recent filings ({recentFilings.length})
            </summary>
            <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
              {recentFilings.slice(0, 6).map((f) => (
                <li
                  key={f.id}
                  className={`flex items-start justify-between gap-3 px-5 py-3 text-sm ${f.isRead ? 'opacity-60' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <a
                      href={f.url}
                      className="block truncate font-medium hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {f.title}
                    </a>
                    {f.summaryOneLine ? (
                      <p className="mt-0.5 text-xs text-[var(--color-muted)]">{f.summaryOneLine}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {f.triage ? <Badge tone={TRIAGE_TONE[f.triage]}>{f.triage}</Badge> : null}
                    {f.publishedAt ? (
                      <span className="tnum text-[10px] text-[var(--color-muted)]">
                        {f.publishedAt.slice(0, 10)}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {/* Filings triage skill output */}
        {filingsTriage && filingsTriage.filings.length > 0 ? (
          <details className="border-t border-[var(--color-border)]">
            <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]">
              Triage output ({filingsTriage.filings.length})
            </summary>
            <ul className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)]">
              {filingsTriage.filings.slice(0, 8).map((f) => (
                <li
                  key={f.url}
                  className="flex items-start justify-between gap-3 px-5 py-3 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <a
                      href={f.url}
                      className="block truncate font-medium hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {f.title}
                    </a>
                    {f.summary_one_line ? (
                      <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                        {f.summary_one_line}
                      </p>
                    ) : null}
                  </div>
                  <Badge tone={TRIAGE_TONE[f.triage]}>{f.triage}</Badge>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {inboxFilings.length === 0 && recentFilings.length === 0 && !filingsTriage ? (
          <p className="px-5 py-6 text-xs text-[var(--color-muted)]">
            No filings on file. Run <code>/filings-triage</code> to populate.
          </p>
        ) : null}
      </Card>

      {/* Upcoming events */}
      {upcomingEvents.length > 0 ? (
        <Card padded={false}>
          <div className="border-b border-[var(--color-border)] px-5 py-4">
            <h3 className="text-sm font-semibold">Upcoming events</h3>
            <p className="text-xs text-[var(--color-muted)]">{upcomingEvents.length} scheduled</p>
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {upcomingEvents.slice(0, 6).map((ev) => (
              <li key={ev.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{ev.title}</p>
                  {ev.notes ? (
                    <p className="text-xs text-[var(--color-muted)]">{ev.notes}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge
                    tone={
                      ev.eventType === 'earnings'
                        ? 'info'
                        : ev.eventType === 'ex_div'
                          ? 'pos'
                          : 'neutral'
                    }
                  >
                    {ev.eventType.replace('_', ' ')}
                  </Badge>
                  <span className="tnum text-xs text-[var(--color-muted)]">{ev.eventDate}</span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}

function ThesisImpactBlock({ text }: { text: string }) {
  const { text: short, truncated } = truncate(text, 200);
  if (!truncated) {
    return <p className="text-xs text-[var(--color-muted)] italic">{short}</p>;
  }
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-[var(--color-muted)] italic">
        {short}{' '}
        <span className="ml-1 text-[var(--color-accent)] not-italic hover:underline">
          show more
        </span>
      </summary>
      <p className="mt-1 text-[var(--color-muted)] italic">{text}</p>
    </details>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </div>
      <div className="tnum mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}
