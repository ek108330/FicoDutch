export default function PerimeterClock({ remaining, duration, label }: { remaining: number; duration: number; label: string }) {
  const remainingMs = Math.min(duration, Math.max(0, remaining));
  const seconds = Math.ceil(remainingMs / 1_000);
  return (
    <svg className="perimeter-clock" role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={Math.ceil(duration / 1_000)} aria-valuenow={seconds} aria-valuetext={`${seconds} secondes`}>
      <rect className="perimeter-clock-track" x="1.5" y="1.5" rx="10" />
      <rect className="perimeter-clock-progress" x="1.5" y="1.5" rx="10" pathLength="100"
        strokeDashoffset={-100 * (1 - remainingMs / duration)} />
    </svg>
  );
}
