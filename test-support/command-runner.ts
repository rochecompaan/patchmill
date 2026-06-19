import type {
  CommandResult,
  CommandRunner,
} from "../src/cli/commands/triage/types.ts";

export type RecordedCommandCall = {
  command: string;
  args: string[];
  cwd?: string;
};

export function normalizeRecordedPiCall(
  command: string,
  args: string[],
  cwd?: string,
): RecordedCommandCall {
  if (
    command === process.execPath &&
    /@earendil-works[/\\]pi-coding-agent[/\\]dist[/\\]cli\.js$/.test(
      args[0] ?? "",
    )
  ) {
    return { command: "pi", args: args.slice(1), cwd };
  }
  return { command, args: [...args], cwd };
}

export function createStaticCommandRunner(
  results: CommandResult[],
): CommandRunner & {
  calls: RecordedCommandCall[];
} {
  const calls: RecordedCommandCall[] = [];
  let index = 0;
  return {
    calls,
    async run(command, args, options = {}) {
      calls.push(normalizeRecordedPiCall(command, args, options.cwd));
      const result = results[index];
      index += 1;
      return result ?? { code: 0, stdout: "", stderr: "" };
    },
  };
}
