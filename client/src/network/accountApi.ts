import type { Account, MatchStatus, Profile, SavedMatch } from "../../../shared/statistics";
import { SERVER_URL } from "./socket";

export type AccountSession = { enabled: boolean; account: Account | null };
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
export const readMatch = (id: string, signal?: AbortSignal) => request<SavedMatch>(`/matches/${encodeURIComponent(id)}`, { signal });
export const readProfile = (id: string, signal?: AbortSignal) => request<Profile>(`/players/${encodeURIComponent(id)}`, { signal });
export const readRecentMatches = (cursor: string | null, signal?: AbortSignal) =>
  request<{ matches: RecentMatch[]; next: string | null }>(
    "/matches/recent" + (cursor ? `?before=${encodeURIComponent(cursor)}` : ""), { signal });

export const matchPath = (id: string) => `/parties/${encodeURIComponent(id)}`;
export const profilePath = (id: string) => `/joueurs/${encodeURIComponent(id)}`;
