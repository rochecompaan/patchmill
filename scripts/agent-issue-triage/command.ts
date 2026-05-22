import { spawn } from "node:child_process";
import type { CommandResult, CommandRunner } from "./types.ts";

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function createCommandRunner(): CommandRunner {
  return {
    run(command, args, options = {}) {
      return new Promise<CommandResult>((resolve) => {
        let settled = false;
        const settle = (result: CommandResult) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        const child = spawn(command, args, {
          cwd: options.cwd,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => {
          const text = String(chunk);
          stdout += text;
          options.onStdout?.(text);
        });
        child.stderr.on("data", (chunk) => {
          const text = String(chunk);
          stderr += text;
          options.onStderr?.(text);
        });
        child.on("error", (error) => {
          settle({ code: 1, stdout, stderr: stderr + error.message });
        });
        child.on("close", (code) => {
          settle({ code: code ?? 1, stdout, stderr });
        });
      });
    },
  };
}

export function createDryRunCommandRunner(): CommandRunner & { commands: string[] } {
  const commands: string[] = [];
  return {
    commands,
    async run(command, args, options = {}) {
      const rendered = [command, ...args].map(shellQuote).join(" ");
      commands.push(options.cwd ? `cd ${shellQuote(options.cwd)} && ${rendered}` : rendered);
      return { code: 0, stdout: "", stderr: "" };
    },
  };
}

export function createStaticCommandRunner(results: CommandResult[]): CommandRunner & {
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
