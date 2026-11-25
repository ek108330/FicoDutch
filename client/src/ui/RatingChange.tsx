const signedRating = new Intl.NumberFormat("fr", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});

export default function RatingChange({ delta }: { delta: number }) {
  const direction = Math.abs(delta) < 0.005 ? undefined : delta > 0 ? "up" : "down";
  return <span className="rn-change" data-direction={direction}>{signedRating.format(delta)}</span>;
}
