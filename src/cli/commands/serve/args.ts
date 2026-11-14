import { isIP } from "node:net";
export function parseServeArgs(
  args: readonly string[],
): { host: string; port: number } | "help" {
  if (args.length === 1 && ["--help", "-h", "help"].includes(args[0]!))
    return "help";
  let host = "127.0.0.1",
    port = 4280;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i]!,
      value = args[i + 1];
    if (
      !["--host", "--port"].includes(flag) ||
      value === undefined ||
      seen.has(flag)
    )
      throw Error("Use --host HOST and --port PORT.");
    seen.add(flag);
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
  return { host, port };
}
