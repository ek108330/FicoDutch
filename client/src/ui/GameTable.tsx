import PlayingCard from "./PlayingCard";

type TablePlayer = {
  id: string;
  pseudo: string;
  cardCount: number;
};

type GameTableProps = {
  localPlayerId: string;
  players: TablePlayer[];
};

type PlayerPosition = {
  player: TablePlayer;
  position: string;
};

export default function GameTable({
  localPlayerId,
  players,
}: GameTableProps) {
  const localPlayer = players.find(
    (player) => player.id === localPlayerId
  );

  const opponents = players.filter(
    (player) => player.id !== localPlayerId
  );

  const positionLayouts: Record<number, string[]> = {
    2: ["top"],
    3: ["left", "right"],
    4: ["top", "left", "right"],
    5: ["left-top", "left-bottom", "right-top", "right-bottom"],
    6: ["top", "left-top", "left-bottom", "right-top", "right-bottom"],
  };

  const positions = positionLayouts[players.length] || [];

  const positionedPlayers: PlayerPosition[] = opponents.map(
    (player, index) => ({
      player,
      position: positions[index] || "top",
    })
  );

  if (localPlayer) {
    positionedPlayers.push({
      player: localPlayer,
      position: "bottom",
    });
  }

  return (
    <div className="game-table">
      <div className="table-center">
        <div className="deck-placeholder">Pioche</div>
        <div className="discard-placeholder">Défausse</div>
      </div>

      {positionedPlayers.map(({ player, position }) => (
        <div
          className={`table-player position-${position}`}
          key={player.id}
        >
          <div className="player-name">
            {player.pseudo}
            {position === "bottom" ? " (Moi)" : ""}
          </div>

          <div
  className={`player-cards ${
    player.cardCount === 6 ? "cards-six" : "cards-four"
  }`}
>
  {Array.from(
    { length: player.cardCount },
    (_, index) => (
      <PlayingCard key={index} index={index} />
    )
  )}
</div>
        </div>
      ))}
    </div>
  );
}