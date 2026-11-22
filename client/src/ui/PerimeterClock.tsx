import { useLayoutEffect, useRef, useState } from "react";

function perimeterPath(width: number, height: number, radius: number) {
  const left = 1.5;
  const top = 1.5;
  const right = width - left;
  const bottom = height - top;
  if (right <= left || bottom <= top) return undefined;

  const corner = Math.min(radius, (right - left) / 2, (bottom - top) / 2);
  const arc = `A ${corner} ${corner} 0 0 1`;
  return `M ${width / 2} ${top} H ${right - corner}
    ${arc} ${right} ${top + corner} V ${bottom - corner}
    ${arc} ${right - corner} ${bottom} H ${left + corner}
    ${arc} ${left} ${bottom - corner} V ${top + corner}
    ${arc} ${left + corner} ${top} Z`;
}

export default function PerimeterClock({ remaining, duration, label, radius = 10 }: {
  remaining: number;
  duration: number;
  label: string;
  radius?: number;
}) {
  const clock = useRef<SVGSVGElement>(null);
  const [path, setPath] = useState<string>();
  useLayoutEffect(() => {
    const svg = clock.current;
    if (!svg) return;
    const measure = () => setPath(perimeterPath(svg.clientWidth, svg.clientHeight, radius));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [radius]);

  const remainingMs = Math.min(duration, Math.max(0, remaining));
  const seconds = Math.ceil(remainingMs / 1_000);
  return (
    <svg ref={clock} className="perimeter-clock" role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={Math.ceil(duration / 1_000)} aria-valuenow={seconds} aria-valuetext={`${seconds} secondes`}>
      <path className="perimeter-clock-track" d={path} />
      <path className="perimeter-clock-progress" d={path} pathLength="100"
        strokeDashoffset={-100 * (1 - remainingMs / duration)} />
    </svg>
  );
}
