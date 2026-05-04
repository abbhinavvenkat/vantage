/**
 * Compounder Thesis tickbox panel — Server Component (no JS).
 *
 * Renders one symbol's CompounderProfile as a 10-factor grid + classification
 * pill + estimated 10y multiple + per-factor evidence list. Used as the
 * inline section inside the Decisions per-symbol expanded view (Option A) and
 * inside the row-detail of the dedicated /decisions/compounder page (Option B).
 */

import type {
  CompounderProfile,
  CompounderProfileView,
  CompounderClassification,
} from '@/lib/compounder/score';
import { Badge } from '@/components/ui/Badge';

const STATUS_GLYPH = {
  pass: '☑',
  fail: '☒',
  partial: '◐',
  unknown: '?',
} as const;

const STATUS_TONE: Record<
  'pass' | 'fail' | 'partial' | 'unknown',
  'pos' | 'neg' | 'warning' | 'neutral'
> = {
  pass: 'pos',
  fail: 'neg',
  partial: 'warning',
  unknown: 'neutral',
};

const CLASS_TONE: Record<CompounderClassification, 'pos' | 'info' | 'warning' | 'neg'> = {
  '7-9x candidate': 'pos',
  'solid compounder': 'info',
  mediocre: 'warning',
  broken: 'neg',
};

export function CompounderPanel({
  profile,
}: {
  profile: CompounderProfile | CompounderProfileView;
}) {
  const cagrPct = (profile.estimatedAnnualisedCagr * 100).toFixed(1);
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] p-3 text-xs">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
            Compounder thesis
          </span>
          <Badge tone={CLASS_TONE[profile.classification]}>{profile.classification}</Badge>
        </div>
        <div className="flex items-center gap-3 text-[var(--color-muted)] tabular-nums">
          <span>
            score <span className="text-[var(--color-fg)]">{profile.weightedScore.toFixed(2)}</span>
          </span>
          <span>·</span>
          <span>
            CAGR <span className="text-[var(--color-fg)]">{cagrPct}%</span>
          </span>
          <span>·</span>
          <span>
            10y{' '}
            <span className="text-[var(--color-fg)]">
              {profile.estimatedTenYearReturn.toFixed(1)}×
            </span>
          </span>
        </div>
      </div>
      <ul className="space-y-1">
        {profile.factors.map(({ factor, verdict }) => (
          <li
            key={factor.id}
            className="flex flex-wrap items-baseline gap-2 border-b border-dotted border-[var(--color-border)] pb-1 last:border-b-0 last:pb-0"
            title={factor.description + ' — cite: ' + factor.citation}
          >
            <span
              aria-hidden
              className={
                'inline-flex h-4 w-4 items-center justify-center text-[14px] ' +
                (verdict.status === 'pass'
                  ? 'text-[var(--color-pos)]'
                  : verdict.status === 'fail'
                    ? 'text-[var(--color-neg)]'
                    : verdict.status === 'partial'
                      ? 'text-[var(--color-accent)]'
                      : 'text-[var(--color-muted)]')
              }
            >
              {STATUS_GLYPH[verdict.status]}
            </span>
            <span className="font-medium">{factor.label}</span>
            <Badge tone={STATUS_TONE[verdict.status]}>{verdict.status}</Badge>
            <span className="text-[var(--color-muted)]">— {verdict.rationale}</span>
            {verdict.evidence.length > 0 ? (
              <span className="text-[10px] text-[var(--color-muted)] italic">
                {verdict.evidence.join(' · ')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[var(--color-muted)]">
        <span>
          pass <span className="text-[var(--color-pos)]">{profile.passCount}</span>
        </span>
        <span>·</span>
        <span>
          partial <span className="text-[var(--color-accent)]">{profile.partialCount}</span>
        </span>
        <span>·</span>
        <span>
          fail <span className="text-[var(--color-neg)]">{profile.failCount}</span>
        </span>
        <span>·</span>
        <span>unknown {profile.unknownCount}</span>
      </div>
    </div>
  );
}
