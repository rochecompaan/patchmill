import type {
  CommandResult,
  CommandRunner,
} from "../src/cli/commands/triage/types.ts";

export function createStaticCommandRunner(
  results: CommandResult[],
): CommandRunner & {
  calls: Array<{ command: string; args: string[]; cwd?: string }>;
} {
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  let index = 0;
  return {
    calls,
    async run(command, args, options = {}) {
      calls.push({ command, args: [...args], cwd: options.cwd });
      const result = results[index];
      index += 1;
      return result ?? { code: 0, stdout: "", stderr: "" };
    },
  };
}
