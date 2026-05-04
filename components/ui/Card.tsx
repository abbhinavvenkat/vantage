import type { HTMLAttributes } from 'react';

type Props = HTMLAttributes<HTMLDivElement> & {
  padded?: boolean;
};

export function Card({ className, children, padded = true, ...rest }: Props) {
  return (
    <div
      className={
        'rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-sm)] ' +
        (padded ? 'p-5' : '') +
        (className ?? '')
      }
      {...rest}
    >
      {children}
    </div>
  );
}
