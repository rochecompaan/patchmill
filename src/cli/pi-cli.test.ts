import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import {
  piAgentCommandEnv,
  piCommandArgs,
  resolveBundledPiCommand,
  resolveBundledPiCommandFrom,
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

test("resolveBundledPiCommand works from compiled dist module locations", async () => {
  const packageRoot = await mkdtemp(join(tmpdir(), "patchmill-pi-cli-dist-"));
  const distCliDir = join(packageRoot, "dist", "src", "cli");
  const piPackageDir = join(
    packageRoot,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
  );
  await mkdir(join(piPackageDir, "bin"), { recursive: true });
  await mkdir(distCliDir, { recursive: true });
  await writeFile(
    join(piPackageDir, "package.json"),
    JSON.stringify({ bin: { pi: "bin/pi.js" } }),
  );

  const spec = resolveBundledPiCommandFrom(
    pathToFileURL(join(distCliDir, "pi-cli.js")).href,
  );

  assert.equal(spec.command, process.execPath);
  assert.equal(spec.argsPrefix[0], resolve(piPackageDir, "bin", "pi.js"));
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
