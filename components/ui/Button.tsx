import { type ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const VARIANT_CLASS: Record<Variant, string> = {
  primary:
    'bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50 shadow-[var(--shadow-sm)]',
  secondary:
    'border border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-fg)] hover:bg-[var(--color-card-hover)] hover:border-[var(--color-border-strong)] disabled:opacity-50',
  ghost: 'text-[var(--color-fg)] hover:bg-[var(--color-card-hover)] disabled:opacity-50',
  danger: 'bg-[var(--color-neg)] text-white hover:opacity-90 disabled:opacity-50',
};

const SIZE_CLASS: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3.5 text-sm',
  lg: 'h-10 px-5 text-sm',
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={
        'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] font-medium transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-bg)] focus-visible:outline-none ' +
        SIZE_CLASS[size] +
        ' ' +
        VARIANT_CLASS[variant] +
        (className ? ' ' + className : '')
      }
      {...rest}
    />
  );
});
