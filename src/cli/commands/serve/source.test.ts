import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { recordingRunner } from "../../../../test-support/recording-runner.ts";
import { DEFAULT_CONFIG } from "../../../config/config.ts";
import { createServeSource } from "./source.ts";

test("explicit samples need no repository config, Git, or host access", async (t) => {
  const repoRoot = await fs.mkdtemp(join(tmpdir(), "patchmill-serve-source-"));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  const { source, sessions } = await createServeSource({
    sample: true,
    repoRoot,
    runner: async () => assert.fail("sample accessed a host or Git"),
    warn: assert.fail,
  });
  assert.equal((await source.snapshot()).source, "sample");
  assert.equal(sessions, undefined);
  await assert.rejects(
    createServeSource({
      sample: false,
      repoRoot,
      runner: async () => assert.fail("config must load first"),
      warn: assert.fail,
    }),
    /patchmill.config.json/,
  );
});

test("real source uses configured host metadata and current base selection", async (t) => {
  const repoRoot = await fs.mkdtemp(join(tmpdir(), "patchmill-serve-real-"));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));
  await fs.writeFile(
    join(repoRoot, "patchmill.config.json"),
    JSON.stringify(DEFAULT_CONFIG),
  );
  const runner = recordingRunner([
    {
      match: /^gh repo view --json/,
      result: {
        stdout: JSON.stringify({
          nameWithOwner: "owner/repo",
          defaultBranchRef: { name: "main" },
        }),
      },
    },
    {
      match: /^gh repo view owner\/repo --json/,
      result: {
        stdout: JSON.stringify({
          url: "https://github.com/owner/repo",
          sshUrl: "git@github.com:owner/repo.git",
        }),
      },
    },
    {
      match: /^git remote get-url origin/,
      result: { stdout: "git@github.com:owner/repo.git" },
    },
    { match: /^git symbolic-ref/, result: { code: 1 } },
    {
      match:
        /^gh api --paginate --slurp repos\/\{owner\}\/\{repo\}\/(issues|pulls)\?/,
      result: { stdout: "[[]]" },
    },
  ]);
  const { source, sessions } = await createServeSource({
    sample: false,
    repoRoot,
    runner,
    warn: assert.fail,
  });
  assert.ok(sessions);
  t.after(() => sessions.close());
  const data = await source.snapshot();
  assert.equal(data.source, "live");
  assert.deepEqual(data.repository, {
    name: "owner/repo",
    url: "https://github.com/owner/repo",
  });
  assert.deepEqual(data.issues, []);
  assert.ok(runner.options.every((o) => o.cwd === repoRoot));
});
