import { useEffect, useRef, useState } from "react";
import { emojis, maxMessageLength } from "../../../shared/hubSocial.json";
import type { LobbyChatContent, LobbyChatMessage, LobbyChatStatus } from "../../../shared/hubTypes";
import { socket } from "../network/socket";
import EmojiButtons from "./EmojiButtons";

type Props = { hubId: string; connected: boolean; active: boolean };
const MAX_VISIBLE_MESSAGES = 32;

export default function LobbyChat({ hubId, connected, active }: Props) {
  const [messages, setMessages] = useState<LobbyChatMessage[]>([]);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function receive(message: LobbyChatMessage) {
      if (message.hubId !== hubId) return;
      setMessages((current) => [...current.slice(1 - MAX_VISIBLE_MESSAGES), message]);
    }
    socket.on("hub:lobby-chat", receive);
    return () => { socket.off("hub:lobby-chat", receive); };
  }, [hubId]);

  useEffect(() => {
    if (active && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [active, messages]);

  function send(content: LobbyChatContent) {
    if (!connected || !socket.connected) return;
    setNotice("");
    socket.timeout(3_000).emit("hub:lobby-chat", { hubId, ...content }, (error: Error | null, status: LobbyChatStatus) => {
      if (error || status === "unavailable") {
        setNotice("Le message n’a pas été envoyé.");
      } else if (status === "slow") {
        setNotice("Attends un instant avant d’envoyer un autre message.");
      } else if (status === "invalid") {
        setNotice("Ce message ne peut pas être envoyé.");
      } else if (content.kind === "text") {
        setText((draft) => draft.trim() === content.text ? "" : draft);
      }
    });
  }

  return (
    <section className="lobby-chat" aria-label="Chat du Hub" hidden={!active}>
      <div className="chat-log" ref={log} role="log" aria-label="Messages du Hub" tabIndex={0}>
        {messages.length ? (
          <ol>
            {messages.map((message) => (
              <li key={message.id}>
                <strong>{message.pseudo}</strong>
                {message.kind === "text" ? <span>{message.text}</span>
                  : <span role="img" aria-label={emojis[message.emoji].label}>{emojis[message.emoji].symbol}</span>}
              </li>
            ))}
          </ol>
        ) : <p>Aucun message pour le moment.</p>}
      </div>
      <form className="chat-composer" onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) send({ kind: "text", text: text.trim() });
      }}>
        <input aria-label="Message du Hub" placeholder="Écris un message" type="text" autoComplete="off"
          value={text} maxLength={maxMessageLength} disabled={!connected}
          onChange={(event) => setText(event.target.value)} />
        <button type="submit" disabled={!connected || !text.trim()}>Envoyer</button>
      </form>
      <EmojiButtons label="Emojis du Hub" disabled={!connected} onChoose={(emoji) => send({ kind: "emoji", emoji })} />
      {notice && <p className="chat-notice" role="status">{notice}</p>}
    </section>
  );
}
