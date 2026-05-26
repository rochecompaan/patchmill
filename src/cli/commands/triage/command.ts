import { spawn } from "node:child_process";
import type { CommandResult, CommandRunner } from "./types.ts";

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
