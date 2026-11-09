import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { FakeHost, writeFakeHostState } from "../../test-support/fake-host.ts";
import { parseConfig } from "../config/config.ts";
import { KERNEL_COMMENT, kernelComment } from "./comments.ts";
import { LabelWorkflowState } from "./label-workflow.ts";

async function setup(t: TestContext, labels: string[] = []) {
  const root = await fs.mkdtemp(join(tmpdir(), "patchmill-label-workflow-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const path = join(root, "host.json");
  writeFakeHostState(path, {
    issues: [
      {
        number: 9,
        title: "Issue",
        body: "",
        author: "owner",
        state: "open",
        url: "https://example.invalid/9",
        createdAt: "2026-10-01",
        labels,
        comments: [
          {
            author: "owner",
            body: KERNEL_COMMENT + "\nQuestion",
            createdAt: "2026-10-02",
          },
        ],
      },
    ],
  });
  const host = new FakeHost(path);
  return {
    host,
    workflow: new LabelWorkflowState(host, parseConfig({}).labels),
  };
}

// Wrong precedence changes triage and run eligibility for mixed labels.
test("label status follows label precedence", async (t) => {
  for (const [labels, status] of [
    [[], "untriaged"],
    [["needs-info", "agent-unsuitable"], "unsuitable"],
    [["agent-ready", "agent-done"], "ready"],
    [["in-progress", "agent-ready"], "inProgress"],
  ] as const) {
    const { workflow } = await setup(t, [...labels]);
    assert.equal((await workflow.issue(9)).status, status);
    const listed = (await workflow.openIssues())[0]!;
    assert.equal(listed.status, status);
    assert.equal(listed.statusSince, undefined);
    assert.equal(listed.comments[0]!.fromPatchmill, true);
    await workflow.sync();
  }
});

test("setStatus leaves exactly one workflow label", async (t) => {
  const { host, workflow } = await setup(t, [
    "bug",
    "in-progress",
    "agent-ready",
  ]);
  await workflow.setStatus(9, { status: "needsInfo" });
  assert.deepEqual(host.state().issues[0]!.labels, ["bug", "needs-info"]);
});

test("setStatus posts the kernel comment only with a summary", async (t) => {
  const { host, workflow } = await setup(t);
  await workflow.setStatus(9, {
    status: "needsInfo",
    summary: "S",
    cost: "C",
    warnings: ["W"],
  });
  await workflow.setStatus(9, { status: "ready" });
  assert.equal(
    host.state().calls.filter((call) => call === "commentIssue:9").length,
    1,
  );
  assert.equal(
    host.state().issues[0]!.comments[1]!.body,
    kernelComment({
      issue: 9,
      label: "needs-info",
      summary: "S",
      cost: "C",
      warnings: ["W"],
    }),
  );
  assert.equal(
    host.state().issues[0]!.comments[1]!.body,
    "<!-- patchmill:kernel-comment -->\n\nIssue #9: needs-info\n\nS\n\nC\n\nW",
  );
});

test("labels are ensured once per instance", async (t) => {
  const { host, workflow } = await setup(t);
  await workflow.setStatus(9, { status: "ready" });
  await workflow.setStatus(9, { status: "done" });
  assert.equal(
    host.state().calls.filter((call) => call === "listLabels").length,
    1,
  );
});

test("a failed swap rejects and posts nothing", async (t) => {
  const { host, workflow } = await setup(t);
  host.setLabels = async () => {
    throw new Error("swap denied");
  };
  await assert.rejects(
    workflow.setStatus(9, { status: "ready", summary: "S" }),
    { message: "Label update failed: swap denied" },
  );
  assert.equal(host.state().issues[0]!.comments.length, 1);
});

test("a failed optional comment is a warning", async (t) => {
  const { host, workflow } = await setup(t);
  host.commentIssue = async () => {
    throw new Error("comment denied");
  };
  assert.deepEqual(
    await workflow.setStatus(9, { status: "ready", summary: "S" }),
    ["Comment failed: comment denied"],
  );
  assert.deepEqual(host.state().issues[0]!.labels, ["agent-ready"]);
});

test("a failed label setup rejects without swapping or commenting", async (t) => {
  const { host, workflow } = await setup(t);
  host.createLabel = async () => {
    throw new Error("setup denied");
  };
  await assert.rejects(
    workflow.setStatus(9, { status: "ready", summary: "S" }),
    /setup denied/,
  );
  assert.deepEqual(host.state().issues[0]!.labels, []);
  assert.equal(host.state().issues[0]!.comments.length, 1);
});

test("label setup retries after failure and caches success", async (t) => {
  const { host, workflow } = await setup(t);
  const listLabels = host.listLabels.bind(host);
  let attempts = 0;
  host.listLabels = async () => {
    if (++attempts === 1) throw new Error("setup unavailable");
    return listLabels();
  };
  await assert.rejects(
    workflow.setStatus(9, { status: "ready" }),
    /setup unavailable/,
  );
  await workflow.setStatus(9, { status: "done" });
  assert.deepEqual(host.state().issues[0]!.labels, ["agent-done"]);
  await workflow.setStatus(9, { status: "ready" });
  assert.equal(attempts, 2);
});
