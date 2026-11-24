export type MatchStatus = "finished" | "interrupted";

export type MatchPlayer = {
  id: string;
  name: string;
  rounds: number;
  wins: number;
  scoreSum: number;
  bestScore: number | null;
  dutch: number;
  dutchWon: number;
  reactions: number;
  penalties: number;
  exchanges: number;
  rank?: number;
  total?: number;
  eligible?: boolean;
  accountId?: string;
};

export type AwardId = "shuriken" | "luckyLuke" | "boulet" | "cible" | "pyromane" | "roisNoirs" |
  "distributeur" | "victime" | "rivalite" | "meilleur" | "pire" | "voleur" | "bourreau";

export type Award = { players: string[]; value: number; extra?: number };

export type MatchStats = {
  status: MatchStatus;
  partial: boolean;
  rounds: number;
  players: MatchPlayer[];
  awards: Partial<Record<AwardId, Award[]>>;
  unfinished?: { round: number; reactions: number; penalties: number; exchanges: number; gifts: number };
};

export type SavedMatch = MatchStats & { id: string; startedAt: number; endedAt: number };

export type Account = { id: string; handle: string; name: string };

export type Profile = {
  demoBot?: boolean;
  id: string;
  name: string;
  rating: number;
  matches: number;
  finished: number;
  interrupted: number;
  victories: number;
  rounds: number;
  roundWins: number;
  scoreSum: number;
  bestScore: number | null;
  dutch: number;
  dutchWon: number;
  reactions: number;
  penalties: number;
  exchanges: number;
  ratings: { rating: number; date: number }[];
  rivals: { id: string; name: string; played: number; wins: number; losses: number }[];
  encounters: { date: number; opponents: { id: string; name: string; outcome: number }[] }[];
};
