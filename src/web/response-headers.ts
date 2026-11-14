import type { ServerResponse } from "node:http";
export function setResponseHeaders(
  response: ServerResponse,
  preview = false,
): void {
  const script = preview ? "'none'" : "'self'";
  response.setHeader(
    "Content-Security-Policy",
    `default-src 'none'; script-src ${script}; style-src 'self'; font-src 'self'; img-src 'self'; connect-src ${script}; frame-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'self'${preview ? "; sandbox allow-same-origin" : ""}`,
  );
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
}
