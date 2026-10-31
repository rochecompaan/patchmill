import { spawn } from "node:child_process";

export type CommandResult = { code: number; stdout: string; stderr: string };
export type CommandRunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  stdin?: string;
};
export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandRunOptions,
) => Promise<CommandResult>;

export const commandOutput = (result: CommandResult): string =>
  result.stderr.trim() || result.stdout.trim() || "no output";

export class CommandFailedError extends Error {
  readonly command: string;
  readonly args: string[];
  readonly result: CommandResult;
  constructor(command: string, args: string[], result: CommandResult) {
    super(
      `${command} ${args.join(" ")} exited with code ${result.code}: ${commandOutput(result)}`,
    );
    this.name = "CommandFailedError";
    this.command = command;
    this.args = args;
    this.result = result;
  }
}

export const runCommand: CommandRunner = (command, args, options = {}) =>
  new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, {
        shell: false,
        stdio: [
          options.stdin === undefined ? "ignore" : "pipe",
          "pipe",
          "pipe",
        ],
        ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        ...(options.env !== undefined ? { env: options.env } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      resolve({ code: -1, stdout: "", stderr: `${message}\n` });
      return;
    }
    let stdout = "";
    let stderr = "";
    let errorMessage = "";
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      errorMessage = error.message;
    });
    child.on("close", (code, signal) => {
      if (errorMessage)
        stderr += `${stderr && !stderr.endsWith("\n") ? "\n" : ""}${errorMessage}\n`;
      resolve({
        code: errorMessage || signal || code === null || code < 0 ? -1 : code,
        stdout,
        stderr,
      });
    });
    if (options.stdin !== undefined) {
      child.stdin?.on("error", () => {});
      child.stdin?.end(options.stdin);
    }
  });
