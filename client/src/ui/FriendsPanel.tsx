import { useEffect, useId, useRef, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import type { FriendPlayer, FriendPresence, FriendsList } from "../../../shared/friends";
import { profilePath, readFriends, updateFriendship } from "../network/accountApi";
import { socket } from "../network/socket";
import PlayerAvatar from "./PlayerAvatar";
import RatingBadge from "./RatingBadge";

function FriendIdentity({ player, navigate }: { player: FriendPlayer; navigate: (path: string) => void }) {
  const path = profilePath(player.id);
  return <a className="friend-identity" href={path} onClick={(event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(path);
  }}>
    <PlayerAvatar id={player.id} name={player.name} style={player.avatarStyle} photoId={player.avatarPhotoId} mini />
    <span title={player.name}>{player.name}</span>
    <RatingBadge rating={player.rating} />
  </a>;
}

export default function FriendsPanel({ navigate }: { navigate: (path: string) => void }) {
  const [data, setData] = useState<FriendsList>();
  const [listError, setListError] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const dialogTitle = useId();

  useEffect(() => {
    let pending: AbortController | undefined;
    const latestPresence = new Map<string, boolean>();
    function load() {
      pending?.abort();
      latestPresence.clear();
      const controller = new AbortController();
      pending = controller;
      void readFriends(controller.signal).then((next) => {
        if (controller.signal.aborted) return;
        pending = undefined;
        setListError(false);
        setData({ ...next, friends: next.friends.map((friend) =>
          ({ ...friend, online: latestPresence.get(friend.id) ?? friend.online })) });
        latestPresence.clear();
      }, () => {
        if (!controller.signal.aborted) {
          pending = undefined;
          setListError(true);
        }
      });
    }
    function presence({ id, online }: FriendPresence) {
      if (pending) latestPresence.set(id, online);
      setData((current) => current && ({ ...current, friends: current.friends.map((friend) =>
        friend.id === id ? { ...friend, online } : friend) }));
    }
    load();
    socket.on("connect", load);
    socket.on("friends:changed", load);
    socket.on("friends:presence", presence);
    return () => {
      pending?.abort();
      socket.off("connect", load);
      socket.off("friends:changed", load);
      socket.off("friends:presence", presence);
    };
  }, []);

  async function decide(id: string, action: "accept" | "remove") {
    setBusy(true);
    setActionError("");
    try {
      await updateFriendship(id, action);
      setData((current) => current && ({ ...current, incoming: current.incoming.filter((player) => player.id !== id) }));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Cette demande est indisponible.");
    } finally {
      setBusy(false);
    }
  }

  const friends = [...(data?.friends ?? [])].sort((a, b) => Number(b.online) - Number(a.online));
  const incoming = data?.incoming ?? [];
  const requestLabel = incoming.length === 1 ? "1 demande d’amitié" : `${incoming.length} demandes d’amitié`;
  return <section className="home-friends" aria-labelledby={title}>
    <header>
      <h2 id={title}>Amis</h2>
      <button type="button" className="friend-notifications" aria-haspopup="dialog"
        aria-label={incoming.length ? requestLabel : "Demandes d’amitié"}
        title={incoming.length ? requestLabel : "Demandes d’amitié"} onClick={() => {
          setActionError("");
          dialog.current?.showModal();
        }}>
        <Bell size={16} aria-hidden="true" />
        {incoming.length > 0 && <span aria-hidden="true">{incoming.length}</span>}
      </button>
      <span className="sr-only" aria-live="polite">{incoming.length > 0 ? requestLabel : ""}</span>
    </header>
    {friends.length ? <ul className="home-friends-list" aria-label="Liste d’amis" tabIndex={friends.length > 2 ? 0 : undefined}>
      {friends.map((friend) => <li key={friend.id} data-online={friend.online}>
        <span className="friend-presence" role="img" aria-label={friend.online ? "En ligne" : "Hors ligne"}
          title={friend.online ? "En ligne" : "Hors ligne"} />
        <FriendIdentity player={friend} navigate={navigate} />
      </li>)}
    </ul> : <p className="home-friends-empty">{listError ? "Liste indisponible" : data ? "Aucun ami" : "Chargement…"}</p>}
    <dialog className="hub-management friend-requests" ref={dialog} aria-labelledby={dialogTitle}>
      <header>
        <h2 id={dialogTitle}>Demandes d’amitié</h2>
        <button type="button" className="friend-request-icon" aria-label="Fermer les demandes d’amitié" autoFocus
          onClick={() => dialog.current?.close()}><X size={19} aria-hidden="true" /></button>
      </header>
      {incoming.length > 0 ? <ul>{incoming.map((player) => <li key={player.id}>
        <FriendIdentity player={player} navigate={(path) => {
          dialog.current?.close();
          navigate(path);
        }} />
        <button type="button" className="friend-request-icon friend-accept" disabled={busy}
          aria-label={`Accepter la demande de ${player.name}`} onClick={() => void decide(player.id, "accept")}>
          <Check size={18} aria-hidden="true" />
        </button>
        <button type="button" className="friend-request-icon friend-refuse" disabled={busy}
          aria-label={`Refuser la demande de ${player.name}`} onClick={() => void decide(player.id, "remove")}>
          <X size={18} aria-hidden="true" />
        </button>
      </li>)}</ul> : <p>Aucune demande en attente.</p>}
      {actionError && <p role="alert">{actionError}</p>}
    </dialog>
  </section>;
}
