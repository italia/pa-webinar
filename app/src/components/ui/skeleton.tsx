/**
 * Skeleton loader riusabile (.italia-coerente). Sostituisce i
 * "Caricamento…" testuali con placeholder a shimmer → percezione di
 * velocità e finitura. Lo shimmer è definito in globals.scss
 * (`.app-skeleton`) e rispetta `prefers-reduced-motion`.
 */

interface SkeletonProps {
  /** Altezza CSS (default 1rem). */
  height?: number | string;
  /** Larghezza CSS (default '100%'). */
  width?: number | string;
  /** border-radius (default 6). */
  radius?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({
  height = '1rem',
  width = '100%',
  radius = 6,
  className,
  style,
}: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`app-skeleton d-block${className ? ` ${className}` : ''}`}
      style={{ height, width, borderRadius: radius, ...style }}
    />
  );
}

/**
 * Blocco di N righe skeleton (per liste/testi). Aria-busy sul wrapper +
 * label invisibile per screen reader.
 */
export function SkeletonLines({
  lines = 3,
  gap = 8,
  loadingLabel,
}: {
  lines?: number;
  gap?: number;
  loadingLabel?: string;
}) {
  return (
    <div role="status" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '70%' : '100%'} />
      ))}
      {loadingLabel ? <span className="visually-hidden">{loadingLabel}</span> : null}
    </div>
  );
}
