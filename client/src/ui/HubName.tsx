import type { Hub } from "../../../shared/hubTypes";
import PlayerAvatar from "./PlayerAvatar";

export default function HubName({ hub }: { hub: Pick<Hub, "name" | "creatorAvatar"> }) {
  const avatar = hub.creatorAvatar;
  return <span className="hub-name">
    {avatar && <PlayerAvatar id={avatar.id} name={hub.name.slice("Hub de ".length)} style={avatar.style} photoId={avatar.photoId} mini />}
    <span>{hub.name}</span>
  </span>;
}
