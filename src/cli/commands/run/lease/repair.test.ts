import assert from "node:assert/strict";
import test from "node:test";
import { runLeaseRepairCommand } from "./repair.ts";
function stream() {
  let text = "";
  return {
    write: (v: string) => {
      text += v;
      return true;
    },
    get text() {
      return text;
    },
  };
}
test("inspection prints a fingerprinted follow-up command", async () => {
  const out = stream(),
    err = stream();
  const code = await runLeaseRepairCommand(["--issue", "45"], {
    loadConfig: async () => ({ repoRoot: ".", runStateDir: "runs" }),
    inspect: async () => ({
      kind: "remote-lease",
      sha256: "abc",
      owner: {
        version: 1,
        issueNumber: 45,
        pid: 1,
        hostname: "remote",
        ownerToken: "x",
        acquiredAt: "now",
      },
    }),
    stdout: out as never,
    stderr: err as never,
  });
  assert.equal(code, 0);
  assert.match(err.text, /--expect-lease-sha256 abc --confirm-owner-stopped/);
});
test("delegates every confirmed repair mode with its matching confirmation", async () => {
  for (const [flag, confirmation, result] of [
    ["--expect-lease-sha256", "--confirm-owner-stopped", "lease-quarantined"],
    [
      "--expect-guard-sha256",
      "--confirm-all-runners-stopped",
      "guard-quarantined",
    ],
    [
      "--expect-state-sha256",
      "--confirm-all-runners-stopped",
      "legacy-fence-written",
    ],
  ] as const) {
    let input: { confirmedProcessesStopped: boolean } | undefined;
    const code = await runLeaseRepairCommand(
      ["--issue", "45", flag, "abc", confirmation],
      {
        loadConfig: async () => ({ repoRoot: ".", runStateDir: "runs" }),
        admitMutation: async (_config, _issue, action) => action(),
        repair: async (value) => {
          input = value;
          return { kind: result, path: "runs/archive" };
        },
        stderr: stream() as never,
      },
    );
    assert.equal(code, 0);
    assert.equal(input?.confirmedProcessesStopped, true);
  }
});
test("interrupted repair inspection reserves no admission and carries both fingerprints", async () => {
  const err = stream();
  const code = await runLeaseRepairCommand(["--issue", "45"], {
    loadConfig: async () => ({ repoRoot: ".", runStateDir: "runs" }),
    admitMutation: async () => assert.fail("inspection must remain read-only"),
    inspect: async () => ({
      kind: "interrupted-repair",
      sha256: "primary",
      pairedGuardSha256: "paired",
      owner: {
        version: 1,
        issueNumber: 45,
        pid: 9,
        hostname: "local",
        ownerToken: "guard",
        acquiredAt: "2026-01-01T00:00:00Z",
      },
    }),
    stderr: err as never,
  });
  assert.equal(code, 0);
  assert.match(
    err.text,
    /--expect-repair-sha256 primary --expect-paired-guard-sha256 paired --confirm-all-runners-stopped/u,
  );
  let admitted = false;
  await runLeaseRepairCommand(
    [
      "--issue",
      "45",
      "--expect-repair-sha256",
      "primary",
      "--expect-paired-guard-sha256",
      "paired",
      "--confirm-all-runners-stopped",
    ],
    {
      loadConfig: async () => ({ repoRoot: ".", runStateDir: "runs" }),
      admitMutation: async (_config, _issue, action) => {
        admitted = true;
        return action();
      },
      repair: async (input) => {
        assert.equal(admitted, true);
        assert.equal(input.expectedRepairSha256, "primary");
        assert.equal(input.expectedPairedGuardSha256, "paired");
        return { kind: "repair-guards-quarantined", path: "archive" };
      },
      stderr: stream() as never,
    },
  );
  await assert.rejects(
    runLeaseRepairCommand([
      "--issue",
      "45",
      "--expect-paired-guard-sha256",
      "paired",
      "--confirm-all-runners-stopped",
    ]),
    /requires a repair guard fingerprint/u,
  );
});

test("rejects mismatched and confirmation-only repair confirmations", async () => {
  await assert.rejects(
    runLeaseRepairCommand([
      "--issue",
      "45",
      "--expect-lease-sha256",
      "a",
      "--confirm-all-runners-stopped",
    ]),
    /matching/,
  );
  await assert.rejects(
    runLeaseRepairCommand(["--issue", "45", "--confirm-owner-stopped"]),
    /requires a repair fingerprint/,
  );
});
test("rejects unknown, duplicate, pipeline, and force-like options", async () => {
  for (const args of [
    ["--issue", "45", "--force"],
    ["--issue", "45", "--dry-run"],
    ["--issue", "45", "--issue", "46"],
    ["--issue", "45", "--unknown"],
  ])
    await assert.rejects(runLeaseRepairCommand(args), /Unsupported|duplicate/);
});
test("rejects invalid issue and mixed fingerprints", async () => {
  await assert.rejects(
    runLeaseRepairCommand(["--issue", "0"]),
    /requires --issue/,
  );
  await assert.rejects(
    runLeaseRepairCommand([
      "--issue",
      "45",
      "--expect-lease-sha256",
      "a",
      "--expect-state-sha256",
      "b",
    ]),
    /exactly one/,
  );
});
