import assert from "node:assert/strict";
import test from "node:test";
import { HELP_TEXT, main } from "./main.ts";

test("run-once writes the plan-only warning only to stderr before argument errors", async () => {
  let stdout = "";
  let stderr = "";
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    assert.equal(await main(["--plan-only", "--unknown"]), 1);
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  assert.equal((stderr.match(/Deprecated: --plan-only/gu) ?? []).length, 1);
  assert.match(stdout, /\{"status":"error"/u);
  assert.doesNotMatch(stdout, /Deprecated:/u);
});

test("run-once help documents the deprecated plan-only replacement without a warning", async () => {
  let stdout = "";
  let stderr = "";
  const originalLog = console.log;
  const originalError = console.error;
  const originalStderrWrite = process.stderr.write;
  console.log = (line?: unknown) => {
    stdout += `${String(line)}\n`;
  };
  console.error = (line?: unknown) => {
    stderr += `${String(line)}\n`;
  };
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    assert.equal(await main(["--help", "--plan-only"]), 0);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.stderr.write = originalStderrWrite;
  }
  assert.match(HELP_TEXT, /Deprecated; use Run-once review gates/u);
  assert.match(stdout, /Deprecated; use Run-once review gates/u);
  assert.equal(stderr, "");
});
