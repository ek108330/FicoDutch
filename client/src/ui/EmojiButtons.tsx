import { useRef } from "react";
import { emojis } from "../../../shared/hubSocial.json";
import type { HubEmoji } from "../../../shared/hubTypes";

type Props = {
  label: string;
  disabled?: boolean;
  onChoose: (emoji: HubEmoji) => void;
};

export default function EmojiButtons({ label, disabled, onChoose }: Props) {
  return (
    <div className="emoji-buttons" role="group" aria-label={label}>
      {(Object.keys(emojis) as HubEmoji[]).map((emoji) => (
        <button key={emoji} type="button" aria-label={`Envoyer l’emoji ${emojis[emoji].label}`}
          title={emojis[emoji].label} disabled={disabled} onClick={() => onChoose(emoji)}>
          <span aria-hidden="true">{emojis[emoji].symbol}</span>
        </button>
      ))}
    </div>
  );
}

export function TableEmojiPicker({ onChoose }: Pick<Props, "onChoose">) {
  const menu = useRef<HTMLDetailsElement>(null);
  return (
    <details className="table-emoji-picker" ref={menu}>
      <summary>Emojis</summary>
      <EmojiButtons label="Emojis de la table" onChoose={(emoji) => {
        if (menu.current) {
          menu.current.open = false;
          menu.current.querySelector("summary")?.focus();
        }
        onChoose(emoji);
      }} />
    </details>
  );
}
