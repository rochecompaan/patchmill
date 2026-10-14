import assert from "node:assert/strict";
import test from "node:test";
import {
  implementationResumeFixture,
  resumeGit,
} from "../../../../test-support/run-once/planning-implementation-resume-fixture.ts";
import { runPlanningPhase } from "./planning-phase-runner.ts";
import {
  PlanningImplementationValidationError,
  validatePlanningImplementation,
} from "./planning-implementation-validation.ts";

test("independent validation pins a reference-less receipt to its saved PR URL", async () => {
  const run = await implementationResumeFixture("branch-pushed");
  try {
    const saved = run.current().phases[0];
    if (saved?.kind !== "implementation" || saved.status !== "branch-pushed")
      assert.fail();
    const head = await run.advance();
    const prUrl = run.pull().url.replace("/17", "/18");
    run.setPull({ ...run.pull(), number: 18, url: prUrl });
    const { checkedHeadOid: _checked, ...implementation } =
      saved.implementation;
    await assert.rejects(
      validatePlanningImplementation({
        state: run.current(),
        phase: {
          ...saved,
          workspace: { ...saved.workspace, headOid: head },
          publication: { ...saved.publication, headOid: head },
          implementation: { ...implementation, prUrl, commits: [head] },
          revalidation: {
            publication: saved.publication,
            implementation: saved.implementation,
          },
        },
        host: run.input.host,
        workspaces: run.workspaces,
        git: run.input.publicationGit,
      }),
      (error: unknown) =>
        error instanceof PlanningImplementationValidationError &&
        error.validationReason === "url",
    );
  } finally {
    await run.close();
  }
});

async function missingBranchPushedWorkspace() {
  const run = await implementationResumeFixture("branch-pushed");
  await run.advance();
  resumeGit(run.repo, "worktree", "remove", run.path);
  resumeGit(run.repo, "branch", "-D", run.identity.branch);
  return run;
}

test("restoring a branch-pushed receipt supplies its saved PR URL as agent identity", async () => {
  const run = await missingBranchPushedWorkspace();
  try {
    const result = await runPlanningPhase(run.input);
    assert.equal(
      result.kind,
      "implementation-published",
      JSON.stringify(result),
    );
    assert.equal(run.agents(), 1);
    const phase = run.current().phases[0];
    if (
      phase?.kind !== "implementation" ||
      phase.status !== "pull-request-open"
    )
      assert.fail();
    assert.equal(phase.pullRequest.reference.number, 17);
  } finally {
    await run.close();
  }
});

test("a restored branch-pushed retry rejects another valid PR on the same branch", async () => {
  const run = await missingBranchPushedWorkspace();
  try {
    assert.ok(run.input.implementation);
    run.input.implementation.implementation.runAgent = async () => {
      const head = resumeGit(run.path, "rev-parse", "HEAD");
      const replacement = {
        ...run.pull(),
        number: 18,
        url: run.pull().url.replace("/17", "/18"),
        headSha: head,
      };
      run.setPull(replacement);
      return {
        status: "pr-created",
        prUrl: replacement.url,
        branch: run.identity.branch,
        commits: [head],
        validation: ["fresh checks"],
      };
    };
    const result = await runPlanningPhase(run.input);
    assert.equal(result.kind, "blocked", JSON.stringify(result));
    const phase = run.current().phases[0];
    assert.ok(phase?.kind === "implementation" && "revalidation" in phase);
    assert.equal(
      phase.revalidation?.implementation.prUrl,
      "https://github.com/test/repo/pull/17",
    );
    assert.equal(phase.revalidation?.pullRequest, undefined);
  } finally {
    await run.close();
  }
});
