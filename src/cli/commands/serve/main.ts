import type { CliOutput } from "../../main.ts";
import { createServeAuth } from "../../../web/auth.ts";
import { createServeSource } from "./source.ts";
import { runCommand, type CommandRunner } from "../../../process/command.ts";
import { startServeServer, type Serving } from "../../../web/server.ts";
import { parseServeArgs } from "./args.ts";
export type ServeMainOptions = {
  output?: CliOutput;
  env?: NodeJS.ProcessEnv;
  startServer?: typeof startServeServer;
  createSource?: typeof createServeSource;
  repoRoot?: string;
  runner?: CommandRunner;
};
const HELP =
  "Usage: patchmill serve [--sample] [--host HOST] [--port PORT]\nServe the repository board and its Web sessions. Use --sample for view-only design fixtures without a repository. Defaults: 127.0.0.1:4280. Open the printed token link.";
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
    const data = await (options.createSource ?? createServeSource)({
      sample: flags.sample,
      repoRoot: options.repoRoot ?? process.cwd(),
      runner: options.runner ?? runCommand,
      warn: (message) => output.stderr(`Warning: ${message}`),
    });
    serving = await (options.startServer ?? startServeServer)({
      host: flags.host,
      port: flags.port,
      auth,
      source: data.source,
      ...(data.sessions ? { sessions: data.sessions } : {}),
    });
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    if (serving.networkExposed)
      output.stderr(
        "Warning: the server is available on the network. HTTP does not encrypt content. Use only a trusted network or VPN.",
      );
    output.stdout(
      `Patchmill ${flags.sample ? "sample data" : "board"}: ${serving.url}`,
    );
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
