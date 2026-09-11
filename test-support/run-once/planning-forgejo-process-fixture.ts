import type { CommandResult } from "../../src/cli/commands/run-once/types.ts";
import { issueListPayload, labelListPayload } from "./issue-fixtures.ts";
import type {
  PlanningProviderFixtureInput,
  PlanningScenarioPull,
} from "./planning-provider-scenario-types.ts";

function fixtureError(args: readonly string[]): never {
  throw new Error(`unexpected tea command: ${args.join(" ")}`);
}

function argument(args: readonly string[], flag: string) {
  const value = args[args.indexOf(flag) + 1];
  if (value === undefined) fixtureError(args);
  return value;
}

function repository(name = "patchmill") {
  return {
    name,
    full_name: `acme/${name}`,
    owner: { login: "acme" },
    html_url: `https://forge.test/acme/${name}`,
  };
}

export function forgejoPullPayload(pull: PlanningScenarioPull) {
  const headRepository = {
    name: pull.headRepository.split("/").at(-1)!,
    full_name: pull.headRepository,
    owner: { login: pull.headRepository.split("/")[0]! },
    html_url: `https://forge.test/${pull.headRepository}`,
  };
  return {
    number: pull.number,
    html_url: `https://forge.test/acme/patchmill/pulls/${pull.number}`,
    body: pull.body,
    state: pull.merged || pull.closed ? "closed" : "open",
    merged: pull.merged === true,
    merge_commit_sha: pull.mergeOid ?? null,
    base: { ref: "main", repo: repository() },
    head: { ref: pull.branch, sha: pull.headOid, repo: headRepository },
  };
}

export function forgejoResult(stdout: unknown): CommandResult {
  return { code: 0, stdout: JSON.stringify(stdout), stderr: "" };
}

/** Parses only the tea commands emitted by ForgejoTeaPullRequestHost. */
export function createForgejoProcessFixture(
  input: PlanningProviderFixtureInput,
) {
  return async (args: string[]): Promise<CommandResult> => {
    const [group, action] = args;
    if (group === "comment") {
      const handoff = await input.implementationFinish();
      input.record({
        kind: "write",
        operation: handoff ? "handoff-comment" : "issue-comment",
      });
      if (handoff) await input.interrupt("after-handoff-comment");
      input.addIssueComment(args.at(-1)!);
      return { code: 0, stdout: "", stderr: "" };
    }
    if (group === "issues" && action === "list") {
      input.record({ kind: "read", operation: "issue-read" });
      const page = argument(args, "--page");
      return {
        code: 0,
        stdout: page === "1" ? issueListPayload([input.issue]) : "[]",
        stderr: "",
      };
    }
    if (group === "issues" && action === "edit") {
      const done = await input.implementationFinish();
      input.record({
        kind: "write",
        operation: done ? "done-label" : "issue-label-edit",
      });
      if (done) await input.interrupt("after-done-label");
      input.updateIssueLabels(
        args.flatMap((value, index) =>
          value === "--add-labels" ? [args[index + 1]!] : [],
        ),
        args.flatMap((value, index) =>
          value === "--remove-labels" ? [args[index + 1]!] : [],
        ),
      );
      return { code: 0, stdout: "", stderr: "" };
    }
    if (group === "labels" && action === "list") {
      input.record({ kind: "read", operation: "repository-read" });
      return { code: 0, stdout: labelListPayload(), stderr: "" };
    }
    if (group !== "api") return fixtureError(args);
    if (input.consumeHostReadFailure())
      return { code: 1, stdout: "", stderr: "transient host failure" };
    const path = args.find((value) => value.startsWith("/repos/"));
    if (path === undefined) return fixtureError(args);
    if (path.endsWith("/repos/{owner}/{repo}")) {
      input.record({ kind: "read", operation: "repository-read" });
      const repo = argument(args, "--repo");
      return forgejoResult(
        repository(
          repo === "acme/patchmill-head" ? "patchmill-head" : "patchmill",
        ),
      );
    }
    if (path.includes("/pulls?")) {
      input.record({ kind: "read", operation: "pull-request-read" });
      return forgejoResult(input.pulls.map(forgejoPullPayload));
    }
    if (/\/pulls\/\d+$/u.test(path)) {
      input.record({ kind: "read", operation: "pull-request-read" });
      const number = Number(path.split("/").at(-1));
      const pull = input.pulls.find((item) => item.number === number);
      if (pull === undefined)
        return { code: 1, stdout: "", stderr: "HTTP/1.1 404 Not Found" };
      if (number === 99)
        await input.interrupt("after-implementation-pull-request-validation");
      return forgejoResult(forgejoPullPayload(pull));
    }
    if (path.endsWith("/pulls") && args.includes("--method")) {
      const head = args.find((value) => value.startsWith("head="));
      if (head === undefined) return fixtureError(args);
      const body = args.find((value) => value.startsWith("body="));
      if (body === undefined) return fixtureError(args);
      const pull = {
        number: input.nextPull(),
        branch: head.slice(5).split(":").at(-1)!,
        body: body.slice(5),
        headOid: await input.headOid(head.slice(5).split(":").at(-1)!),
        headRepository: "acme/patchmill-head",
      };
      input.pulls.push(pull);
      const ownership = await input.ownershipForBranch(pull.branch);
      input.record({
        kind: "write",
        operation: "planning-pull-request-create",
        phase: ownership.phase,
        branch: ownership.branch,
        ref: `refs/heads/${ownership.branch}`,
      });
      await input.interrupt("after-planning-pull-request-create");
      return forgejoResult(forgejoPullPayload(pull));
    }
    return fixtureError(args);
  };
}
