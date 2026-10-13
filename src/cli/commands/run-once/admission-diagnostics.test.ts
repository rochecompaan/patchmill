import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { rm } from "node:fs/promises";
import {
  RunAdmissionConflictError,
  withRunAdmission,
  type RunAdmissionMode,
} from "../../../workflow/run-admission.ts";
import { failureForPipelineError } from "./pipeline-error-diagnostics.ts";
import { writePipelineFailureResult } from "./main.ts";

const recordedOwner = {
  version: 1,
  attemptId: "winner",
  ownerToken: "private-owner-token",
  mode: "automatic",
  pid: process.pid,
  hostname: hostname(),
};

async function conflict(
  t: TestContext,
  mode: RunAdmissionMode,
  owner: object | string = recordedOwner,
  unreadable = false,
) {
  const root = await mkdtemp(join(tmpdir(), "admission-diagnostics-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const records = join(root, "patchmill", "run-once", "admissions");
  await mkdir(records, { recursive: true });
  const recordPath = join(records, "winner.json");
  const bytes = typeof owner === "string" ? owner : JSON.stringify(owner);
  await writeFile(recordPath, bytes);
  if (unreadable) await chmod(recordPath, 0);
  let actionStarted = false;
  let observed: unknown;
  await assert.rejects(
    withRunAdmission(
      {
        namespace: {
          commonDir: root,
          cloneRoot: root,
          hostRepository: {
            provider: "github",
            host: "github.example.test",
            owner: "patchmill",
            repository: "demo",
          },
          runStateDir: join(root, "state"),
          worktreeRoot: join(root, "workspaces"),
          todoRoot: { kind: "workspace-relative", path: ".pi/todos" },
        },
        attemptId: "loser",
        mode,
        ...(mode === "automatic" ? {} : { issueNumber: 276 }),
      },
      async () => {
        actionStarted = true;
      },
    ),
    (error: unknown) => {
      observed = error;
      return error instanceof RunAdmissionConflictError;
    },
  );
  assert.equal(actionStarted, false);
  if (unreadable) await chmod(recordPath, 0o600);
  assert.equal(await readFile(recordPath, "utf8"), bytes);
  assert.deepEqual(await readdir(records), ["winner.json"]);
  return { error: observed, root, recordPath };
}

async function render(error: unknown, logPath: string, isTTY = false) {
  const output: string[] = [];
  const code = await writePipelineFailureResult(error, logPath, {
    stdout: { isTTY, columns: 100, write: (chunk) => output.push(chunk) },
    env: { NO_COLOR: "1" },
  });
  return { code, text: output.join("") };
}

test("live automatic admission stops explicit work with bounded evidence in JSON, JSONL and TTY", async (t) => {
  const { error, root, recordPath } = await conflict(t, "explicit");
  const logPath = join(root, "run.jsonl");
  const json = await render(error, logPath);
  assert.equal(json.code, 0);
  const result = JSON.parse(json.text);
  assert.equal(result.status, "stopped");
  assert.equal(result.reason, "run-admission-busy");
  assert.equal(result.issueNumber, 276);
  const details = result.diagnostic.details;
  assert.equal(
    details.find((entry) => entry.key === "recordPath").value,
    recordPath,
  );
  assert.equal(
    details.find((entry) => entry.key === "requestedMode").value,
    "explicit",
  );
  assert.deepEqual(details.find((entry) => entry.key === "owner").value, [
    "attemptId=winner",
    "mode=automatic",
    `pid=${process.pid}`,
    `hostname=${hostname()}`,
  ]);
  assert.match(result.diagnostic.explanation, /automatic.*exclusive/iu);
  assert.match(result.diagnostic.explanation, /before.*issue work/iu);
  assert.equal(result.diagnostic.retry.kind, "after-action");
  assert.match(result.diagnostic.retry.guidance, /owner.*stop/iu);
  assert.equal(
    result.diagnostic.actions[0].command,
    "patchmill run-once --issue 276",
  );
  assert.doesNotMatch(json.text, /private-owner-token|ownerToken/u);

  const tty = await render(error, logPath, true);
  assert.equal(tty.code, 0);
  assert.match(tty.text, /Final result:.*Stopped/u);
  assert.match(tty.text, /Recorded owner/u);
  assert.match(tty.text, /mode=automatic/u);
  assert.match(tty.text, /patchmill run-once --issue 276/u);
  assert.doesNotMatch(tty.text, /private-owner-token|ownerToken/u);
  const events = (await readFile(logPath, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(events.length, 2);
  for (const event of events) {
    assert.equal(event.level, "warning");
    assert.equal(event.stage, "result");
    assert.equal(event.message, "final result stopped");
    assert.deepEqual(event.data, result);
  }
});

test("automatic selection reports the explicit owner without mistaking its issue for the requested issue", async (t) => {
  const { error, root } = await conflict(t, "automatic", {
    ...recordedOwner,
    mode: "explicit",
    issueNumber: 275,
  });
  const output = await render(error, join(root, "run.jsonl"));
  assert.equal(output.code, 0);
  const result = JSON.parse(output.text);
  assert.equal(result.status, "stopped");
  assert.equal("issueNumber" in result, false);
  assert.equal(result.diagnostic.actions[0].command, undefined);
  assert.match(result.diagnostic.explanation, /automatic.*exclusive/iu);
  assert.ok(
    result.diagnostic.details
      .find((entry) => entry.key === "owner")
      .value.includes("issueNumber=275"),
  );
});

for (const mode of ["recovery"] as const) {
  test(`${mode} admission does not suggest a normal issue run as its retry`, async (t) => {
    const { error, root } = await conflict(t, mode);
    const output = await render(error, join(root, "run.jsonl"));
    assert.equal(output.code, 0);
    const result = JSON.parse(output.text);
    assert.equal(result.status, "stopped");
    assert.equal(result.diagnostic.actions[0].command, undefined);
    assert.match(result.diagnostic.actions[0].description, /same command/iu);
  });
}

for (const [name, owner] of [
  ["foreign", { ...recordedOwner, hostname: "unverified-host" }],
  ["malformed", "not-json"],
] as const) {
  test(`${name} admission stays an inspection-required error and preserves the record`, async (t) => {
    const { error, root, recordPath } = await conflict(t, "explicit", owner);
    const logPath = join(root, "run.jsonl");
    const output = await render(error, logPath);
    assert.equal(output.code, 1);
    const result = JSON.parse(output.text);
    assert.equal(result.status, "error");
    assert.equal(result.reason, "run-admission-unverifiable");
    assert.doesNotMatch(result.error, /active attempt/u);
    assert.equal(result.diagnostic.retry.kind, "inspect-first");
    assert.equal(result.diagnostic.actions[0].command, undefined);
    assert.equal(
      result.diagnostic.details.find((entry) => entry.key === "recordPath")
        .value,
      recordPath,
    );
    assert.doesNotMatch(output.text, /private-owner-token|ownerToken/u);
    assert.equal(JSON.parse(await readFile(logPath, "utf8")).level, "error");
  });
}

test(
  "unreadable admission requires inspection and preserves its bytes",
  { skip: process.getuid?.() === 0 },
  async (t) => {
    const { error, root } = await conflict(t, "explicit", recordedOwner, true);
    const output = await render(error, join(root, "run.jsonl"));
    const result = JSON.parse(output.text);
    assert.equal(output.code, 1);
    assert.equal(result.reason, "run-admission-unverifiable");
    assert.equal(result.diagnostic.retry.kind, "inspect-first");
    assert.doesNotMatch(result.error, /active attempt/u);
  },
);

test("permission-denied owner checks are not reported as verified live contention", async (t) => {
  t.mock.method(process, "kill", () => {
    throw Object.assign(new Error("permission denied"), { code: "EPERM" });
  });
  const { error, root } = await conflict(t, "explicit");
  const output = await render(error, join(root, "run.jsonl"));
  assert.equal(output.code, 1);
  assert.equal(JSON.parse(output.text).reason, "run-admission-unverifiable");
});

test("unknown admission-guard failures stay errors instead of claiming no issue work ran", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "admission-guard-result-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const error = new RunAdmissionConflictError(join(root, "admission-guard"));
  const output = await render(error, join(root, "run.jsonl"));
  assert.equal(output.code, 1);
  const result = JSON.parse(output.text);
  assert.equal(result.reason, "run-admission-unverifiable");
  assert.doesNotMatch(result.diagnostic.explanation, /before.*issue work/iu);
});

test("a reporting failure alongside contention is not hidden by a successful stop", async (t) => {
  const { error } = await conflict(t, "explicit");
  const failure = failureForPipelineError(
    new AggregateError(
      [error, new Error("reporting failed")],
      "reporting failed",
    ),
  );
  assert.equal(failure.reason, "unexpected-error");
});
