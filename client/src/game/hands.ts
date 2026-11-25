import { GAME_CONFIG } from "../config/gameConfig.ts";
import { getCardFace, getCardValue, type Card } from "./cards.ts";
import type { GamePlayer, GameState, PublicCardMove } from "./gameTypes";
import { addHandSlot, getHandLayout } from "./handLayout.ts";
import { logMatch } from "./matchJournal.ts";

export function changeHand(player: GamePlayer, cards: Card[]): GamePlayer {
  return { ...player, cards, handVersion: player.handVersion + 1 };
}

export function appendCard(player: GamePlayer, card: Card): GamePlayer {
  const layout = getHandLayout(player.cards.length, player.handLayout);
  return { ...changeHand(player, [...player.cards, card]), handLayout: addHandSlot(layout) };
}

export function removeCard(player: GamePlayer, position: number): GamePlayer {
  const layout = getHandLayout(player.cards.length, player.handLayout);
  return {
    ...changeHand(player, player.cards.filter((_, index) => index !== position)),
    handLayout: { ...layout, slots: layout.slots.filter((_, index) => index !== position) },
  };
}

export function recordCardMove(state: GameState, move: PublicCardMove, now: number): NonNullable<GameState["cardMotion"]> {
  return { id: (state.cardMotion?.id ?? 0) + 1, at: now, move };
}

function handPoints(cards: Card[]) {
  return cards.reduce((sum, card) => sum + getCardValue(card), 0);
}

export function rankPlayers<Player extends { totalScore: number }>(players: readonly Player[]) {
  const sorted = [...players].sort((a, b) => a.totalScore - b.totalScore);
  return sorted.map((player) => ({ player, rank: sorted.findIndex(({ totalScore }) => totalScore === player.totalScore) + 1 }));
}

export function getRoundLeaders(state: GameState) {
  if (state.roundNumber < 2) return [];
  return rankPlayers(state.players.filter(({ hasLeft }) => !hasLeft))
    .filter(({ rank }) => rank === 1).map(({ player }) => player.id);
}

export function finishRound(state: GameState, now: number, emptyHandPlayerId: string | null = null): GameState {
  if (state.phase !== "playing") return state;
  const baseScores = state.players.map(({ id, cards }) => ({
    id,
    points: handPoints(cards),
  }));
  const dutchAnnouncerId = state.dutch?.announcerId ?? null;
  const announcerPoints = baseScores.find(({ id }) => id === dutchAnnouncerId)?.points;
  const dutchPenalty = announcerPoints !== undefined &&
    baseScores.some(({ id, points }) => id !== dutchAnnouncerId && points <= announcerPoints);
  const otherZeroIds = emptyHandPlayerId
    ? baseScores.filter(({ id, points }) => id !== emptyHandPlayerId && points === 0).map(({ id }) => id)
    : [];

  // En cas de main vide, la priorité du score nul s'applique avant les pénalités.
  const scored = baseScores.map(({ id, points }) => {
    const penalized = (id === dutchAnnouncerId && dutchPenalty) ||
      (id === emptyHandPlayerId && otherZeroIds.length > 0);
    return points + (penalized ? 10 : 0);
  });
  const best = Math.min(...scored);
  const winnerIds = emptyHandPlayerId
    ? otherZeroIds.length ? otherZeroIds : [emptyHandPlayerId]
    : baseScores.filter((_, index) => scored[index] === best).map(({ id }) => id);
  const players = state.players.map((player, index) => {
    const totalScore = player.totalScore + scored[index];
    return {
      ...player,
      roundScore: scored[index],
      totalScore,
      scoreHistory: [...player.scoreHistory, totalScore].slice(-GAME_CONFIG.scoring.historyLength),
    };
  });
  const threshold = state.endThreshold;
  const gameEnded = threshold !== null && players.some(({ totalScore }) => totalScore >= threshold);
  const lowestTotal = Math.min(...players.map(({ totalScore }) => totalScore));
  const gameWinnerIds = gameEnded ? players.filter(({ totalScore }) => totalScore === lowestTotal).map(({ id }) => id) : [];

  const next: GameState = {
    ...state,
    phase: "results",
    cardMotion: state.cardMotion?.at === now ? state.cardMotion : undefined,
    phaseDeadline: gameEnded ? null : now + GAME_CONFIG.round.resultsMs,
    currentPlayerId: null,
    turn: null,
    players,
    result: {
      emptyHandPlayerId,
      dutchAnnouncerId,
      dutchPenalty,
      winnerIds,
      gameWinnerIds,
      nextVariants: { ...state.variants },
    },
  };
  return logMatch(next, now, {
    kind: "round-result", announcer: dutchAnnouncerId, dutchPenalty, winners: winnerIds, emptyHand: emptyHandPlayerId,
    scores: players.map(({ id, roundScore, totalScore, hasLeft }, index) =>
      ({ id, score: roundScore, base: baseScores[index].points, total: totalScore, left: hasLeft })),
  });
}

export function getRoundResultView(state: GameState, includeHands = true) {
  if (state.phase !== "results" || !state.result) return null;
  return {
    ...state.result,
    endThreshold: state.endThreshold,
    players: state.players.map(({ id, pseudo, roundScore, totalScore, cards, handLayout, previousRank }) => ({
      id, pseudo, roundScore, totalScore, penaltyPoints: includeHands ? roundScore - handPoints(cards) : 0,
      cards: includeHands ? cards.map(getCardFace) : [],
      ...(includeHands && handLayout && { handLayout }), ...(previousRank !== undefined && { previousRank }),
    })),
  };
}

export type RoundResultView = NonNullable<ReturnType<typeof getRoundResultView>>;
