import { emojis } from "../../../shared/hubSocial.json";
import type { HubEmoji } from "../../../shared/hubTypes";

type Props = {
  label: string;
  disabled?: boolean;
  onChoose: (emoji: HubEmoji) => void;
};

export default function EmojiButtons({ label, disabled, onChoose }: Props) {
  const available = Object.keys(emojis) as HubEmoji[];
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
