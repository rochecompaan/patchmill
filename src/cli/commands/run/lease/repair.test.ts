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
