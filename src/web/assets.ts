import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { findPackageRoot } from "../package-root.ts";
export type WebAsset = { body: Buffer; contentType: string; preview: boolean };
const publicFiles = new Set([
  "index.html",
  "app.js",
  "api.js",
  "state.js",
  "controller.js",
  "dom.js",
  "board.js",
  "issue.js",
  "thread.js",
  "artifacts.js",
  "preferences.js",
  "theme-init.js",
  "links.js",
  "styles/base.css",
  "styles/board.css",
  "styles/issue.css",
  "styles/thread.css",
  "styles/artifacts.css",
  "images/grain.svg",
  "images/mark.svg",
  "fonts/atkinson-hyperlegible-next.woff2",
  "fonts/atkinson-hyperlegible-mono.woff2",
  "samples/board.html",
  "samples/design-review.html",
  "samples/planning-flow.html",
  "samples/preview.css",
  "samples/board-columns.png",
  "samples/blocked-card.png",
  "samples/board-mobile.png",
]);
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};
export function resolveWebRoot(
  moduleUrl: string | URL = import.meta.url,
): string {
  return join(findPackageRoot(dirname(fileURLToPath(moduleUrl))), "web");
}
export function publicPath(target: string): string | null {
  const raw = target.slice(
    0,
    target.indexOf("?") < 0 ? target.length : target.indexOf("?"),
  );
  if (!raw.startsWith("/") || raw.startsWith("//") || /%(?:2f|5c)/i.test(raw))
    return null;
  try {
    const decoded = decodeURIComponent(raw);
    if (
      /[\x00-\x1f\\%#]/.test(decoded) ||
      decoded.split("/").some((s) => s === "." || s === "..")
    )
      return null;
    return decoded;
  } catch {
    return null;
  }
}
export async function readWebAsset(
  webRoot: string,
  target: string,
): Promise<WebAsset | null> {
  const path = publicPath(target);
  if (path === null) return null;
  const file = path === "/" ? "index.html" : path.slice(1);
  if (!publicFiles.has(file)) return null;
  try {
    const root = await realpath(webRoot),
      candidate = await realpath(join(root, file)),
      rel = relative(root, candidate);
    if (
      rel.startsWith("..") ||
      isAbsolute(rel) ||
      !(await stat(candidate)).isFile()
    )
      return null;
    return {
      body: await readFile(candidate),
      contentType: mime[extname(file)]!,
      preview: file.startsWith("samples/") && file.endsWith(".html"),
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["ENOENT", "ENOTDIR", "ELOOP"].includes(String(error.code))
    )
      return null;
    throw error;
  }
}
