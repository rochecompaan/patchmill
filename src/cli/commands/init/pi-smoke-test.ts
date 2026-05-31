import type { CommandRunner } from "../triage/types.ts";

const PI_SMOKE_PROMPT = "Reply with PATCHMILL_PI_OK and nothing else.";
const PI_SMOKE_SENTINEL = "PATCHMILL_PI_OK";

export type PiSmokeTestResult = {
  status: "pass" | "fail";
  message: string;
  command: string;
  details?: string;
};

function shellQuote(value: string): string {
  return /\s/u.test(value) ? value : value;
}

function formatCommand(args: string[]): string {
  return ["pi", ...args.map(shellQuote)].join(" ");
}

function commandOutput(stdout: string, stderr: string): string {
  return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
}

export async function runPiSmokeTest(
  runner: CommandRunner,
  options: { repoRoot: string; model?: string },
): Promise<PiSmokeTestResult> {
  const args = ["--no-session", "--no-context-files", "--no-prompt-templates"];
  if (options.model) args.push("--model", options.model);
  args.push("-p", PI_SMOKE_PROMPT);

  const result = await runner.run("pi", args, { cwd: options.repoRoot });
  const command = formatCommand(args);
  if (result.code === 0 && result.stdout.includes(PI_SMOKE_SENTINEL)) {
    return {
      status: "pass",
      message: `Pi completed the provider smoke test${options.model ? ` with ${options.model}` : ""}.`,
      command,
    };
  }

  return {
    status: "fail",
    message: "Pi could not complete the provider smoke test.",
    command,
    details:
      commandOutput(result.stdout, result.stderr) || `exit code ${result.code}`,
  };
}
