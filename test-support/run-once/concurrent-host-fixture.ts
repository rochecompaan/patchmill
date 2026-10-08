import type { CommandResult } from "../../src/command/types.ts";
import type { IssueSummary } from "../../src/issue/types.ts";
import { issue, labelListPayload } from "./issue-fixtures.ts";

export type ConcurrentPull = {
  number: number;
  issueNumber: number;
  branch: string;
  headOid: string;
  body: string;
  mergeOid?: string;
};
const ok = (value: unknown = ""): CommandResult => ({
  code: 0,
  stdout: typeof value === "string" ? value : JSON.stringify(value),
  stderr: "",
});
const argument = (args: string[], flag: string) =>
  args[args.indexOf(flag) + 1]!;
export function createConcurrentHost(kinds: Array<"planning" | "legacy">) {
  const issues = kinds.map((kind, index) =>
    issue(index + 1, kind === "legacy" ? ["in-progress"] : ["agent-ready"]),
  );
  const effects: Array<{ issueNumber: number; operation: string }> = [];
  const reads: Array<{ operation: string; issueNumber?: number }> = [];
  const pulls: ConcurrentPull[] = [];
  const pushed = new Map<string, string>();
  const payload = (item: IssueSummary) => ({
    ...item,
    author: { login: item.author },
    labels: item.labels.map((name) => ({ name })),
    updatedAt: item.updated,
  });
  const pullPayload = (pull: ConcurrentPull) => ({
    number: pull.number,
    url: `https://github.test/acme/patchmill/pull/${pull.number}`,
    body: pull.body,
    state: pull.mergeOid ? "MERGED" : "OPEN",
    mergeCommit: pull.mergeOid ? { oid: pull.mergeOid } : null,
    baseRefName: "main",
    headRefName: pull.branch,
    headRefOid: pull.headOid,
    headRepository: { nameWithOwner: "acme/patchmill" },
  });
  return {
    issues,
    pulls,
    effects,
    reads,
    pushed(branch: string, headOid: string) {
      pushed.set(branch, headOid);
    },
    publish(input: Omit<ConcurrentPull, "number">) {
      const pull = { ...input, number: pulls.length + 10 };
      pulls.push(pull);
      return pullPayload(pull).url;
    },
    async run(args: string[]): Promise<CommandResult> {
      const [group, action] = args;
      if (group === "repo" && action === "view")
        return ok({
          nameWithOwner: "acme/patchmill",
          url: "https://github.test/acme/patchmill",
        });
      if (group === "label" && action === "list")
        return { code: 0, stdout: labelListPayload(), stderr: "" };
      if (group === "issue" && action === "list") {
        reads.push({ operation: "list" });
        return ok(issues.filter((item) => item.state === "open").map(payload));
      }
      if (group === "issue") {
        const number = Number(args[2]);
        const selected = issues.find((item) => item.number === number);
        if (!selected) throw new Error(`unrelated issue read: ${number}`);
        if (action === "view") {
          reads.push({ operation: "view", issueNumber: number });
          return ok(payload(selected));
        }
        effects.push({ issueNumber: number, operation: action! });
        if (action === "edit") {
          for (let index = 0; index < args.length; index++) {
            if (args[index] === "--remove-label")
              selected.labels = selected.labels.filter(
                (name) => !args[index + 1]!.split(",").includes(name),
              );
            if (args[index] === "--add-label")
              selected.labels.push(...args[index + 1]!.split(","));
          }
          return ok();
        }
        if (action === "comment") {
          selected.comments!.push({
            author: { login: "patchmill" },
            body: argument(args, "--body"),
          });
          return ok();
        }
      }
      if (group === "api" && action === "graphql") {
        const number = Number(
          args.find((value) => value.startsWith("number="))?.slice(7),
        );
        return ok({
          data: {
            repository: {
              nameWithOwner: "acme/patchmill",
              pullRequest: pulls.some((pull) => pull.number === number)
                ? { number }
                : null,
            },
          },
        });
      }
      if (group === "pr" && action === "list")
        return ok(
          pulls
            .filter((pull) => pull.branch === argument(args, "--head"))
            .map(pullPayload),
        );
      if (group === "pr" && action === "view") {
        const pull = pulls.find((pull) => pull.number === Number(args[2]));
        if (!pull) throw new Error("missing pull request");
        return ok(pullPayload(pull));
      }
      if (group === "pr" && action === "create") {
        const branch = argument(args, "--head").split(":").at(-1)!;
        const number = Number(/issue-(\d+)/u.exec(branch)?.[1]);
        const headOid = pushed.get(branch);
        if (!headOid) throw new Error("planning push receipt is missing");
        const pull = {
          number: pulls.length + 10,
          issueNumber: number,
          branch,
          headOid,
          body: argument(args, "--body"),
        };
        pulls.push(pull);
        return ok(pullPayload(pull).url);
      }
      if (group === "pr" && action === "edit") return ok();
      throw new Error(`unexpected host command: gh ${args.join(" ")}`);
    },
  };
}
