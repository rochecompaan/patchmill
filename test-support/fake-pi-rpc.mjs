// The `--mode rpc` side of fake-pi.mjs. It speaks the subset of Pi's JSONL
// protocol that Patchmill's RPC client uses. The order of records follows
// Pi 1.5.2: extension handlers for `agent_settled` (and so the
// background-work report) run before Pi writes `agent_settled`.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import fs from "node:fs/promises";
import { join } from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runRpc({ step, script, sideEffects, sessionDir }) {
  await fs.writeFile(`${script}.pid`, String(process.pid));
  const out = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
  const dialogs = new Map();
  const prompted = Promise.withResolvers();
  let prompts = 0;
  let settles = 0;
  // The step that answers the current turn, and the end of a hanging turn.
  let current = step;
  let hanging;
  let aborted = false;
  const handle = (command) => {
    appendFileSync(`${script}.commands.log`, `${JSON.stringify(command)}\n`);
    if (command.type === "extension_ui_response") {
      dialogs.get(command.id)?.(command);
      return;
    }
    // Exit with the command still unanswered.
    if (command.type === step.exitOn) process.exit(3);
    if (command.type === "abort") {
      aborted = true;
      if (current.ignoreAbort) return;
      const end = hanging;
      hanging = undefined;
      // Pi answers abort after the turn is idle.
      if (end) {
        const settle = ++settles;
        report(settle, 0);
        out({ type: "agent_settled" });
        end();
      }
      out({
        id: command.id,
        type: "response",
        command: "abort",
        success: true,
      });
      return;
    }
    if (
      command.type === "prompt" &&
      prompts > 0 &&
      aborted &&
      current.recovery
    ) {
      aborted = false;
      current = current.recovery;
      const recovery = current;
      if (recovery.promptError) {
        out({
          id: command.id,
          type: "response",
          command: "prompt",
          success: false,
          error: recovery.promptError,
        });
        return;
      }
      out({
        id: command.id,
        type: "response",
        command: "prompt",
        success: true,
        data: { disposition: "started" },
      });
      void recoveryTurn(recovery);
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
    if (command.type === "prompt" && prompts > 0) {
      const reminder = step.reminder ?? {};
      if (reminder.promptError) {
        out({
          id: command.id,
          type: "response",
          command: "prompt",
          success: false,
          error: reminder.promptError,
        });
        return;
      }
      out({
        id: command.id,
        type: "response",
        command: "prompt",
        success: true,
        data: { disposition: reminder.handled ? "handled" : "started" },
      });
      if (!reminder.handled) void reminderTurn();
      return;
    }
    if (command.type === "prompt") {
      prompts += 1;
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

  const update = () =>
    out({ type: "message_update", message: { role: "assistant" } });
  const appendEntries = async (entries) => {
    if (!entries?.length) return;
    await fs.appendFile(
      join(sessionDir, "fake.jsonl"),
      entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""),
    );
  };
  // After the side effects, a hanging turn writes nothing until `abort`.
  const hang = () =>
    new Promise((resolve) => {
      hanging = resolve;
    });
  const startCommandChild = async () => {
    const child = spawn("sleep", ["600"], { detached: true, stdio: "ignore" });
    await fs.writeFile(`${script}.command.pid`, String(child.pid));
    child.unref();
  };
  // The turn after the recovery prompt. Its answer comes from `step.recovery`.
  const recoveryTurn = async (recovery) => {
    if (recovery.delayStartMs) {
      // A late report for the aborted settle must not finish the session.
      report(settles, 0);
      await sleep(recovery.delayStartMs);
    }
    out({ type: "agent_start" });
    update();
    await sideEffects(recovery);
    await appendEntries(recovery.sessionEntries);
    update();
    if (recovery.commandChild) await startCommandChild();
    if (recovery.hang) return hang();
    const lines = [];
    if (recovery.stdout !== undefined) lines.push(recovery.stdout);
    if (recovery.result !== undefined && recovery.result !== null)
      lines.push(`\`\`\`json\n${JSON.stringify(recovery.result)}\n\`\`\``);
    message(lines.join("\n"));
    const settle = ++settles;
    report(settle, 0);
    out({ type: "agent_settled" });
  };

  // A later prompt is the Result reminder. Its answer comes from `step.reminder`.
  const reminderTurn = async () => {
    const reminder = step.reminder ?? {};
    if (step.duplicateZero) {
      report(1, 0);
      await sleep(50);
    }
    out({ type: "agent_start" });
    const lines = [];
    if (reminder.stdout !== undefined) lines.push(reminder.stdout);
    if (reminder.result !== undefined && reminder.result !== null)
      lines.push(`\`\`\`json\n${JSON.stringify(reminder.result)}\n\`\`\``);
    out({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: lines.join("\n") }],
        stopReason: reminder.stopReason ?? "stop",
      },
    });
    const settle = ++settles;
    report(settle, 0);
    out({ type: "agent_settled" });
  };

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
  update();
  await sideEffects();
  update();
  if (step.commandChild) await startCommandChild();
  if (step.hang) return hang();
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
    settles = settle;
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
