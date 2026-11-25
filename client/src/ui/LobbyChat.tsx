import { useEffect, useId, useRef, useState } from "react";
import { Smile } from "lucide-react";
import { emojis, maxMessageLength } from "../../../shared/hubSocial.json";
import type { LobbyChatContent, LobbyChatMessage, LobbyChatStatus } from "../../../shared/hubTypes";
import { socket } from "../network/socket";
import EmojiButtons from "./EmojiButtons";

type Props = { hubId: string; connected: boolean };
const MAX_VISIBLE_MESSAGES = 32;

export default function LobbyChat({ hubId, connected }: Props) {
  const [messages, setMessages] = useState<LobbyChatMessage[]>([]);
  const [text, setText] = useState("");
  const [notice, setNotice] = useState("");
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiId = useId();
  const emojiPicker = useRef<HTMLDivElement>(null);
  const emojiTrigger = useRef<HTMLButtonElement>(null);
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
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!emojiOpen) return;
    function dismiss(event: Event) {
      if (event.type === "pointerdown" && emojiPicker.current?.contains(event.target as Node)) return;
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event.type !== "pointerdown") emojiTrigger.current?.focus();
      setEmojiOpen(false);
    }
    window.addEventListener("pointerdown", dismiss);
    window.addEventListener("keydown", dismiss);
    window.addEventListener("ficodutch:back", dismiss);
    return () => {
      window.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("keydown", dismiss);
      window.removeEventListener("ficodutch:back", dismiss);
    };
  }, [emojiOpen]);

  function send(content: LobbyChatContent) {
    if (!connected || !socket.connected) return;
    setNotice("");
    socket.timeout(3_000).emit("hub:lobby-chat", { hubId, ...content }, (error: Error | null, status: LobbyChatStatus) => {
      if (error || status === "unavailable") {
        setNotice("Le message n’a pas été envoyé.");
      } else if (status === "invalid") {
        setNotice("Ce message ne peut pas être envoyé.");
      } else if (status === "ok" && content.kind === "text") {
        setText((draft) => draft.trim() === content.text ? "" : draft);
      }
    });
  }

  return (
    <section className="lobby-chat" aria-label="Chat du Hub">
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
        <div className="chat-emoji-picker" ref={emojiPicker}>
          <button type="button" className="chat-emoji-trigger" ref={emojiTrigger} aria-label="Émojis du Hub"
            aria-expanded={emojiOpen && connected} aria-controls={emojiId} disabled={!connected}
            onClick={() => setEmojiOpen(!emojiOpen)}><Smile size={19} aria-hidden="true" /></button>
          <div className="chat-emoji-options" id={emojiId} hidden={!emojiOpen || !connected}>
            <EmojiButtons label="Choisir un émoji" onChoose={(emoji) => {
              send({ kind: "emoji", emoji });
              setEmojiOpen(false);
              emojiTrigger.current?.focus();
            }} />
          </div>
        </div>
        <button type="submit" disabled={!connected || !text.trim()}>Envoyer</button>
      </form>
      {notice && <p className="chat-notice" role="status">{notice}</p>}
    </section>
  );
}
