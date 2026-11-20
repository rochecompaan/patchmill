/** @typedef {import('../src/web/api-types.ts').DocumentLink} DocumentLink */

/** Same shape as `fileIdPattern` on the server; IDs are issued, never paths. */
const issueFile =
  /^\/files\/issues\/[1-9]\d*\/(?:mockup|diagram)-[0-9a-f]{12}$/;

/** Root-relative previews only; the server owns the concrete asset allowlist.
 * @param {string} value @returns {string|null} */
export function safePreviewUrl(value) {
  if (issueFile.test(value)) return value;
  if (!value.startsWith("/samples/") || /[\\\\%?#\s]/.test(value)) return null;
  const path = new URL(value, "http://preview.invalid").pathname;
  return path === value &&
    /\.(?:html|png)$/.test(path) &&
    !path.split("/").some((part) => part.startsWith("."))
    ? path
    : null;
}

/**
 * Repository files may run scripts, but only in an opaque origin. Sample
 * previews keep same-origin access and run no scripts (their CSP).
 * @param {string} url @returns {"allow-scripts"|"allow-same-origin"}
 */
export function previewSandbox(url) {
  return issueFile.test(url) ? "allow-scripts" : "allow-same-origin";
}

/**
 * Host links for documents the viewer does not already open.
 * @param {readonly DocumentLink[]} links
 * @param {readonly {kind:string}[]} artifacts
 * @returns {DocumentLink[]}
 */
export function remainingDocumentLinks(links, artifacts) {
  return links.filter((link) => !artifacts.some((a) => a.kind === link.kind));
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
