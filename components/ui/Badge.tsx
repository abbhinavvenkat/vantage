import type { HTMLAttributes } from 'react';

type Tone = 'neutral' | 'pos' | 'neg' | 'info' | 'warning';

type Props = HTMLAttributes<HTMLSpanElement> & {
  tone?: Tone;
};

const TONE_CLASS: Record<Tone, string> = {
  neutral:
    'bg-[var(--color-card-hover)] text-[var(--color-muted)] border border-[var(--color-border)]',
  pos: 'bg-[var(--color-pos-soft)] text-[var(--color-pos)] border border-[var(--color-pos)]/20',
  neg: 'bg-[var(--color-neg-soft)] text-[var(--color-neg)] border border-[var(--color-neg)]/20',
  info: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)] border border-[var(--color-accent)]/20',
  warning: 'badge-warning border',
};

export function Badge({ tone = 'neutral', className, children, ...rest }: Props) {
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ' +
        TONE_CLASS[tone] +
        (className ? ' ' + className : '')
      }
      {...rest}
    >
      {children}
    </span>
  );
}
