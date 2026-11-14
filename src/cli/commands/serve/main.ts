import type { CliOutput } from "../../main.ts";
import { createServeAuth } from "../../../web/auth.ts";
import { createSampleRunDataSource } from "../../../web/sample-data.ts";
import { startServeServer, type Serving } from "../../../web/server.ts";
import { parseServeArgs } from "./args.ts";
export type ServeMainOptions = {
  output?: CliOutput;
  env?: NodeJS.ProcessEnv;
  startServer?: typeof startServeServer;
};
const HELP =
  "Usage: patchmill serve [--host HOST] [--port PORT]\nServe the view-only sample board. Defaults: 127.0.0.1:4280. Open the printed token link.";
export async function main(
  args: string[] = process.argv.slice(2),
  options: ServeMainOptions = {},
): Promise<number> {
  const output = options.output ?? {
    stdout: console.log,
    stderr: console.error,
  };
  let serving: Serving | undefined;
  const stop = () => {
    void serving?.close().catch(() => {});
  };
  try {
    const flags = parseServeArgs(args);
    if (flags === "help") {
      output.stdout(HELP);
      return 0;
    }
    const auth = createServeAuth(
      (options.env ?? process.env).PATCHMILL_SERVE_TOKEN,
    );
    serving = await (options.startServer ?? startServeServer)({
      ...flags,
      auth,
      source: createSampleRunDataSource(),
    });
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    if (serving.networkExposed)
      output.stderr(
        "Warning: the server is available on the network. HTTP does not encrypt content. Use only a trusted network or VPN.",
      );
    output.stdout(`Patchmill sample data: ${serving.url}`);
    await serving.closed;
    return 0;
  } catch (error) {
    output.stderr(
      error instanceof Error ? error.message : "Could not start the server.",
    );
    return 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await serving?.close();
  }
}
