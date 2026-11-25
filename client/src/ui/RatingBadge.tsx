export default function RatingBadge({ rating, className, showLabel = false }: {
  rating: number;
  className?: string;
  showLabel?: boolean;
}) {
  const value = Math.round(rating);
  const band = Math.min(9, Math.max(0, Math.floor(value / 10)));
  return <span className={className ? `rn-badge ${className}` : "rn-badge"}
    data-rn-band={band} title={`Indice RN ${value}`}>
    {showLabel && "RN "}{value}
  </span>;
}
