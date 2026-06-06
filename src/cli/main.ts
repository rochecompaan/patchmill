import { main as doctorMain } from "./commands/doctor/main.ts";
import { main as initMain } from "./commands/init/main.ts";
import { main as runOnceMain } from "./commands/run-once/main.ts";
import { main as setupTestRepoMain } from "./commands/setup-test-repo/main.ts";
import { main as triageMain } from "./commands/triage/main.ts";

export const HELP_TEXT = `Usage:
  patchmill <command> [options]

Commands:
  init        Create a minimal patchmill.config.json.
  doctor      Run read-only readiness checks.
  triage      Classify repository issues for agent readiness.
  run-once    Claim and process one agent-ready issue.
  setup-test-repo  Create or reset a disposable Patchmill demo repository.
`;

export type CommandHandler = (args: string[]) => number | Promise<number>;

export type CliOutput = {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

export type ResolvedCommand = {
  command: string;
  args: string[];
};

const DEFAULT_OUTPUT: CliOutput = {
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
};

export function resolveCommand(
  argv: string[],
  commandNames: Iterable<string>,
): ResolvedCommand | "help" {
  const command = argv[0];
  if (
    !command ||
    command === "--help" ||
    command === "-h" ||
    command === "help"
  ) {
    return "help";
  }

  if (!new Set(commandNames).has(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  return { command, args: argv.slice(1) };
}

export function createCliMain(
  commands: ReadonlyMap<string, CommandHandler>,
  output: CliOutput = DEFAULT_OUTPUT,
): (argv?: string[]) => Promise<number> {
  return async (argv = process.argv.slice(2)): Promise<number> => {
    let resolved: ResolvedCommand | "help";
    try {
      resolved = resolveCommand(argv, commands.keys());
    } catch (error) {
      output.stderr(error instanceof Error ? error.message : String(error));
      output.stderr(HELP_TEXT);
      return 1;
    }

    if (resolved === "help") {
      output.stdout(HELP_TEXT);
      return 0;
    }

    const handler = commands.get(resolved.command);
    if (!handler) {
      output.stderr(`Unknown command: ${resolved.command}`);
      output.stderr(HELP_TEXT);
      return 1;
    }

    try {
      return await handler(resolved.args);
    } catch (error) {
      output.stderr(error instanceof Error ? error.message : String(error));
      return 1;
    }
  };
}

const COMMANDS = new Map<string, CommandHandler>([
  ["init", initMain],
  ["doctor", doctorMain],
  ["triage", triageMain],
  ["run-once", runOnceMain],
  ["setup-test-repo", setupTestRepoMain],
]);

export const main = createCliMain(COMMANDS);
