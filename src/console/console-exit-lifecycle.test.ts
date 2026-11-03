import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

test(
  "custom-theme console exits after failed replacement and awaited cleanup",
  { timeout: 15000 },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "console-theme-exit-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const agentDir = join(root, "agent");
    await mkdir(join(agentDir, "themes"), { recursive: true });
    const piDist = dirname(
      fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")),
    );
    const theme = JSON.parse(
      await readFile(join(piDist, "modes/interactive/theme/dark.json"), "utf8"),
    );
    theme.name = "custom";
    await writeFile(
      join(agentDir, "themes/custom.json"),
      JSON.stringify(theme),
    );
    await writeFile(join(root, "patchmill.config.json"), "{}");
    const env = {
      ...process.env,
      PI_CODING_AGENT_DIR: agentDir,
      PI_OFFLINE: "1",
    };
    delete env.NODE_TEST_CONTEXT;
    delete env.TMUX;
    for (const name of [
      "PI_SUBAGENT_CHILD",
      "PI_SUBAGENT_PARENT_SESSION",
      "PI_SESSION_FILE",
      "PI_SESSION_ID",
    ])
      delete env[name];
    const child = spawnSync(
      process.execPath,
      [resolve("test-support/console-theme-exit.ts"), root],
      {
        env,
        encoding: "utf8",
        timeout: 10000,
      },
    );
    assert.equal(child.error, undefined, child.stdout + child.stderr);
    assert.equal(child.signal, null, child.stdout + child.stderr);
    assert.equal(child.status, 1, child.stdout + child.stderr);
    assert.match(child.stdout, /CLEANUP_COMPLETE/);
    assert.ok(
      child.stderr.includes(
        `DRAIN_CHECK:${".".repeat(256 * 1024)}:DRAIN_COMPLETE\n`,
      ),
    );
    assert.match(child.stderr, /forced replacement failure/);
    assert.match(
      child.stderr,
      /Run `patchmill run-once --interactive --issue 10` to continue\./,
    );
  },
);
