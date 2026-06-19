import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import {
  piAgentCommandEnv,
  piCommandArgs,
  resolveBundledPiCommand,
} from "./pi-cli.ts";

test("resolveBundledPiCommand returns node and installed Pi CLI script", () => {
  const spec = resolveBundledPiCommand();

  assert.equal(spec.command, process.execPath);
  assert.equal(spec.argsPrefix.length, 1);
  assert.match(
    spec.argsPrefix[0] ?? "",
    /@earendil-works[/\\]pi-coding-agent[/\\]dist[/\\]cli\.js$/,
  );
  assert.equal(existsSync(spec.argsPrefix[0] ?? ""), true);
});

test("piAgentCommandEnv includes repo-local Pi agent dir and preserves extra env", () => {
  assert.deepEqual(
    piAgentCommandEnv("/repo/.patchmill/pi-agent", {
      OTHER: "value",
      UNSET: undefined,
    }),
    {
      OTHER: "value",
      UNSET: undefined,
      PI_CODING_AGENT_DIR: "/repo/.patchmill/pi-agent",
    },
  );
});

test("piCommandArgs prefixes caller args without spawning Pi", () => {
  const spec = { command: "node", argsPrefix: ["/pi/dist/cli.js"] };

  assert.deepEqual(piCommandArgs(spec, ["--help"]), [
    "/pi/dist/cli.js",
    "--help",
  ]);
});
