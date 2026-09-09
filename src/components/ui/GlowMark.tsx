export function GlowMark({
  size = 72,
  dashed = false,
  className = '',
}: {
  size?: number;
  dashed?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`glow-square shrink-0 ${dashed ? 'glow-square-dashed' : ''} ${className}`}
      style={{ ['--glow-size' as string]: `${size}px`, width: size, height: size }}
      aria-hidden
    />
  );
}
