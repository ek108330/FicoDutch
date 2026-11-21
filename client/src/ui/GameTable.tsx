import type { CSSProperties, ReactNode } from "react";
import { emojis } from "../../../shared/hubSocial.json";
import type { HubEmoji } from "../../../shared/hubTypes";
import type { CardTarget, PowerKind } from "../game/gameTypes";
import type { MemorizedCard } from "../game/memorization";
import { canTargetCard, sameTarget, type PowerView } from "../game/powers";
import PlayingCard from "./PlayingCard";

export type TablePlayer = {
  id: string;
  pseudo: string;
  cardCount: number;
};

type GameTableProps = {
  localPlayerId: string;
  players: TablePlayer[];
  controls: ReactNode;
  piles?: ReactNode;
  activePlayerId?: string;
  dealing?: boolean;
  protectedPlayerId?: string;
  tableEmojis?: ReadonlyMap<string, HubEmoji>;
  onReplace?: (position: number) => void;
  onReact?: (position: number) => void;
  power?: {
    kind: PowerKind;
    selection: NonNullable<PowerView["selection"]>;
    chooseCard: (target: CardTarget) => void;
    choosePlayer: (playerId: string) => void;
  };
  memorization?: {
    revealed: MemorizedCard[];
    selected: number[];
    limit: number;
    toggle: (position: number) => void;
  };
};

const positionLayouts: Record<number, string[]> = {
  2: ["top"],
  3: ["left", "right"],
  4: ["top", "left", "right"],
  5: ["left-top", "left-bottom", "right-top", "right-bottom"],
  6: ["top", "left-top", "left-bottom", "right-top", "right-bottom"],
};

export default function GameTable({
  localPlayerId,
  players,
  controls,
  piles,
  activePlayerId,
  dealing,
  protectedPlayerId,
  tableEmojis,
  onReplace,
  onReact,
  memorization,
  power,
}: GameTableProps) {
  const localPlayer = players.find((player) => player.id === localPlayerId);
  const opponents = players.filter((player) => player.id !== localPlayerId);
  const positions = positionLayouts[players.length] || [];
  const positionedPlayers = opponents.map((player, index) => ({
    player,
    position: positions[index] || "top",
  }));
  if (localPlayer) positionedPlayers.push({ player: localPlayer, position: "bottom" });

  return (
    <div className={`game-table${dealing ? " is-dealing" : ""}${players.length >= 4 ? " is-large-table" : ""}`}
      data-player-count={players.length}>
      <div className="table-center">
        {controls}
        {piles ?? (
          <div className="table-piles">
            <div className="deck-placeholder">Pioche</div>
            <div className="discard-placeholder">Défausse</div>
          </div>
        )}
      </div>

      {positionedPlayers.map(({ player, position }) => {
        const ownSelection = position === "bottom" ? memorization : undefined;
        const replace = position === "bottom" ? onReplace : undefined;
        const react = position === "bottom" ? onReact : undefined;
        const active = player.id === activePlayerId ? " is-active-player" : "";
        const giveToPlayer = !onReact && power?.kind === "give-card" && player.id !== localPlayerId;
        const canChooseFromHand = !onReact && power && power.selection.remaining > 0 &&
          canTargetCard(power.kind, localPlayerId, player.id, protectedPlayerId);
        const name = player.pseudo + (position === "bottom" ? " (Moi)" : "");
        const emoji = tableEmojis?.get(player.id);
        const handStyle = { "--hand-columns": Math.max(1, Math.ceil(player.cardCount / 2)) } as CSSProperties;
        return (
          <div className={`table-player position-${position}${active}`} key={player.id}>
            {emoji && <span className="table-emoji" role="status"
              aria-label={`${player.pseudo} · ${emojis[emoji].label}`}>{emojis[emoji].symbol}</span>}
            {giveToPlayer ? (
              <button type="button" className="player-name power-recipient" onClick={() => power.choosePlayer(player.id)}>
                Donner à {player.pseudo}
              </button>
            ) : (
              <div className="player-name">{name}</div>
            )}
            <div className="player-cards" style={handStyle}>
              {Array.from({ length: player.cardCount }, (_, index) => {
                const target = { playerId: player.id, position: index };
                const selected = power?.selection.targets.some((card) => sameTarget(card, target));
                const canChoose = canChooseFromHand && !selected;
                const revealed = power?.selection.revealed.find(({ target: card }) => sameTarget(card, target))?.face ??
                  ownSelection?.revealed.find(({ position }) => position === index)?.face;
                const cardAction = react ? () => react(index)
                  : canChoose ? () => power.chooseCard(target)
                  : ownSelection ? () => ownSelection.toggle(index)
                  : replace && (() => replace(index));
                const actionLabel = react ? `Poser la carte ${index + 1} en réaction`
                  : canChoose ? `Choisir la carte ${index + 1} de ${player.pseudo}`
                  : replace ? `Remplacer la carte ${index + 1}` : undefined;
                return (
                  <PlayingCard
                    key={index}
                    index={index}
                    dealOrder={dealing ? index : undefined}
                    face={revealed}
                    onToggle={cardAction}
                    actionLabel={actionLabel}
                    selected={selected}
                    disabled={ownSelection && ownSelection.selected.length >= ownSelection.limit
                      && !ownSelection.selected.includes(index)}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
