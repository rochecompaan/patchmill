import assert from "node:assert/strict";
import test from "node:test";
import {
  PlanningPublicationGit,
  PlanningPublicationGitError,
} from "./planning-publication-git.ts";

const oid = "a".repeat(40);
const record = (path: string, mode = "100644", type = "blob") =>
  `${mode} ${type} ${oid}\t${path}\0`;

function fixture(stdout: string) {
  const calls: string[][] = [];
  const git = new PlanningPublicationGit({
    repoRoot: "/repo",
    runner: {
      run: async (_command, args) => {
        calls.push(args);
        return { code: 0, stdout, stderr: "" };
      },
    },
  });
  const input = {
    commitOid: oid,
    issueNumber: 307,
    specsDir: "/repo/custom specs",
    plansDir: "custom plans",
  };
  return { git, input, calls };
}

test("discovers current-issue artifacts from committed tree records", async () => {
  const f = fixture(
    [
      record("custom specs/nested/2026-10-11-issue-307-spec.md"),
      record("custom plans/2026-10-11-issue-3070-plan.md"),
      record("custom plans/2026-10-12-issue-307-plan.md", "100755"),
      record("custom plans/2026-10-11-issue-307-link.md", "120000"),
      record(
        "custom plans/2026-10-11-issue-307-submodule.md",
        "160000",
        "commit",
      ),
    ].join(""),
  );
  assert.deepEqual(await f.git.inspectArtifactCandidates(f.input), {
    spec: ["custom specs/nested/2026-10-11-issue-307-spec.md"],
    plan: ["custom plans/2026-10-12-issue-307-plan.md"],
  });
  assert.deepEqual(f.calls, [
    [
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      oid,
      "--",
      "custom specs",
      "custom plans",
    ],
  ]);
});

for (const [condition, stdout] of [
  [
    "missing NUL",
    record("custom plans/2026-10-11-issue-307-plan.md").slice(0, -1),
  ],
  [
    "duplicate record",
    record("custom plans/2026-10-11-issue-307-plan.md").repeat(2),
  ],
  ["invalid path", record("../custom plans/2026-10-11-issue-307-plan.md")],
  [
    "invalid object ID",
    "100644 blob invalid\tcustom plans/2026-10-11-issue-307-plan.md\0",
  ],
  [
    "invalid mode/type",
    record("custom plans/2026-10-11-issue-307-plan.md", "160000", "blob"),
  ],
] as const) {
  test(`committed artifact discovery rejects malformed tree evidence: ${condition}`, async () => {
    const f = fixture(stdout);
    await assert.rejects(
      () => f.git.inspectArtifactCandidates(f.input),
      (error) =>
        error instanceof PlanningPublicationGitError &&
        error.operation === "tree" &&
        error.reason === "malformed-response",
    );
  });
}

test("committed artifact discovery validates scalar inputs before Git", async () => {
  for (const override of [
    { commitOid: "HEAD" },
    { issueNumber: 0 },
    { specsDir: "../outside" },
    { plansDir: "/outside" },
  ]) {
    const f = fixture("");
    await assert.rejects(() =>
      f.git.inspectArtifactCandidates({ ...f.input, ...override }),
    );
    assert.equal(f.calls.length, 0);
  }
});
