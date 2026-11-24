export const avatarStyles = [
  { name: "Pique", symbol: "♠", background: "#183e3b", ink: "#e2f5dc" },
  { name: "Cœur", symbol: "♥", background: "#8f283c", ink: "#fff0e9" },
  { name: "Trèfle", symbol: "♣", background: "#24624a", ink: "#fff3c4" },
  { name: "Carreau", symbol: "♦", background: "#b45729", ink: "#fff5dd" },
  { name: "Pique bleu", symbol: "♠", background: "#263d75", ink: "#edf4ff" },
  { name: "Cœur violet", symbol: "♥", background: "#62417f", ink: "#fff0fd" },
  { name: "Trèfle doré", symbol: "♣", background: "#edcc72", ink: "#352810" },
  { name: "Carreau noir", symbol: "♦", background: "#302c39", ink: "#ffd296" },
];

export const tablePlayerName = (name: string, accountId?: string) =>
  accountId ? Array.from(name).slice(0, 10).join("") : name;
