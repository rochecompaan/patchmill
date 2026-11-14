const previews = new Set([
  "/samples/board.html",
  "/samples/design-review.html",
  "/samples/planning-flow.html",
  "/samples/board-columns.png",
  "/samples/blocked-card.png",
  "/samples/board-mobile.png",
]);
/** @param {string} value @returns {string|null} */
export function safePreviewUrl(value) {
  return previews.has(value) ? value : null;
}

/** @param {string} value @returns {string|null} */
export function safeExternalUrl(value) {
  try {
    if (value.trim().startsWith("//")) return null;
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
