import type { HubSession } from "../../../shared/hubTypes";

const sessionKey = "ficodutch-hub-session";
const returnKey = (hubId: string) => `${sessionKey}:return:${hubId}`;

export function readHubReturnToken(hubId: string) {
  try { return sessionStorage.getItem(returnKey(hubId)); }
  catch { return null; }
}

export function readHubSession(): HubSession | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(sessionKey) ?? "null");
    if (value && typeof value.hubId === "string" && typeof value.playerId === "string" &&
        typeof value.token === "string" && typeof value.isHost === "boolean") {
      const { hubId, playerId, token, isHost, matchId } = value;
      return { hubId, playerId, token, isHost, ...(typeof matchId === "string" && { matchId }) };
    }
  } catch {
    // La partie peut continuer dans l'onglet même si le stockage est indisponible.
  }
  return null;
}

export function saveHubSession(session: HubSession | null) {
  try {
    if (session) {
      sessionStorage.setItem(sessionKey, JSON.stringify(session));
      sessionStorage.setItem(returnKey(session.hubId), session.token);
    } else sessionStorage.removeItem(sessionKey);
  } catch {
    // La reprise dans le même onglet conserve le jeton en mémoire.
  }
}
