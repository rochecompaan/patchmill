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
