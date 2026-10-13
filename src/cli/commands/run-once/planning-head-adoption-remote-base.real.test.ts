import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PlanningHeadAdoptionGit } from "../../../git/planning-head-adoption-git.ts";
import { PlanningWorkspaceRepositoryGit } from "../../../git/planning-workspace-inspection.ts";
import { validatePlanningState } from "../../../workflow/planning-state-validation.ts";
import { adoptPlanningPullRequestHead } from "./planning-head-adoption.ts";

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const specPath = "docs/specs/example.md";
const planPath = "docs/plans/example.md";
const oldMockup = "docs/mockups/old.html";
const newMockup = "docs/mockups/new.html";
const spec = (mockup: string) =>
  `# Spec\n\n## Companion artifacts\n\n- \`${mockup}\`: [Mockup](../mockups/${mockup.split("/").at(-1)})\n`;

for (const changeMockup of [false, true]) {
  test(`durably adopts a shared phase with a base-satisfied spec${changeMockup ? " and revised companions" : ""}`, async () => {
    const root = await mkdtemp(join(tmpdir(), "planning-mixed-source-"));
    try {
      const remote = join(root, "origin.git");
      const author = join(root, "author");
      const reader = join(root, "reader");
      git(root, "init", "--bare", "-b", "main", remote);
      git(root, "init", "-b", "main", author);
      git(author, "config", "user.name", "Patchmill Test");
      git(author, "config", "user.email", "patchmill@example.test");
      await mkdir(join(author, "docs/specs"), { recursive: true });
      await mkdir(join(author, "docs/mockups"), { recursive: true });
      await writeFile(join(author, specPath), spec(oldMockup));
      await writeFile(
        join(author, oldMockup),
        "<!doctype html><title>Old mockup</title>",
      );
      git(author, "add", ".");
      git(author, "commit", "-m", "base spec");
      const base = git(author, "rev-parse", "HEAD");
      git(author, "remote", "add", "origin", remote);
      git(author, "push", "origin", "main");
      git(author, "checkout", "-b", "planning/plan");
      await mkdir(join(author, "docs/plans"));
      await writeFile(join(author, planPath), "# Plan\n");
      git(author, "add", ".");
      git(author, "commit", "-m", "plan");
      const recorded = git(author, "rev-parse", "HEAD");
      git(author, "push", "origin", "planning/plan");
      git(root, "clone", remote, reader);
      await writeFile(join(author, planPath), "# Reviewed plan\n");
      if (changeMockup) {
        await writeFile(join(author, specPath), spec(newMockup));
        await rm(join(author, oldMockup));
        await writeFile(
          join(author, newMockup),
          "<!doctype html><title>New mockup</title>",
        );
      }
      git(author, "add", ".");
      git(author, "commit", "-m", "reviewer edits");
      const candidate = git(author, "rev-parse", "HEAD");
      git(author, "push", "origin", "planning/plan");
      const repository = {
        provider: "github-gh" as const,
        host: "github.com",
        owner: "acme",
        repository: "patchmill",
      };
      const reference = { targetRepository: repository, number: 188 };
      const url = "https://github.com/acme/patchmill/pull/188";
      const runId = "123e4567-e89b-42d3-a456-426614174000";
      const initial = validatePlanningState({
        version: 1,
        workflowVersion: "planning-pr-v1",
        runId,
        issueNumber: 210,
        issueTitle: "Example",
        gates: { specRequired: false, planRequired: true },
        revision: 0,
        createdAt: "2026-10-13T00:00:00.000Z",
        updatedAt: "2026-10-13T00:00:00.000Z",
        phases: [
          {
            kind: "plan",
            status: "pull-request-open",
            base: {
              remote: "origin",
              baseBranch: "main",
              baseOid: base,
              artifactCandidates: { spec: [specPath], plan: [] },
            },
            workspace: {
              runId,
              phase: "plan",
              identity: {
                branch: "planning/plan",
                worktreePath: join(root, "removed-worktree"),
              },
              remote: "origin",
              baseBranch: "main",
              baseOid: base,
              headOid: recorded,
              cleanup: { state: "removed", pushedHeadOid: recorded },
            },
            artifacts: [
              {
                kind: "spec",
                path: specPath,
                source: "remote-base",
                commitOid: base,
                companionPaths: [oldMockup],
              },
              {
                kind: "plan",
                path: planPath,
                source: "workspace",
                commitOid: recorded,
              },
            ],
            publication: {
              targetRepository: repository,
              headRepository: repository,
              baseBranch: "main",
              headBranch: "planning/plan",
              headOid: recorded,
            },
            pullRequest: { reference, url },
          },
          { kind: "implementation", status: "pending" },
        ],
      });
      const adoption = new PlanningHeadAdoptionGit({
        repository: new PlanningWorkspaceRepositoryGit({
          repoRoot: reader,
          worktreeRoot: ".worktrees",
          runner: {
            async run(command, args, options) {
              try {
                return {
                  code: 0,
                  stdout: execFileSync(command, args, {
                    cwd: options?.cwd,
                    encoding: "utf8",
                    stdio: ["ignore", "pipe", "pipe"],
                  }),
                  stderr: "",
                };
              } catch (error) {
                const failure = error as {
                  status: number;
                  stdout: string;
                  stderr: string;
                };
                return {
                  code: failure.status,
                  stdout: failure.stdout,
                  stderr: failure.stderr,
                };
              }
            },
          },
        }),
      });
      let durable = initial;
      const result = await adoptPlanningPullRequestHead({
        state: initial,
        phaseIndex: 0,
        lock: {} as never,
        validated: {
          reference,
          url,
          summary: {
            number: 188,
            url,
            targetRepository: repository,
            headRepository: repository,
            baseBranch: "main",
            headBranch: "planning/plan",
            headSha: candidate,
            body: "<!-- patchmill:planning-pr-v1 issue=210 phase=plan -->",
            status: "open",
          },
        },
        workspaces: { adoptPlanningHead: (input) => adoption.adopt(input) },
        stateStore: {
          async replace({ next }) {
            durable = validatePlanningState(next);
            return durable;
          },
        },
        now: () => new Date("2026-10-13T00:01:00.000Z"),
      });
      assert.equal(result.kind, "ready");
      if (result.kind !== "ready") return;
      assert.equal(result.adopted, true);
      assert.equal(result.state, durable);
      assert.equal(result.phase.workspace.headOid, candidate);
      assert.equal(result.phase.workspace.cleanup.pushedHeadOid, candidate);
      assert.deepEqual(
        result.phase.artifacts.map(({ source, commitOid }) => ({
          source,
          commitOid,
        })),
        [
          { source: "workspace", commitOid: candidate },
          { source: "workspace", commitOid: candidate },
        ],
      );
      assert.deepEqual(result.phase.artifacts[0]?.companionPaths, [
        changeMockup ? newMockup : oldMockup,
      ]);
      assert.equal(
        initial.phases[0] &&
          "artifacts" in initial.phases[0] &&
          initial.phases[0].artifacts[0]?.source,
        "remote-base",
      );
      assert.equal(git(reader, "rev-parse", "HEAD"), base);
      assert.equal(git(reader, "status", "--porcelain"), "");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
