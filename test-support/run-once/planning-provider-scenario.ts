import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import {
  PlanningStateStore,
  type PlanningStateV1,
} from "../../src/workflow/planning-state-store.ts";
import { planningIssueLockPath } from "../../src/workflow/planning-issue-lock.ts";
import { approvalPolicy, makeConfig } from "./pipeline-fixtures.ts";
import { issue } from "./issue-fixtures.ts";
import { promptPath } from "./mock-runner.ts";
import { runOneIssue } from "../../src/cli/commands/run-once/pipeline.ts";
import type { AgentIssuePipelineResult } from "../../src/cli/commands/run-once/types.ts";
import { createGithubProcessFixture } from "./planning-github-process-fixture.ts";
import { createForgejoProcessFixture } from "./planning-forgejo-process-fixture.ts";

const run = promisify(execFile);
const now = new Date("2099-01-01T00:00:00.000Z");

async function git(cwd: string, args: string[]) {
  try {
    const result = await run("git", args, { cwd, encoding: "utf8" });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    const failure = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      code: failure.code ?? 1,
      stdout: failure.stdout ?? "",
      stderr: failure.stderr ?? "",
    };
  }
}

type Pull = {
  number: number;
  branch: string;
  body: string;
  headOid: string;
  headRepository: string;
  merged?: boolean;
  closed?: boolean;
  mergeOid?: string;
};

export type PlanningScenarioProvider = "github-gh" | "forgejo-tea";
export type PlanningScenarioGates = Readonly<{
  specRequired: boolean;
  planRequired: boolean;
}>;
export type PlanningScenarioFailurePoint =
  | "after-phase-push"
  | "after-planning-pull-request-create"
  | "after-worktree-remove"
  | "after-local-branch-remove"
  | "after-planning-merge-observation"
  | "after-implementation-pull-request-validation"
  | "after-handoff-comment"
  | "after-cleanup-hook"
  | "after-implementation-worktree-remove"
  | "after-done-label";
export type RecordedScenarioPullRequest = Readonly<{
  number: number;
  phase: "spec" | "plan" | "implementation";
  targetRepository: string;
  headRepository: string;
  baseBranch: string;
  headBranch: string;
  headOid: string;
  body: string;
  status: "open" | "merged" | "closed-unmerged";
  mergeOid?: string;
}>;
export type PlanningProviderScenario = {
  run(options?: { planOnly?: boolean }): Promise<AgentIssuePipelineResult>;
  state(): Promise<PlanningStateV1 | undefined>;
  pulls(): readonly RecordedScenarioPullRequest[];
  effects(): readonly string[];
  remoteRefs(): Promise<Readonly<Record<string, string>>>;
  mergeOpenPlanningPull(input?: {
    editArtifact?: (content: string) => string;
  }): Promise<void>;
  closeOpenPlanningPull(): void;
  removeSavedPlanningPull(): void;
  duplicateOpenPlanningPull(): void;
  failNextHostRead(): void;
  interruptAt(point: PlanningScenarioFailurePoint): void;
  restorePersistence(): Promise<void>;
  archiveExactStaleLock(): Promise<{
    fingerprint: string;
    archivePath: string;
  }>;
  installDeadProcessLock(): Promise<{ fingerprint: string }>;
  remoteArtifactContents(): Promise<Readonly<Record<string, string>>>;
  carriedArtifactContents(): Readonly<Record<string, string>>;
  cleanup(): Promise<void>;
};

export async function createPlanningProviderScenario(input: {
  provider: PlanningScenarioProvider;
  gates: PlanningScenarioGates;
}): Promise<PlanningProviderScenario> {
  const { provider, gates } = input;
  const invalidImplementation = false;
  const config = await makeConfig({
    dryRun: false,
    execute: true,
    allowDirectLand: true,
    approvalPolicy: approvalPolicy(gates),
    host: { provider, login: "" },
    cleanupHook: "cleanup.sh",
  });
  // The public facade owns a real remote/base/worktree lifecycle; provider
  // commands and Pi are recorded only at their process boundaries.
  const remote = join(config.repoRoot, "remote.git");
  await mkdir(config.worktreeDir, { recursive: true });
  await git(config.repoRoot, ["init", "--initial-branch=main"]);
  await git(config.repoRoot, ["config", "user.email", "test@example.test"]);
  await git(config.repoRoot, ["config", "user.name", "Test"]);
  await writeFile(join(config.repoRoot, "README.md"), "# test\n", "utf8");
  await writeFile(join(config.specsDir, ".gitkeep"), "", "utf8");
  await writeFile(join(config.plansDir, ".gitkeep"), "", "utf8");
  await git(config.repoRoot, ["add", "README.md", "docs"]);
  await git(config.repoRoot, ["commit", "-m", "initial"]);
  await git(config.repoRoot, ["init", "--bare", remote]);
  await git(config.repoRoot, ["remote", "add", "origin", remote]);
  await git(config.repoRoot, ["push", "-u", "origin", "main"]);
  const selected = issue(190, ["agent-ready"], "Provider scenario");
  const addIssueComment = (body: string) => {
    selected.comments?.push({ author: { login: "patchmill" }, body });
  };
  const updateIssueLabels = (
    add: readonly string[],
    remove: readonly string[],
  ) => {
    selected.labels = selected.labels
      .filter((label) => !remove.includes(label))
      .concat(add.filter((label) => !selected.labels.includes(label)));
  };
  const pulls: Pull[] = [];
  let nextPull = 1;
  let failHostRead = false;
  let pendingInterrupt: PlanningScenarioFailurePoint | undefined;
  let persistenceDenied = false;
  const issueStateDirectory = join(
    config.runStateDir,
    "planning-pr-v1",
    "issues",
  );
  const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const carriedArtifacts = new Map<string, string>();
  const recordCarriedArtifacts = async (cwd: string) => {
    const paths = (
      await git(cwd, ["ls-files", "docs/specs", "docs/plans"])
    ).stdout
      .split("\n")
      .filter((path) => path !== "" && !path.endsWith(".gitkeep"));
    for (const path of paths)
      carriedArtifacts.set(path, await readFile(join(cwd, path), "utf8"));
  };
  const state = () => new PlanningStateStore(config.runStateDir).read(190);
  const implementationPhase = async () =>
    (await state())?.phases.find((phase) => phase.kind === "implementation");
  const planningPhaseMerged = async () => {
    const current = await state();
    return current?.phases.some(
      (phase) =>
        phase.kind !== "implementation" &&
        phase.status === "pull-request-open" &&
        pulls.some(
          (pull) =>
            pull.merged && pull.branch === phase.workspace.identity.branch,
        ),
    );
  };
  const interruptAfter = async (point: PlanningScenarioFailurePoint) => {
    if (pendingInterrupt !== point || persistenceDenied) return;
    await chmod(issueStateDirectory, 0o500);
    persistenceDenied = true;
    pendingInterrupt = undefined;
    calls.push({ command: "fixture", args: ["interrupt", point] });
  };
  const nextPullNumber = () => nextPull++;
  const headOid = async (branch: string) =>
    (
      await git(config.repoRoot, ["rev-parse", `refs/heads/${branch}`])
    ).stdout.trim();
  const implementationFinish = async () => {
    const implementation = await implementationPhase();
    return (
      implementation?.kind === "implementation" &&
      implementation.status === "pull-request-open"
    );
  };
  const consumeHostReadFailure = () => {
    if (!failHostRead) return false;
    failHostRead = false;
    return true;
  };
  const fixtureInput = {
    issue: selected,
    pulls,
    nextPull: nextPullNumber,
    headOid,
    implementationFinish,
    interrupt: interruptAfter,
    consumeHostReadFailure,
    addIssueComment,
    updateIssueLabels,
  };
  const githubFixture = createGithubProcessFixture(fixtureInput);
  const forgejoFixture = createForgejoProcessFixture(fixtureInput);
  const runner = {
    calls,
    async run(command: string, args: string[], options: { cwd?: string } = {}) {
      const call =
        command === process.execPath
          ? { command: "pi", args: args.slice(1), cwd: options.cwd }
          : { command, args, cwd: options.cwd };
      calls.push(call);
      if (call.command === "git") {
        if (call.args[0] === "remote" && call.args[1] === "get-url")
          return {
            code: 0,
            stdout: `https://${provider === "github-gh" ? "github.test/acme/patchmill" : "forge.test/acme/patchmill-head"}.git\n`,
            stderr: "",
          };
        const result = await git(call.cwd ?? config.repoRoot, call.args);
        if (
          call.args[0] === "worktree" &&
          call.args[1] === "add" &&
          result.code !== 0
        )
          throw new Error(result.stderr);
        if (call.args[0] === "push" && call.args.includes("--porcelain"))
          await interruptAfter("after-phase-push");
        if (call.args[0] === "worktree" && call.args[1] === "remove") {
          const implementation = await implementationPhase();
          await interruptAfter(
            implementation?.kind === "implementation" &&
              implementation.status === "pull-request-open"
              ? "after-implementation-worktree-remove"
              : "after-worktree-remove",
          );
        }
        if (
          (call.args[0] === "branch" && call.args.includes("-D")) ||
          (call.args[0] === "update-ref" && call.args[1] === "-d")
        )
          await interruptAfter("after-local-branch-remove");
        if (call.args[0] === "fetch" && (await planningPhaseMerged()))
          await interruptAfter("after-planning-merge-observation");
        return result;
      }
      if (call.command === "pi") {
        await recordCarriedArtifacts(call.cwd!);
        const prompt = await readFile(promptPath(call.args), "utf8");
        const path = /"(?:specPath|planPath)"\s*:\s*"([^"]+)"/u.exec(
          prompt,
        )?.[1];
        if (path) {
          await mkdir(dirname(join(call.cwd!, path)), { recursive: true });
          await writeFile(join(call.cwd!, path), "# artifact\n", "utf8");
          await git(call.cwd!, ["add", path]);
          await git(call.cwd!, ["commit", "-m", "planning artifact"]);
          const commit = await git(call.cwd!, ["rev-parse", "HEAD"]);
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
          join(call.cwd!, "implementation.txt"),
          "implemented\n",
          "utf8",
        );
        await git(call.cwd!, ["add", "implementation.txt"]);
        await git(call.cwd!, ["commit", "-m", "implementation"]);
        const branch = (
          await git(call.cwd!, ["branch", "--show-current"])
        ).stdout.trim();
        const headOid = (
          await git(call.cwd!, ["rev-parse", "HEAD"])
        ).stdout.trim();
        await git(call.cwd!, ["push", "origin", `HEAD:${branch}`]);
        calls.push({
          command: "fixture",
          args: ["implementation-push", branch],
        });
        pulls.push({
          number: 99,
          branch,
          headOid,
          headRepository:
            provider === "forgejo-tea"
              ? "acme/patchmill-head"
              : "acme/patchmill",
          body: invalidImplementation
            ? "Closes #189"
            : "Closes #190\n\n<!-- patchmill:planning-pr-v1 issue=190 phase=implementation -->",
        });
        return {
          code: 0,
          stdout: JSON.stringify({
            status: "pr-created",
            prUrl: `https://${provider === "github-gh" ? "github.test/acme/patchmill/pull" : "forge.test/acme/patchmill/pulls"}/99`,
            branch,
            commits: [headOid],
            validation: ["npm test"],
          }),
          stderr: "",
        };
      }
      if (call.command === "gh") return githubFixture(call.args);
      if (call.command === "tea") return forgejoFixture(call.args);
      if (call.command === "bash") {
        await interruptAfter("after-cleanup-hook");
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(
        `unexpected command: ${call.command} ${call.args.join(" ")}`,
      );
    },
  };
  async function mergePlanningPull(
    input: {
      editArtifact?: (content: string) => string;
    } = {},
  ) {
    const pull = pulls.find((item) => item.number !== 99 && !item.merged)!;
    const merged = await git(config.repoRoot, [
      "merge",
      "--no-ff",
      `origin/${pull.branch}`,
      "-m",
      "merge planning",
    ]);
    assert.equal(merged.code, 0, merged.stderr);
    if (input.editArtifact !== undefined) {
      const paths = (
        await git(config.repoRoot, ["diff", "--name-only", "HEAD^1", "HEAD"])
      ).stdout
        .split("\n")
        .filter((path) =>
          pull.body.includes("phase=spec")
            ? path.startsWith("docs/specs/")
            : path.startsWith("docs/plans/"),
        );
      assert.equal(paths.length, 1, "planning pull must contain one artifact");
      const path = paths[0]!;
      const before = await readFile(join(config.repoRoot, path), "utf8");
      await writeFile(
        join(config.repoRoot, path),
        input.editArtifact(before),
        "utf8",
      );
      const added = await git(config.repoRoot, ["add", path]);
      assert.equal(added.code, 0, added.stderr);
      const amended = await git(config.repoRoot, [
        "commit",
        "--amend",
        "--no-edit",
      ]);
      assert.equal(amended.code, 0, amended.stderr);
    }
    pull.mergeOid = (
      await git(config.repoRoot, ["rev-parse", "HEAD"])
    ).stdout.trim();
    pull.merged = true;
    await git(config.repoRoot, ["push", "origin", "main"]);
  }
  const effects = () =>
    calls.map((call) => `${call.command} ${call.args.join(" ")}`);
  const remoteRefs = async () => {
    const result = await git(remote, [
      "for-each-ref",
      "--format=%(refname:strip=2) %(objectname)",
      "refs/heads",
    ]);
    assert.equal(result.code, 0, result.stderr);
    return Object.fromEntries(
      result.stdout
        .trim()
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => line.split(" ") as [string, string]),
    );
  };
  const recorded = (): readonly RecordedScenarioPullRequest[] =>
    pulls.map((pull) => ({
      number: pull.number,
      phase:
        pull.number === 99
          ? "implementation"
          : pull.body.includes("phase=spec")
            ? "spec"
            : "plan",
      targetRepository: "acme/patchmill",
      headRepository: pull.headRepository,
      baseBranch: "main",
      headBranch: pull.branch,
      headOid: pull.headOid,
      body: pull.body,
      status: pull.merged ? "merged" : pull.closed ? "closed-unmerged" : "open",
      ...(pull.mergeOid ? { mergeOid: pull.mergeOid } : {}),
    }));
  return {
    run: async (options = {}) =>
      runOneIssue(
        runner,
        { ...config, planOnly: options.planOnly ?? false },
        { now },
      ),
    state,
    pulls: recorded,
    effects,
    remoteRefs,
    mergeOpenPlanningPull: mergePlanningPull,
    closeOpenPlanningPull: () => {
      const pull = pulls.find((item) => item.number !== 99 && !item.merged);
      if (pull) pull.closed = true;
    },
    removeSavedPlanningPull: () => {
      const index = pulls.findIndex(
        (item) => item.number !== 99 && !item.merged,
      );
      if (index >= 0) pulls.splice(index, 1);
    },
    duplicateOpenPlanningPull: () => {
      const pull = pulls.find((item) => item.number !== 99 && !item.merged);
      if (pull) pulls.push({ ...pull, number: nextPull++ });
    },
    failNextHostRead: () => {
      failHostRead = true;
    },
    interruptAt: (point) => {
      if (pendingInterrupt !== undefined)
        throw new Error(
          `persistence interruption already armed: ${pendingInterrupt}`,
        );
      pendingInterrupt = point;
    },
    restorePersistence: async () => {
      if (!persistenceDenied) return;
      await chmod(issueStateDirectory, 0o700);
      persistenceDenied = false;
    },
    installDeadProcessLock: async () => {
      const current = await state();
      assert.ok(
        current,
        "planning state must exist before a stale lock is installed",
      );
      const path = planningIssueLockPath(config.runStateDir, 190);
      await mkdir(dirname(path), { recursive: true });
      const bytes = Buffer.from(
        `${JSON.stringify({
          version: 1,
          issueNumber: 190,
          runId: current.runId,
          ownershipId: "11111111-1111-4111-8111-111111111111",
          pid: 999999,
          hostname: hostname(),
          acquiredAt: now.toISOString(),
        })}\n`,
        "utf8",
      );
      await writeFile(path, bytes, { mode: 0o600 });
      return { fingerprint: createHash("sha256").update(bytes).digest("hex") };
    },
    archiveExactStaleLock: async () => {
      const path = planningIssueLockPath(config.runStateDir, 190);
      const bytes = await readFile(path);
      const fingerprint = createHash("sha256").update(bytes).digest("hex");
      const archivePath = join(
        config.runStateDir,
        "planning-pr-v1",
        "archives",
        `issue-190.${fingerprint}.lock`,
      );
      await mkdir(dirname(archivePath), { recursive: true });
      await rename(path, archivePath);
      assert.deepEqual(await readFile(archivePath), bytes);
      return { fingerprint, archivePath };
    },
    carriedArtifactContents: () => Object.fromEntries(carriedArtifacts),
    remoteArtifactContents: async () => {
      const completed = await state();
      const artifacts =
        completed?.phases.flatMap((phase) =>
          "artifacts" in phase ? phase.artifacts : [],
        ) ?? [];
      assert.equal(
        new Set(artifacts.map((artifact) => artifact.kind)).size,
        artifacts.length,
        "each artifact kind must have one durable source",
      );
      const contents = await Promise.all(
        artifacts.map(async (artifact) => {
          const result = await git(config.repoRoot, [
            "show",
            `${artifact.commitOid}:${artifact.path}`,
          ]);
          assert.equal(result.code, 0, result.stderr);
          return [artifact.path, result.stdout] as const;
        }),
      );
      return Object.fromEntries(contents);
    },
    cleanup: async () => {
      await chmod(issueStateDirectory, 0o700).catch(() => undefined);
      await rm(config.repoRoot, { recursive: true, force: true });
    },
  };
}
