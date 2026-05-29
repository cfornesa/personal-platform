export function isValidArtPieceThumbnailUrl(value: string) {
  if (value.startsWith("/api/media/")) return value.length > "/api/media/".length;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
