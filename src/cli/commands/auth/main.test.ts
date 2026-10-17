import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_CONFIG } from "../../../config/config.ts";
import { runCommand } from "../../../process/command.ts";
import { authSpawnPlan, main } from "./main.ts";

test("auth preserves command prefix and environment without print mode", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  const pi = { command: "node", argsPrefix: ["pi.js"] };
  const plan = authSpawnPlan("/repo", config, pi);
  assert.deepEqual(plan.args, ["pi.js"]);
  assert.equal(plan.command, "node");
  assert.equal(plan.env.PI_CODING_AGENT_DIR, "/repo/.patchmill/pi-agent");
  assert.equal(plan.env.PATH, process.env.PATH);
  config.pi.agentDir = "custom/agent";
  assert.equal(
    authSpawnPlan("/repo", config, pi).env.PI_CODING_AGENT_DIR,
    "/repo/custom/agent",
  );
});

test("auth uses inherited terminal, returns child failures and reports spawn/config errors", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "patchmill.config.json"), "{}");
  const errors: string[] = [];
  const options = {
    repoRoot: root,
    output: { stdout: () => {}, stderr: (s: string) => errors.push(s) },
  };
  for (const code of [0, 7]) {
    assert.equal(
      await main([], {
        ...options,
        piCommand: {
          command: process.execPath,
          argsPrefix: ["-e", `process.exit(${code})`],
        },
        spawn: (command, args, opts) => {
          assert.equal(opts?.stdio, "inherit");
          assert.equal(opts?.cwd, root);
          assert.equal(
            opts?.env?.PI_CODING_AGENT_DIR,
            join(root, ".patchmill/pi-agent"),
          );
          return spawn(command, args, opts);
        },
      }),
      code,
    );
  }
  assert.equal(
    await main([], {
      ...options,
      piCommand: { command: join(root, "missing"), argsPrefix: [] },
    }),
    1,
  );
  assert.match(errors.join("\n"), /ENOENT/);
  await writeFile(join(root, "patchmill.config.json"), '{"unknown":true}');
  assert.equal(await main([], options), 1);
  assert.match(errors.join("\n"), /unknown/);
  assert.equal(await main(["--bad"], options), 1);
});

test("root dispatches auth and doctor safely without config and still rejects retired run", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "patchmill-dispatch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const command of ["auth", "doctor"]) {
    const help = await runCommand(
      process.execPath,
      [join(process.cwd(), "bin/patchmill.ts"), command, "--help"],
      { cwd: root },
    );
    assert.equal(help.code, 0, help.stderr);
    const failure = await runCommand(
      process.execPath,
      [join(process.cwd(), "bin/patchmill.ts"), command],
      { cwd: root },
    );
    assert.equal(failure.code, 1);
    assert.match(failure.stderr, /Missing.*patchmill.config.json/);
  }
  const retired = await runCommand(
    process.execPath,
    [join(process.cwd(), "bin/patchmill.ts"), "run"],
    { cwd: root },
  );
  assert.equal(retired.code, 1);
  assert.match(retired.stderr, /Unknown command: run/);
});
