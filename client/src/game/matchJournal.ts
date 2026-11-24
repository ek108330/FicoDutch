import { getCardValue, type Card } from "./cards.ts";
import type { GameState, PowerKind } from "./gameTypes";

type JournalCard = { id: string; points: number; blackKing: boolean };
type HandCard = { playerId: string; card: JournalCard };
type RoundScore = { id: string; score: number; base: number; total: number; left: boolean };

export type MatchEvent =
  | { kind: "deal"; players: { id: string; accountId?: string; name: string; isBot?: true; cards: JournalCard[] }[] }
  | { kind: "replace"; playerId: string; added: JournalCard; removed: JournalCard }
  | { kind: "discard"; playerId: string; card: JournalCard; reference: number }
  | { kind: "reaction"; playerId: string; card: JournalCard; reference: number; openedAt: number | null }
  | { kind: "incorrect"; playerId: string; card: JournalCard; reference: number }
  | { kind: "penalty"; playerId: string; card: JournalCard }
  | { kind: "swap"; playerId: string; cards: [HandCard, HandCard] }
  | { kind: "gift"; playerId: string; recipient: string; card: JournalCard }
  | { kind: "power"; playerId: string; power: PowerKind; stage: "start" | "execute" }
  | { kind: "look"; playerId: string; cards: HandCard[] }
  | { kind: "dutch"; playerId: string }
  | { kind: "round-result"; scores: RoundScore[]; winners: string[]; announcer: string | null;
      dutchPenalty: boolean; emptyHand?: string | null }
  | { kind: "match-end"; status: "finished" | "interrupted" };

export type JournalEntry = MatchEvent & { matchId?: string; accountId?: string; sequence: number; round: number; at: number; validated: true };
export type MatchJournal = { entry: JournalEntry; previous?: MatchJournal };

export function journalCard(card: Card): JournalCard {
  const points = getCardValue(card);
  return { id: card.id, points, blackKing: card.rank === "K" && points === 0 };
}

export function logMatch(state: GameState, at: number, ...events: MatchEvent[]): GameState {
  if (!state.journal && events[0]?.kind !== "deal") return state;
  let journal = state.journal;
  for (const event of events) {
    const accountId = "playerId" in event ? state.players.find(({ id }) => id === event.playerId)?.accountId : undefined;
    journal = {
      entry: { ...event, matchId: state.matchId, accountId, round: state.roundNumber, at,
        sequence: (journal?.entry.sequence ?? 0) + 1, validated: true },
      previous: journal,
    };
  }
  return { ...state, journal };
}

export function logDeal(state: GameState, at: number) {
  return logMatch(state, at, {
    kind: "deal",
    players: state.players.map(({ id, accountId, pseudo, cards, isBot }) => ({ id, accountId, isBot, name: pseudo, cards: cards.map(journalCard) })),
  });
}

export function matchEntries(journal?: MatchJournal): JournalEntry[] {
  const entries: JournalEntry[] = [];
  for (let node = journal; node; node = node.previous) entries.push(node.entry);
  return entries.reverse();
}

export function completedRoundsAfter(journal: MatchJournal | undefined, after: number) {
  const rounds: { number: number; announcer: string | null; emptyHand: string | null;
    scores: { id: string; score: number; base: number; left: boolean }[] }[] = [];
  for (let node = journal; node && node.entry.round > after; node = node.previous) {
    const { entry } = node;
    if (entry.kind === "round-result") rounds.push({
      number: entry.round,
      announcer: entry.announcer,
      emptyHand: entry.emptyHand ?? null,
      scores: entry.scores.map(({ id, score, base, left }) => ({ id, score, base, left })),
    });
  }
  return rounds.reverse().slice(0, 20);
}
