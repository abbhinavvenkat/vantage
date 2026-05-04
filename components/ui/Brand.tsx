type Props = {
  size?: number;
  showWordmark?: boolean;
};

export function Brand({ size = 28, showWordmark = true }: Props) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="inline-flex items-center justify-center rounded-[8px] bg-gradient-to-br from-[var(--color-accent)] to-[#7c3aed] text-white shadow-[var(--shadow-sm)]"
        style={{ width: size, height: size }}
      >
        <svg
          width={size * 0.6}
          height={size * 0.6}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="4 17 9 12 13 16 20 8" />
          <polyline points="14 8 20 8 20 14" />
        </svg>
      </span>
      {showWordmark ? (
        <span className="text-[15px] font-semibold tracking-tight text-[var(--color-fg)]">
          Vantage
        </span>
      ) : null}
    </span>
  );
}
