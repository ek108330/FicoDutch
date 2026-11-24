import { avatarStyles } from "./playerAvatarConfig";

export default function PlayerAvatar({ id, name, style, mini = false }: {
  id: string; name: string; style?: number | null; mini?: boolean;
}) {
  const automatic = Number.parseInt(id.slice(-6), 16) % avatarStyles.length;
  const choice = avatarStyles[style ?? automatic] ?? avatarStyles[0];
  const initials = Array.from(name).slice(0, 2).join("").toLocaleUpperCase("fr");
  return <span className={`player-avatar${mini ? " player-avatar-mini" : ""}`} aria-hidden="true"
    style={{ backgroundColor: choice.background, color: choice.ink }}>
    <span>{choice.symbol}</span><span>{initials}</span>
  </span>;
}
