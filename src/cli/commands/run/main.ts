import { main as reset } from "./reset/main.ts";
import { main as lease } from "./lease/main.ts";
export type RunCommandHandler = (args: string[]) => number | Promise<number>;
export async function runRunCommand(
  args: string[],
  commands: ReadonlyMap<string, RunCommandHandler> = new Map<
    string,
    RunCommandHandler
  >([
    ["reset", reset],
    ["lease", lease],
  ]),
): Promise<number> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    console.log("Usage: patchmill run <reset|lease> [options]");
    return 0;
  }
  const handler = commands.get(command);
  if (!handler) {
    console.error(`Unknown run command: ${command}`);
    return 1;
  }
  return handler(rest);
}
export const main = runRunCommand;
