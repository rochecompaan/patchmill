import { main as repair } from "./repair.ts";
import type { RunCommandHandler } from "../main.ts";
export async function runLeaseCommand(
  args: string[],
  commands: ReadonlyMap<string, RunCommandHandler> = new Map([
    ["repair", repair],
  ]),
): Promise<number> {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h") {
    console.log("Usage: patchmill run lease repair --issue <number>");
    return 0;
  }
  const handler = commands.get(command);
  if (!handler) {
    console.error(`Unknown lease command: ${command}`);
    return 1;
  }
  return handler(rest);
}
export const main = runLeaseCommand;
