import { colors, legacyStyleCount } from "../../../shared/avatarPalette.json";

// Saved avatars keep their suit and use the closest colors in the new palette.
const earlyStyles = [
  [2, 0, 5], [3, 12, 13], [0, 3, 6], [1, 9, 7],
  [2, 1, 13], [3, 12, 6], [0, 7, 15], [1, 15, 8],
];
const legacyColors = [4, 0, 6, 11, 14, 12, 9, 13];
const symbols = ["clubs", "diamonds", "spades", "hearts"] as const;
const colorsPerShape = colors.length * (colors.length - 1);
const combinations = symbols.length * colorsPerShape;

function encodeStyle(shape: number, background: number, ink: number) {
  return shape * colorsPerShape + background * (colors.length - 1) + (ink < background ? ink : ink - 1);
}

function styleIndex(id: string, style?: number | null) {
  if (style != null && Number.isInteger(style) && style >= 0 && style < legacyStyleCount + combinations) {
    if (style >= legacyStyleCount) return style - legacyStyleCount;
    const early = earlyStyles[style];
    if (early) return encodeStyle(early[0], early[1], early[2]);
    const index = style - earlyStyles.length;
    const background = Math.floor(index / (legacyColors.length - 1)) % legacyColors.length;
    const ink = index % (legacyColors.length - 1);
    return encodeStyle(Math.floor(index / (legacyColors.length * (legacyColors.length - 1))),
      legacyColors[background], legacyColors[ink < background ? ink : ink + 1]);
  }
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  const background = (hash >>> 2) % colors.length;
  const ink = (background + 1 + (hash >>> 10) % (colors.length - 1)) % colors.length;
  return encodeStyle(hash % symbols.length, background, ink);
}

export function getAvatarStyle(id: string, style?: number | null) {
  const index = styleIndex(id, style);
  const background = Math.floor(index / (colors.length - 1)) % colors.length;
  const otherColor = index % (colors.length - 1);
  return {
    symbol: symbols[Math.floor(index / colorsPerShape)],
    background: colors[background],
    ink: colors[otherColor < background ? otherColor : otherColor + 1],
    initials: background < 3 || background === colors.length - 1 ? "#fff" : "#000",
  };
}

export function generateAvatarStyle(id: string, style?: number) {
  const current = styleIndex(id, style);
  const draw = Math.floor(Math.random() * (combinations - 1));
  return legacyStyleCount + draw + Number(draw >= current);
}

export const tablePlayerName = (name: string, accountId?: string) =>
  accountId ? Array.from(name).slice(0, 10).join("") : name;

export async function prepareAvatarPhoto(file: File) {
  if (!file.size || file.size > 12 * 1024 * 1024) {
    throw new Error("Choisis une image de 12 Mo maximum.");
  }
  let image: ImageBitmap | HTMLImageElement | undefined;
  let objectUrl: string | undefined;
  try {
    try {
      image = await createImageBitmap(file);
    } catch {
      const photo = new Image();
      objectUrl = URL.createObjectURL(file);
      photo.src = objectUrl;
      try { await photo.decode(); }
      catch { throw new Error("Cette image ne peut pas être ouverte. Essaie un fichier JPEG, PNG ou WebP."); }
      image = photo;
    }
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("La réduction de l’image est indisponible.");
    const width = image instanceof HTMLImageElement ? image.naturalWidth : image.width;
    const height = image instanceof HTMLImageElement ? image.naturalHeight : image.height;
    const crop = Math.min(width, height);
    context.beginPath();
    context.arc(size / 2, size / 2, size / 2, 0, 2 * Math.PI);
    context.clip();
    context.imageSmoothingQuality = "high";
    context.drawImage(image, (width - crop) / 2, (height - crop) / 2, crop, crop, 0, 0, size, size);
    return canvas.toDataURL("image/png").split(",")[1];
  } finally {
    if (image && "close" in image) image.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
