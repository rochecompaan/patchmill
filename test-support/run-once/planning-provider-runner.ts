import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promptPath } from "./mock-runner.ts";
import { git, recordCarriedArtifacts } from "./planning-provider-git.ts";
import type {
  PlanningScenarioEffect,
  PlanningScenarioFailurePoint,
  PlanningScenarioOwnership,
  PlanningScenarioProvider,
  PlanningScenarioPull,
} from "./planning-provider-scenario-types.ts";

/** Owns process-boundary effects while the scenario composes provider and Git fixtures. */
export function createPlanningProviderRunner(input: {
  provider: PlanningScenarioProvider;
  repoRoot: string;
  pulls: PlanningScenarioPull[];
  carriedArtifacts: Map<string, string>;
  ownershipForBranch(branch: string): Promise<PlanningScenarioOwnership>;
  ownershipForWorktree(
    worktreePath: string,
  ): Promise<PlanningScenarioOwnership>;
  planningPhaseMerged(): Promise<boolean>;
  interruptAfter(point: PlanningScenarioFailurePoint): Promise<void>;
  github(
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  forgejo(
    args: string[],
  ): Promise<{ code: number; stdout: string; stderr: string }>;
  record(effect: PlanningScenarioEffect): void;
}) {
  return {
    async run(command: string, args: string[], options: { cwd?: string } = {}) {
      const name = command === process.execPath ? "pi" : command;
      const values = name === "pi" ? args.slice(1) : args;
      if (name === "git") {
        if (values[0] === "remote" && values[1] === "get-url") {
          input.record({ kind: "read", operation: "repository-read" });
          return {
            code: 0,
            stdout: `https://${input.provider === "github-gh" ? "github.test/acme/patchmill" : "forge.test/acme/patchmill-head"}.git\n`,
            stderr: "",
          };
        }
        const result = await git(options.cwd ?? input.repoRoot, values);
        if (
          values[0] === "worktree" &&
          values[1] === "add" &&
          result.code !== 0
        )
          throw new Error(result.stderr);
        if (values[0] === "push" && values.includes("--porcelain")) {
          const branch = values
            .at(-1)
            ?.split(":")
            .at(-1)
            ?.replace(/^refs\/heads\//u, "");
          if (branch === undefined) throw new Error("push branch is missing");
          const ownership = await input.ownershipForBranch(branch);
          input.record({
            kind: "write",
            operation: "phase-push",
            phase: ownership.phase,
            branch: ownership.branch,
            ref: `refs/heads/${ownership.branch}`,
          });
          await input.interruptAfter("after-phase-push");
        }
        if (values[0] === "worktree" && values[1] === "remove") {
          const worktreePath = values.at(-1);
          if (worktreePath === undefined)
            throw new Error("worktree removal target is missing");
          const ownership = await input.ownershipForWorktree(worktreePath);
          input.record({
            kind: "write",
            operation: "workspace-remove",
            ...ownership,
          });
          await input.interruptAfter(
            ownership.phase === "implementation"
              ? "after-implementation-worktree-remove"
              : "after-worktree-remove",
          );
        }
        if (
          (values[0] === "branch" && values.includes("-D")) ||
          (values[0] === "update-ref" && values[1] === "-d")
        ) {
          const branch =
            values[0] === "update-ref"
              ? values[2]?.replace(/^refs\/heads\//u, "")
              : values.at(-1);
          if (branch === undefined)
            throw new Error("branch removal target is missing");
          const ownership = await input.ownershipForBranch(branch);
          input.record({
            kind: "write",
            operation: "branch-remove",
            phase: ownership.phase,
            branch: ownership.branch,
          });
          await input.interruptAfter("after-local-branch-remove");
        }
        if (values[0] === "fetch") {
          input.record({ kind: "read", operation: "remote-fetch" });
          if (await input.planningPhaseMerged())
            await input.interruptAfter("after-planning-merge-observation");
        }
        return result;
      }
      if (name === "pi") {
        const cwd = options.cwd!;
        const ownership = await input.ownershipForWorktree(cwd);
        input.record({ kind: "write", operation: "agent-run", ...ownership });
        await recordCarriedArtifacts(cwd, input.carriedArtifacts);
        const prompt = await readFile(promptPath(values), "utf8");
        const path = /"(?:specPath|planPath)"\s*:\s*"([^"]+)"/u.exec(
          prompt,
        )?.[1];
        if (path) {
          await mkdir(dirname(join(cwd, path)), { recursive: true });
          await writeFile(join(cwd, path), "# artifact\n", "utf8");
          await git(cwd, ["add", path]);
          await git(cwd, ["commit", "-m", "planning artifact"]);
          const commit = await git(cwd, ["rev-parse", "HEAD"]);
          return {
            code: 0,
            stdout: JSON.stringify({
              status: path.includes("specs") ? "spec-created" : "plan-created",
              ...(path.includes("specs")
                ? { specPath: path }
                : { planPath: path }),
              commit: commit.stdout.trim(),
            }),
            stderr: "",
          };
        }
        await writeFile(
          join(cwd, "implementation.txt"),
          "implemented\n",
          "utf8",
        );
        await git(cwd, ["add", "implementation.txt"]);
        await git(cwd, ["commit", "-m", "implementation"]);
        const branch = (
          await git(cwd, ["branch", "--show-current"])
        ).stdout.trim();
        const headOid = (await git(cwd, ["rev-parse", "HEAD"])).stdout.trim();
        await git(cwd, ["push", "origin", `HEAD:${branch}`]);
        const publicationOwnership = await input.ownershipForBranch(branch);
        input.record({
          kind: "write",
          operation: "implementation-push",
          phase: publicationOwnership.phase,
          branch: publicationOwnership.branch,
          ref: `refs/heads/${publicationOwnership.branch}`,
        });
        input.pulls.push({
          number: 99,
          branch,
          headOid,
          headRepository:
            input.provider === "forgejo-tea"
              ? "acme/patchmill-head"
              : "acme/patchmill",
          body: "Closes #190\n\n<!-- patchmill:planning-pr-v1 issue=190 phase=implementation -->",
        });
        return {
          code: 0,
          stdout: JSON.stringify({
            status: "pr-created",
            prUrl: `https://${input.provider === "github-gh" ? "github.test/acme/patchmill/pull" : "forge.test/acme/patchmill/pulls"}/99`,
            branch,
            commits: [headOid],
            validation: ["npm test"],
          }),
          stderr: "",
        };
      }
      if (name === "gh") return input.github(values);
      if (name === "tea") return input.forgejo(values);
      if (name === "bash") {
        const cwd = options.cwd;
        if (cwd === undefined)
          throw new Error("cleanup hook worktree is missing");
        const ownership = await input.ownershipForWorktree(cwd);
        input.record({
          kind: "write",
          operation: "cleanup-hook",
          ...ownership,
        });
        await input.interruptAfter("after-cleanup-hook");
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected command: ${name} ${values.join(" ")}`);
    },
  };
}
