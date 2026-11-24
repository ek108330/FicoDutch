import { useState } from "react";
import { avatarPhotoUrl } from "../network/accountApi";
import { getAvatarStyle } from "./playerAvatarConfig";

const shapes = {
  clubs: "M10 22h4l-1-5a5 5 0 1 0 3-7.5 5 5 0 1 0-8 0 5 5 0 1 0 3 7.5Z",
  diamonds: "M12 2 21 12 12 22 3 12Z",
  spades: "M12 2c-4.4 4.6-9 7.9-9 12a5 5 0 0 0 8 4L9 22h6l-2-4a5 5 0 0 0 8-4c0-4.1-4.6-7.4-9-12Z",
  hearts: "M12 21 4.1 13.3C-2 7.4 6 0 12 6.5 18 0 26 7.4 19.9 13.3Z",
  robot: "M9 6h2V2h2v4h2a4 4 0 0 1 4 4v1h2v6h-2a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4H3v-6h2v-1a4 4 0 0 1 4-4Z",
};

export default function PlayerAvatar({ id, name, style, photoId, mini = false, isBot = false }: {
  id: string; name: string; style?: number | null; photoId?: string | null; mini?: boolean; isBot?: boolean;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string>();
  const choice = getAvatarStyle(id, style);
  const mark = isBot ? "robot" : choice.symbol;
  const initials = Array.from(name).slice(0, 2).join("").toLocaleUpperCase("fr");
  return <span className={`player-avatar${mini ? " player-avatar-mini" : ""}`} aria-hidden="true"
    style={{ backgroundColor: choice.background, color: choice.ink }}>
    {!isBot && photoId && photoId !== failedPhoto
      ? <img src={avatarPhotoUrl(photoId)} alt="" width={128} height={128} onError={() => setFailedPhoto(photoId)} />
      : <>
        <svg className="avatar-symbol" viewBox="0 0 24 24" data-avatar-mark={mark} aria-hidden="true">
          <path d={shapes[mark]} fill="currentColor" stroke="#000" strokeWidth="1.5" strokeLinejoin="round" />
          {isBot && <g fill="#fff" stroke="#000" strokeWidth="0.65">
            <circle cx="9" cy="12" r="1.55" /><circle cx="15" cy="12" r="1.55" />
            <rect x="9" y="16" width="6" height="1.5" rx="0.65" />
          </g>}
        </svg>
        {!mini && <span style={{ color: choice.initials }}>{initials}</span>}
      </>}
  </span>;
}
