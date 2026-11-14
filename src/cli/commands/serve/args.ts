import { isIP } from "node:net";
export function parseServeArgs(
  args: readonly string[],
): { host: string; port: number; sample: boolean } | "help" {
  if (args.length === 1 && ["--help", "-h", "help"].includes(args[0]!))
    return "help";
  let host = "127.0.0.1",
    port = 4280,
    sample = false;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (!["--host", "--port", "--sample"].includes(flag) || seen.has(flag))
      throw Error("Use --sample, --host HOST, and --port PORT.");
    seen.add(flag);
    if (flag === "--sample") {
      sample = true;
      continue;
    }
    const value = args[++i];
    if (value === undefined)
      throw Error("Use --sample, --host HOST, and --port PORT.");
    if (flag === "--port") {
      if (!/^[1-9]\d*$/.test(value) || Number(value) > 65535)
        throw Error("Port must be an integer from 1 to 65535.");
      port = Number(value);
    } else {
      if (
        !value ||
        (!isIP(value) &&
          !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(value))
      )
        throw Error("Host must be an IP address or hostname, not a URL.");
      host = value;
    }
  }
  return { host, port, sample };
}
