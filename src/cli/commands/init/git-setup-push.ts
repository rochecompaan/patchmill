import type { CommandResult, CommandRunner } from "../triage/types.ts";
import type { InitGitPolicyPrompt } from "./git-policy.ts";

const SETUP_COMMIT_SUBJECT = "chore: initialize Patchmill";

export type InitSetupPushOptions = {
  repoRoot: string;
  runner: CommandRunner;
  remote: string;
  baseBranch: string;
  isInteractive: boolean;
  assumeYes: boolean;
  prompt?: InitGitPolicyPrompt;
};

export type InitSetupPushResult = {
  message?: string;
};

type SetupCommit = {
  sha: string;
  subject: string;
};

type PushSafety =
  | { status: "safe"; targetRef: string; commit: SetupCommit }
  | { status: "unsafe"; targetRef: string; reason: string };

function targetRef(remote: string, baseBranch: string): string {
  return `refs/remotes/${remote}/${baseBranch}`;
}

function targetName(remote: string, baseBranch: string): string {
  return `${remote}/${baseBranch}`;
}

function manualPushCommand(remote: string, baseBranch: string): string {
  return `git push ${remote} HEAD:${baseBranch}`;
}

function gitOutput(result: CommandResult): string {
  return result.stderr || result.stdout || "unknown error";
}

function parseCommitLog(stdout: string): SetupCommit[] {
  return stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [sha = "", subject = ""] = line.split("\0", 2);
      return { sha, subject };
    });
}

function guidance(options: {
  remote: string;
  baseBranch: string;
  reason: string;
}): string {
  const target = targetName(options.remote, options.baseBranch);
  return [
    `Patchmill created a setup commit that must be pushed or merged into ${target} before patchmill run-once can create issue PRs.`,
    `Patchmill did not push automatically: ${options.reason}.`,
    "If appropriate, run:",
    `  ${manualPushCommand(options.remote, options.baseBranch)}`,
  ].join("\n");
}

async function inspectPushSafety(
  options: Pick<
    InitSetupPushOptions,
    "repoRoot" | "runner" | "remote" | "baseBranch"
  >,
): Promise<PushSafety> {
  const configuredTargetRef = targetRef(options.remote, options.baseBranch);
  const configuredTargetName = targetName(options.remote, options.baseBranch);

  const branch = await options.runner.run(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: options.repoRoot },
  );
  const branchName = branch.stdout.trim();
  if (branch.code !== 0 || branchName === "") {
    return {
      status: "unsafe",
      targetRef: configuredTargetRef,
      reason: `current branch could not be determined: ${gitOutput(branch)}`,
    };
  }
  if (branchName === "HEAD") {
    return {
      status: "unsafe",
      targetRef: configuredTargetRef,
      reason: "current checkout is detached",
    };
  }

  const upstream = await options.runner.run(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    { cwd: options.repoRoot },
  );
  const upstreamName = upstream.stdout.trim();
  if (upstream.code !== 0 || upstreamName === "") {
    return {
      status: "unsafe",
      targetRef: configuredTargetRef,
      reason: `current branch does not track ${configuredTargetName}`,
    };
  }
  if (upstreamName !== configuredTargetName) {
    return {
      status: "unsafe",
      targetRef: configuredTargetRef,
      reason: `current branch tracks ${upstreamName}, not ${configuredTargetName}`,
    };
  }

  const verifyTarget = await options.runner.run(
    "git",
    ["rev-parse", "--verify", `${configuredTargetRef}^{commit}`],
    { cwd: options.repoRoot },
  );
  if (verifyTarget.code !== 0) {
    return {
      status: "unsafe",
      targetRef: configuredTargetRef,
      reason: `${configuredTargetRef} is missing; run git fetch or push the setup commit before run-once`,
    };
  }

  const ancestor = await options.runner.run(
    "git",
    ["merge-base", "--is-ancestor", configuredTargetRef, "HEAD"],
    { cwd: options.repoRoot },
  );
  if (ancestor.code !== 0) {
    return {
      status: "unsafe",
      targetRef: configuredTargetRef,
      reason: `${configuredTargetRef} is not an ancestor of HEAD`,
    };
  }

  const log = await options.runner.run(
    "git",
    ["log", "--format=%H%x00%s", `${configuredTargetRef}..HEAD`],
    { cwd: options.repoRoot },
  );
  if (log.code !== 0) {
    return {
      status: "unsafe",
      targetRef: configuredTargetRef,
      reason: `git log failed while checking unpushed setup commit: ${gitOutput(log)}`,
    };
  }

  const commits = parseCommitLog(log.stdout);
  if (commits.length !== 1) {
    const subjects = commits.map((commit) => commit.subject).join(", ");
    return {
      status: "unsafe",
      targetRef: configuredTargetRef,
      reason:
        commits.length === 0
          ? "HEAD has no unpushed Patchmill setup commit"
          : `HEAD has unpushed commits in addition to ${SETUP_COMMIT_SUBJECT}: ${subjects}`,
    };
  }

  const [commit] = commits;
  if (!commit || commit.subject !== SETUP_COMMIT_SUBJECT) {
    return {
      status: "unsafe",
      targetRef: configuredTargetRef,
      reason: `the unpushed commit is ${commit?.subject || "unknown"}, not ${SETUP_COMMIT_SUBJECT}`,
    };
  }

  return { status: "safe", targetRef: configuredTargetRef, commit };
}

function accepted(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "" || normalized === "y" || normalized === "yes";
}

export async function maybeOfferInitSetupPush(
  options: InitSetupPushOptions,
): Promise<InitSetupPushResult> {
  const safety = await inspectPushSafety(options);
  if (safety.status !== "safe") {
    return {
      message: guidance({
        remote: options.remote,
        baseBranch: options.baseBranch,
        reason: safety.reason,
      }),
    };
  }

  if (!options.isInteractive || options.assumeYes || !options.prompt) {
    return {
      message: guidance({
        remote: options.remote,
        baseBranch: options.baseBranch,
        reason: options.assumeYes
          ? "--yes does not perform network pushes"
          : "init is non-interactive",
      }),
    };
  }

  const answer = await options.prompt(
    [
      `Patchmill committed config and skills locally. patchmill run-once needs this setup commit on ${targetName(options.remote, options.baseBranch)} before creating issue branches.`,
      "Push it now? [Y/n] ",
    ].join("\n"),
  );
  if (!accepted(answer)) {
    return {
      message: guidance({
        remote: options.remote,
        baseBranch: options.baseBranch,
        reason: "the push was declined",
      }),
    };
  }

  const push = await options.runner.run(
    "git",
    ["push", options.remote, `HEAD:${options.baseBranch}`],
    { cwd: options.repoRoot },
  );
  if (push.code !== 0) {
    return {
      message: [
        `Warning: git push failed while publishing Patchmill setup commit; continuing. ${gitOutput(push)}`,
        guidance({
          remote: options.remote,
          baseBranch: options.baseBranch,
          reason: "git push failed",
        }),
      ].join("\n"),
    };
  }

  return {
    message: `Pushed Patchmill setup commit to ${targetName(options.remote, options.baseBranch)}. patchmill run-once can now create issue branches from the configured base.`,
  };
}
