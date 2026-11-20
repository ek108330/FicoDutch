type PlayingCardProps = {
  index: number;
};

export default function PlayingCard({ index }: PlayingCardProps) {
  return (
    <div className="playing-card face-down" aria-label={`Carte ${index + 1} face cachée`}>
      <div className="card-back-pattern">
        <span>F</span>
      </div>
    </div>
  );
}