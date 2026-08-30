import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recoverBlockedWorkspace } from "./pipeline-recovery.ts";
import { AgentIssueSafetyError } from "./pipeline-lifecycle.ts";

const lease = {
  path: "lease",
  record: {
    version: 1 as const,
    issueNumber: 45,
    ownerToken: "owner",
    pid: 1,
    hostname: "host",
    startedAt: "2026-08-30T00:00:00.000Z",
  },
};

async function expectUnsafeSnapshot(state: unknown): Promise<void> {
  const runStateDir = await mkdtemp(join(tmpdir(), "patchmill-retry-state-"));
  await writeFile(join(runStateDir, "issue-45.json"), JSON.stringify(state));
  let gitCalled = false;
  await assert.rejects(
    recoverBlockedWorkspace({
      runner: {
        run: async () => {
          gitCalled = true;
          throw new Error("Git must not run for unsafe retry state");
        },
      },
      config: { runStateDir, repoRoot: runStateDir, baseRef: "HEAD" } as never,
      issueNumber: 45,
      existingState: state as never,
      expectedWorkspace: { branch: "agent/issue-45", worktreePath: "work" },
      ignoredPaths: [],
      resolvedArtifacts: {} as never,
      lease,
    }),
    (error: unknown) => {
      assert.ok(error instanceof AgentIssueSafetyError);
      assert.match(error.message, /recovery state is unsafe/);
      return true;
    },
  );
  assert.equal(gitCalled, false);
}

test("blocked retry rejects a snapshot whose issue identity differs before Git effects", async () => {
  await expectUnsafeSnapshot({
    issueNumber: 46,
    title: "Wrong issue",
    status: "blocked",
    createdAt: "2026-08-30T00:00:00.000Z",
    updatedAt: "2026-08-30T00:00:00.000Z",
  });
});

test("blocked retry rejects a malformed snapshot before Git effects", async () => {
  await expectUnsafeSnapshot({
    issueNumber: 45,
    title: "Unsafe retry",
    status: "blocked",
    createdAt: 3,
    updatedAt: "2026-08-30T00:00:00.000Z",
  });
});
