import { useEffect, useState } from "react";
import { UserMinus, UserPlus } from "lucide-react";
import type { Friendship } from "../../../shared/friends";
import { readFriendship, updateFriendship } from "../network/accountApi";
import { socket } from "../network/socket";

export default function FriendProfileActions({ id }: { id: string }) {
  const [relationship, setRelationship] = useState<Friendship>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let pending: AbortController | undefined;
    function load() {
      pending?.abort();
      const controller = new AbortController();
      pending = controller;
      void readFriendship(id, controller.signal).then(({ relationship }) => {
        if (!controller.signal.aborted) setRelationship(relationship);
      }, () => {
        if (!controller.signal.aborted) setError("Action d’amitié indisponible.");
      });
    }
    load();
    socket.on("friends:changed", load);
    socket.on("connect", load);
    return () => {
      pending?.abort();
      socket.off("friends:changed", load);
      socket.off("connect", load);
    };
  }, [id]);

  async function change(action: Parameters<typeof updateFriendship>[1]) {
    setBusy(true);
    setError("");
    try {
      const updated = await updateFriendship(id, action);
      setRelationship(updated.relationship);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Action d’amitié indisponible.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="archive-actions profile-friend-actions">
    {relationship === "none" && <button type="button" disabled={busy} onClick={() => void change("request")}>
      <UserPlus size={16} aria-hidden="true" /> Ajouter en ami
    </button>}
    {relationship === "friends" && <button type="button" disabled={busy} onClick={() => void change("remove")}>
      <UserMinus size={16} aria-hidden="true" /> Retirer des amis
    </button>}
    {relationship === "sent" && <>
      <span role="status">Demande envoyée</span>
      <button type="button" disabled={busy} onClick={() => void change("remove")}>Annuler la demande</button>
    </>}
    {relationship === "received" && <>
      <button type="button" disabled={busy} onClick={() => void change("accept")}>Accepter la demande</button>
      <button type="button" disabled={busy} onClick={() => void change("remove")}>Refuser la demande</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
