export type Friendship = "none" | "sent" | "received" | "friends";

export type FriendPlayer = {
  id: string;
  name: string;
  rating: number;
  avatarStyle: number | null;
  avatarPhotoId: string | null;
};

export type FriendPresence = { id: string; online: boolean };

export type FriendsList = {
  friends: (FriendPlayer & FriendPresence)[];
  incoming: FriendPlayer[];
};
