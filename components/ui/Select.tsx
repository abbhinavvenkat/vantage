import { type SelectHTMLAttributes, forwardRef } from 'react';

type Props = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, Props>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={
        'h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 pr-8 text-sm text-[var(--color-fg)] transition-colors focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:outline-none disabled:opacity-50' +
        (className ? ' ' + className : '')
      }
      {...rest}
    >
      {children}
    </select>
  );
});
