/**
 * Final Recommendation card — server-rendered synthesis of the five framework
 * outputs into one action with risk overrides + per-framework breakdown.
 */

import { Badge } from '@/components/ui/Badge';
import {
  type FinalRecommendation,
  type FrameworkSource,
} from '@/lib/synthesis/finalRecommendation';
import {
  STALWART_DISPLAY_LABEL,
  STALWART_DISPLAY_TONE,
  finalToDisplayAction,
} from '@/lib/decisions/displayAction';

const SOURCE_LABEL: Record<FrameworkSource, string> = {
  stalwarts: 'Stalwarts',
  compounder: 'Compounder',
  valuation: 'Valuation',
  forecast: 'Forecast',
  research: 'Research',
};

const CONF_DOT_COLOR: Record<'low' | 'medium' | 'high', string> = {
  high: 'var(--color-pos)',
  medium: 'var(--color-accent)',
  low: 'var(--color-muted)',
};

function fmtScore(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

export function FinalRecommendationCard({
  recommendation,
  held,
}: {
  recommendation: FinalRecommendation;
  held: boolean;
}) {
  const r = recommendation;
  const displayAction = finalToDisplayAction(r.action, { held });
  return (
    <div className="flex flex-col gap-4">
      {/* Headline action + composite score + confidence dot */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Badge tone={STALWART_DISPLAY_TONE[displayAction]}>
            <span className="text-base">{STALWART_DISPLAY_LABEL[displayAction]}</span>
          </Badge>
          <span className="text-sm text-[var(--color-muted)] tabular-nums">
            composite {fmtScore(r.weightedScore)}
          </span>
          <span
            className="inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]"
            title={`Confidence: ${r.confidence}`}
          >
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: CONF_DOT_COLOR[r.confidence] }}
            />
            {r.confidence} confidence
          </span>
        </div>
      </div>

      {/* Rationale */}
      <p className="text-sm text-[var(--color-fg)]">{r.rationaleMd}</p>

      {/* Per-framework breakdown table */}
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
        <table className="w-full text-xs">
          <thead className="bg-[var(--color-card-hover)]">
            <tr>
              <th className="px-3 py-2 text-left text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
                Framework
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
                Vote
              </th>
              <th className="px-3 py-2 text-right text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
                Weight
              </th>
              <th className="px-3 py-2 text-left text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
                Rationale
              </th>
            </tr>
          </thead>
          <tbody>
            {r.votes.map((v) => {
              const abstain = v.weight === 0;
              const tone =
                v.score > 0
                  ? 'text-[var(--color-pos)]'
                  : v.score < 0
                    ? 'text-[var(--color-neg)]'
                    : 'text-[var(--color-muted)]';
              return (
                <tr key={v.source} className="border-t border-[var(--color-border)]">
                  <td className="px-3 py-2 font-medium">{SOURCE_LABEL[v.source]}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${tone}`}>
                    {abstain ? '—' : fmtScore(v.score)}
                  </td>
                  <td className="px-3 py-2 text-right text-[var(--color-muted)] tabular-nums">
                    {v.weight.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-[var(--color-muted)]">{v.rationale}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Risk overrides */}
      {r.riskOverrides.length > 0 ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-warning,#d97706)]/40 bg-[var(--color-card-hover)] p-3 text-xs">
          <div className="font-medium text-[var(--color-fg)]">Risk overrides applied</div>
          <ul className="mt-2 space-y-1">
            {r.riskOverrides.map((o, i) => (
              <li key={i} className="flex items-start gap-2 text-[var(--color-muted)]">
                <span
                  aria-hidden
                  className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning,#d97706)]"
                />
                <span>{o.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
