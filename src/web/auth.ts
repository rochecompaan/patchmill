import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
export type TokenExchange =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "redirect"; location: string; cookie: string };
export interface ServeAuth {
  readonly token: string;
  authenticated(cookieHeader: string | undefined): boolean;
  exchange(method: string, rawTarget: string): TokenExchange;
}
const digest = (value: string) => createHash("sha256").update(value).digest();

export function createServeAuth(environmentToken?: string): ServeAuth {
  if (
    environmentToken !== undefined &&
    (Buffer.byteLength(environmentToken) === 0 ||
      Buffer.byteLength(environmentToken) > 1024)
  )
    throw new Error(
      "PATCHMILL_SERVE_TOKEN must contain 1 to 1024 UTF-8 bytes.",
    );
  const token = environmentToken ?? randomBytes(32).toString("base64url");
  const expected = digest(token);
  const matches = (candidate: string) =>
    timingSafeEqual(digest(candidate), expected);
  return {
    token,
    authenticated(header) {
      const values = (header ?? "")
        .split(";")
        .map((part) => part.trim())
        .filter((part) => part.split("=")[0] === "patchmill_serve");
      if (values.length !== 1) return false;
      try {
        return matches(
          decodeURIComponent(values[0]!.slice("patchmill_serve=".length)),
        );
      } catch {
        return false;
      }
    },
    exchange(method, target) {
      const separator = target.indexOf("?");
      const path = separator < 0 ? target : target.slice(0, separator);
      const query = separator < 0 ? "" : target.slice(separator + 1);
      if (method !== "GET" || path !== "/") return { kind: "none" };
      const params = new URLSearchParams(query);
      if (!params.has("token")) return { kind: "none" };
      try {
        decodeURIComponent(query.replaceAll("+", " "));
      } catch {
        return { kind: "invalid" };
      }
      const values = params.getAll("token");
      if (values.length !== 1 || !values[0] || !matches(values[0]))
        return { kind: "invalid" };
      params.delete("token");
      const remaining = params.toString();
      return {
        kind: "redirect",
        location: "/" + (remaining ? "?" + remaining : ""),
        cookie: `patchmill_serve=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`,
      };
    },
  };
}
