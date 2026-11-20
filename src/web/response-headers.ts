import type { ServerResponse } from "node:http";

/**
 * `app` is the page. `sample` is a fixed sample preview, scripts off.
 * `document` is a repository HTML file: scripts on, opaque origin, no network.
 */
export type ResponseProfile = "app" | "sample" | "document";

const DOCUMENT_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts";

function policy(profile: ResponseProfile): string {
  if (profile === "document") return DOCUMENT_CSP;
  const preview = profile === "sample";
  const script = preview ? "'none'" : "'self'";
  return `default-src 'none'; script-src ${script}; style-src 'self'; font-src 'self'; img-src 'self'; connect-src ${script}; frame-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'self'${preview ? "; sandbox allow-same-origin" : ""}`;
}

export function setResponseHeaders(
  response: ServerResponse,
  profile: ResponseProfile = "app",
): void {
  response.setHeader("Content-Security-Policy", policy(profile));
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
}
