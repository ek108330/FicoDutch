import { emojis } from "../../../shared/hubSocial.json";
import type { HubEmoji } from "../../../shared/hubTypes";

type Props = {
  label: string;
  table?: boolean;
  disabled?: boolean;
  onChoose: (emoji: HubEmoji) => void;
};

export default function EmojiButtons({ label, table, disabled, onChoose }: Props) {
  const available = (Object.keys(emojis) as HubEmoji[]).filter((emoji) => table || !("tableOnly" in emojis[emoji]));
  return (
    <div className="emoji-buttons" role="group" aria-label={label}>
      {available.map((emoji) => (
        <button key={emoji} type="button" aria-label={`Envoyer l’emoji ${emojis[emoji].label}`}
          title={emojis[emoji].label} disabled={disabled} onClick={() => onChoose(emoji)}>
          <span aria-hidden="true">{emojis[emoji].symbol}</span>
        </button>
      ))}
    </div>
  );
}
