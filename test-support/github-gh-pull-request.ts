import assert from "node:assert/strict";
import type {
  CommandResult,
  CommandRunOptions,
  CommandRunner,
} from "../src/command/types.ts";
import type { RepositoryIdentity } from "../src/host/pull-requests.ts";

export type Call = {
  command: string;
  args: string[];
  options?: CommandRunOptions;
};
export type ScriptedResult = CommandResult | Promise<CommandResult>;
export const key = (command: string, args: string[]) =>
  JSON.stringify([command, args]);

export class Runner implements CommandRunner {
  readonly calls: Call[] = [];
  private readonly results: Map<string, ScriptedResult[]>;

  constructor(results: Map<string, ScriptedResult[]>) {
    this.results = results;
  }

  async run(
    command: string,
    args: string[],
    options?: CommandRunOptions,
  ): Promise<CommandResult> {
    this.calls.push({ command, args: [...args], options });
    const result = this.results.get(key(command, args))?.shift();
    assert.ok(result, `unexpected ${command} ${args.join(" ")}`);
    return result;
  }
}

export const ok = (stdout = ""): CommandResult => ({
  code: 0,
  stdout,
  stderr: "",
});
export const target: RepositoryIdentity = {
  provider: "github-gh",
  host: "github.com",
  owner: "acme",
  repository: "project",
};
export const targetPayload = JSON.stringify({
  nameWithOwner: "acme/project",
  url: "https://github.com/acme/project",
});
export const repository = ["repo", "view", "--json", "nameWithOwner,url"];
export const remote = ["remote", "get-url", "--push", "--all", "--", "publish"];
export const remoteRepo = [
  "repo",
  "view",
  "github.com/acme/project",
  "--json",
  "nameWithOwner,url",
];
export const gql =
  "query PatchmillPullRequestExists($owner: String!, $repository: String!, $number: Int!) { repository(owner: $owner, name: $repository) { nameWithOwner pullRequest(number: $number) { number } } }";
export const existence = [
  "api",
  "graphql",
  "--hostname",
  "github.com",
  "--raw-field",
  `query=${gql}`,
  "--field",
  "owner=acme",
  "--field",
  "repository=project",
  "--field",
  "number=42",
];
export const fields =
  "number,url,state,mergeCommit,baseRefName,headRefName,headRefOid,headRepository,body";
export const view = [
  "pr",
  "view",
  "42",
  "--repo",
  "github.com/acme/project",
  "--json",
  fields,
];
export const payload = JSON.stringify({
  number: 42,
  url: "https://github.com/acme/project/pull/42",
  state: "OPEN",
  mergeCommit: null,
  baseRefName: "main",
  headRefName: "agent/change",
  headRefOid: "abc",
  headRepository: { nameWithOwner: "acme/project" },
  body: "body",
});

export function setup(
  extra: [string, string[], ScriptedResult][] = [],
  remoteUrls = "git@github.com:acme/project.git\n",
  remotePayload = targetPayload,
): Runner {
  const entries: [string, ScriptedResult[]][] = [
    [key("gh", repository), [ok(targetPayload)]],
    [key("git", remote), [ok(remoteUrls)]],
    [
      key("gh", remoteRepo),
      Array.from({ length: remoteUrls.trim().split(/\r?\n/u).length }, () =>
        ok(remotePayload),
      ),
    ],
  ];
  for (const [command, args, result] of extra) {
    const found = entries.find(([entry]) => entry === key(command, args));
    if (found) found[1].push(result);
    else entries.push([key(command, args), [result]]);
  }
  return new Runner(new Map(entries));
}
