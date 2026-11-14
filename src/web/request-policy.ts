import { isIP } from "node:net";
export type Binding = {
  host: string;
  address: string;
  port: number;
  interfaces: readonly string[];
};
export type RequestPolicy = {
  authority(rawHeaders: readonly string[]): string | null;
  originAllowed(
    method: string,
    rawHeaders: readonly string[],
    authority: string,
  ): boolean;
};
function headerValues(headers: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < headers.length; i += 2)
    if (headers[i]?.toLowerCase() === name) values.push(headers[i + 1] ?? "");
  return values;
}
function authority(value: string): string | null {
  if (!/^(?:\[[0-9a-fA-F:.]+\]|[a-zA-Z0-9.-]+)(?::[0-9]+)?$/.test(value))
    return null;
  try {
    const parsed = new URL("http://" + value);
    const rawHost = value.startsWith("[")
      ? value.slice(0, value.indexOf("]") + 1)
      : value.split(":")[0]!;
    // Reject alternate numeric IP spellings instead of treating them as DNS names.
    if (
      parsed.hostname[0] !== "[" &&
      isIP(parsed.hostname) &&
      parsed.hostname !== rawHost.toLowerCase()
    )
      return null;
    const port = Number(parsed.port || 80);
    if (port < 1 || port > 65535) return null;
    return `${parsed.hostname.toLowerCase()}:${port}`;
  } catch {
    return null;
  }
}
const ipHost = (host: string) => (isIP(host) === 6 ? `[${host}]` : host);
export function isLoopback(host: string): boolean {
  if (host === "localhost") return true;
  if (isIP(host) === 4) return host.startsWith("127.");
  if (isIP(host) !== 6) return false;
  try {
    const canonical = new URL(`http://[${host}]`).hostname;
    return (
      canonical === "[::1]" ||
      /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(canonical)
    );
  } catch {
    return false;
  }
}
export function createRequestPolicy(binding: Binding): RequestPolicy {
  const wildcard = ["0.0.0.0", "::"].includes(binding.host);
  const hosts = wildcard
    ? [...binding.interfaces, "localhost", "127.0.0.1", "::1"]
    : [
        binding.host,
        binding.address,
        ...(isLoopback(binding.address) ? ["localhost"] : []),
      ];
  const allowed = new Set(
    hosts
      .filter((h) => !["0.0.0.0", "::"].includes(h))
      .map((h) => authority(`${ipHost(h)}:${binding.port}`))
      .filter((h) => h !== null),
  );
  return {
    authority(headers) {
      const values = headerValues(headers, "host");
      if (values.length !== 1) return null;
      const canonical = authority(values[0]!);
      return canonical && allowed.has(canonical) ? canonical : null;
    },
    originAllowed(method, headers, host) {
      if (method === "GET" || method === "HEAD") return true;
      const values = headerValues(headers, "origin");
      if (values.length !== 1) return false;
      const value = values[0]!;
      if (!value.startsWith("http://")) return false;
      const candidate = authority(value.slice(7));
      return candidate !== null && candidate === host;
    },
  };
}
