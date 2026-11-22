// The `--mode rpc` side of fake-pi.mjs. It speaks the subset of Pi's JSONL
// protocol that Patchmill's RPC client uses. The order of records follows
// Pi 1.5.2: extension handlers for `agent_settled` (and so the
// background-work report) run before Pi writes `agent_settled`.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import fs from "node:fs/promises";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runRpc({ step, script, sideEffects }) {
  await fs.writeFile(`${script}.pid`, String(process.pid));
  const out = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
  const dialogs = new Map();
  const prompted = Promise.withResolvers();
  const handle = (command) => {
    appendFileSync(`${script}.commands.log`, `${JSON.stringify(command)}\n`);
    if (command.type === "extension_ui_response") {
      dialogs.get(command.id)?.(command);
      return;
    }
    // Exit with the command still unanswered.
    if (command.type === step.exitOn) process.exit(3);
    if (command.type === "prompt" && step.promptError) {
      out({
        id: command.id,
        type: "response",
        command: "prompt",
        success: false,
        error: step.promptError,
      });
      return;
    }
    if (command.type === "prompt") {
      out({
        id: command.id,
        type: "response",
        command: "prompt",
        success: true,
        data: { disposition: step.handled ? "handled" : "started" },
      });
      prompted.resolve();
      return;
    }
    out({
      id: command.id,
      type: "response",
      command: command.type,
      success: true,
    });
  };
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let end = buffer.indexOf("\n");
    while (end >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim()) handle(JSON.parse(line));
      end = buffer.indexOf("\n");
    }
  });
  // Pi shuts down when its input closes. A hung Pi ignores it.
  process.stdin.on("end", () => {
    if (!step.ignoreSigterm) process.exit(0);
  });
  const message = (text) =>
    out({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text }],
        stopReason: step.stopReason ?? "stop",
        ...(step.errorMessage ? { errorMessage: step.errorMessage } : {}),
      },
    });
  const report = (settle, count) =>
    out({
      type: "extension_ui_request",
      id: `status-${settle}-${count}`,
      method: "setStatus",
      statusKey: "patchmill-background-work",
      statusText: `${settle}:${count}`,
    });

  if (step.spawnChild) {
    // A group member that outlives Pi and ignores its closed input.
    const grandchild = spawn(
      process.execPath,
      ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"],
      { stdio: "ignore" },
    );
    await fs.writeFile(`${script}.child.pid`, String(grandchild.pid));
    grandchild.unref();
  }
  if (step.extensionError)
    out({
      type: "extension_error",
      extensionPath: "/ext/broken.ts",
      event: "session_start",
      error: step.extensionError,
    });
  await prompted.promise;
  if (step.handled || step.promptError) return;
  out({ type: "agent_start" });
  await sideEffects();
  if (step.stderr !== undefined) console.error(step.stderr);
  const lines = [];
  if (step.stdout !== undefined) lines.push(step.stdout);
  for (const name of step.printEnv ?? []) lines.push(process.env[name] ?? "");
  if (step.dialog) {
    const id = "dialog-1";
    const answered = new Promise((resolve) => dialogs.set(id, resolve));
    out({ type: "extension_ui_request", id, method: step.dialog, title: "?" });
    lines.push(`dialog:${JSON.stringify(await answered)}`);
  }
  if (step.result !== undefined && step.result !== null)
    lines.push(`\`\`\`json\n${JSON.stringify(step.result)}\n\`\`\``);
  message(lines.join("\n"));
  if (step.sleepMs) await sleep(step.sleepMs);
  // A crash after the result: an external kill, such as the OOM killer.
  if (step.killSignal) {
    process.kill(process.pid, step.killSignal);
    await new Promise(() => {});
  }
  if (step.exitCode) process.exit(step.exitCode);
  const counts = step.backgroundCounts ?? [0];
  for (const [index, count] of counts.entries()) {
    const settle = index + 1;
    if (!step.noReport && !step.reportAfterSettle) report(settle, count);
    out({ type: "agent_settled" });
    if (!step.noReport && step.reportAfterSettle) report(settle, count);
    if (count === 0) continue;
    await sleep(50);
    if (step.lateZero) {
      report(settle, 0);
      break;
    }
    out({ type: "agent_start" });
    message(`background turn ${settle + 1}`);
  }
}
