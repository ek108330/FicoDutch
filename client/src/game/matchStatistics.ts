import type { Award, AwardId, MatchPlayer, MatchStats, MatchStatus } from "../../../shared/statistics";
import { matchEntries, type MatchJournal } from "./matchJournal.ts";

type Totals = { count: number; points: number };
type Activity = {
  player: MatchPlayer;
  firstRound: number;
  rois: Set<string>;
  reactionPoints: number;
  quickest: number;
  reactionErrors: number;
  penaltyPoints: number;
  sent: Totals;
  received: number;
  haters: Set<string>;
  caused: number;
  bestSwap: number;
  worstSwap?: Award;
  blocked: number;
};

function newActivity(id: string, name: string, firstRound: number): Activity {
  return {
    player: {
      id, name, rounds: 0, wins: 0, scoreSum: 0, bestScore: null,
      dutch: 0, dutchWon: 0, reactions: 0, penalties: 0, exchanges: 0,
    },
    firstRound, rois: new Set(), reactionPoints: 0, quickest: Infinity, reactionErrors: 0, penaltyPoints: 0,
    sent: { count: 0, points: 0 }, received: 0, haters: new Set(), caused: 0,
    bestSwap: 0, blocked: 0,
  };
}

function best(candidates: Award[], minimize = false) {
  if (!candidates.length) return [];
  const order = (a: Award, b: Award) => (minimize ? a.value - b.value : b.value - a.value) ||
    (b.extra ?? 0) - (a.extra ?? 0);
  return candidates.sort(order).filter((entry, _, sorted) => order(entry, sorted[0]) === 0);
}

function countPair(store: Map<string, Award>, first: string, second: string) {
  const key = JSON.stringify([first, second]);
  const pair = store.get(key);
  if (pair) pair.value++;
  else store.set(key, { players: [first, second], value: 1 });
}

export function matchStatistics(journal: MatchJournal | undefined, status: MatchStatus, partial = false,
  previousGames: MatchJournal[] = []): MatchStats {
  const activities = new Map<string, Activity>();
  const botIds = new Set<string>();
  const targets = new Map<string, Award>();
  const pairs = new Map<string, Award>();
  const seatsByAccount = new Map<string, string>();
  const aliases = new Map<string, string>();
  const canonical = (id: string) => aliases.get(id) ?? id;
  const lookUp = (id: string) => activities.get(canonical(id));
  let discardOrigin: string | undefined;
  let rounds = 0;
  let unfinished: MatchStats["unfinished"];
  let official: Extract<ReturnType<typeof matchEntries>[number], { kind: "round-result" }>["scores"] = [];
  const collect = (owner: string, card: { id: string; blackKing: boolean }) => {
    if (card.blackKing) lookUp(owner)?.rois.add(card.id);
  };
  const attack = (from: string, to: string) => {
    const target = lookUp(to);
    if (canonical(from) === canonical(to) || !target) return;
    target.received++;
    target.haters.add(canonical(from));
  };

  for (const event of [...previousGames, journal].flatMap(matchEntries)) {
    switch (event.kind) {
      case "deal":
        discardOrigin = undefined;
        unfinished = { round: rounds + 1, reactions: 0, penalties: 0, exchanges: 0, gifts: 0 };
        for (const { id, name, accountId, cards, isBot } of event.players) {
          if (previousGames.length && accountId) {
            const firstSeat = seatsByAccount.get(accountId) ?? id;
            seatsByAccount.set(accountId, firstSeat);
            aliases.set(id, firstSeat);
          }
          const seat = canonical(id);
          if (isBot) botIds.add(seat);
          if (!activities.has(seat)) activities.set(seat, newActivity(seat, name, event.round));
          for (const card of cards) collect(id, card);
        }
        break;
      case "replace":
        collect(event.playerId, event.added);
        break;
      case "discard":
        discardOrigin = event.playerId;
        break;
      case "reaction": {
        if (unfinished) unfinished.reactions++;
        const player = lookUp(event.playerId)!;
        player.player.reactions++;
        player.reactionPoints += event.card.points;
        if (event.openedAt !== null && event.at >= event.openedAt) {
          player.quickest = Math.min(player.quickest, event.at - event.openedAt);
        }
        if (discardOrigin) lookUp(discardOrigin)!.caused++;
        break;
      }
      case "incorrect":
        lookUp(event.playerId)!.reactionErrors++;
        break;
      case "penalty": {
        if (unfinished) unfinished.penalties++;
        const player = lookUp(event.playerId)!;
        player.player.penalties++;
        player.penaltyPoints += event.card.points;
        collect(event.playerId, event.card);
        break;
      }
      case "gift": {
        if (unfinished) unfinished.gifts++;
        const { sent } = lookUp(event.playerId)!;
        sent.count++;
        sent.points += event.card.points;
        attack(event.playerId, event.recipient);
        collect(event.recipient, event.card);
        break;
      }
      case "swap": {
        if (unfinished) unfinished.exchanges++;
        const [one, two] = event.cards;
        lookUp(event.playerId)!.player.exchanges++;
        for (const target of new Set([canonical(one.playerId), canonical(two.playerId)])) {
          if (target === canonical(event.playerId)) continue;
          attack(event.playerId, target);
          countPair(targets, canonical(event.playerId), target);
        }
        if (one.playerId === two.playerId) break;
        const [first, second] = [canonical(one.playerId), canonical(two.playerId)].sort();
        countPair(pairs, first, second);
        for (const [given, received] of [[one, two], [two, one]]) {
          const player = lookUp(given.playerId)!;
          const gain = given.card.points - received.card.points;
          player.bestSwap = Math.max(player.bestSwap, gain);
          if (-gain > (player.worstSwap?.value ?? 0)) {
            player.worstSwap = { players: [player.player.id], value: -gain,
              exchange: { opponentId: canonical(received.playerId), given: given.card.id, received: received.card.id } };
          }
          collect(given.playerId, received.card);
        }
        break;
      }
      case "dutch":
        lookUp(event.playerId)!.player.dutch++;
        break;
      case "round-result": {
        rounds++;
        unfinished = undefined;
        official = event.scores;
        const announcer = event.announcer && lookUp(event.announcer);
        const announcedScore = event.scores.find(({ id }) => id === event.announcer);
        if (announcer && !event.dutchPenalty) announcer.player.dutchWon++;
        for (const { id, score, base } of event.scores) {
          const entry = lookUp(id)!;
          const player = entry.player;
          player.rounds++;
          player.scoreSum += score;
          player.bestScore = Math.min(player.bestScore ?? score, score);
          if (event.winners.includes(id)) player.wins++;
          if (event.dutchPenalty && announcedScore && id !== event.announcer && base <= announcedScore.base) entry.blocked++;
        }
        break;
      }
    }
  }

  if (status === "finished") {
    const scores = [...official].sort((a, b) => a.total - b.total);
    for (const score of scores) {
      const entry = lookUp(score.id)!;
      entry.player.rank = scores.findIndex((other) => other.total === score.total) + 1;
      entry.player.total = score.total;
      entry.player.eligible = entry.firstRound === 1 && !score.left && !botIds.has(score.id);
    }
  }

  const players = [...activities.values()];
  const individual = (read: (player: Activity) => number, secondary?: (player: Activity) => number,
    allowZero = false) => players.flatMap((entry): Award[] => {
    const value = read(entry);
    if (!Number.isFinite(value) || (!allowZero && value <= 0)) return [];
    const extra = secondary?.(entry);
    return [{ players: [entry.player.id], value, ...(extra !== undefined && { extra }) }];
  });

  const awards: MatchStats["awards"] = {};
  function add(key: AwardId, candidates: Award[], minimize = false) {
    if (candidates.length) awards[key] = best(candidates, minimize);
  }
  add("shuriken", individual((entry) => entry.player.reactions, (entry) => entry.reactionPoints));
  add("luckyLuke", individual((entry) => entry.quickest, undefined, true), true);
  add("boulet", individual((entry) => entry.reactionErrors, partial ? undefined : (entry) => entry.penaltyPoints));
  add("cible", individual((entry) => entry.received, (entry) => entry.haters.size));
  add("pyromane", individual((entry) => entry.caused));
  if (!partial) add("roisNoirs", individual((entry) => entry.rois.size));
  add("distributeur", individual((entry) => entry.sent.count, partial ? undefined : (entry) => entry.sent.points));
  add("victime", [...targets.values()]);
  add("rivalite", [...pairs.values()]);
  if (!partial) {
    add("meilleur", individual((entry) => entry.bestSwap));
    add("pire", players.flatMap(({ worstSwap }) => worstSwap ? [worstSwap] : []));
  }
  add("bourreau", individual((entry) => entry.blocked));
  return { status, partial, rounds, players: players.map(({ player }) => player), awards,
    ...(status === "interrupted" && unfinished && { unfinished }) };
}
