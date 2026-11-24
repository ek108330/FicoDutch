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

const pastelColors = [
  ["#d5e2d5", "#456454"], ["#dbe5ef", "#496587"], ["#f0e2ad", "#765e2c"], ["#efd6d8", "#8b4b56"],
  ["#e2e0df", "#575960"], ["#e5daed", "#755785"], ["#eedbc9", "#8a583c"], ["#f8f4e9", "#fffcf4"],
];
const symbols = ["♣", "♦", "♠", "♥"];

export function automaticAvatar(id: string) {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const background = (hash >>> 2) % pastelColors.length;
  const foreground = (background + 1 + (hash >>> 10) % (pastelColors.length - 1)) % pastelColors.length;
  return {
    symbol: symbols[hash % symbols.length],
    background: pastelColors[background][foreground === pastelColors.length - 1 ? 1 : 0],
    ink: pastelColors[foreground][1],
  };
}

export const tablePlayerName = (name: string, accountId?: string) =>
  accountId ? Array.from(name).slice(0, 10).join("") : name;

export async function prepareAvatarPhoto(file: File) {
  if (!file.size || file.size > 12 * 1024 * 1024) {
    throw new Error("Choisis une image de 12 Mo maximum.");
  }
  let image: ImageBitmap;
  try { image = await createImageBitmap(file); }
  catch { throw new Error("Cette image ne peut pas être ouverte. Essaie un fichier JPEG, PNG ou WebP."); }
  try {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("La réduction de l’image est indisponible.");
    const crop = Math.min(image.width, image.height);
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2, 0, 2 * Math.PI);
    context.clip();
    context.imageSmoothingQuality = "high";
    context.drawImage(image, (image.width - crop) / 2, (image.height - crop) / 2, crop, crop, 0, 0, size, size);
    return canvas.toDataURL("image/png").split(",")[1];
  } finally {
    image.close();
  }
}
