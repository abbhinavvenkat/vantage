import type { ReactNode } from 'react';

import { Card } from '@/components/ui/Card';

type Props = {
  number: string;
  title: string;
  subtitle?: string;
  id?: string;
  /** Right-aligned slot in the section header (badge, link, etc.). */
  action?: ReactNode;
  /** When true, children are rendered raw (no Card wrap). Use for sections that already use Card padded={false}. */
  bare?: boolean;
  children: ReactNode;
};

/**
 * Roman-numeral labelled section shell used by the per-stock detail page.
 *
 * Renders a header band (number + title + optional subtitle) above the content
 * area. Pure server component — no client state.
 */
export function Section({ number, title, subtitle, id, action, bare = false, children }: Props) {
  const slug = id ?? slugify(title);
  const header = (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
      <div className="flex items-baseline gap-3">
        <span
          aria-hidden
          className="text-2xl font-bold text-[var(--color-accent)] tabular-nums"
          style={{ minWidth: '2.25rem' }}
        >
          {number}.
        </span>
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-[var(--color-muted)]">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );

  if (bare) {
    return (
      <section id={slug} className="scroll-mt-20">
        {header}
        <div className="mt-3">{children}</div>
      </section>
    );
  }

  return (
    <section id={slug} className="scroll-mt-20">
      <Card padded={false}>
        {header}
        <div className="px-5 py-4">{children}</div>
      </Card>
    </section>
  );
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
