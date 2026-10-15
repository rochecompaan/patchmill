import type {
  CommandResult,
  CommandRunner,
  CommandRunOptions,
} from "../src/process/command.ts";

export function recordingRunner(
  responses: Array<{ match: RegExp; result: Partial<CommandResult> }>,
): CommandRunner & { calls: string[][]; options: CommandRunOptions[] } {
  const calls: string[][] = [];
  const options: CommandRunOptions[] = [];
  const runner: CommandRunner = async (command, args, runOptions = {}) => {
    const argv = [command, ...args];
    calls.push(argv);
    options.push(runOptions);
    const response = responses.find(({ match }) => {
      match.lastIndex = 0;
      return match.test(argv.join(" "));
    });
    if (!response)
      throw new Error(`recordingRunner: no response for ${argv.join(" ")}`);
    return { code: 0, stdout: "", stderr: "", ...response.result };
  };
  return Object.assign(runner, { calls, options });
}
