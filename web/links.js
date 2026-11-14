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
