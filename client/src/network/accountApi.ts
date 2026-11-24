import type { Account, DirectoryPlayer, MatchStatus, Profile, SavedMatch } from "../../../shared/statistics";
import { SERVER_URL } from "./socket";

export type AccountSession = { enabled: boolean; account: Account | null; demo?: boolean };
export type RecentMatch = { id: string; date: number; status: MatchStatus };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${SERVER_URL}/api${path}`, {
    credentials: "include",
    ...options,
    ...(options?.body && { headers: { "Content-Type": "application/json" } }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Cette page est momentanément indisponible.");
  return data as T;
}

export const readAccount = (signal?: AbortSignal) => request<AccountSession>("/session", { signal });
export const signIn = (handle: string, password: string, create: boolean) =>
  request<AccountSession>(create ? "/accounts" : "/session", { method: "POST", body: JSON.stringify({ handle, password }) });
export const signOut = () => request<AccountSession>("/session", { method: "DELETE" });
export const rename = (name: string) => request<AccountSession>("/account", { method: "PATCH", body: JSON.stringify({ name }) });
export function guestMatchToken(id: string) {
  try { return sessionStorage.getItem("ficodutch-match:" + id); }
  catch { return null; }
}
export function rememberGuestMatch(id: string, token: string) {
  try { sessionStorage.setItem("ficodutch-match:" + id, token); }
  catch { /* The browser can block session storage. */ }
}
function matchOptions(id: string, signal?: AbortSignal) {
  const token = guestMatchToken(id);
  return { signal, ...(token && { headers: { "X-FicoDutch-Seat": token } }) };
}
export const readMatch = (id: string, signal?: AbortSignal) =>
  request<SavedMatch>(`/matches/${encodeURIComponent(id)}`, matchOptions(id, signal));
export const readTableSummary = (id: string, signal?: AbortSignal) =>
  request<SavedMatch>(`/matches/${encodeURIComponent(id)}?table=1`, matchOptions(id, signal));
export const readPlayers = (query: string, after: string, signal?: AbortSignal) =>
  request<{ players: DirectoryPlayer[]; next: string | null }>(
    "/players?" + new URLSearchParams({ q: query, after }), { signal });
export const readProfile = (id: string, signal?: AbortSignal) => request<Profile>(`/players/${encodeURIComponent(id)}`, { signal });
export const readDemoBots = (signal?: AbortSignal) => request<Array<{ id: string; name: string; matches: number }>>("/demo-bots", { signal });
export const readRecentMatches = (cursor: string | null, signal?: AbortSignal) =>
  request<{ matches: RecentMatch[]; next: string | null }>(
    "/matches/recent" + (cursor ? `?before=${encodeURIComponent(cursor)}` : ""), { signal });

export const matchPath = (id: string) => `/parties/${encodeURIComponent(id)}`;
export const tableSummaryPath = (id: string) => `/bilans/${encodeURIComponent(id)}`;
export const profilePath = (id: string) => `/joueurs/${encodeURIComponent(id)}`;
