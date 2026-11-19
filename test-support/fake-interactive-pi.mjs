#!/usr/bin/env node
// A scripted long-lived `pi --mode rpc` for the interactive RPC client tests.
// The script is a JSON object in the file named by PATCHMILL_FAKE_PI_SCRIPT.
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const script = process.env.PATCHMILL_FAKE_PI_SCRIPT;
const step = JSON.parse(readFileSync(script, "utf8"));
writeFileSync(`${script}.pid`, String(process.pid));
const stopCommand = step.stopCommand ?? "/patchmill-web-session-stop";
const out = (record) => process.stdout.write(`${JSON.stringify(record)}\n`);
let prompts = 0;

if (step.ignoreSigterm) process.on("SIGTERM", () => {});
if (step.spawnChild) {
  const grandchild = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"],
    { stdio: "ignore" },
  );
  writeFileSync(`${script}.child.pid`, String(grandchild.pid));
  grandchild.unref();
}
if (step.noise) process.stdout.write(`${step.noise}\n`);
if (step.stderr) process.stderr.write(`${step.stderr}\n`);
if (step.exitBeforeReady !== undefined) process.exit(step.exitBeforeReady);

const respond = (command, fields = {}) =>
  out({
    id: command.id,
    type: "response",
    command: command.type,
    success: true,
    ...fields,
  });

function handle(command) {
  appendFileSync(`${script}.commands.log`, `${JSON.stringify(command)}\n`);
  if (command.type === "extension_ui_response") return;
  if (command.type === "get_state") {
    respond(command, { data: { isStreaming: false } });
    return;
  }
  if (command.type === "prompt") {
    if (command.message === stopCommand) {
      respond(command, { data: { disposition: "handled" } });
      if (!step.ignoreStopCommand) setTimeout(() => process.exit(0), 10);
      return;
    }
    if (step.promptError) {
      out({
        id: command.id,
        type: "response",
        command: "prompt",
        success: false,
        error: step.promptError,
      });
      return;
    }
    respond(command, { data: { disposition: "started" } });
    prompts += 1;
    for (const record of step.onPrompt ?? []) out(record);
    if (prompts === 1 && step.dialog) out(step.dialog);
    if (step.exitAfterPrompt !== undefined)
      setTimeout(() => process.exit(step.exitAfterPrompt), 10);
    return;
  }
  respond(command);
}

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
process.stdin.on("end", () => {
  if (!step.ignoreStdinEnd) process.exit(0);
});
setInterval(() => {}, 1000);
