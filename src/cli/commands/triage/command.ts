import { spawn } from "node:child_process";
import type { CommandResult, CommandRunner } from "./types.ts";

function appendAbortMarker(stderr: string): string {
  return `${stderr}${stderr.length > 0 && !stderr.endsWith("\n") ? "\n" : ""}command aborted\n`;
}

export function createCommandRunner(): CommandRunner {
  return {
    run(command, args, options = {}) {
      if (options.signal?.aborted) {
        return Promise.resolve({
          code: 1,
          stdout: "",
          stderr: "command aborted before spawn",
        });
      }

      return new Promise<CommandResult>((resolve) => {
        let settled = false;
        let stdout = "";
        let stderr = "";
        const settle = (result: CommandResult) => {
          if (settled) return;
          settled = true;
          options.signal?.removeEventListener("abort", onAbort);
          resolve(result);
        };
        const child = spawn(command, args, {
          cwd: options.cwd,
          env: options.env ? { ...process.env, ...options.env } : undefined,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const onAbort = () => {
          stderr = appendAbortMarker(stderr);
          child.kill("SIGTERM");
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });
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
        child.on("close", (code, signal) => {
          if (signal && !stderr.includes(signal)) stderr += `${signal}\n`;
          settle({
            code: options.signal?.aborted ? 1 : (code ?? 1),
            stdout,
            stderr,
          });
        });
      });
    },
  };
}
