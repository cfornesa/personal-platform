function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
export function buildStaticImmersiveThreeEmbedHtml(
  title: string,
  pieceId: number,
  versionId: number,
  origin: string,
): string {
  const safeTitle = escapeHtml(title);
  const src = `${origin}/immersive/pieces/${pieceId}?embed=1&static=1&version=${versionId}`;
  return `<!DOCTYPE html>
<html lang="en">
...

<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle}</title>
  <style>
    html, body { margin: 0; padding: 0; overflow: hidden; width: 100%; height: 100%; background: #050b16; }
    iframe { display: block; width: 100%; height: 100%; border: 0; background: #050b16; }
  </style>
</head>
<body>
  <iframe
    src="${src}"
    title="${safeTitle}"
    loading="lazy"
    allowfullscreen
    allow="fullscreen"
    sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
  ></iframe>
</body>
</html>`;
}
