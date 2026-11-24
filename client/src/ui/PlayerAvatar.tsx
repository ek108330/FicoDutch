import { useState } from "react";
import { avatarPhotoUrl } from "../network/accountApi";
import { getAvatarStyle } from "./playerAvatarConfig";

export default function PlayerAvatar({ id, name, style, photoId, mini = false }: {
  id: string; name: string; style?: number | null; photoId?: string | null; mini?: boolean;
}) {
  const [failedPhoto, setFailedPhoto] = useState<string>();
  const choice = getAvatarStyle(id, style);
  const initials = Array.from(name).slice(0, 2).join("").toLocaleUpperCase("fr");
  return <span className={`player-avatar${mini ? " player-avatar-mini" : ""}`} aria-hidden="true"
    style={{ backgroundColor: choice.background, color: choice.ink }}>
    {photoId && photoId !== failedPhoto
      ? <img src={avatarPhotoUrl(photoId)} alt="" width={128} height={128} onError={() => setFailedPhoto(photoId)} />
      : <><span>{choice.symbol}</span><span>{initials}</span></>}
  </span>;
}
