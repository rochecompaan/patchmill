/** Root-relative previews only; the server owns the concrete asset allowlist.
 * @param {string} value @returns {string|null} */
export function safePreviewUrl(value) {
  if (!value.startsWith("/samples/") || /[\\\\%?#\s]/.test(value)) return null;
  const path = new URL(value, "http://preview.invalid").pathname;
  return path === value &&
    /\.(?:html|png)$/.test(path) &&
    !path.split("/").some((part) => part.startsWith("."))
    ? path
    : null;
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
