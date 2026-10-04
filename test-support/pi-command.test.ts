import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRecordedPiCall as normalizeTriageCall } from "./command-runner.ts";
import { normalizeRecordedPiCall as normalizeRunOnceCall } from "./run-once/mock-runner.ts";

const normalizers = [
  {
    name: "triage",
    normalize: (call: { command: string; args: string[]; cwd: string }) =>
      normalizeTriageCall(call.command, call.args, call.cwd),
  },
  { name: "run-once", normalize: normalizeRunOnceCall },
];

for (const { name, normalize } of normalizers) {
  for (const cliPath of [
    "/repo/node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
    "/repo/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
    "C:\\repo\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\bundle\\cli.js",
  ]) {
    test(`${name} records the Pi invocation from ${cliPath}`, () => {
      const call = {
        command: process.execPath,
        args: [cliPath, "--thinking", "high", "-p", "@/tmp/prompt.md"],
        cwd: "/repo",
      };

      assert.deepEqual(normalize(call), {
        command: "pi",
        args: ["--thinking", "high", "-p", "@/tmp/prompt.md"],
        cwd: "/repo",
      });
      assert.equal(call.args[0], cliPath);
    });
  }

  for (const cliPath of [
    "/repo/node_modules/other-agent/dist/bundle/cli.js",
    "/repo/node_modules/@earendil-works/pi-coding-agent/dist/bundle/other.js",
  ]) {
    test(`${name} leaves unrelated Node commands unchanged: ${cliPath}`, () => {
      const call = {
        command: process.execPath,
        args: [cliPath, "--help"],
        cwd: "/repo",
      };

      assert.deepEqual(normalize(call), call);
    });
  }
}
