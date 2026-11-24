import type { GameState } from "./gameTypes";
import { matchEntries, type JournalEntry, type MatchJournal } from "./matchJournal.ts";

export type HostRound = { hubId: string; gameNumber: number; state: GameState; previousGames?: MatchJournal[] };
type Backup = {
  clock: number;
  state: Omit<GameState, "journal">;
  journal: JournalEntry[];
  previous: JournalEntry[][];
};

const encoder = new TextEncoder();
const context = (hubId: string, gameNumber: number) => encoder.encode(`${hubId}:${gameNumber}`);

export async function importRoundKey(raw: string) {
  return crypto.subtle.importKey("raw", Uint8Array.from(atob(raw), (character) => character.charCodeAt(0)),
    "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function newRoundKey() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
}

function restoreJournal(entries: JournalEntry[]) {
  return entries.reduce<MatchJournal | undefined>((previous, entry) => ({ entry, previous }), undefined);
}

export async function encodeRoundBackup({ hubId, gameNumber, state, previousGames }: HostRound, key: CryptoKey, clock: number) {
  const { journal, ...visibleToSuccessor } = state;
  const backup: Backup = { clock, state: visibleToSuccessor, journal: matchEntries(journal),
    previous: previousGames?.map(matchEntries) ?? [] };
  const gzip = new Blob([JSON.stringify(backup)]).stream().pipeThrough(new CompressionStream("gzip"));
  const compressed = await new Response(gzip).arrayBuffer();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: context(hubId, gameNumber) }, key, compressed);
  const bytes = new Uint8Array(iv.length + encrypted.byteLength);
  bytes.set(iv);
  bytes.set(new Uint8Array(encrypted), iv.length);
  return bytes;
}

export async function decodeRoundBackup(hubId: string, gameNumber: number, bytes: ArrayBuffer, key: CryptoKey, now: () => number): Promise<HostRound> {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: context(hubId, gameNumber) },
    key, bytes.slice(12));
  const plain = new Blob([decrypted]).stream().pipeThrough(new DecompressionStream("gzip"));
  const backup: Backup = await new Response(plain).json();
  const { state } = backup;
  const offset = now() - backup.clock;
  const shift = (time: number | null) => time === null ? null : time + offset;
  return { hubId, gameNumber, state: {
    ...state, journal: restoreJournal(backup.journal),
    phaseDeadline: shift(state.phaseDeadline),
    turn: state.turn && { ...state.turn, deadline: state.turn.deadline + offset },
    reaction: { ...state.reaction, presentedAt: shift(state.reaction.presentedAt) },
    ...(state.cardMotion && { cardMotion: { ...state.cardMotion, at: state.cardMotion.at + offset } }),
    ...(state.dutch && { dutch: { ...state.dutch,
      ...(state.dutch.announcedAt !== undefined && { announcedAt: state.dutch.announcedAt + offset }) } }),
  }, previousGames: backup.previous.flatMap((entries) => restoreJournal(entries) ?? []) };
}
